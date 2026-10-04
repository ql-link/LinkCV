"""Reconcile completed dataset documents with their LinkRag copies.

The loop compares ``user_dataset`` (the truth for existence, owner and content
revision) with ``user_dataset_rag_sync`` and repairs every difference: create
missing records, upload pending revisions, poll parsing, and delete RAG files
whose dataset was removed or replaced. Existing upload, replace and delete
paths are untouched; the RAG copy follows them within one sync interval.

Owner row locks serialize remote mutations with account deletion. Mapping
writes use independent, conditional transactions under that owner lock.
Each state write is conditional on the record's previous status and revision
so a stale step can never overwrite newer progress.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from linkresume.core.database import utc_now
from linkresume.integrations.linkrag_client import LinkRagClient, LinkRagError
from linkresume.modules.datasets.models import UserDataset, UserDatasetRagSync
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkresume.services.dataset_content_service import content_key, read_markdown

logger = logging.getLogger(__name__)

MAX_BACKOFF_MINUTES = 60

# Local image references are rejected by LinkRag's Markdown upload (it would
# require an asset bundle). Remote, data and anchor targets are kept.
_LOCAL_TARGET = r"(?!\s*<?(?:https?:|data:|//|#))"
_INLINE_IMAGE = re.compile(r"!\[(?:\\.|[^\]])*\]\(" + _LOCAL_TARGET + r"(?:\\.|[^)])*\)")
_WIKI_IMAGE = re.compile(r"!\[\[[^\]]+\]\]")
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_IMG_SRC = re.compile(r"""\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.IGNORECASE)
_REFERENCE_DEFINITION = re.compile(r"(?m)^ {0,3}\[([^\]]+)\]:\s*(\S+).*$")
_REFERENCE_IMAGE = re.compile(r"!\[([^\]]*)\]\[([^\]]*)\]")
_REMOTE = re.compile(r"^<?(?:https?:|data:|//|#)", re.IGNORECASE)


def strip_local_images(markdown: str) -> str:
    """Drop image syntax that points at local files; other content is kept."""
    local_labels = {
        match.group(1).strip().lower()
        for match in _REFERENCE_DEFINITION.finditer(markdown)
        if not _REMOTE.match(match.group(2))
    }

    def reference(match: re.Match[str]) -> str:
        label = (match.group(2) or match.group(1)).strip().lower()
        return "" if label in local_labels else match.group(0)

    text = _INLINE_IMAGE.sub("", markdown)
    text = _WIKI_IMAGE.sub("", text)
    def tag(match: re.Match[str]) -> str:
        source = _IMG_SRC.search(match.group(0))
        target = next((group for group in source.groups() if group), "") if source else ""
        return match.group(0) if not target or _REMOTE.match(target.strip()) else ""

    text = _IMG_TAG.sub(tag, text)
    return _REFERENCE_IMAGE.sub(reference, text)


@dataclass(frozen=True)
class _Work:
    record_id: int
    dataset_id: int
    user_id: int
    status: str
    content_revision: int
    rag_file_id: int | None
    attempt_count: int


