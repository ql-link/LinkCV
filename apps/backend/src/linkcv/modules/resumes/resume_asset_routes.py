from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import (
    AssetStorage,
    build_resume_asset_object_name,
    decode_image_data_url,
    get_storage,
    infer_image_content_type,
)
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import ResumeVersion
from linkcv.modules.resumes.routes import require_owned_resume

router = APIRouter(prefix="/resumes/{resume_id}/assets", tags=["resume-assets"])
MAX_IMAGE_BYTES = 10 * 1024 * 1024


class ResumeAssetUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_name: str = "image"
    data_url: str


class ResumeAssetRecord(BaseModel):
    object_key: str
    url: str


class ResumeAssetResponse(BaseModel):
    asset: ResumeAssetRecord


class DeleteResumeAssetResponse(BaseModel):
    deleted: bool


def _stream_object(response: Any) -> Iterator[bytes]:
    try:
        for chunk in response.stream(64 * 1024):
            yield chunk
    finally:
        response.close()
        response.release_conn()


def _asset_prefix(user_id: int, resume_id: int) -> str:
    return f"users/{user_id}/resumes/{resume_id}/assets/"


def _object_url(resume_id: int, object_name: str) -> str:
    asset_name = object_name.rsplit("/", 1)[-1]
    return f"/api/resumes/{resume_id}/assets/{quote(asset_name, safe='')}"


def _contains_reference(value: object, object_key: str) -> bool:
    if isinstance(value, str):
        return object_key in value
    if isinstance(value, dict):
        return any(_contains_reference(item, object_key) for item in value.values())
    if isinstance(value, list):
        return any(_contains_reference(item, object_key) for item in value)
    return False


@router.post("", response_model=ResumeAssetResponse, status_code=201)
def upload_resume_asset(
    resume_id: str,
    payload: ResumeAssetUploadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> ResumeAssetResponse:
    resume = require_owned_resume(db, resume_id, user.id)
    image = decode_image_data_url(payload.data_url)
    if image is None:
        raise ApiError(400, "INVALID_IMAGE")
    data, content_type = image
    if len(data) > MAX_IMAGE_BYTES:
        raise ApiError(413, "IMAGE_TOO_LARGE")
    object_key = build_resume_asset_object_name(
        user.id,
        resume.id,
        payload.file_name,
        content_type,
    )
    try:
        storage.upload(object_key, data, content_type)
    except Exception as error:
        raise ApiError(502, "ASSET_UPLOAD_FAILED") from error
    return ResumeAssetResponse(
        asset=ResumeAssetRecord(
            object_key=object_key,
            url=_object_url(resume.id, object_key),
        )
    )


@router.get("/{asset_name}", response_model=None)
def read_resume_asset(
    resume_id: str,
    asset_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> StreamingResponse:
    resume = require_owned_resume(db, resume_id, user.id)
    if "/" in asset_name or "\\" in asset_name or asset_name in {".", ".."}:
        raise ApiError(404, "ASSET_NOT_FOUND")
    object_key = _asset_prefix(user.id, resume.id) + asset_name
    try:
        response = storage.get(object_key)
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "ASSET_NOT_FOUND") from error
        raise ApiError(502, "ASSET_READ_FAILED") from error
    except Exception as error:
        raise ApiError(502, "ASSET_READ_FAILED") from error
    return StreamingResponse(
        _stream_object(response),
        media_type=infer_image_content_type(object_key),
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{asset_name}", response_model=DeleteResumeAssetResponse)
def delete_resume_asset(
    resume_id: str,
    asset_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> DeleteResumeAssetResponse:
    resume = require_owned_resume(db, resume_id, user.id)
    if "/" in asset_name or "\\" in asset_name or asset_name in {".", ".."}:
        raise ApiError(404, "ASSET_NOT_FOUND")
    object_key = _asset_prefix(user.id, resume.id) + asset_name
    asset_url = _object_url(resume.id, object_key)
    if _contains_reference(resume.data_json, object_key) or _contains_reference(
        resume.data_json, asset_url
    ):
        raise ApiError(409, "ASSET_IN_USE")
    versions = db.scalars(
        select(ResumeVersion).where(ResumeVersion.resume_id == resume.id)
    ).all()
    if any(
        _contains_reference(version.data_json, object_key)
        or _contains_reference(version.data_json, asset_url)
        for version in versions
    ):
        raise ApiError(409, "ASSET_IN_USE")
    try:
        storage.delete(object_key)
    except Exception as error:
        raise ApiError(502, "ASSET_DELETE_FAILED") from error
    return DeleteResumeAssetResponse(deleted=True)
