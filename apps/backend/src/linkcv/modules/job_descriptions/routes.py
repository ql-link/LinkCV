from __future__ import annotations

import base64
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from linkcv.application.job_descriptions.service import (
    DuplicateJobDescription,
    JobEditConflict,
    JobWriteFailed,
    create_or_resolve_job,
    find_owned_job,
    hard_delete_owned_job,
    list_owned_jobs,
    update_owned_job,
)
from linkcv.application.job_descriptions.import_service import (
    InvalidJobImport,
    build_job_description_from_capture,
)
from linkcv.application.job_descriptions.ai_import_service import (
    draft_warnings,
    parse_image_draft,
    parse_text_draft,
)
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.job_source import InvalidJobSource
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.job_descriptions.schemas import (
    DeleteJobDescriptionResponse,
    JobDescriptionCreateRequest,
    JobDescriptionImportRequest,
    JobDescriptionListResponse,
    JobDescriptionRecord,
    JobDescriptionResponse,
    JobDescriptionSummary,
    JobDescriptionUpdateRequest,
    JobDescriptionDraftResponse,
)
from linkcv.modules.llm.dependencies import get_llm_service
from linkcv.modules.llm.service import LLMError, LLMService
from linkcv.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/job-descriptions", tags=["job-descriptions"])
MAX_JOB_IMPORT_TEXT_CHARS = 60_000
MAX_JOB_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024
MAX_JOB_IMPORT_IMAGE_PIXELS = 40_000_000
IMAGE_MIME_BY_FORMAT = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


async def read_limited_image(image: UploadFile) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while True:
        chunk = await image.read(min(1024 * 1024, MAX_JOB_IMPORT_IMAGE_BYTES + 1 - size))
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
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as error:
        raise ApiError(400, "JD_IMPORT_IMAGE_INVALID") from error
    return f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}"


def raise_draft_parse_error(error: LLMError, input_type: str) -> None:
    details = {"callId": error.call_id, "inputType": input_type}
    if error.code in {"LLM_MODEL_NOT_CONFIGURED", "LLM_CHAT_NOT_CONFIGURED", "LLM_CREDENTIALS_UNAVAILABLE"}:
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
            "JD_IMPORT_INPUT_AMBIGUOUS" if normalized_text and image is not None else "JD_IMPORT_INPUT_REQUIRED",
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
        result = create_or_resolve_job(db=db, user_id=user.id, payload=payload)
    except InvalidJobSource as error:
        raise ApiError(400, "INVALID_JOB_SOURCE") from error
    except DuplicateJobDescription as error:
        raise ApiError(409, "JD_SOURCE_DUPLICATE", duplicate_details(error)) from error
    except JobEditConflict as error:
        raise ApiError(409, "JD_EDIT_CONFLICT") from error
    except JobWriteFailed as error:
        raise ApiError(500, "JD_WRITE_FAILED") from error
    response.status_code = 201 if result.created else 200
    bind_audit_target(request, result.job.id)
    return JobDescriptionResponse(job_description=job_record(result.job))


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
        result = create_or_resolve_job(db=db, user_id=user.id, payload=structured)
    except InvalidJobImport as error:
        raise ApiError(400, "INVALID_JOB_IMPORT") from error
    except InvalidJobSource as error:
        raise ApiError(400, "INVALID_JOB_SOURCE") from error
    except DuplicateJobDescription as error:
        raise ApiError(409, "JD_SOURCE_DUPLICATE", duplicate_details(error)) from error
    except JobEditConflict as error:
        raise ApiError(409, "JD_EDIT_CONFLICT") from error
    except JobWriteFailed as error:
        raise ApiError(500, "JD_WRITE_FAILED") from error
    response.status_code = 201 if result.created else 200
    bind_audit_target(request, result.job.id)
    return JobDescriptionResponse(job_description=job_record(result.job))


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
) -> DeleteJobDescriptionResponse:
    deleted = hard_delete_owned_job(db, job_id, user.id)
    if not deleted:
        raise ApiError(404, "JD_NOT_FOUND")
    return DeleteJobDescriptionResponse(deleted=True)
