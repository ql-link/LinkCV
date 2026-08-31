from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic

from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from linkcv.core.config import Settings
from linkcv.core.database import utc_now
from linkcv.core.storage import AssetStorage
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownConverter,
)
from linkcv.modules.datasets.models import UserDataset
from linkcv.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkcv.workers.resume_import_worker import (
    UNLOCK_SCRIPT,
    WorkerDependencyUnavailable,
    WorkerTaskRetryable,
    _read_storage_object,
)

logger = logging.getLogger(__name__)
CONTENT_TYPES = {
    "md": "text/markdown",
    "txt": "text/plain",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}
FAILURE_REASON_BY_CODE = {
    "UNSUPPORTED_IMPORT_FORMAT": "format_unsupported",
    "IMPORT_CONTENT_INVALID": "content_invalid",
    "IMPORT_FILE_TOO_LARGE": "size_exceeded",
    "DOCUMENT_CONVERSION_UNAVAILABLE": "service_unavailable",
    "DOCUMENT_CONVERSION_TIMEOUT": "timeout",
    "IMPORT_DEADLINE_EXCEEDED": "timeout",
}

DATASET_DISPATCH_BATCH_SIZE = 100
DEFAULT_DATASET_DISPATCH_SCAN_SECONDS = 5
DEFAULT_DATASET_REDISPATCH_AFTER_SECONDS = 30
DEFAULT_DATASET_PARSE_STALE_SECONDS = 240
DEFAULT_DATASET_PARSE_MAX_ATTEMPTS = 3
DEFAULT_DATASET_UPLOAD_RESERVATION_TTL_SECONDS = 86400


@dataclass(frozen=True, slots=True)
class _DatasetParseClaim:
    task: DocumentParseTask
    attempt: int


@dataclass(frozen=True, slots=True)
class _UploadReservation:
    task_id: int
    user_id: int
    object_name: str


PublishDatasetTask = Callable[[int], Awaitable[bool]]


