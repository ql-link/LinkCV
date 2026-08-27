import base64
import logging

import redis
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db, utc_now
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
    build_avatar_object_name,
    decode_image_data_url,
    get_storage,
)
from linkcv.integrations.wechat_client import WechatApiError, WechatClient
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User, UserProfile
from linkcv.modules.identity.schemas import (
    AccountProfileResponse,
    AvatarResponse,
    AvatarUploadRequest,
    ChangePasswordRequest,
    OkResponse,
    PasswordChangedResponse,
    ProfileUpdateRequest,
    RecentResumeSummary,
    UserProfileData,
    UserProfileResponse,
    UserProfileUpdateRequest,
    WechatBindConfirmRequest,
    WechatBindRequestResponse,
    WechatBindStatusResponse,
)
from linkcv.modules.identity.wechat_bind_service import (
    bind_status,
    bind_ticket_user,
    mark_bind_success,
    new_bind_ticket,
)
from linkcv.modules.resumes.models import Resume

router = APIRouter(prefix="/account", tags=["account"])
MAX_AVATAR_BYTES = 10 * 1024 * 1024
MIN_PASSWORD_LENGTH = 8
NICKNAME_MAX_LENGTH = 50
RECENT_RESUMES_LIMIT = 5
logger = logging.getLogger(__name__)


def require_legacy_test_route(request: Request) -> None:
    if not getattr(request.app.state, "legacy_identity_test_routes", False):
        raise ApiError(404, "NOT_FOUND")


def _password_strong(password: str) -> bool:
    """至少 8 位且同时包含字母和数字。"""
    if len(password) < MIN_PASSWORD_LENGTH:
        return False
    return any(character.isalpha() for character in password) and any(
        character.isdigit() for character in password
    )


def get_wechat_client(request: Request) -> WechatClient:
    return request.app.state.wechat_client


def _profile(user: User, settings: Settings) -> UserProfileResponse:
    if user.wechat_openid:
        wechat_status = "bound"
    elif settings.wechat_enabled:
        wechat_status = "unbound"
    else:
        wechat_status = "unavailable"
    return UserProfileResponse(
        id=str(user.id),
        email=user.email,
        nickname=user.nickname,
        is_admin=bool(user.is_admin),
        avatar_url=(
            asset_url(user.avatar_object_key) if user.avatar_object_key else None
        ),
        wechat_status=wechat_status,
        wechat_bound_at=user.wechat_bound_at,
    )


def _user_profile_data(profile: UserProfile | None) -> UserProfileData:
    """未创建画像时返回 lock_version=1 的空画像约定，不写库。"""
    if profile is None:
        return UserProfileData(lock_version=1)
    return UserProfileData.model_validate(profile)


def _select_user_profile(db: Session, user_id: int) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def _apply_profile_fields(
    profile: UserProfile, payload: UserProfileUpdateRequest
) -> None:
    """整体替换画像可编辑字段，缺省字段以 None/[] 覆盖旧值。"""
    profile.work_city = payload.work_city
    profile.salary_min = payload.salary_min
    profile.salary_max = payload.salary_max
    profile.salary_currency = payload.salary_currency
    profile.salary_period = payload.salary_period
    profile.employment_type = payload.employment_type
    profile.work_mode = payload.work_mode
    profile.target_positions = list(payload.target_positions)
    profile.exclusions = list(payload.exclusions)
    profile.target_companies = list(payload.target_companies)
    profile.availability = payload.availability
    profile.available_from = payload.available_from
    profile.school = payload.school
    profile.school_tier = list(payload.school_tier)
    profile.major = payload.major
    profile.education_level = payload.education_level
    profile.years_experience = payload.years_experience
    profile.birth_date = payload.birth_date
    profile.languages = list(payload.languages)
    profile.skills = list(payload.skills)
    profile.certifications = list(payload.certifications)
    profile.honors = list(payload.honors)
    profile.campus_experiences = list(payload.campus_experiences)


