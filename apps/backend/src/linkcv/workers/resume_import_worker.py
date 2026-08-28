import asyncio
import logging
import secrets
from datetime import timezone
from pathlib import PurePath
from time import monotonic

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.application.resumes.service import (
    MAX_RESUMES_PER_USER,
    parse_persisted_template_snapshot,
    presentation_from_template,
    persist_resume_with_initial_version,
    resume_slot_count,
)
from linkcv.core.config import Settings
from linkcv.core.database import utc_now
from linkcv.core.storage import (
    AssetStorage,
    build_converted_markdown_object_name,
    build_source_graph_object_name,
    import_operation_id_from_object_name,
)
from linkcv.domain.resume import (
    CanonicalResumeDocument,
    ResumePresentation,
    TemplateDefinition,
)
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    ResumeTemplate,
)
from linkcv.services.resume_import_service import (
    ResumeImportFailure,
    ResumeImportService,
)

logger = logging.getLogger(__name__)
CONTENT_TYPES = {
    "md": "text/markdown",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}
FAILURE_REASON_BY_CODE = {
    "UNSUPPORTED_IMPORT_FORMAT": "format_unsupported",
    "IMPORT_CONTENT_INVALID": "content_invalid",
    "RESUME_STRUCTURE_INVALID": "content_invalid",
    "RESUME_LAYOUT_UNSUPPORTED": "content_invalid",
    "IMPORT_FILE_TOO_LARGE": "size_exceeded",
    "STRUCTURING_INPUT_TOO_LARGE": "size_exceeded",
    "DOCUMENT_CONVERSION_UNAVAILABLE": "service_unavailable",
    "STRUCTURING_MODEL_UNAVAILABLE": "service_unavailable",
    "DOCUMENT_CONVERSION_TIMEOUT": "timeout",
    "IMPORT_DEADLINE_EXCEEDED": "timeout",
    "RESUME_LIMIT_REACHED": "quota_exceeded",
}
UNLOCK_SCRIPT = r"""
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


class WorkerDependencyUnavailable(RuntimeError):
    """A shared dependency is unavailable; the broker message must remain pending."""


class WorkerTaskRetryable(RuntimeError):
    """A single import hit a transient failure and may use bounded broker retries."""

    def __init__(
        self,
        message: str,
        *,
        stage: str | None = None,
        exception_type: str | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.exception_type = exception_type


def _read_storage_object(storage: AssetStorage, object_key: str) -> bytes:
    response = storage.get(object_key)
    if isinstance(response, bytes):
        return response
    try:
        data = response.read()
        if not isinstance(data, bytes):
            raise TypeError("storage response did not return bytes")
        return data
    finally:
        close = getattr(response, "close", None)
        if close is not None:
            close()
        release = getattr(response, "release_conn", None)
        if release is not None:
            release()


class ResumeImportProcessor:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        storage: AssetStorage,
        redis,
        import_service: ResumeImportService,
        settings: Settings,
    ) -> None:
        self._session_factory = session_factory
        self._storage = storage
        self._redis = redis
        self._import_service = import_service
        self._settings = settings

    @staticmethod
    def _lock_key(import_id: int) -> str:
        return f"resume-import:worker-lock:v1:{import_id}"

    async def _acquire_lock(self, import_id: int, token: str) -> bool:
        try:
            result = await asyncio.to_thread(
                self._redis.set,
                self._lock_key(import_id),
                token,
                nx=True,
                ex=self._settings.resume_import_worker_lock_seconds,
            )
            return bool(result)
        except Exception as error:
            raise WorkerDependencyUnavailable("Redis lock unavailable") from error

    async def _release_lock(self, import_id: int, token: str) -> None:
        try:
            await asyncio.to_thread(
                self._redis.eval,
                UNLOCK_SCRIPT,
                1,
                self._lock_key(import_id),
                token,
            )
        except Exception:
            logger.warning(
                "resume import worker lock release failed",
                extra={"import_id": import_id},
                exc_info=True,
            )

    def _load_inputs(
        self,
        import_id: int,
        message_template_id: int,
    ) -> tuple[DocumentParseTask, TemplateDefinition, ResumePresentation] | None:
        try:
            with self._session_factory() as db:
                record = db.scalar(
                    select(DocumentParseTask).where(
                        DocumentParseTask.id == import_id,
                        DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                    )
                )
                if record is None or record.parse_status in {"succeeded", "failed"}:
                    return None
                if (
                    record.upload_status != "succeeded"
                    or record.parse_status != "processing"
                ):
                    return None
                selected_template_id = record.selected_template_id
                if selected_template_id is None:
                    raise ResumeImportFailure(
                        422, "IMPORT_TEMPLATE_NOT_FROZEN", stage="task_load"
                    )
                if selected_template_id != message_template_id:
                    raise ResumeImportFailure(
                        409, "IMPORT_TEMPLATE_MISMATCH", stage="task_load"
                    )
                template = db.scalar(
                    select(ResumeTemplate).where(
                        ResumeTemplate.id == selected_template_id,
                        ResumeTemplate.is_active == 1,
                    )
                )
                if template is None:
                    raise ResumeImportFailure(
                        422, "TEMPLATE_INACTIVE", stage="task_load"
                    )
                try:
                    template_snapshot = parse_persisted_template_snapshot(
                        template.data_json, template.style_json
                    )
                    presentation = presentation_from_template(template_snapshot.style)
                    if not isinstance(presentation, ResumePresentation):
                        raise ValueError("resume import presentation is not canonical")
                except ValueError as error:
                    raise ResumeImportFailure(
                        422,
                        "TEMPLATE_INACTIVE",
                        stage="task_load",
                        exception_type=type(error).__name__,
                    ) from error
                db.expunge(record)
                # Keep a detached value snapshot for the entire parse.  The
                # ORM template is deliberately not allowed to leak past this
                # session boundary or be re-read as the source of style.
                return (
                    record,
                    template_snapshot.style.model_copy(deep=True),
                    presentation.model_copy(deep=True),
                )
        except ResumeImportFailure:
            raise
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def _mark_failed(
        self,
        import_id: int,
        started: float | None,
        failure_reason: str = "internal_error",
    ) -> None:
        try:
            with self._session_factory() as db:
                record = db.scalar(
                    select(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == import_id,
                        DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                    )
                    .with_for_update()
                )
                if record is None or record.parse_status != "processing":
                    return
                record.parse_status = "failed"
                record.failure_reason = failure_reason
                if started is None:
                    created_at = record.created_at
                    if created_at.tzinfo is None:
                        created_at = created_at.replace(tzinfo=timezone.utc)
                    elapsed_ms = round((utc_now() - created_at).total_seconds() * 1000)
                else:
                    elapsed_ms = round((monotonic() - started) * 1000)
                record.parse_duration_ms = min(max(0, elapsed_ms), 2**32 - 1)
                db.commit()
        except SQLAlchemyError as error:
            raise WorkerDependencyUnavailable("database unavailable") from error

    def mark_retry_exhausted(self, import_id: int) -> None:
        """Best-effort terminal update before the broker moves a task to DLT."""
        self._mark_failed(import_id, None)

    async def _persist_converted_markdown(
        self,
        *,
        import_id: int,
        user_id: int,
        operation_id: str,
        markdown: str,
    ) -> None:
        object_name: str | None = None
        try:
            with self._session_factory() as db:
                record = db.scalar(
                    select(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == import_id,
                        DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                        DocumentParseTask.user_id == user_id,
                        DocumentParseTask.parse_status == "processing",
                    )
                    .with_for_update()
                )
                if record is None:
                    return
                object_name = build_converted_markdown_object_name(
                    user_id, operation_id
                )
                try:
                    # The task row lock is intentionally held through both
                    # object upload and the reference commit.  Delete and
                    # confirmation paths therefore cannot race this pair.
                    await asyncio.to_thread(
                        self._storage.upload,
                        object_name,
                        markdown.encode("utf-8"),
                        "text/markdown",
                    )
                    record.converted_object_name = object_name
                    db.commit()
                except Exception:
                    db.rollback()
                    raise
        except Exception as error:
            # A missing, foreign, or already-terminal task returns before an
            # object name is allocated, so no orphan object can be created or
            # compensated for that status race.
            if object_name is None:
                logger.warning(
                    "resume import converted markdown persistence failed",
                    extra={
                        "import_id": import_id,
                        "error_type": type(error).__name__,
                    },
                    exc_info=True,
                )
                return
            try:
                # COMMIT failures have an indeterminate outcome: MySQL may
                # have applied the reference before the acknowledgement or
                # connection was lost.  Reconcile with a fresh locked read and
                # never delete an object that the durable task already owns.
                with self._session_factory() as verification_db:
                    verified_record = verification_db.scalar(
                        select(DocumentParseTask)
                        .where(
                            DocumentParseTask.id == import_id,
                            DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                            DocumentParseTask.user_id == user_id,
                        )
                        .with_for_update()
                    )
                    if (
                        verified_record is not None
                        and verified_record.converted_object_name == object_name
                    ):
                        logger.warning(
                            "resume import converted markdown commit reconciled",
                            extra={"import_id": import_id},
                        )
                        return
                    try:
                        await asyncio.to_thread(self._storage.delete, object_name)
                    except Exception as compensation_error:
                        logger.warning(
                            "resume import converted markdown compensation failed",
                            extra={
                                "import_id": import_id,
                                "error_type": type(compensation_error).__name__,
                            },
                            exc_info=True,
                        )
                        raise WorkerTaskRetryable(
                            "converted markdown persistence compensation failed",
                            stage="converted_markdown_persistence",
                            exception_type=type(compensation_error).__name__,
                        ) from compensation_error
            except WorkerTaskRetryable:
                raise
            except Exception as verification_error:
                logger.warning(
                    "resume import converted markdown commit verification failed",
                    extra={
                        "import_id": import_id,
                        "error_type": type(verification_error).__name__,
                    },
                    exc_info=True,
                )
                raise WorkerTaskRetryable(
                    "converted markdown persistence outcome unavailable",
                    stage="converted_markdown_persistence",
                    exception_type=type(verification_error).__name__,
                ) from verification_error
            logger.warning(
                "resume import converted markdown persistence failed",
                extra={
                    "import_id": import_id,
                    "error_type": type(error).__name__,
                },
                exc_info=True,
            )

    async def _persist_source_graph(
        self,
        *,
        import_id: int,
        user_id: int,
        operation_id: str,
        source_graph,
    ) -> str:
        """Persist the deterministic provenance graph before creating the resume.

        The object key is task-owned and deterministic, so a bounded broker
        retry overwrites the same private artifact instead of creating orphans.
        The task row is the durable ownership reference used by cleanup paths.
        """

        object_name = build_source_graph_object_name(user_id, operation_id)
        payload = source_graph.model_dump_json().encode("utf-8")
        try:
            await asyncio.to_thread(
                self._storage.upload,
                object_name,
                payload,
                "application/json",
            )
            with self._session_factory() as db:
                record = db.scalar(
                    select(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == import_id,
                        DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                        DocumentParseTask.user_id == user_id,
                        DocumentParseTask.parse_status == "processing",
                    )
                    .with_for_update()
                )
                if record is None:
                    raise WorkerTaskRetryable(
                        "source graph task is no longer processable",
                        stage="source_graph_persistence",
                    )
                record.source_graph_object_name = object_name
                db.commit()
            return object_name
        except WorkerTaskRetryable:
            raise
        except Exception as error:
            try:
                with self._session_factory() as verification_db:
                    durable_name = verification_db.scalar(
                        select(DocumentParseTask.source_graph_object_name).where(
                            DocumentParseTask.id == import_id,
                            DocumentParseTask.user_id == user_id,
                        )
                    )
                if durable_name == object_name:
                    return object_name
                await asyncio.to_thread(self._storage.delete, object_name)
            except Exception as verification_error:
                raise WorkerTaskRetryable(
                    "source graph persistence outcome unavailable",
                    stage="source_graph_persistence",
                    exception_type=type(verification_error).__name__,
                ) from verification_error
            raise WorkerTaskRetryable(
                "source graph persistence failed",
                stage="source_graph_persistence",
                exception_type=type(error).__name__,
            ) from error

    def _persist_success(
        self,
        *,
        import_id: int,
        selected_template_id: int,
        title: str,
        parsed,
        template_definition: TemplateDefinition,
        presentation: ResumePresentation,
        started: float,
    ) -> None:
        try:
            with self._session_factory() as db:
                user_id = db.scalar(
                    select(DocumentParseTask.user_id).where(
                        DocumentParseTask.id == import_id,
                        DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                    )
                )
                if user_id is None:
                    return
                locked_user = db.scalar(
                    select(User.id).where(User.id == user_id).with_for_update()
                )
                if locked_user is None:
                    raise ResumeImportFailure(
                        409, "RESUME_OWNER_MISSING", stage="resume_persistence"
                    )
                record = db.scalar(
                    select(DocumentParseTask)
                    .where(
                        DocumentParseTask.id == import_id,
                        DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                        DocumentParseTask.user_id == user_id,
                    )
                    .with_for_update()
                )
                if record is None or record.parse_status != "processing":
                    return
                if record.selected_template_id != selected_template_id:
                    raise ResumeImportFailure(
                        409, "IMPORT_TEMPLATE_MISMATCH", stage="resume_persistence"
                    )
                if not record.source_graph_object_name:
                    raise ResumeImportFailure(
                        422,
                        "SOURCE_GRAPH_MISSING",
                        stage="resume_persistence",
                    )
                if resume_slot_count(db, record.user_id) > MAX_RESUMES_PER_USER:
                    raise ResumeImportFailure(
                        409, "RESUME_LIMIT_REACHED", stage="resume_persistence"
                    )
                template = db.scalar(
                    select(ResumeTemplate)
                    .where(ResumeTemplate.id == selected_template_id)
                    .with_for_update()
                )
                if template is None or template.is_active != 1:
                    raise ResumeImportFailure(
                        422, "TEMPLATE_INACTIVE", stage="resume_persistence"
                    )
                try:
                    current_snapshot = parse_persisted_template_snapshot(
                        template.data_json, template.style_json
                    )
                except ValueError as error:
                    raise ResumeImportFailure(
                        422,
                        "TEMPLATE_INACTIVE",
                        stage="resume_persistence",
                        exception_type=type(error).__name__,
                    ) from error
                if (
                    current_snapshot.style != template_definition
                ):
                    raise ResumeImportFailure(
                        422, "TEMPLATE_INACTIVE", stage="resume_persistence"
                    )
                if not isinstance(parsed.document, CanonicalResumeDocument):
                    raise ResumeImportFailure(
                        422,
                        "RESUME_STRUCTURE_INVALID",
                        stage="resume_persistence",
                    )
                resume = persist_resume_with_initial_version(
                    CreateResumeCommand(
                        user_id=record.user_id,
                        title=title,
                        data=parsed.document,
                        style=presentation,
                        source_type="import",
                        template_id=template.id,
                    ),
                    db,
                )
                resume.parse_task_id = record.id
                record.parse_status = "succeeded"
                record.parse_duration_ms = min(
                    round((monotonic() - started) * 1000),
                    2**32 - 1,
                )
                db.commit()
        except ResumeImportFailure:
            raise
        except (SQLAlchemyError, OSError) as error:
            raise WorkerDependencyUnavailable("database unavailable") from error
        except ValueError as error:
            raise ResumeImportFailure(
                422,
                "TEMPLATE_INACTIVE",
                stage="resume_persistence",
                exception_type=type(error).__name__,
            ) from error

    async def process(self, *, import_id: int, template_id: int) -> None:
        started = monotonic()
        operation_id = str(import_id)
        logger.info(
            "resume import task started",
            extra={
                "task_id": import_id,
                "operation_id": operation_id,
                "stage": "task_load",
            },
        )
        token = secrets.token_urlsafe(24)
        if not await self._acquire_lock(import_id, token):
            raise WorkerDependencyUnavailable("import lock is already held")
        try:
            try:
                loaded = self._load_inputs(import_id, template_id)
                if loaded is None:
                    return
                record, template_definition, presentation = loaded
                logger.info(
                    "resume import stage completed",
                    extra={
                        "task_id": import_id,
                        "operation_id": operation_id,
                        "stage": "task_load",
                        "source_format": record.file_format,
                    },
                )
                source_read_started = monotonic()
                try:
                    content = await asyncio.to_thread(
                        _read_storage_object,
                        self._storage,
                        record.object_name,
                    )
                except Exception as error:
                    raise WorkerTaskRetryable(
                        "source object unavailable",
                        stage="source_read",
                        exception_type=type(error).__name__,
                    ) from error
                logger.info(
                    "resume import stage completed",
                    extra={
                        "task_id": import_id,
                        "operation_id": operation_id,
                        "stage": "source_read",
                        "duration_ms": round(
                            (monotonic() - source_read_started) * 1000
                        ),
                    },
                )
                parsed = await self._import_service.parse_resume(
                    user_id=record.user_id,
                    filename=record.file_name,
                    content_type=CONTENT_TYPES[record.file_format],
                    content=content,
                    operation_id=str(record.id),
                    request_pdf_layout=True,
                    deadline_monotonic=(
                        monotonic()
                        + self._settings.resume_import_parse_deadline_seconds
                    ),
                    on_markdown_extracted=lambda markdown: (
                        self._persist_converted_markdown(
                            import_id=record.id,
                            user_id=record.user_id,
                            operation_id=(
                                import_operation_id_from_object_name(
                                    record.user_id,
                                    record.object_name,
                                )
                                or str(record.id)
                            ),
                            markdown=markdown,
                        )
                    ),
                )
                if parsed.source_graph is None:
                    raise ResumeImportFailure(
                        422,
                        "SOURCE_GRAPH_MISSING",
                        stage="source_graph_persistence",
                    )
                operation_id_from_source = import_operation_id_from_object_name(
                    record.user_id,
                    record.object_name,
                )
                if operation_id_from_source is None:
                    raise ResumeImportFailure(
                        422,
                        "SOURCE_GRAPH_MISSING",
                        stage="source_graph_persistence",
                    )
                await self._persist_source_graph(
                    import_id=record.id,
                    user_id=record.user_id,
                    operation_id=operation_id_from_source,
                    source_graph=parsed.source_graph,
                )
                title = PurePath(record.file_name).stem or "未命名简历"
                persistence_started = monotonic()
                selected_template_id = record.selected_template_id
                if selected_template_id is None:
                    raise ResumeImportFailure(
                        422, "IMPORT_TEMPLATE_NOT_FROZEN", stage="resume_persistence"
                    )
                self._persist_success(
                    import_id=record.id,
                    selected_template_id=selected_template_id,
                    title=title,
                    parsed=parsed,
                    template_definition=template_definition,
                    presentation=presentation,
                    started=started,
                )
                logger.info(
                    "resume import stage completed",
                    extra={
                        "task_id": import_id,
                        "operation_id": operation_id,
                        "stage": "resume_persistence",
                        "duration_ms": round(
                            (monotonic() - persistence_started) * 1000
                        ),
                    },
                )
                logger.info(
                    "resume import task completed",
                    extra={
                        "task_id": import_id,
                        "operation_id": operation_id,
                        "duration_ms": round((monotonic() - started) * 1000),
                        "result": "succeeded",
                    },
                )
            except ResumeImportFailure as error:
                logger.warning(
                    "resume import task failed",
                    extra={
                        "task_id": import_id,
                        "operation_id": operation_id,
                        "duration_ms": round((monotonic() - started) * 1000),
                        "result": "failed",
                        "error_code": error.code,
                        "failure_stage": error.stage or "unknown",
                        "exception_type": error.exception_type,
                        "validation_model": error.validation_model,
                        "validation_paths": error.validation_paths,
                        "validation_types": error.validation_types,
                    },
                )
                if error.status_code >= 500:
                    raise WorkerTaskRetryable(
                        error.code,
                        stage=error.stage,
                        exception_type=error.exception_type,
                    ) from error
                self._mark_failed(
                    import_id,
                    started,
                    FAILURE_REASON_BY_CODE.get(error.code, "internal_error"),
                )
            except WorkerTaskRetryable as error:
                logger.warning(
                    "resume import task retry required",
                    extra={
                        "task_id": import_id,
                        "operation_id": operation_id,
                        "duration_ms": round((monotonic() - started) * 1000),
                        "result": "failed",
                        "failure_stage": error.stage or "unknown",
                        "exception_type": error.exception_type,
                    },
                )
                raise
        finally:
            await self._release_lock(import_id, token)
