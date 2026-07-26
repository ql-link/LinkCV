from __future__ import annotations

import re
import time
import unicodedata
from pathlib import PurePath

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import (
    AssetStorage,
    decode_image_data_url,
    get_storage,
)
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import (
    AvatarResponse,
    AvatarUploadRequest,
    UpdateUserRequest,
    UserResponse,
)
from linkcv.modules.identity.views import build_user_response

router = APIRouter(prefix="/users", tags=["identity"])
AVATAR_MAX_BYTES = 10 * 1024 * 1024
SUPPORTED_AVATAR_CONTENT_TYPES = {
    "image/apng": ".apng",
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
}


def _safe_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    safe = re.sub(r"[^\w.-]+", "-", normalized).strip("-")[:80]
    return safe or "avatar"


def _avatar_object_key(user_id: int, file_name: str, content_type: str) -> str:
    base = PurePath(_safe_name(file_name)).stem or "avatar"
    extension = SUPPORTED_AVATAR_CONTENT_TYPES.get(content_type, ".png")
    unique = f"{int(time.time() * 1000)}-{time.strftime('%H%M%S')}"
    return f"users/{user_id}/avatars/{unique}-{base}{extension}"


@router.patch("/me", response_model=UserResponse)
def update_nickname(
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserResponse:
    nickname = payload.nickname.strip()
    if not nickname:
        raise ApiError(400, "NICKNAME_REQUIRED")
    if len(nickname) > 50:
        raise ApiError(400, "NICKNAME_TOO_LONG")
    user.nickname = nickname
    db.commit()
    db.refresh(user)
    return build_user_response(user)


@router.put("/me/avatar", response_model=AvatarResponse)
def update_avatar(
    payload: AvatarUploadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> AvatarResponse:
    image = decode_image_data_url(payload.dataUrl)
    if image is None:
        raise ApiError(400, "INVALID_IMAGE")
    data, content_type = image
    if len(data) > AVATAR_MAX_BYTES:
        raise ApiError(413, "IMAGE_TOO_LARGE")

    old_key = user.avatar_object_key
    object_key = _avatar_object_key(int(user.id), payload.fileName, content_type)
    try:
        storage.upload(object_key, data, content_type)
    except Exception as error:
        raise ApiError(502, "ASSET_UPLOAD_FAILED") from error

    user.avatar_object_key = object_key
    db.commit()
    db.refresh(user)

    if old_key:
        try:
            storage.delete(old_key)
        except Exception:
            pass

    return AvatarResponse(avatarUrl=build_user_response(user).avatar_url)
