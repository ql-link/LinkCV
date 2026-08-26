import asyncio
import logging
import secrets
from datetime import timezone
from time import monotonic

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from linkcv.core.config import Settings
from linkcv.core.database import utc_now
from linkcv.core.storage import AssetStorage
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownConverter,
)
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


class DatasetParseProcessor:
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

    async def _acquire_lock(self, parse_task_id: int, token: str) -> bool:
        try:
            return bool(
                await asyncio.to_thread(
                    self._redis.set,
                    self._lock_key(parse_task_id),
                    token,
                    nx=True,
                    ex=self._settings.resume_import_worker_lock_seconds,
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

    def _load_task(self, parse_task_id: int) -> DocumentParseTask | None:
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
                    elapsed_ms = round(
                        (utc_now() - created_at).total_seconds() * 1000
                    )
                    task.upload_status = "succeeded"
                    task.upload_duration_ms = min(
                        max(0, elapsed_ms),
                        2**32 - 1,
                    )
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

    def _mark_failed(
        self,
        parse_task_id: int,
        started: float | None,
        failure_reason: str,
    ) -> None:
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
                if task is None or task.parse_status != "processing":
                    return
                task.parse_status = "failed"
                task.failure_reason = failure_reason
                if started is None:
                    created_at = task.created_at
                    if created_at.tzinfo is None:
                        created_at = created_at.replace(tzinfo=timezone.utc)
                    elapsed_ms = round((utc_now() - created_at).total_seconds() * 1000)
                else:
                    elapsed_ms = round((monotonic() - started) * 1000)
                task.parse_duration_ms = min(max(0, elapsed_ms), 2**32 - 1)
                db.commit()
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def mark_retry_exhausted(self, parse_task_id: int) -> None:
        self._mark_failed(parse_task_id, None, "internal_error")

    def _persist_success(
        self,
        *,
        parse_task_id: int,
        user_id: int,
        markdown: str,
        started: float,
    ) -> None:
        converted_object_name = f"users/{user_id}/datasets/converted/{parse_task_id}.md"
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
        try:
            with self._session_factory() as db:
                task = db.scalar(
                    select(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == parse_task_id,
                        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                        DocumentParseTask.user_id == user_id,
                    )
                    .with_for_update()
                )
                if task is None or task.parse_status != "processing":
                    return
                task.converted_object_name = converted_object_name
                task.parse_status = "failed" if persistence_failed else "succeeded"
                task.failure_reason = (
                    "service_unavailable" if persistence_failed else None
                )
                task.parse_duration_ms = min(
                    max(0, round((monotonic() - started) * 1000)),
                    2**32 - 1,
                )
                db.commit()
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    async def process(self, *, parse_task_id: int) -> None:
        started = monotonic()
        token = secrets.token_urlsafe(24)
        if not await self._acquire_lock(parse_task_id, token):
            raise WorkerDependencyUnavailable("dataset parse lock is already held")
        try:
            task = self._load_task(parse_task_id)
            if task is None:
                return
            try:
                content = await asyncio.to_thread(
                    _read_storage_object,
                    self._storage,
                    task.object_name,
                )
            except Exception as error:
                raise WorkerTaskRetryable("source object unavailable") from error
            try:
                result = await self._document_converter.convert(
                    filename=task.file_name,
                    content_type=CONTENT_TYPES[task.file_format],
                    content=content,
                    operation_id=str(task.id),
                    deadline_monotonic=(
                        monotonic()
                        + self._settings.resume_import_parse_deadline_seconds
                    ),
                )
            except (DocumentConversionFailure, UnicodeDecodeError) as error:
                code = getattr(error, "code", "IMPORT_CONTENT_INVALID")
                self._mark_failed(
                    parse_task_id,
                    started,
                    FAILURE_REASON_BY_CODE.get(code, "internal_error"),
                )
                return
            self._persist_success(
                parse_task_id=parse_task_id,
                user_id=task.user_id,
                markdown=result.markdown,
                started=started,
            )
        finally:
            await self._release_lock(parse_task_id, token)