class RagSyncService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        storage,
        client: LinkRagClient,
        batch_size: int,
        max_attempts: int,
        markdown_max_bytes: int,
        now: Callable[[], datetime] = utc_now,
    ) -> None:
        self._session_factory = session_factory
        self._storage = storage
        self._client = client
        self._batch_size = batch_size
        self._max_attempts = max_attempts
        self._markdown_max_bytes = markdown_max_bytes
        self._now = now
        self._users_with_dataset: set[int] = set()

    # -- reconciliation ----------------------------------------------------

    def run_once(self) -> int:
        """Run one bounded reconciliation round; returns records touched."""
        touched = self._create_missing()
        touched += self._mark_revision_changes()
        for work in self._orphans():
            touched += self._delete_orphan(work)
        for work in self._due("pending"):
            touched += self._upload(work)
        for work in self._due("parsing"):
            touched += self._poll(work)
        return touched

    def reset_failed(self) -> int:
        with self._session_factory() as db:
            result = db.execute(
                update(UserDatasetRagSync)
                .where(UserDatasetRagSync.status == "failed")
                .values(status="pending", attempt_count=0, next_attempt_at=None, last_error=None)
                .execution_options(synchronize_session=False)
            )
            db.commit()
            return result.rowcount or 0

    def _completed_documents(self):
        return (
            select(UserDataset.id, UserDataset.user_id, UserDataset.content_revision)
            .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
            .join(User, User.id == UserDataset.user_id)
            .where(
                User.deletion_requested_at.is_(None),
                UserDataset.asset_kind == "document",
                DocumentParseTask.user_id == UserDataset.user_id,
                DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                DocumentParseTask.parse_status == "succeeded",
            )
        )

    def _create_missing(self) -> int:
        with self._session_factory() as db:
            rows = db.execute(
                self._completed_documents()
                .outerjoin(UserDatasetRagSync, UserDatasetRagSync.dataset_id == UserDataset.id)
                .where(UserDatasetRagSync.id.is_(None))
                .order_by(UserDataset.id)
                .limit(self._batch_size)
            ).all()
        created = 0
        for dataset_id, user_id, revision in rows:
            with self._session_factory() as db:
                user = db.scalar(select(User).where(User.id == user_id).with_for_update())
                if user is None or user.deletion_requested_at is not None:
                    continue
                # Recheck after the owner lock: the batch snapshot may predate cleanup.
                document = db.execute(self._completed_documents().where(UserDataset.id == dataset_id)).first()
                if document is None:
                    continue
                revision = document.content_revision
                db.add(
                    UserDatasetRagSync(
                        dataset_id=dataset_id,
                        user_id=user_id,
                        status="pending",
                        content_revision=revision,
                        attempt_count=0,
                    )
                )
                try:
                    db.commit()
                    created += 1
                except IntegrityError:
                    # Another reconciler created it first.
                    db.rollback()
        return created

    def _mark_revision_changes(self) -> int:
        """Coordinate revision changes with uploads and account cleanup."""
        with self._session_factory() as db:
            rows = db.execute(
                select(UserDatasetRagSync.id, UserDatasetRagSync.user_id)
                .join(UserDataset, UserDataset.id == UserDatasetRagSync.dataset_id)
                .where(UserDataset.content_revision != UserDatasetRagSync.content_revision)
                .limit(self._batch_size)
            ).all()
        changed = 0
        for record_id, user_id in rows:
            with self._session_factory() as db:
                user = db.scalar(select(User).where(User.id == user_id).with_for_update())
                if user is None or user.deletion_requested_at is not None:
                    continue
                row = db.execute(select(UserDatasetRagSync, UserDataset.content_revision)
                    .join(UserDataset, UserDataset.id == UserDatasetRagSync.dataset_id)
                    .where(UserDatasetRagSync.id == record_id)).first()
                if row is None:
                    continue
                record, revision = row
                if record.content_revision == revision:
                    continue
                record.status = "pending"
                record.content_revision = revision
                record.attempt_count = 0
                record.next_attempt_at = record.last_error = None
                db.commit()
                changed += 1
        return changed

    def _orphans(self) -> list[_Work]:
        """Records whose dataset is gone or is no longer a completed document."""
        completed = self._completed_documents().subquery()
        with self._session_factory() as db:
            rows = db.scalars(
                select(UserDatasetRagSync)
                .outerjoin(
                    completed,
                    and_(
                        completed.c.id == UserDatasetRagSync.dataset_id,
                        completed.c.user_id == UserDatasetRagSync.user_id,
                    ),
                )
                .where(completed.c.id.is_(None))
                .order_by(UserDatasetRagSync.id)
                .limit(self._batch_size)
            ).all()
            return [_work(row) for row in rows]

    def _due(self, status: str) -> list[_Work]:
        now = self._now()
        with self._session_factory() as db:
            rows = db.scalars(
                select(UserDatasetRagSync)
                .join(User, User.id == UserDatasetRagSync.user_id)
                .where(
                    User.deletion_requested_at.is_(None),
                    UserDatasetRagSync.status == status,
                    (UserDatasetRagSync.next_attempt_at.is_(None))
                    | (UserDatasetRagSync.next_attempt_at <= now),
                )
                .order_by(UserDatasetRagSync.id)
                .limit(self._batch_size)
            ).all()
            return [_work(row) for row in rows]

    # -- steps ---------------------------------------------------------------

    def _delete_orphan(self, work: _Work) -> int:
        with self._session_factory() as db:
            user = db.scalar(select(User).where(User.id == work.user_id).with_for_update())
            if user is not None and user.deletion_requested_at is not None:
                return 0  # The durable deletion job owns this file now.
            return self._delete_orphan_active(work)

    def _delete_orphan_active(self, work: _Work) -> int:
        """Delete the RAG copy of a dataset that no longer qualifies.

        A dataset that is merely re-parsing (replace in flight) also lands
        here; its record is recreated once parsing succeeds again.
        """
        if work.rag_file_id is not None:
            try:
                self._client.delete_file(work.user_id, work.rag_file_id)
            except LinkRagError as error:
                self._log("delete", work, error)
                return 0
        with self._session_factory() as db:
            db.execute(
                delete(UserDatasetRagSync).where(
                    UserDatasetRagSync.id == work.record_id,
                    _same_file(work),
                )
            )
            db.commit()
        return 1

    def _upload(self, work: _Work) -> int:
        # Keep the owner locked through upload and recording its returned file
        # ID. Even if a Redis lease expires, account cleanup cannot pass this
        # upload and miss a late index file. The mapping has no user FK and its
        # bounded transition uses a separate session without taking this lock.
        with self._session_factory() as owner_db:
            user = owner_db.scalar(select(User).where(User.id == work.user_id).with_for_update())
            if user is None or user.deletion_requested_at is not None or user.status != 1:
                return 0
            current = owner_db.scalar(select(UserDatasetRagSync).where(UserDatasetRagSync.id == work.record_id))
            if current is None or _work(current) != work:
                return 0  # Another cycle already changed this batch snapshot.
            return self._upload_active(work)

    def _upload_active(self, work: _Work) -> int:
        if work.rag_file_id is not None:
            # A replaced revision: remove the stale copy before uploading.
            try:
                self._client.delete_file(work.user_id, work.rag_file_id)
            except LinkRagError as error:
                self._log("delete", work, error)
                return self._fail(work, error.reason)
            if not self._transition(work, rag_file_id=None, synced_revision=None):
                return 0
            work = _Work(**{**work.__dict__, "rag_file_id": None})
        markdown = self._read(work)
        if markdown is None:
            return self._fail(work, "CONTENT_UNAVAILABLE")
        markdown = strip_local_images(markdown).strip()
        if not markdown:
            return self._fail(work, "CONTENT_EMPTY", final=True)
        try:
            if work.user_id not in self._users_with_dataset:
                self._client.ensure_default_dataset(work.user_id)
                self._users_with_dataset.add(work.user_id)
            file_id = self._client.upload_markdown(
                work.user_id,
                filename=f"{work.dataset_id}.md",
                markdown=markdown,
                external_ref=f"dataset:{work.dataset_id}:{work.content_revision}",
            )
        except LinkRagError as error:
            self._log("upload", work, error)
            return self._fail(work, error.reason)
        if not self._transition(
            work,
            status="parsing",
            rag_file_id=file_id,
            synced_revision=work.content_revision,
            next_attempt_at=None,
            last_error=None,
        ):
            # The revision moved on while uploading; drop the orphaned copy.
            try:
                self._client.delete_file(work.user_id, file_id)
            except LinkRagError as error:
                self._log("delete", work, error)
        return 1

    def _poll(self, work: _Work) -> int:
        with self._session_factory() as db:
            user = db.scalar(select(User).where(User.id == work.user_id).with_for_update())
            if user is None or user.deletion_requested_at is not None:
                return 0
            return self._poll_active(work)

    def _poll_active(self, work: _Work) -> int:
        if work.rag_file_id is None:
            return int(self._transition(work, status="pending"))
        try:
            status = self._client.file_status(work.user_id, work.rag_file_id)
        except LinkRagError as error:
            if error.not_found:
                return int(self._transition(work, status="pending", rag_file_id=None, synced_revision=None))
            self._log("status", work, error)
            return 0
        if status.ready:
            return int(self._transition(work, status="ready", last_error=None))
        if status.failed:
            try:
                self._client.delete_file(work.user_id, work.rag_file_id)
            except LinkRagError as error:
                self._log("delete", work, error)
                return 0
            if not self._transition(work, rag_file_id=None, synced_revision=None):
                return 0
            return self._fail(_Work(**{**work.__dict__, "rag_file_id": None}), "RAG_PARSE_FAILED")
        return 0

    # -- helpers -------------------------------------------------------------

    def _read(self, work: _Work) -> str | None:
        with self._session_factory() as db:
            row = db.execute(
                select(UserDataset, DocumentParseTask)
                .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
                .where(
                    UserDataset.id == work.dataset_id,
                    UserDataset.user_id == work.user_id,
                    DocumentParseTask.user_id == work.user_id,
                    DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                )
            ).one_or_none()
            if row is None or row[0].content_revision != work.content_revision:
                return None
            dataset, task = row
            try:
                key = content_key(dataset, task)
            except Exception:
                return None
        try:
            return read_markdown(self._storage, key, self._markdown_max_bytes)
        except Exception:
            logger.warning(
                "linkrag sync content read failed",
                extra={"dataset_id": work.dataset_id, "error_code": "CONTENT_UNAVAILABLE"},
            )
            return None

    def _fail(self, work: _Work, reason: str, *, final: bool = False) -> int:
        attempts = work.attempt_count + 1
        exhausted = final or attempts >= self._max_attempts
        backoff = timedelta(minutes=min(2 ** (attempts - 1), MAX_BACKOFF_MINUTES))
        values: dict[str, object] = {
            "attempt_count": attempts,
            "last_error": reason[:64],
            "status": "failed" if exhausted else "pending",
            "next_attempt_at": None if exhausted else self._now() + backoff,
        }
        return int(self._transition(work, **values))

    def _transition(self, work: _Work, **values: object) -> bool:
        with self._session_factory() as db:
            result = db.execute(
                update(UserDatasetRagSync)
                .where(
                    UserDatasetRagSync.id == work.record_id,
                    UserDatasetRagSync.status == work.status,
                    UserDatasetRagSync.content_revision == work.content_revision,
                    _same_file(work),
                )
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            db.commit()
            return result.rowcount == 1

    @staticmethod
    def _log(step: str, work: _Work, error: LinkRagError) -> None:
        logger.warning(
            "linkrag sync step failed",
            extra={
                "dataset_id": work.dataset_id,
                "error_code": error.reason,
                "summary": f"step={step} status={error.status}",
            },
        )


def _same_file(work: _Work):
    column = UserDatasetRagSync.rag_file_id
    return column.is_(None) if work.rag_file_id is None else column == work.rag_file_id


def _work(row: UserDatasetRagSync) -> _Work:
    return _Work(
        record_id=row.id,
        dataset_id=row.dataset_id,
        user_id=row.user_id,
        status=row.status,
        content_revision=row.content_revision,
        rag_file_id=row.rag_file_id,
        attempt_count=row.attempt_count,
    )


def ready_files(
    db: Session, *, user_id: int, dataset_ids: list[int] | None
) -> dict[int, tuple[int, int]]:
    """``rag_file_id -> (dataset_id, content_revision)`` for ready records.

    ``dataset_ids=None`` means every dataset of the user. Only records whose
    synced revision equals the dataset's current revision are returned, so a
    replaced dataset never recalls its previous content.
    """
    statement = (
        select(
            UserDatasetRagSync.rag_file_id,
            UserDatasetRagSync.dataset_id,
            UserDatasetRagSync.synced_revision,
        )
        .join(UserDataset, UserDataset.id == UserDatasetRagSync.dataset_id)
        .where(
            UserDatasetRagSync.user_id == user_id,
            UserDataset.user_id == user_id,
            UserDatasetRagSync.status == "ready",
            UserDatasetRagSync.rag_file_id.is_not(None),
            UserDatasetRagSync.synced_revision == UserDataset.content_revision,
        )
        .order_by(UserDataset.created_at.desc(), UserDataset.id.desc())
    )
    if dataset_ids is not None:
        if not dataset_ids:
            return {}
        statement = statement.where(UserDatasetRagSync.dataset_id.in_(dataset_ids))
    return {
        int(file_id): (int(dataset_id), int(revision))
        for file_id, dataset_id, revision in db.execute(statement.limit(100)).all()
    }


@dataclass(frozen=True)
class RagSnippet:
    dataset_id: int
    title: str
    version: str
    text: str
    score: float


def recall_dataset_snippets(
    db: Session,
    client: LinkRagClient,
    *,
    user_id: int,
    query: str,
    dataset_ids: list[int] | None,
    limit: int,
) -> tuple[list[RagSnippet], set[int]]:
    """Recall from ready datasets; returns ``(snippets, covered_dataset_ids)``.

    ``covered_dataset_ids`` are the datasets that went through RAG, so callers
    fall back to local matching only for the rest. Every hit is re-checked
    against LinkResume's own records (owner, ready revision) before use, so a
    misbehaving RAG service cannot surface another user's or a stale text.
    Raises ``LinkRagError`` on any RAG failure; callers then fall back fully.
    """
    # Local import keeps this service free of a hard dependency cycle.
    from linkresume.services.dataset_content_service import source_version

    files = ready_files(db, user_id=user_id, dataset_ids=dataset_ids)
    if not files:
        return [], set()
    hits = client.recall(user_id, query=query, file_ids=list(files), top_k=limit)
    covered = {dataset_id for dataset_id, _ in files.values()}
    datasets = {
        row.id: row
        for row in db.scalars(
            select(UserDataset).where(
                UserDataset.user_id == user_id, UserDataset.id.in_(covered)
            )
        )
    }
    snippets: list[RagSnippet] = []
    for hit in hits:
        mapped = files.get(hit.file_id)
        if mapped is None:
            continue
        dataset_id, revision = mapped
        dataset = datasets.get(dataset_id)
        if dataset is None or dataset.content_revision != revision or not hit.content.strip():
            continue
        snippets.append(
            RagSnippet(
                dataset_id=dataset_id,
                title=dataset.file_name,
                version=source_version(dataset),
                text=hit.content,
                score=hit.score,
            )
        )
        if len(snippets) >= limit:
            break
    return snippets, covered
