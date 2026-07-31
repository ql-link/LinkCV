import logging

import redis
from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.core.security import (
    clear_auth_cookies,
    hash_password,
    revoke_user_sessions,
    verify_password,
)
from linkcv.core.storage import (
    AssetStorage,
    asset_url,
    build_asset_object_name,
    decode_image_data_url,
    get_storage,
)
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import (
    AccountProfileResponse,
    AvatarResponse,
    AvatarUploadRequest,
    ChangePasswordRequest,
    OkResponse,
    PasswordChangedResponse,
    ProfileUpdateRequest,
    RecentResumeSummary,
    UserProfileResponse,
)
from linkcv.modules.resumes.models import Resume

router = APIRouter(prefix="/account", tags=["account"])
MAX_AVATAR_BYTES = 10 * 1024 * 1024
MIN_PASSWORD_LENGTH = 8
NICKNAME_MAX_LENGTH = 50
RECENT_RESUMES_LIMIT = 5
logger = logging.getLogger(__name__)


def _profile(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        id=str(user.id),
        email=user.email,
        nickname=user.nickname,
        is_admin=bool(user.is_admin),
        avatar_url=(
            asset_url(user.avatar_object_key) if user.avatar_object_key else None
        ),
    )


@router.get("/profile", response_model=AccountProfileResponse)
def get_profile(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AccountProfileResponse:
    resume_count = (
        db.scalar(
            select(func.count()).select_from(Resume).where(Resume.user_id == user.id)
        )
        or 0
    )
    recent = db.scalars(
        select(Resume)
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id.desc())
        .limit(RECENT_RESUMES_LIMIT)
    ).all()
    return AccountProfileResponse(
        user=_profile(user),
        resume_count=resume_count,
        recent_resumes=[
            RecentResumeSummary(
                id=str(resume.id), title=resume.title, updated_at=resume.updated_at
            )
            for resume in recent
        ],
    )


@router.patch("/profile", response_model=UserProfileResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: AssetStorage = Depends(get_storage),
) -> AvatarResponse:
    image = decode_image_data_url(payload.dataUrl)
    if image is None:
        raise ApiError(400, "INVALID_IMAGE")
    data, content_type = image
    if len(data) > MAX_AVATAR_BYTES:
        raise ApiError(413, "IMAGE_TOO_LARGE")

    object_name = build_asset_object_name(user.id, payload.fileName, content_type)
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

    # Remove the previous avatar only after the replacement is committed.
    if previous_key and previous_key != object_name:
        try:
            storage.delete(previous_key)
        except Exception:
            logger.warning("failed to delete replaced avatar object %s", previous_key)
    return AvatarResponse(url=asset_url(object_name))


@router.delete("/avatar", response_model=OkResponse)
def delete_avatar(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: AssetStorage = Depends(get_storage),
) -> OkResponse:
    previous_key = user.avatar_object_key
    user.avatar_object_key = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to delete avatar for user %s", user.id)
        raise
    if previous_key:
        try:
            storage.delete(previous_key)
        except Exception:
            logger.warning("failed to delete avatar object %s", previous_key)
    return OkResponse(ok=True)


@router.post("/change-password", response_model=PasswordChangedResponse)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> PasswordChangedResponse:
    if not verify_password(payload.current_password, user.password_hash):
        raise ApiError(400, "INVALID_CURRENT_PASSWORD")
    if len(payload.new_password) < MIN_PASSWORD_LENGTH:
        raise ApiError(400, "WEAK_PASSWORD")
    if payload.new_password != payload.confirm_password:
        raise ApiError(400, "PASSWORD_MISMATCH")
    if payload.new_password == payload.current_password:
        raise ApiError(400, "PASSWORD_UNCHANGED")

    user.password_hash = hash_password(payload.new_password)
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to change password for user %s", user.id)
        raise

    # Every existing session is revoked, so the user must sign in with the new
    # password; the current cookies are cleared in the same response.
    revoke_user_sessions(redis_client, user.id)
    clear_auth_cookies(response, settings)
    return PasswordChangedResponse(ok=True, message="密码已修改，请重新登录")
