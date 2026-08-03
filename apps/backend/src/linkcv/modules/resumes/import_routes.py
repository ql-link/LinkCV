import asyncio
import logging
from contextlib import suppress
from time import monotonic
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Header, Request, UploadFile
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import find_owned_resume, has_resume_capacity
from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, get_storage
from linkcv.domain.document_conversion import DocumentMarkdownConverter
from linkcv.integrations.resume_structuring import ResumeStructuringClient
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.routes import resume_record
from linkcv.modules.resumes.schemas import (
    ResumeImportMetadata,
    ResumeImportResponse,
)
from linkcv.services.import_admission import (
    ImportAdmissionController,
    ImportAdmissionRejected,
)
from linkcv.services.resume_import_idempotency import (
    IdempotencyLeaseLostError,
    IdempotencyUnavailableError,
    ResumeImportIdempotency,
    import_fingerprint,
)
from linkcv.services.resume_import_service import (
    ImportResult,
    ResumeImportFailure,
    ResumeImportService,
    safe_import_filename,
    validate_import_file,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resumes", tags=["resume-imports"])


def get_document_converter(request: Request) -> DocumentMarkdownConverter:
    return request.app.state.document_converter


def get_structuring_client(request: Request) -> ResumeStructuringClient:
    return request.app.state.structuring_client


def get_import_admission(request: Request) -> ImportAdmissionController:
    return request.app.state.import_admission


def get_import_idempotency(request: Request) -> ResumeImportIdempotency:
    return request.app.state.import_idempotency


def canonical_idempotency_key(value: str | None) -> str:
    try:
        parsed = UUID(value or "")
    except (ValueError, AttributeError) as error:
        raise ResumeImportFailure(400, "INVALID_IDEMPOTENCY_KEY") from error
    canonical = str(parsed)
    if value != canonical:
        raise ResumeImportFailure(400, "INVALID_IDEMPOTENCY_KEY")
    return canonical


def import_response(result: ImportResult) -> ResumeImportResponse:
    return ResumeImportResponse(
        resume=resume_record(result.resume),
        **{
            "import": ResumeImportMetadata(
                source_file_name=result.source_file_name,
                source_file_format=result.source_file_format,
                warnings=result.warnings,
            )
        },
    )


async def run_until_disconnect(request: Request, coroutine) -> ImportResult:
    task = asyncio.create_task(coroutine)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=0.25)
            if task in done:
                return task.result()
            if await request.is_disconnected():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                raise asyncio.CancelledError
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


@router.post("/import", response_model=ResumeImportResponse, status_code=201)
async def import_resume(
    request: Request,
    file: UploadFile = File(...),
    title: str | None = Form(default=None, max_length=255),
    idempotency_key_header: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    document_converter: DocumentMarkdownConverter = Depends(get_document_converter),
    structuring_client: ResumeStructuringClient = Depends(get_structuring_client),
    import_admission: ImportAdmissionController = Depends(get_import_admission),
    idempotency: ResumeImportIdempotency = Depends(get_import_idempotency),
) -> ResumeImportResponse:
    lease: tuple[str, str, str] | None = None
    try:
        idempotency_key = canonical_idempotency_key(idempotency_key_header)
        deadline_monotonic = monotonic() + settings.resume_import_deadline_seconds
        filename = safe_import_filename(file.filename or "resume.bin")
        content_type = (file.content_type or "application/octet-stream").lower()
        content = await file.read(settings.resume_import_max_bytes + 1)
        extension = validate_import_file(
            filename=filename,
            content_type=content_type,
            content=content,
            max_bytes=settings.resume_import_max_bytes,
        )
        fingerprint = import_fingerprint(
            filename=filename,
            source_format=extension,
            content_type=content_type,
            title=title,
            content=content,
        )
        operation_id = uuid4().hex
        try:
            acquired = await idempotency.acquire_or_replay(
                user_id=user.id,
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                owner=operation_id,
            )
        except IdempotencyUnavailableError as error:
            raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE") from error

        if acquired.status == "conflict":
            raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
        if acquired.status == "processing":
            raise ApiError(409, "IMPORT_ALREADY_PROCESSING")
        if acquired.status == "failed":
            raise ApiError(
                acquired.state.error_status or 409,
                acquired.state.error_code or "IMPORT_PREVIOUSLY_FAILED",
            )
        if acquired.status == "succeeded":
            state = acquired.state
            if (
                state.resume_id is None
                or state.source_file_name is None
                or state.source_file_format is None
            ):
                raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE")
            resume = find_owned_resume(db, state.resume_id, user.id)
            if resume is None:
                raise ApiError(503, "IMPORT_REPLAY_UNAVAILABLE")
            return import_response(
                ImportResult(
                    resume=resume,
                    source_file_name=state.source_file_name,
                    source_file_format=state.source_file_format,
                    warnings=state.warnings,
                )
            )

        lease = (idempotency_key, fingerprint, operation_id)

        async def assert_lease() -> None:
            await idempotency.renew_and_assert_owner(
                user_id=user.id,
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                owner=operation_id,
            )

        try:
            if not has_resume_capacity(db, user.id):
                raise ResumeImportFailure(409, "RESUME_LIMIT_REACHED")
            async with import_admission.acquire(user.id):
                service = ResumeImportService(
                    document_converter=document_converter,
                    structuring_client=structuring_client,
                    storage=storage,
                    max_structuring_bytes=settings.resume_structuring_max_bytes,
                    structuring_timeout_seconds=(
                        settings.resume_structuring_timeout_seconds
                    ),
                )
                result = await run_until_disconnect(
                    request,
                    service.import_resume(
                        db=db,
                        user_id=user.id,
                        filename=filename,
                        content_type=content_type,
                        content=content,
                        title=title,
                        operation_id=operation_id,
                        deadline_monotonic=deadline_monotonic,
                        assert_lease=assert_lease,
                    ),
                )
        except ImportAdmissionRejected as error:
            raise ResumeImportFailure(429, "IMPORT_RATE_LIMITED") from error

        try:
            await idempotency.mark_succeeded(
                user_id=user.id,
                idempotency_key=idempotency_key,
                fingerprint=fingerprint,
                owner=operation_id,
                resume_id=str(result.resume.id),
                source_file_name=result.source_file_name,
                source_file_format=result.source_file_format,
                warnings=result.warnings,
            )
        except (IdempotencyUnavailableError, IdempotencyLeaseLostError) as error:
            logger.error(
                "resume import committed but idempotency finalization failed",
                extra={"operation_id": operation_id, "user_id": user.id},
            )
            raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE") from error
        return import_response(result)
    except ResumeImportFailure as error:
        if lease is not None:
            key, fingerprint, owner = lease
            try:
                await idempotency.mark_failed(
                    user_id=user.id,
                    idempotency_key=key,
                    fingerprint=fingerprint,
                    owner=owner,
                    error_status=error.status_code,
                    error_code=error.code,
                )
            except (IdempotencyUnavailableError, IdempotencyLeaseLostError) as state_error:
                raise ApiError(503, "IMPORT_IDEMPOTENCY_UNAVAILABLE") from state_error
        raise ApiError(error.status_code, error.code) from error
    except asyncio.CancelledError:
        if lease is not None:
            key, fingerprint, owner = lease
            with suppress(IdempotencyUnavailableError, IdempotencyLeaseLostError):
                await asyncio.shield(
                    idempotency.mark_failed(
                        user_id=user.id,
                        idempotency_key=key,
                        fingerprint=fingerprint,
                        owner=owner,
                        error_status=499,
                        error_code="IMPORT_CANCELLED",
                    )
                )
        raise
    finally:
        await file.close()