@router.get("/profile", response_model=AccountProfileResponse)
def get_profile(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
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
    profile_row = _select_user_profile(db, user.id)
    return AccountProfileResponse(
        user=_profile(user, settings),
        resume_count=resume_count,
        recent_resumes=[
            RecentResumeSummary(
                id=str(resume.id), title=resume.title, updated_at=resume.updated_at
            )
            for resume in recent
        ],
        profile=(
            _user_profile_data(profile_row) if profile_row is not None else None
        ),
    )


@router.get("/user-profile", response_model=UserProfileData)
def get_user_profile(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileData:
    """未创建画像时返回空画像（lock_version=1 约定），不写库。"""
    return _user_profile_data(_select_user_profile(db, user.id))


@router.put("/user-profile", response_model=UserProfileData)
def put_user_profile(
    payload: UserProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileData:
    current = _select_user_profile(db, user.id)

    # 首次写入：尝试 INSERT，并发时 UNIQUE 冲突回退到 409。
    if current is None:
        if payload.base_lock_version != 1:
            raise ApiError(
                409,
                "USER_PROFILE_VERSION_CONFLICT",
                details={"profile": _user_profile_data(None).model_dump(mode="json")},
            )
        profile = UserProfile(user_id=user.id, lock_version=1)
        _apply_profile_fields(profile, payload)
        db.add(profile)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = _select_user_profile(db, user.id)
            raise ApiError(
                409,
                "USER_PROFILE_VERSION_CONFLICT",
                details={"profile": _user_profile_data(existing).model_dump(mode="json")},
            ) from None
        except Exception:
            db.rollback()
            logger.exception("failed to create user profile for user %s", user.id)
            raise
        db.refresh(profile)
        return _user_profile_data(profile)

    # 已有画像：原子比较 lock_version，影响 0 行即并发冲突。
    if payload.base_lock_version != current.lock_version:
        raise ApiError(
            409,
            "USER_PROFILE_VERSION_CONFLICT",
            details={"profile": _user_profile_data(current).model_dump(mode="json")},
        )
    updated = db.execute(
        update(UserProfile)
        .where(
            UserProfile.user_id == user.id,
            UserProfile.lock_version == payload.base_lock_version,
        )
        .values(
            lock_version=current.lock_version + 1,
            work_city=payload.work_city,
            salary_min=payload.salary_min,
            salary_max=payload.salary_max,
            salary_currency=payload.salary_currency,
            salary_period=payload.salary_period,
            employment_type=payload.employment_type,
            work_mode=payload.work_mode,
            target_positions=list(payload.target_positions),
            exclusions=list(payload.exclusions),
            target_companies=list(payload.target_companies),
            availability=payload.availability,
            available_from=payload.available_from,
            school=payload.school,
            school_tier=list(payload.school_tier),
            major=payload.major,
            education_level=payload.education_level,
            years_experience=payload.years_experience,
            birth_date=payload.birth_date,
            languages=list(payload.languages),
            skills=list(payload.skills),
            certifications=list(payload.certifications),
            honors=list(payload.honors),
            campus_experiences=list(payload.campus_experiences),
        )
    )
    if updated.rowcount == 0:
        # 并发写入已抢先更新；返回最新画像供前端刷新后重试。
        db.rollback()
        existing = _select_user_profile(db, user.id)
        raise ApiError(
            409,
            "USER_PROFILE_VERSION_CONFLICT",
            details={"profile": _user_profile_data(existing).model_dump(mode="json")},
        ) from None
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to update user profile for user %s", user.id)
        raise
    db.refresh(current)
    return _user_profile_data(current)


@router.patch("/profile", response_model=UserProfileResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
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
    return _profile(user, settings)


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


@router.post(
    "/change-password",
    response_model=PasswordChangedResponse,
    include_in_schema=False,
)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    _legacy_route: None = Depends(require_legacy_test_route),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> PasswordChangedResponse:
    require_legacy_test_route(request)
    if not verify_password(payload.current_password, user.password_hash):
        raise ApiError(400, "INVALID_CURRENT_PASSWORD")
    if not _password_strong(payload.new_password):
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


@router.post(
    "/wechat/bind-request",
    response_model=WechatBindRequestResponse,
    include_in_schema=False,
)
def create_wechat_bind_request(
    request: Request,
    _legacy_route: None = Depends(require_legacy_test_route),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    wechat: WechatClient = Depends(get_wechat_client),
) -> WechatBindRequestResponse:
    require_legacy_test_route(request)
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
    if user.wechat_openid:
        raise ApiError(400, "WECHAT_ALREADY_BOUND")

    ticket = new_bind_ticket(
        redis_client, user.id, settings.wechat_bind_ticket_ttl_seconds
    )
    try:
        qrcode = wechat.mini_program_qrcode(ticket)
    except WechatApiError as error:
        logger.warning(
            "failed to generate wechat qrcode",
            extra={"user_id": user.id, "error_code": error.code},
        )
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from error
    return WechatBindRequestResponse(
        ticket=ticket, qrcode_data=base64.b64encode(qrcode).decode("ascii")
    )


@router.post(
    "/wechat/bind-confirm",
    response_model=OkResponse,
    include_in_schema=False,
)
def confirm_wechat_bind(
    payload: WechatBindConfirmRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    wechat: WechatClient = Depends(get_wechat_client),
) -> OkResponse:
    require_legacy_test_route(request)
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
    try:
        owner_id = bind_ticket_user(redis_client, payload.ticket)
    except ValueError:
        owner_id = None
    if owner_id is None:
        raise ApiError(400, "BIND_TICKET_INVALID")
    if bind_status(redis_client, payload.ticket) == "bound":
        return OkResponse(ok=True)

    try:
        openid = wechat.code_to_openid(payload.code)
    except WechatApiError as error:
        logger.warning(
            "failed to exchange wechat code",
            extra={"ticket": payload.ticket, "error_code": error.code},
        )
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from error

    existing = db.scalar(select(User).where(User.wechat_openid == openid))
    if existing is not None and existing.id != owner_id:
        raise ApiError(409, "WECHAT_ALREADY_BOUND")
    if existing is not None:
        mark_bind_success(
            redis_client, payload.ticket, settings.wechat_bind_ticket_ttl_seconds
        )
        return OkResponse(ok=True)

    owner = db.get(User, owner_id)
    if owner is None:
        raise ApiError(400, "BIND_TICKET_INVALID")
    owner.wechat_openid = openid
    owner.wechat_bound_at = utc_now()
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "WECHAT_ALREADY_BOUND") from error
    mark_bind_success(
        redis_client, payload.ticket, settings.wechat_bind_ticket_ttl_seconds
    )
    return OkResponse(ok=True)


@router.get(
    "/wechat/bind-status",
    response_model=WechatBindStatusResponse,
    include_in_schema=False,
)
def get_wechat_bind_status(
    ticket: str,
    request: Request,
    _legacy_route: None = Depends(require_legacy_test_route),
    user: User = Depends(get_current_user),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> WechatBindStatusResponse:
    require_legacy_test_route(request)
    return WechatBindStatusResponse(status=bind_status(redis_client, ticket))
