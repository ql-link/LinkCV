from __future__ import annotations

import base64
from io import BytesIO
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from minio.error import S3Error
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from linkresume.application.job_descriptions.service import (
    DuplicateJobDescription,
    JobEditConflict,
    JobWriteFailed,
    create_or_resolve_job,
    find_owned_job,
    hard_delete_owned_job,
    list_owned_jobs,
    update_owned_job,
)
from linkresume.application.job_descriptions.logo_service import (
    MAX_LOGO_BYTES, MAX_STORED_LOGO_BYTES, attach_logo,
)
from linkresume.application.interviews.service import ensure_pending_application_for_job
from linkresume.application.job_descriptions.import_service import (
    InvalidJobImport,
    build_job_description_from_capture,
)
from linkresume.application.job_descriptions.ai_import_service import (
    draft_warnings,
    parse_image_draft,
    parse_text_draft,
)
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.domain.job_source import InvalidJobSource
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.job_descriptions.models import JobDescription
from linkresume.modules.job_descriptions.schemas import (
    CompanyLogoResponse,
    DeleteJobDescriptionResponse,
    JobDescriptionCreateRequest,
    JobDescriptionImportRequest,
    JobImportApplicationRecord,
    JobDescriptionListResponse,
    JobDescriptionRecord,
    JobDescriptionResponse,
    JobDescriptionSummary,
    JobDescriptionUpdateRequest,
    JobDescriptionDraftResponse,
)
from linkresume.modules.llm.dependencies import get_llm_service
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/job-descriptions", tags=["job-descriptions"])
MAX_JOB_IMPORT_TEXT_CHARS = 60_000
MAX_JOB_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024
MAX_JOB_IMPORT_IMAGE_PIXELS = 40_000_000
IMAGE_MIME_BY_FORMAT = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


async def read_limited_image(image: UploadFile) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await image.read(
            min(1024 * 1024, MAX_JOB_IMPORT_IMAGE_BYTES + 1 - size)
        )
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_JOB_IMPORT_IMAGE_BYTES:
            raise ApiError(400, "JD_IMPORT_IMAGE_TOO_LARGE")
        chunks.append(chunk)
    if size == 0:
        raise ApiError(400, "JD_IMPORT_IMAGE_INVALID")
    return b"".join(chunks)


def validated_image_data_url(data: bytes) -> str:
    try:
        with Image.open(BytesIO(data)) as decoded:
            image_format = decoded.format
            width, height = decoded.size
            media_type = IMAGE_MIME_BY_FORMAT.get(image_format or "")
            if media_type is None:
                raise ApiError(400, "JD_IMPORT_IMAGE_UNSUPPORTED")
            if (
                width <= 0
                or height <= 0
                or width * height > MAX_JOB_IMPORT_IMAGE_PIXELS
            ):
                raise ApiError(400, "JD_IMPORT_IMAGE_INVALID")
            decoded.verify()
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        ValueError,
    ) as error:
        raise ApiError(400, "JD_IMPORT_IMAGE_INVALID") from error
    return f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}"


def raise_draft_parse_error(error: LLMError, input_type: str) -> None:
    details = {"callId": error.call_id, "inputType": input_type}
    if error.code in {
        "LLM_MODEL_NOT_CONFIGURED",
        "LLM_CHAT_NOT_CONFIGURED",
        "LLM_CREDENTIALS_UNAVAILABLE",
    }:
        raise ApiError(503, "JD_IMPORT_MODEL_NOT_CONFIGURED", details) from error
    if error.code == "LLM_TIMEOUT":
        raise ApiError(504, "JD_IMPORT_PARSE_TIMEOUT", details) from error
    raise ApiError(502, "JD_IMPORT_PARSE_FAILED", details) from error


def require_owned_job(db: Session, job_id: str, user_id: int) -> JobDescription:
    job = find_owned_job(db, job_id, user_id)
    if job is None:
        raise ApiError(404, "JD_NOT_FOUND")
    return job


def job_summary(job: JobDescription) -> JobDescriptionSummary:
    return JobDescriptionSummary.model_validate(job)


def job_record(job: JobDescription) -> JobDescriptionRecord:
    return JobDescriptionRecord.model_validate(job)


