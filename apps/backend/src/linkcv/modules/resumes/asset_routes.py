from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from pydantic import BaseModel

from linkcv.core.errors import ApiError
from linkcv.core.storage import (
    AssetStorage,
    asset_url,
    build_asset_object_name,
    decode_image_data_url,
    get_storage,
    infer_image_content_type,
)
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User

router = APIRouter(prefix="/assets", tags=["assets"])
MAX_IMAGE_BYTES = 10 * 1024 * 1024


class AssetUploadRequest(BaseModel):
    fileName: str = "image"
    dataUrl: str


class AssetResponse(BaseModel):
    objectName: str
    url: str


class AssetUploadResponse(BaseModel):
    asset: AssetResponse


def stream_object(response: Any) -> Iterator[bytes]:
    try:
        for chunk in response.stream(64 * 1024):
            yield chunk
    finally:
        response.close()
        response.release_conn()


@router.post("", response_model=AssetUploadResponse, status_code=201)
def upload_asset(
    payload: AssetUploadRequest,
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> AssetUploadResponse:
    image = decode_image_data_url(payload.dataUrl)
    if image is None:
        raise ApiError(400, "INVALID_IMAGE")
    data, content_type = image
    if len(data) > MAX_IMAGE_BYTES:
        raise ApiError(413, "IMAGE_TOO_LARGE")

    object_name = build_asset_object_name(user.id, payload.fileName, content_type)
    try:
        storage.upload(object_name, data, content_type)
    except Exception as error:
        raise ApiError(502, "ASSET_UPLOAD_FAILED") from error

    return AssetUploadResponse(
        asset=AssetResponse(objectName=object_name, url=asset_url(object_name))
    )


@router.get("/{object_name:path}", response_model=None)
def read_asset(
    object_name: str,
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> StreamingResponse:
    if not object_name.startswith(f"users/{user.id}/"):
        raise ApiError(403, "FORBIDDEN")
    try:
        response = storage.get(object_name)
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "ASSET_NOT_FOUND") from error
        raise ApiError(502, "ASSET_READ_FAILED") from error
    except Exception as error:
        raise ApiError(502, "ASSET_READ_FAILED") from error

    return StreamingResponse(
        stream_object(response),
        media_type=infer_image_content_type(object_name),
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )
