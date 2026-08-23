import logging

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from sqlalchemy.orm import Session

from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import (
    AssetStorage,
    build_avatar_object_name,
    decode_image_data_url,
    get_storage,
)
from linkcv.modules.identity.dependencies import get_current_miniprogram_user
from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import (
    AvatarResponse,
    AvatarUploadRequest,
    MiniProgramProfileResponse,
    MiniProgramProfileUpdateRequest,
)
from linkcv.modules.resumes.asset_routes import (
    infer_image_content_type,
    stream_object,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/miniprogram/account", tags=["miniprogram"])

MAX_AVATAR_BYTES = 10 * 1024 * 1024
NICKNAME_MAX_LENGTH = 50


def mini_avatar_url(user: User) -> str | None:
    if not user.avatar_object_key:
        return None
    return "/api/miniprogram/account/avatar"


def _profile(user: User) -> MiniProgramProfileResponse:
    return MiniProgramProfileResponse(
        nickname=user.nickname,
        avatar_url=mini_avatar_url(user),
    )


@router.get("/profile", response_model=MiniProgramProfileResponse)
def get_profile(
    user: User = Depends(get_current_miniprogram_user),
) -> MiniProgramProfileResponse:
    return _profile(user)


@router.patch("/profile", response_model=MiniProgramProfileResponse)
def update_profile(
    payload: MiniProgramProfileUpdateRequest,
    user: User = Depends(get_current_miniprogram_user),
    db: Session = Depends(get_db),
) -> MiniProgramProfileResponse:
    nickname = payload.nickname.strip()
    if not nickname or len(nickname) > NICKNAME_MAX_LENGTH:
        raise ApiError(400, "INVALID_NICKNAME")
    user.nickname = nickname
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to update nickname for user %s", user.id)
        raise
    db.refresh(user)
    return _profile(user)


@router.put("/avatar", response_model=AvatarResponse)
def upload_avatar(
    payload: AvatarUploadRequest,
    user: User = Depends(get_current_miniprogram_user),
    db: Session = Depends(get_db),
    storage: AssetStorage = Depends(get_storage),
) -> AvatarResponse:
    image = decode_image_data_url(payload.dataUrl)
    if image is None:
        raise ApiError(400, "INVALID_IMAGE")
    data, content_type = image
    if len(data) > MAX_AVATAR_BYTES:
        raise ApiError(413, "IMAGE_TOO_LARGE")

    object_name = build_avatar_object_name(user.id, payload.fileName, content_type)
    try:
        storage.upload(object_name, data, content_type)
    except Exception as error:
        raise ApiError(502, "ASSET_UPLOAD_FAILED") from error

    previous_key = user.avatar_object_key
    user.avatar_object_key = object_name
    try:
        db.commit()
    except Exception as error:
        db.rollback()
        logger.exception("failed to persist avatar for user %s", user.id)
        try:
            storage.delete(object_name)
        except Exception:
            pass
        raise ApiError(502, "ASSET_UPLOAD_FAILED") from error
    db.refresh(user)

    if previous_key and previous_key != object_name:
        try:
            storage.delete(previous_key)
        except Exception:
            logger.warning("failed to delete replaced avatar object %s", previous_key)
    return AvatarResponse(url=mini_avatar_url(user))


@router.get("/avatar", response_model=None)
def read_avatar(
    user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage),
) -> Response:
    object_name = user.avatar_object_key
    if not object_name or not object_name.startswith(f"users/{user.id}/assets/"):
        raise ApiError(404, "ASSET_NOT_FOUND")
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
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )
