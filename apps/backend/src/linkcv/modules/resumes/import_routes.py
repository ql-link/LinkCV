import asyncio
import logging
from time import monotonic
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    Request,
    Response,
    UploadFile,
)
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import (
    close_stale_resume_imports,
    has_resume_capacity,
    parse_decimal_id,
    parse_persisted_template_snapshot,
)
from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.mq import MQPublisher, ResumeImportMessage
from linkcv.core.mq.factory import build_mq_publisher
from linkcv.core.storage import AssetStorage, build_import_object_name, get_storage
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.observability.audit import bind_audit_target
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeTemplate,
)
from linkcv.modules.resumes.schemas import ResumeImportResponse, ResumeImportSummary
from linkcv.services.resume_import_idempotency import (
    IdempotencyBindingLostError,
    IdempotencyUnavailableError,
    ResumeImportIdempotency,
    import_fingerprint,
)
from linkcv.services.import_admission import (
    ImportAdmissionController,
    ImportAdmissionRejected,
)
from linkcv.services.resume_import_service import (
    ResumeImportFailure,
    safe_import_filename,
    validate_import_file,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resumes", tags=["resume-imports"])
DEFAULT_RESUME_TEMPLATE_KEY = "classic-technical-cn"


def get_import_idempotency(request: Request) -> ResumeImportIdempotency:
    return request.app.state.import_idempotency


def get_import_admission(request: Request) -> ImportAdmissionController:
    return request.app.state.import_admission


def get_mq_publisher(request: Request, settings: Settings) -> MQPublisher:
    publisher = request.app.state.mq_publisher
    if publisher is None:
        try:
            publisher = build_mq_publisher(settings)
        except Exception as error:
            raise ApiError(503, "RESUME_IMPORT_QUEUE_UNAVAILABLE") from error
        request.app.state.mq_publisher = publisher
    return publisher


def canonical_idempotency_key(value: str | None) -> str:
    try:
        parsed = UUID(value or "")
    except (ValueError, AttributeError) as error:
        raise ResumeImportFailure(400, "INVALID_IDEMPOTENCY_KEY") from error
    canonical = str(parsed)
    if value != canonical:
        raise ResumeImportFailure(400, "INVALID_IDEMPOTENCY_KEY")
    return canonical


def import_summary(db: Session, record: DocumentParseTask) -> ResumeImportSummary:
    result_resume_id = None
    if record.parse_status == "succeeded":
        result_resume_id = db.scalar(
            select(Resume.id).where(Resume.parse_task_id == record.id)
        )
    return ResumeImportSummary(
        id=str(record.id),
        source_filename=record.file_name,
        source_file_format=record.file_format,
        upload_status=record.upload_status,
        upload_duration_ms=record.upload_duration_ms,
        parse_status=record.parse_status,
        parse_duration_ms=record.parse_duration_ms,
        selected_template_id=(
            str(record.selected_template_id)
            if record.selected_template_id is not None
            else None
        ),
        result_resume_id=(
            str(result_resume_id) if result_resume_id is not None else None
        ),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _template_is_usable(template: ResumeTemplate) -> bool:
    try:
        snapshot = parse_persisted_template_snapshot(
            template.data_json,
            template.style_json,
        )
    except (TypeError, ValueError):
        return False
    return snapshot.style.template_key == template.key


def _select_import_template(
    db: Session,
    *,
    parsed_template_id: int | None,
) -> ResumeTemplate | None:
    """Resolve and validate the template frozen into a new import task."""

    if parsed_template_id is not None:
        template = db.scalar(
            select(ResumeTemplate).where(
                ResumeTemplate.id == parsed_template_id,
                ResumeTemplate.is_active == 1,
            )
        )
        return template if template is not None and _template_is_usable(template) else None

    preferred = db.scalar(
        select(ResumeTemplate).where(
            ResumeTemplate.key == DEFAULT_RESUME_TEMPLATE_KEY,
            ResumeTemplate.is_active == 1,
        )
    )
    if preferred is not None and _template_is_usable(preferred):
        return preferred

    # Keep the production fallback documented and deterministic: a valid
    # active non-blank template may replace an unavailable configured default.
    candidates = db.scalars(
        select(ResumeTemplate)
        .where(
            ResumeTemplate.is_active == 1,
            ResumeTemplate.key != "blank-cn",
        )
        .order_by(ResumeTemplate.id)
    ).all()
    return next((template for template in candidates if _template_is_usable(template)), None)


def import_details(db: Session, record: DocumentParseTask) -> dict[str, object]:
    return {"import": import_summary(db, record).model_dump(mode="json")}


def _duration_ms(started: float) -> int:
    return min(round((monotonic() - started) * 1000), 2**32 - 1)


def _load_owned_import(db: Session, import_id: str, user_id: int) -> DocumentParseTask:
    parsed_id = parse_decimal_id(import_id)
    record = (
        db.scalar(
            select(DocumentParseTask).where(
                DocumentParseTask.id == parsed_id,
                DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                DocumentParseTask.user_id == user_id,
            )
        )
        if parsed_id is not None
        else None
    )
    if record is None:
        raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE")
    return record


def _replay_response(
    db: Session,
    record: DocumentParseTask,
    response: Response,
) -> ResumeImportResponse:
    if record.parse_status == "failed" or record.upload_status == "failed":
        raise ApiError(409, "IMPORT_PREVIOUSLY_FAILED", import_details(db, record))
    response.status_code = 200 if record.parse_status == "succeeded" else 202
    return ResumeImportResponse.model_validate({"import": import_summary(db, record)})


def _mark_queue_unavailable(
    db: Session,
    record: DocumentParseTask,
    response: Response,
) -> ResumeImportResponse:
    """Close an accepted task unless a worker has already completed it.

    Publisher construction and confirm failures happen after the source file
    is durable.  The conditional update makes that task user-cleanable while
    preserving a worker result that won the race with the failed request.
    """
    result = db.execute(
        update(DocumentParseTask)
        .where(
            DocumentParseTask.id == record.id,
            DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
            DocumentParseTask.parse_status == "processing",
        )
        .values(
            parse_status="failed",
            parse_duration_ms=0,
            failure_reason="service_unavailable",
        )
    )
    db.commit()
    db.expire_all()
    latest = _load_owned_import(db, str(record.id), record.user_id)
    if result.rowcount != 1:
        return _replay_response(db, latest, response)
    raise ApiError(
        503,
        "RESUME_IMPORT_QUEUE_UNAVAILABLE",
        import_details(db, latest),
    )


@router.post("/import", response_model=ResumeImportResponse, status_code=202)
async def import_resume(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    template_id: str | None = Form(default=None),
    idempotency_key_header: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    idempotency: ResumeImportIdempotency = Depends(get_import_idempotency),
    import_admission: ImportAdmissionController = Depends(get_import_admission),
) -> ResumeImportResponse:
    record: DocumentParseTask | None = None
    admission_context = None
    try:
        if template_id is not None and parse_decimal_id(template_id) is None:
            raise ResumeImportFailure(422, "TEMPLATE_INACTIVE")
        parsed_template_id = (
            parse_decimal_id(template_id) if template_id is not None else None
        )

        idempotency_key = canonical_idempotency_key(idempotency_key_header)
        filename = safe_import_filename(file.filename or "resume.bin")
        content_type = (file.content_type or "application/octet-stream").lower()
        content = await file.read(settings.resume_import_max_bytes + 1)
        extension = validate_import_file(
            filename=filename,
            content_type=content_type,
            content=content,
            max_bytes=settings.resume_import_max_bytes,
        )
        close_stale_resume_imports(
            db,
            user_id=user.id,
            upload_stale_seconds=settings.resume_import_upload_stale_seconds,
            parse_stale_seconds=settings.resume_import_parse_stale_seconds,
        )

        template = _select_import_template(
            db,
            parsed_template_id=parsed_template_id,
        )
        template_available = template is not None
        fingerprint_template_id = (
            str(template.id)
            if template is not None
            else (template_id or DEFAULT_RESUME_TEMPLATE_KEY)
        )
        fingerprint = import_fingerprint(
            filename=filename,
            source_format=extension,
            content_type=content_type,
            template_id=fingerprint_template_id,
            content=content,
        )
        if not template_available:
            try:
                existing = await idempotency.read_state(
                    user_id=user.id,
                    idempotency_key=idempotency_key,
                )
            except IdempotencyUnavailableError as error:
                raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE") from error
            if existing is None:
                raise ResumeImportFailure(422, "TEMPLATE_INACTIVE")
            if existing.fingerprint != fingerprint:
                raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
            if existing.import_id is None:
                try:
                    existing = await idempotency.wait_for_binding(
                        user_id=user.id,
                        idempotency_key=idempotency_key,
                    )
                except IdempotencyUnavailableError as error:
                    raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE") from error
            if existing is None or existing.import_id is None:
                raise ApiError(409, "IMPORT_ACCEPTANCE_IN_PROGRESS")
            record = _load_owned_import(db, existing.import_id, user.id)
            bind_audit_target(request, record.id)
            return _replay_response(db, record, response)

        assert template is not None
        admission_context = import_admission.acquire(user.id)
        try:
            await admission_context.__aenter__()
        except ImportAdmissionRejected as error:
            admission_context = None
            raise ApiError(429, "IMPORT_RATE_LIMITED") from error

        owner = uuid4().hex
        try:
            acquired = await idempotency.acquire_or_replay(
                user_id=user.id,
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                owner=owner,
            )
        except IdempotencyUnavailableError as error:
            raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE") from error

        if acquired.status == "conflict":
            raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
        if acquired.status == "processing":
            state = acquired.state
            if state.import_id is None:
                try:
                    state = await idempotency.wait_for_binding(
                        user_id=user.id,
                        idempotency_key=idempotency_key,
                    )
                except IdempotencyUnavailableError as error:
                    raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE") from error
            if state is None or state.import_id is None:
                raise ApiError(409, "IMPORT_ACCEPTANCE_IN_PROGRESS")
            record = _load_owned_import(db, state.import_id, user.id)
            bind_audit_target(request, record.id)
            return _replay_response(db, record, response)

        operation_id = uuid4().hex
        request.state.operation_id = operation_id
        object_key = build_import_object_name(user.id, operation_id, filename)
        try:
            locked_user_id = db.scalar(
                select(User.id).where(User.id == user.id).with_for_update()
            )
            if locked_user_id is None:
                raise ApiError(401, "UNAUTHORIZED")
            if not has_resume_capacity(db, user.id):
                raise ApiError(409, "RESUME_LIMIT_REACHED")
            record = DocumentParseTask(
                source_type=RESUME_IMPORT_SOURCE_TYPE,
                user_id=user.id,
                file_name=filename,
                file_format=extension,
                object_name=object_key,
                selected_template_id=template.id,
                upload_status="uploading",
            )
            db.add(record)
            db.commit()
            record = _load_owned_import(db, str(record.id), user.id)
            bind_audit_target(request, record.id)
        except Exception:
            db.rollback()
            raise

        try:
            await idempotency.bind_import_id(
                user_id=user.id,
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                owner=owner,
                import_id=str(record.id),
            )
        except (IdempotencyUnavailableError, IdempotencyBindingLostError) as error:
            record.upload_status = "failed"
            record.upload_duration_ms = 0
            db.commit()
            raise ApiError(
                503,
                "IMPORT_IDEMPOTENCY_UNAVAILABLE",
                import_details(db, record),
            ) from error

        upload_started = monotonic()
        try:
            await asyncio.to_thread(storage.upload, object_key, content, content_type)
        except Exception as error:
            try:
                await asyncio.to_thread(storage.delete, object_key)
            except Exception:
                logger.warning(
                    "resume source upload compensation failed",
                    extra={"import_id": record.id},
                    exc_info=True,
                )
            record.upload_status = "failed"
            record.upload_duration_ms = _duration_ms(upload_started)
            db.commit()
            raise ApiError(
                502,
                "RESUME_SOURCE_UPLOAD_FAILED",
                import_details(db, record),
            ) from error

        record.upload_status = "succeeded"
        record.upload_duration_ms = _duration_ms(upload_started)
        record.parse_status = "processing"
        db.commit()
        record = _load_owned_import(db, str(record.id), user.id)

        try:
            publisher = get_mq_publisher(request, settings)
            await publisher.publish(
                ResumeImportMessage.create(
                    import_id=record.id,
                    template_id=template.id,
                )
            )
        except Exception as error:
            try:
                return _mark_queue_unavailable(db, record, response)
            except ApiError as queue_error:
                raise queue_error from error
        return ResumeImportResponse.model_validate(
            {"import": import_summary(db, record)}
        )
    except ResumeImportFailure as error:
        raise ApiError(error.status_code, error.code) from error
    finally:
        if admission_context is not None:
            await admission_context.__aexit__(None, None, None)
        await file.close()