class DatasetParseProcessor:
    """Consume and recover dataset parse tasks.

    Dataset tasks use the database as the source of truth.  Once the migration
    fields are present, a message is only useful when it wins the conditional
    ``queued -> processing`` update.  Redis remains in the legacy compatibility
    path only; it is deliberately not used to make the new claim safe.
    """

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        storage: AssetStorage,
        redis,
        document_converter: DocumentMarkdownConverter,
        settings: Settings,
    ) -> None:
        self._session_factory = session_factory
        self._storage = storage
        self._redis = redis
        self._document_converter = document_converter
        self._settings = settings

    @staticmethod
    def _lock_key(parse_task_id: int) -> str:
        return f"dataset-parse:worker-lock:v1:{parse_task_id}"

    @staticmethod
    def _uses_attempt_fields() -> bool:
        """Return whether WP1's task columns are available in this process."""
        return all(
            hasattr(DocumentParseTask, field)
            for field in ("parse_attempt_count", "last_dispatched_at")
        )

    def _setting(self, name: str, fallback: int) -> int:
        value = getattr(self._settings, name, fallback)
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback

    @property
    def _dispatch_scan_seconds(self) -> int:
        return max(
            1,
            self._setting(
                "dataset_dispatch_scan_seconds",
                DEFAULT_DATASET_DISPATCH_SCAN_SECONDS,
            ),
        )

    @property
    def _redispatch_after_seconds(self) -> int:
        return max(
            1,
            self._setting(
                "dataset_redispatch_after_seconds",
                DEFAULT_DATASET_REDISPATCH_AFTER_SECONDS,
            ),
        )

    @property
    def _parse_stale_seconds(self) -> int:
        # The fallback keeps an older checkout usable until WP1's config lands.
        return max(
            1,
            self._setting(
                "dataset_parse_stale_seconds",
                getattr(
                    self._settings,
                    "resume_import_parse_stale_seconds",
                    DEFAULT_DATASET_PARSE_STALE_SECONDS,
                ),
            ),
        )

    @property
    def _parse_max_attempts(self) -> int:
        return max(
            1,
            self._setting(
                "dataset_parse_max_attempts",
                DEFAULT_DATASET_PARSE_MAX_ATTEMPTS,
            ),
        )

    @property
    def _upload_reservation_ttl_seconds(self) -> int:
        return max(
            1,
            self._setting(
                "dataset_upload_reservation_ttl_seconds",
                DEFAULT_DATASET_UPLOAD_RESERVATION_TTL_SECONDS,
            ),
        )

    async def _acquire_lock(self, parse_task_id: int, token: str) -> bool:
        try:
            return bool(
                await asyncio.to_thread(
                    self._redis.set,
                    self._lock_key(parse_task_id),
                    token,
                    nx=True,
                    ex=getattr(
                        self._settings,
                        "resume_import_worker_lock_seconds",
                        self._parse_stale_seconds,
                    ),
                )
            )
        except Exception as error:
            raise WorkerDependencyUnavailable("Redis lock unavailable") from error

    async def _release_lock(self, parse_task_id: int, token: str) -> None:
        try:
            await asyncio.to_thread(
                self._redis.eval,
                UNLOCK_SCRIPT,
                1,
                self._lock_key(parse_task_id),
                token,
            )
        except Exception:
            logger.warning(
                "dataset parse worker lock release failed",
                extra={"parse_task_id": parse_task_id},
                exc_info=True,
            )

    def _load_legacy_task(self, parse_task_id: int) -> DocumentParseTask | None:
        """Load the pre-0043 processing task used by old local fixtures."""
        try:
            with self._session_factory() as db:
                task = db.scalar(
                    select(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == parse_task_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                    )
                    .with_for_update()
                )
                if task is None:
                    return None
                if task.upload_status == "uploading" and task.parse_status is None:
                    created_at = task.created_at
                    if created_at.tzinfo is None:
                        created_at = created_at.replace(tzinfo=timezone.utc)
                    elapsed_ms = round((utc_now() - created_at).total_seconds() * 1000)
                    task.upload_status = "succeeded"
                    task.upload_duration_ms = min(max(0, elapsed_ms), 2**32 - 1)
                    task.parse_status = "processing"
                    db.commit()
                elif (
                    task.upload_status != "succeeded"
                    or task.parse_status != "processing"
                ):
                    return None
                db.expunge(task)
                return task
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def _claim_queued_task(self, parse_task_id: int) -> _DatasetParseClaim | None:
        """Atomically claim one queued task and return its new attempt version."""
        if not self._uses_attempt_fields():
            task = self._load_legacy_task(parse_task_id)
            return None if task is None else _DatasetParseClaim(task=task, attempt=0)

        now = utc_now()
        try:
            with self._session_factory() as db:
                result = db.execute(
                    update(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == parse_task_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.upload_status == "succeeded",
                        DocumentParseTask.parse_status == "queued",
                    )
                    .values(
                        parse_status="processing",
                        parse_attempt_count=DocumentParseTask.parse_attempt_count + 1,
                        converted_object_name=None,
                        parse_duration_ms=None,
                        failure_reason=None,
                        updated_at=now,
                    )
                    .execution_options(synchronize_session=False)
                )
                if result.rowcount != 1:
                    db.rollback()
                    return None
                task = db.scalar(
                    select(DocumentParseTask).where(
                        DocumentParseTask.id == parse_task_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                    )
                )
                if task is None:
                    db.rollback()
                    return None
                attempt = int(task.parse_attempt_count)
                db.expunge(task)
                db.commit()
                return _DatasetParseClaim(task=task, attempt=attempt)
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    # Kept as a small compatibility seam for callers/tests that used the old
    # private helper.  New processing always goes through _claim_queued_task.
    def _load_task(self, parse_task_id: int) -> DocumentParseTask | None:
        claim = self._claim_queued_task(parse_task_id)
        return None if claim is None else claim.task

    def _mark_failed(
        self,
        parse_task_id: int,
        started: float | None,
        failure_reason: str,
        *,
        attempt: int | None = None,
    ) -> bool:
        """Conditionally mark the current attempt failed.

        Returning ``False`` means that a stale attempt lost ownership; callers
        must not touch the current task in that case.
        """
        try:
            with self._session_factory() as db:
                if started is None:
                    task = db.scalar(
                        select(DocumentParseTask.created_at).where(
                            DocumentParseTask.id == parse_task_id,
                            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        )
                    )
                    if task is None:
                        return False
                    created_at = task
                    if created_at.tzinfo is None:
                        created_at = created_at.replace(tzinfo=timezone.utc)
                    elapsed_ms = round((utc_now() - created_at).total_seconds() * 1000)
                else:
                    elapsed_ms = round((monotonic() - started) * 1000)
                conditions = [
                    DocumentParseTask.id == parse_task_id,
                    DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                    DocumentParseTask.upload_status == "succeeded",
                    DocumentParseTask.parse_status == "processing",
                ]
                if self._uses_attempt_fields() and attempt is not None:
                    conditions.append(DocumentParseTask.parse_attempt_count == attempt)
                result = db.execute(
                    update(DocumentParseTask)
                    .where(*conditions)
                    .values(
                        parse_status="failed",
                        failure_reason=failure_reason,
                        parse_duration_ms=min(max(0, elapsed_ms), 2**32 - 1),
                        updated_at=utc_now(),
                    )
                    .execution_options(synchronize_session=False)
                )
                db.commit()
                return result.rowcount == 1
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def _requeue_attempt(self, parse_task_id: int, attempt: int) -> bool:
        """Return a still-owned attempt to queued for a later dispatch."""
        if not self._uses_attempt_fields():
            return False
        try:
            with self._session_factory() as db:
                result = db.execute(
                    update(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == parse_task_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.upload_status == "succeeded",
                        DocumentParseTask.parse_status == "processing",
                        DocumentParseTask.parse_attempt_count == attempt,
                    )
                    .values(
                        parse_status="queued",
                        converted_object_name=None,
                        parse_duration_ms=None,
                        failure_reason=None,
                        last_dispatched_at=None,
                        updated_at=utc_now(),
                    )
                    .execution_options(synchronize_session=False)
                )
                db.commit()
                return result.rowcount == 1
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def mark_retry_exhausted(self, parse_task_id: int) -> None:
        """Best-effort legacy hook; new dataset attempts are lease-recovered.

        The message envelope does not carry an attempt version, so marking a
        task failed here could let a delayed broker retry fail a newer attempt.
        The recovery scanner owns that transition for the new schema.
        """
        if self._uses_attempt_fields():
            logger.warning(
                "dataset retry exhausted without attempt version; lease recovery will decide",
                extra={"parse_task_id": parse_task_id},
            )
            return
        self._mark_failed(parse_task_id, None, "internal_error")

    def _persist_success(
        self,
        *,
        parse_task_id: int,
        user_id: int,
        markdown: str,
        started: float,
        attempt: int | None = None,
    ) -> bool:
        converted_suffix = (
            f"{parse_task_id}-{attempt}.md"
            if self._uses_attempt_fields() and attempt is not None
            else f"{parse_task_id}.md"
        )
        converted_object_name = (
            f"users/{user_id}/datasets/converted/{converted_suffix}"
        )
        persistence_failed = False
        try:
            self._storage.upload(
                converted_object_name,
                markdown.encode("utf-8"),
                "text/markdown",
            )
        except Exception:
            logger.warning(
                "dataset converted markdown persistence failed",
                extra={"parse_task_id": parse_task_id},
                exc_info=True,
            )
            persistence_failed = True
            converted_object_name = None

        if persistence_failed:
            if self._uses_attempt_fields() and attempt is not None:
                if attempt < self._parse_max_attempts:
                    self._requeue_attempt(parse_task_id, attempt)
                else:
                    self._mark_failed(
                        parse_task_id,
                        started,
                        "service_unavailable",
                        attempt=attempt,
                    )
            else:
                self._mark_failed(parse_task_id, started, "service_unavailable")
            return False

        owned_attempt = False
        try:
            with self._session_factory() as db:
                conditions = [
                    DocumentParseTask.id == parse_task_id,
                    DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                    DocumentParseTask.user_id == user_id,
                    DocumentParseTask.upload_status == "succeeded",
                    DocumentParseTask.parse_status == "processing",
                ]
                if self._uses_attempt_fields() and attempt is not None:
                    conditions.append(DocumentParseTask.parse_attempt_count == attempt)
                result = db.execute(
                    update(DocumentParseTask)
                    .where(*conditions)
                    .values(
                        converted_object_name=converted_object_name,
                        parse_status="succeeded",
                        failure_reason=None,
                        parse_duration_ms=min(
                            max(0, round((monotonic() - started) * 1000)),
                            2**32 - 1,
                        ),
                        updated_at=utc_now(),
                    )
                    .execution_options(synchronize_session=False)
                )
                db.commit()
                owned_attempt = result.rowcount == 1
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error
        if not owned_attempt:
            # Attempt-scoped object names prevent a late worker from overwriting
            # the current result. Remove its unreferenced object when ownership
            # was already reclaimed.
            try:
                self._storage.delete(converted_object_name)
            except Exception:
                logger.warning(
                    "dataset stale converted object cleanup failed",
                    extra={
                        "parse_task_id": parse_task_id,
                        "parse_attempt": attempt,
                    },
                    exc_info=True,
                )
        return owned_attempt

    async def process(self, *, parse_task_id: int) -> None:
        started = monotonic()
        claim = self._claim_queued_task(parse_task_id)
        if claim is None:
            # A duplicate message, a terminal task, or a task reclaimed by a
            # newer attempt is safely acknowledged by the consumer.
            return
        task = claim.task
        attempt = claim.attempt
        token: str | None = None

        # Old schemas need their Redis guard because they have no conditional
        # attempt update.  The migrated path intentionally does not acquire it.
        if not self._uses_attempt_fields():
            token = secrets.token_urlsafe(24)
            if not await self._acquire_lock(parse_task_id, token):
                raise WorkerDependencyUnavailable("dataset parse lock is already held")
        try:
            try:
                content = await asyncio.to_thread(
                    _read_storage_object,
                    self._storage,
                    task.object_name,
                )
            except Exception as error:
                if self._uses_attempt_fields():
                    if attempt < self._parse_max_attempts:
                        self._requeue_attempt(parse_task_id, attempt)
                    else:
                        self._mark_failed(
                            parse_task_id,
                            started,
                            "service_unavailable",
                            attempt=attempt,
                        )
                raise WorkerTaskRetryable("source object unavailable") from error

            try:
                result = await self._document_converter.convert(
                    filename=task.file_name,
                    content_type=CONTENT_TYPES[task.file_format],
                    content=content,
                    operation_id=str(task.id),
                    request_pdf_layout=False,
                    deadline_monotonic=(
                        monotonic()
                        + self._settings.resume_import_parse_deadline_seconds
                    ),
                )
            except (DocumentConversionFailure, UnicodeDecodeError) as error:
                code = getattr(error, "code", "IMPORT_CONTENT_INVALID")
                reason = FAILURE_REASON_BY_CODE.get(code, "internal_error")
                retryable = (
                    isinstance(error, DocumentConversionFailure)
                    and error.status_code >= 500
                ) or reason in {"service_unavailable", "timeout"}
                if (
                    self._uses_attempt_fields()
                    and retryable
                    and attempt < self._parse_max_attempts
                ):
                    self._requeue_attempt(parse_task_id, attempt)
                else:
                    self._mark_failed(
                        parse_task_id,
                        started,
                        reason,
                        attempt=attempt if self._uses_attempt_fields() else None,
                    )
                return
            except Exception as error:
                # Unexpected converter failures are transient from the task
                # state machine's perspective; bounded broker retry and lease
                # recovery still apply.
                if self._uses_attempt_fields():
                    if attempt < self._parse_max_attempts:
                        self._requeue_attempt(parse_task_id, attempt)
                    else:
                        self._mark_failed(
                            parse_task_id,
                            started,
                            "service_unavailable",
                            attempt=attempt,
                        )
                raise WorkerTaskRetryable("document conversion unavailable") from error

            if self._uses_attempt_fields():
                await asyncio.to_thread(
                    self._persist_success,
                    parse_task_id=parse_task_id,
                    user_id=task.user_id,
                    markdown=result.markdown,
                    started=started,
                    attempt=attempt,
                )
            else:
                self._persist_success(
                    parse_task_id=parse_task_id,
                    user_id=task.user_id,
                    markdown=result.markdown,
                    started=started,
                    attempt=None,
                )
        finally:
            if token is not None:
                await self._release_lock(parse_task_id, token)

    def _dispatch_candidates(self) -> list[int]:
        if not self._uses_attempt_fields():
            return []
        cutoff = utc_now() - timedelta(seconds=self._redispatch_after_seconds)
        try:
            with self._session_factory() as db:
                return list(
                    db.scalars(
                        select(DocumentParseTask.id)
                        .where(
                            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                            DocumentParseTask.upload_status == "succeeded",
                            DocumentParseTask.parse_status == "queued",
                            or_(
                                DocumentParseTask.last_dispatched_at.is_(None),
                                DocumentParseTask.last_dispatched_at < cutoff,
                            ),
                        )
                        .order_by(DocumentParseTask.id)
                        .limit(DATASET_DISPATCH_BATCH_SIZE)
                    ).all()
                )
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def _mark_dispatched(self, parse_task_id: int, dispatched_at: datetime) -> bool:
        try:
            with self._session_factory() as db:
                result = db.execute(
                    update(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == parse_task_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.upload_status == "succeeded",
                        DocumentParseTask.parse_status == "queued",
                    )
                    .values(last_dispatched_at=dispatched_at)
                    .execution_options(synchronize_session=False)
                )
                db.commit()
                return result.rowcount == 1
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def _stale_processing_tasks(self) -> list[tuple[int, int, datetime]]:
        if not self._uses_attempt_fields():
            return []
        cutoff = utc_now() - timedelta(seconds=self._parse_stale_seconds)
        try:
            with self._session_factory() as db:
                rows = db.execute(
                    select(
                        DocumentParseTask.id,
                        DocumentParseTask.parse_attempt_count,
                        DocumentParseTask.updated_at,
                    ).where(
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.upload_status == "succeeded",
                        DocumentParseTask.parse_status == "processing",
                        DocumentParseTask.updated_at < cutoff,
                    )
                ).all()
                return [
                    (int(task_id), int(attempt_count or 0), updated_at)
                    for task_id, attempt_count, updated_at in rows
                ]
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def recover_stale_processing(self) -> int:
        """Requeue stale processing tasks or terminally fail exhausted ones."""
        stale_tasks = self._stale_processing_tasks()
        if not stale_tasks:
            return 0
        now = utc_now()
        cutoff = now - timedelta(seconds=self._parse_stale_seconds)
        recovered = 0
        try:
            with self._session_factory() as db:
                for task_id, attempt, updated_at in stale_tasks:
                    if updated_at.tzinfo is None:
                        updated_at = updated_at.replace(tzinfo=timezone.utc)
                    elapsed_ms = min(
                        max(0, round((now - updated_at).total_seconds() * 1000)),
                        2**32 - 1,
                    )
                    conditions = [
                        DocumentParseTask.id == task_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.upload_status == "succeeded",
                        DocumentParseTask.parse_status == "processing",
                        DocumentParseTask.parse_attempt_count == attempt,
                        DocumentParseTask.updated_at < cutoff,
                    ]
                    if attempt >= self._parse_max_attempts:
                        values = {
                            "parse_status": "failed",
                            "parse_duration_ms": elapsed_ms,
                            "failure_reason": "timeout",
                            "updated_at": now,
                        }
                    else:
                        values = {
                            "parse_status": "queued",
                            "converted_object_name": None,
                            "parse_duration_ms": None,
                            "failure_reason": None,
                            "last_dispatched_at": None,
                            "updated_at": now,
                        }
                    result = db.execute(
                        update(DocumentParseTask)
                        .where(*conditions)
                        .values(**values)
                        .execution_options(synchronize_session=False)
                    )
                    recovered += int(result.rowcount == 1)
                db.commit()
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error
        return recovered

    @staticmethod
    def _safe_source_object(user_id: int, object_name: str) -> bool:
        prefix = f"users/{user_id}/datasets/"
        return object_name.startswith(prefix) and not object_name.startswith(
            f"{prefix}converted/"
        )

    def _expire_uploading_reservations(self) -> list[_UploadReservation]:
        if not self._uses_attempt_fields():
            return []
        cutoff = utc_now() - timedelta(seconds=self._upload_reservation_ttl_seconds)
        now = utc_now()
        try:
            with self._session_factory() as db:
                rows = db.execute(
                    select(
                        DocumentParseTask.id,
                        DocumentParseTask.user_id,
                        DocumentParseTask.object_name,
                        DocumentParseTask.created_at,
                    ).where(
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.upload_status == "uploading",
                        DocumentParseTask.parse_status.is_(None),
                        DocumentParseTask.updated_at < cutoff,
                    )
                ).all()
                expired: list[_UploadReservation] = []
                for task_id, user_id, object_name, created_at in rows:
                    created_at_utc = (
                        created_at.replace(tzinfo=timezone.utc)
                        if created_at.tzinfo is None
                        else created_at
                    )
                    result = db.execute(
                        update(DocumentParseTask)
                        .where(
                            DocumentParseTask.id == task_id,
                            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                            DocumentParseTask.upload_status == "uploading",
                            DocumentParseTask.parse_status.is_(None),
                            DocumentParseTask.updated_at < cutoff,
                        )
                        .values(
                            upload_status="failed",
                            upload_duration_ms=min(
                                max(
                                    0,
                                    round(
                                        (now - created_at_utc).total_seconds() * 1000
                                    ),
                                ),
                                2**32 - 1,
                            ),
                            updated_at=now,
                        )
                        .execution_options(synchronize_session=False)
                    )
                    if result.rowcount == 1:
                        expired.append(
                            _UploadReservation(
                                task_id=int(task_id),
                                user_id=int(user_id),
                                object_name=str(object_name),
                            )
                        )
                db.commit()
                return expired
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    async def cleanup_upload_reservations(self) -> int:
        """Expire stale uploading reservations and remove any safe source object."""
        reservations = await asyncio.to_thread(self._expire_uploading_reservations)
        cleaned = 0
        for reservation in reservations:
            if not self._safe_source_object(
                reservation.user_id,
                reservation.object_name,
            ):
                logger.error(
                    "dataset upload reservation has unsafe object key",
                    extra={"parse_task_id": reservation.task_id},
                )
                continue
            try:
                await asyncio.to_thread(self._storage.delete, reservation.object_name)
            except Exception:
                logger.warning(
                    "dataset stale upload object cleanup failed",
                    extra={"parse_task_id": reservation.task_id},
                    exc_info=True,
                )
            cleaned += 1
        return cleaned

    def cleanup_failed_reservations(self) -> int:
        """Delete retained failed uploads only after storage cleanup succeeds."""
        if not self._uses_attempt_fields():
            return 0
        cutoff = utc_now() - timedelta(seconds=self._upload_reservation_ttl_seconds)
        try:
            with self._session_factory() as db:
                rows = list(
                    db.execute(
                    select(
                        DocumentParseTask.id,
                        DocumentParseTask.user_id,
                        DocumentParseTask.object_name,
                    ).where(
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.upload_status == "failed",
                        DocumentParseTask.parse_status.is_(None),
                        DocumentParseTask.updated_at < cutoff,
                    )
                    ).all()
                )
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

        deleted_count = 0
        for task_id, user_id, object_name in rows:
            if not self._safe_source_object(int(user_id), str(object_name)):
                logger.error(
                    "dataset failed reservation has unsafe object key",
                    extra={"parse_task_id": task_id},
                )
                continue
            try:
                self._storage.delete(str(object_name))
            except Exception:
                logger.warning(
                    "dataset failed reservation object cleanup failed",
                    extra={"parse_task_id": task_id},
                    exc_info=True,
                )
                continue
            try:
                with self._session_factory() as db:
                    db.execute(
                        delete(UserDataset).where(
                            UserDataset.parse_task_id == task_id,
                            UserDataset.user_id == user_id,
                        )
                    )
                    task_result = db.execute(
                        delete(DocumentParseTask).where(
                            DocumentParseTask.id == task_id,
                            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                            DocumentParseTask.upload_status == "failed",
                            DocumentParseTask.parse_status.is_(None),
                            DocumentParseTask.updated_at < cutoff,
                        )
                    )
                    deleted_count += int(task_result.rowcount == 1)
                    db.commit()
            except SQLAlchemyError as error:
                raise WorkerDependencyUnavailable("database unavailable") from error
        return deleted_count

    async def recover_once(self, *, publish: PublishDatasetTask) -> int:
        """Run one short recovery cycle without holding a DB transaction over MQ."""
        await self.cleanup_upload_reservations()
        await asyncio.to_thread(self.cleanup_failed_reservations)
        await asyncio.to_thread(self.recover_stale_processing)
        dispatched = 0
        for task_id in await asyncio.to_thread(self._dispatch_candidates):
            try:
                confirmed = await publish(task_id)
            except Exception:
                logger.warning(
                    "dataset queued task dispatch failed",
                    extra={"parse_task_id": task_id},
                    exc_info=True,
                )
                continue
            if confirmed is False:
                logger.warning(
                    "dataset queued task dispatch was not confirmed",
                    extra={"parse_task_id": task_id},
                )
                continue
            if await asyncio.to_thread(self._mark_dispatched, task_id, utc_now()):
                dispatched += 1
        return dispatched

    async def run_recovery_loop(self, *, publish: PublishDatasetTask) -> None:
        """Keep queued/stale/uploading recovery alive in the existing Worker."""
        while True:
            try:
                await self.recover_once(publish=publish)
            except asyncio.CancelledError:
                raise
            except WorkerDependencyUnavailable:
                logger.warning(
                    "dataset recovery cycle database unavailable",
                    exc_info=True,
                )
            except Exception:
                # A single failed cycle must not stop normal message consumption.
                logger.exception("dataset recovery cycle failed")
            await asyncio.sleep(self._dispatch_scan_seconds)