def duplicate_details(error: DuplicateJobDescription) -> dict[str, object]:
    existing = job_summary(error.existing).model_dump(mode="json")
    return {
        "duplicate": {
            "existing": existing,
            "allowed_actions": ["update", "cancel"],
        }
    }


def create_job_and_pending_application(
    db: Session,
    user_id: int,
    payload: JobDescriptionCreateRequest,
) -> tuple[JobDescription, JobApplication, bool]:
    try:
        result = create_or_resolve_job(
            db=db, user_id=user_id, payload=payload, commit=False
        )
        job = result.job
        created = result.created
    except DuplicateJobDescription as error:
        job = error.existing
        created = False
    try:
        application, _ = ensure_pending_application_for_job(db, user_id, job)
        db.commit()
        db.refresh(job)
        db.refresh(application)
    except Exception:
        db.rollback()
        raise
    return job, application, created


@router.get("", response_model=JobDescriptionListResponse)
def list_job_descriptions(
    keyword: str | None = Query(default=None, max_length=200),
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionListResponse:
    try:
        jobs, next_cursor = list_owned_jobs(
            db=db,
            user_id=user.id,
            keyword=keyword,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise ApiError(400, "INVALID_JOB_QUERY") from error
    return JobDescriptionListResponse(
        items=[job_summary(job) for job in jobs], next_cursor=next_cursor
    )


@router.post("/parse-draft", response_model=JobDescriptionDraftResponse)
async def parse_job_description_draft(
    text: str | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    service: LLMService = Depends(get_llm_service),
) -> JobDescriptionDraftResponse:
    normalized_text = text.strip() if text is not None else ""
    if bool(normalized_text) == (image is not None):
        raise ApiError(
            400,
            "JD_IMPORT_INPUT_AMBIGUOUS"
            if normalized_text and image is not None
            else "JD_IMPORT_INPUT_REQUIRED",
        )
    if normalized_text:
        if len(normalized_text) > MAX_JOB_IMPORT_TEXT_CHARS:
            raise ApiError(400, "JD_IMPORT_TEXT_TOO_LARGE")
        try:
            result = await parse_text_draft(
                service, user_id=user.id, text=normalized_text
            )
        except LLMError as error:
            raise_draft_parse_error(error, "text")
        return JobDescriptionDraftResponse(
            draft=result.value,
            warnings=draft_warnings(result.value),
            input_type="text",
            call_id=result.call_id,
        )

    assert image is not None
    image_data_url = validated_image_data_url(await read_limited_image(image))
    try:
        result = await parse_image_draft(
            service, user_id=user.id, image_data_url=image_data_url
        )
    except LLMError as error:
        raise_draft_parse_error(error, "image")
    return JobDescriptionDraftResponse(
        draft=result.value,
        warnings=draft_warnings(result.value),
        input_type="image",
        call_id=result.call_id,
    )


@router.post("", response_model=JobDescriptionResponse, status_code=201)
def create_job_description(
    payload: JobDescriptionCreateRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    try:
        job, application, created = create_job_and_pending_application(
            db, user.id, payload
        )
    except InvalidJobSource as error:
        raise ApiError(400, "INVALID_JOB_SOURCE") from error
    except JobEditConflict as error:
        raise ApiError(409, "JD_EDIT_CONFLICT") from error
    except JobWriteFailed as error:
        raise ApiError(500, "JD_WRITE_FAILED") from error
    response.status_code = 201 if created else 200
    bind_audit_target(request, job.id)
    return JobDescriptionResponse(
        job_description=job_record(job),
        application=JobImportApplicationRecord.model_validate(application),
    )


@router.post("/import", response_model=JobDescriptionResponse, status_code=201)
def import_job_description(
    payload: JobDescriptionImportRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    try:
        structured = build_job_description_from_capture(payload)
        job, application, created = create_job_and_pending_application(
            db, user.id, structured
        )
    except InvalidJobImport as error:
        raise ApiError(400, "INVALID_JOB_IMPORT") from error
    except InvalidJobSource as error:
        raise ApiError(400, "INVALID_JOB_SOURCE") from error
    except JobEditConflict as error:
        raise ApiError(409, "JD_EDIT_CONFLICT") from error
    except JobWriteFailed as error:
        raise ApiError(500, "JD_WRITE_FAILED") from error
    response.status_code = 201 if created else 200
    bind_audit_target(request, job.id)
    return JobDescriptionResponse(
        job_description=job_record(job),
        application=JobImportApplicationRecord.model_validate(application),
    )


@router.post("/{job_id}/logo", response_model=CompanyLogoResponse)
def upload_company_logo(
    job_id: str,
    request: Request,
    file: UploadFile = File(),
    mode: Literal["fill_missing", "replace"] = Form(default="fill_missing"),
    expected_revision: str | None = Form(default=None, max_length=64),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> CompanyLogoResponse:
    job = require_owned_job(db, job_id, user.id)
    try:
        key = f"company-logo:upload:{user.id}"
        count = request.app.state.redis.incr(key)
        if count == 1:
            request.app.state.redis.expire(key, 60)
    except Exception as error:
        raise ApiError(503, "COMPANY_LOGO_UNAVAILABLE") from error
    if count > 30:
        raise ApiError(429, "COMPANY_LOGO_RATE_LIMITED")
    if mode == "fill_missing" and job.logo_sha256:
        return CompanyLogoResponse(logo_url=job.resolved_logo_url, revision=job.logo_sha256)
    data = file.file.read(MAX_LOGO_BYTES + 1)
    result = attach_logo(db, storage, job, data, mode=mode, expected_revision=expected_revision)
    return CompanyLogoResponse(**result)


@router.get("/{job_id}/logo", response_model=None)
def read_company_logo(
    job_id: str,
    request: Request,
    v: str = Query(pattern=r"^[0-9a-f]{64}$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> Response:
    job = require_owned_job(db, job_id, user.id)
    if v != job.logo_sha256:
        raise ApiError(404, "COMPANY_LOGO_NOT_FOUND")
    etag = f'"{v}"'
    headers = {"Cache-Control": "private, no-cache", "ETag": etag,
               "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"}
    try:
        remote = storage.get(f"company-logos/{v}.webp")
        try:
            matches = {item.strip().removeprefix("W/") for item in request.headers.get("if-none-match", "").split(",")}
            if etag in matches or "*" in matches:
                return Response(status_code=304, headers=headers)
            data = remote.read(MAX_STORED_LOGO_BYTES + 1)
            if not data or len(data) > MAX_STORED_LOGO_BYTES:
                raise ApiError(503, "COMPANY_LOGO_READ_FAILED")
        finally:
            remote.close()
            remote.release_conn()
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "COMPANY_LOGO_NOT_FOUND") from error
        raise ApiError(503, "COMPANY_LOGO_READ_FAILED") from error
    except ApiError:
        raise
    except Exception as error:
        raise ApiError(503, "COMPANY_LOGO_READ_FAILED") from error
    return Response(content=data, media_type="image/webp", headers=headers)


@router.get("/{job_id}", response_model=JobDescriptionResponse)
def get_job_description(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    return JobDescriptionResponse(
        job_description=job_record(require_owned_job(db, job_id, user.id))
    )


@router.put("/{job_id}", response_model=JobDescriptionResponse)
def update_job_description(
    job_id: str,
    payload: JobDescriptionUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    job = require_owned_job(db, job_id, user.id)
    try:
        updated_job = update_owned_job(
            db=db,
            job=job,
            user_id=user.id,
            payload=payload,
        )
    except ValueError as error:
        raise ApiError(400, "INVALID_JOB_DESCRIPTION") from error
    if updated_job is None:
        raise ApiError(409, "JD_EDIT_CONFLICT")
    return JobDescriptionResponse(job_description=job_record(updated_job))


@router.delete("/{job_id}", response_model=DeleteJobDescriptionResponse)
def delete_job_description(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> DeleteJobDescriptionResponse:
    def delete_asset_object(object_name: str) -> None:
        try:
            storage.delete(object_name)
        except S3Error as error:
            if error.code not in {"NoSuchKey", "NoSuchObject"}:
                raise

    try:
        deleted = hard_delete_owned_job(
            db,
            job_id,
            user.id,
            delete_asset_object=delete_asset_object,
        )
    except Exception as error:
        raise ApiError(502, "JD_DELETE_FAILED") from error
    if not deleted:
        raise ApiError(404, "JD_NOT_FOUND")
    return DeleteJobDescriptionResponse(deleted=True)
