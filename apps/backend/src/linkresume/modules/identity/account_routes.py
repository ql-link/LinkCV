import base64
import logging
import re

import redis
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.core.config import Settings
from linkresume.core.database import get_db, utc_now
from linkresume.core.errors import ApiError
from linkresume.core.redis import get_redis
from linkresume.core.security import (
    clear_auth_cookies,
    hash_password,
    revoke_user_sessions,
    verify_password,
    session_key,
)
from linkresume.core.storage import (
    AssetStorage,
    asset_url,
    build_avatar_object_name,
    decode_image_data_url,
    get_storage,
)
from linkresume.integrations.wechat_client import WechatApiError, WechatClient
from linkresume.modules.identity import wechat_action_service as actions
from linkresume.modules.identity.account_deletion_service import (
    active_types, deletion_status, ensure_no_public_responsibility, request_deletion,
)
from linkresume.modules.identity.wechat_routes import require_wechat_environment
from linkresume.modules.identity.dependencies import get_current_user, get_settings, lock_active_user
from linkresume.modules.identity.capabilities import password_login_enabled, require_password_enabled, wechat_login_enabled
from linkresume.modules.identity.models import AccountPreference, User, UserProfile
from linkresume.modules.identity.schemas import (
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
    AccountCapabilities,
    AccountPreferencesResponse,
    ContactEmailRequest,
    ContactEmailResponse,
    CurrentSessionResponse,
    WechatActionRequest, WechatActionPoll, WechatActionConfirm,
    AccountDeletionRequest, AccountDeletionStatusRequest,
)
from linkresume.modules.resumes.models import Resume

router = APIRouter(prefix="/account", tags=["account"])
MAX_AVATAR_BYTES = 10 * 1024 * 1024
MIN_PASSWORD_LENGTH = 8
NICKNAME_MAX_LENGTH = 50
RECENT_RESUMES_LIMIT = 5
logger = logging.getLogger(__name__)


def _password_strong(password: str) -> bool:
    """至少 8 位且同时包含字母和数字。"""
    if len(password) < MIN_PASSWORD_LENGTH:
        return False
    return bool(re.search(r"[A-Za-z]", password) and re.search(r"[0-9]", password))


def require_development_password(settings: Settings = Depends(get_settings)) -> None:
    require_password_enabled(settings)


def _profile(user: User, settings: Settings) -> UserProfileResponse:
    if not wechat_login_enabled(settings):
        wechat_status = "unavailable"
    elif user.wechat_openid:
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
        wechat_bound_at=user.wechat_bound_at if wechat_login_enabled(settings) else None,
        contact_email=user.contact_email,
        registered_at=user.create_time,
    )


def account_capabilities(user: User, settings: Settings) -> AccountCapabilities:
    password = password_login_enabled(settings)
    wechat = wechat_login_enabled(settings)
    method = "password" if password and user.password_hash else "wechat" if wechat and user.wechat_openid else None
    return AccountCapabilities(
        auth_mode="password" if password else "wechat" if wechat else "unavailable",
        can_change_password=password and bool(user.password_hash),
        can_delete_account=settings.account_deletion_enabled and not bool(user.is_admin) and method is not None,
        deletion_confirmation_method=method,
    )


def device_label(user_agent: str) -> str:
    browser = next((label for marker, label in [
        ("Edg/", "Edge"), ("OPR/", "Opera"), ("Chrome/", "Chrome"),
        ("Firefox/", "Firefox"), ("Safari/", "Safari"),
    ] if marker in user_agent), None)
    system = next((label for marker, label in [
        ("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iPadOS"),
        ("Windows", "Windows"), ("Macintosh", "macOS"), ("Linux", "Linux"),
    ] if marker in user_agent), None)
    return " · ".join(part for part in [system, browser] if part) or "当前浏览器"


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
    profile.candidate_cities = list(payload.candidate_cities)
    profile.salary_min = payload.salary_min
    profile.salary_max = payload.salary_max
    profile.salary_currency = payload.salary_currency
    profile.salary_period = payload.salary_period
    profile.employment_types = list(payload.employment_types)
    profile.school = payload.school
    profile.school_tier = list(payload.school_tier)
    profile.major = payload.major
    profile.education_level = payload.education_level
    profile.years_experience = payload.years_experience
    profile.candidate_status = payload.candidate_status
    profile.graduation_year = payload.graduation_year
    profile.languages = list(payload.languages)
    profile.skills = list(payload.skills)
    profile.certifications = list(payload.certifications)
    profile.honors = list(payload.honors)
    profile.campus_experiences = list(payload.campus_experiences)


@router.get("/profile", response_model=AccountProfileResponse)
def get_profile(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
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
        .order_by(Resume.update_time.desc(), Resume.id.desc())
        .limit(RECENT_RESUMES_LIMIT)
    ).all()
    return AccountProfileResponse(
        user=_profile(user, settings),
        current_session=CurrentSessionResponse(
            device_label=device_label(redis_client.hget(
                session_key(request.state.session_id), "user_agent"
            ) or "")
        ),
        capabilities=account_capabilities(user, settings),
        resume_count=resume_count,
        recent_resumes=[
            RecentResumeSummary(
                id=str(resume.id), title=resume.title, updated_at=resume.update_time
            )
            for resume in recent
        ],
    )


@router.put("/contact-email", response_model=ContactEmailResponse)
def update_contact_email(
    payload: ContactEmailRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContactEmailResponse:
    user = lock_active_user(db, user.id)
    email = payload.email.strip() if payload.email is not None else ""
    if email and (len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)):
        raise ApiError(400, "INVALID_CONTACT_EMAIL")
    user.contact_email = email or None
    db.commit()
    return ContactEmailResponse(contact_email=user.contact_email)


def _preferences(row: AccountPreference | None) -> AccountPreferencesResponse:
    return AccountPreferencesResponse(
        locale=row.locale if row else "zh-CN",
        interview_reminder_enabled=bool(row.is_interview_reminder_enabled) if row else False,
    )


@router.get("/preferences", response_model=AccountPreferencesResponse)
def get_preferences(
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> AccountPreferencesResponse:
    return _preferences(db.scalar(select(AccountPreference).where(AccountPreference.user_id == user.id)))


@router.patch("/preferences", response_model=AccountPreferencesResponse)
def update_preferences(
    payload: dict[str, object],
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> AccountPreferencesResponse:
    user = lock_active_user(db, user.id)
    if not payload or set(payload) - {"locale", "interview_reminder_enabled"}:
        raise ApiError(400, "INVALID_ACCOUNT_PREFERENCES")
    if "locale" in payload and payload["locale"] not in ("zh-CN", "en-US"):
        raise ApiError(400, "INVALID_ACCOUNT_PREFERENCES")
    if "interview_reminder_enabled" in payload and type(payload["interview_reminder_enabled"]) is not bool:
        raise ApiError(400, "INVALID_ACCOUNT_PREFERENCES")
    row = db.scalar(select(AccountPreference).where(AccountPreference.user_id == user.id))
    if row is None:
        row = AccountPreference(user_id=user.id, locale="zh-CN", is_interview_reminder_enabled=0)
        db.add(row)
    if "locale" in payload:
        row.locale = str(payload["locale"])
    if "interview_reminder_enabled" in payload:
        row.is_interview_reminder_enabled = int(bool(payload["interview_reminder_enabled"]))
    db.commit()
    return _preferences(row)


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
    user = lock_active_user(db, user.id)
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
            candidate_cities=list(payload.candidate_cities),
            salary_min=payload.salary_min,
            salary_max=payload.salary_max,
            salary_currency=payload.salary_currency,
            salary_period=payload.salary_period,
            employment_types=list(payload.employment_types),
            school=payload.school,
            school_tier=list(payload.school_tier),
            major=payload.major,
            education_level=payload.education_level,
            years_experience=payload.years_experience,
            candidate_status=payload.candidate_status,
            graduation_year=payload.graduation_year,
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
    user = lock_active_user(db, user.id)
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
    user = lock_active_user(db, user.id)
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
    user = lock_active_user(db, user.id)
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
    dependencies=[Depends(require_development_password)],
)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> PasswordChangedResponse:
    user = lock_active_user(db, user.id)
    require_password_enabled(settings)
    _limit_sensitive(request, redis_client, "password-change", user.id)
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
        # Revoke under the same owner lock used by login/refresh. A Redis
        # failure rolls back the password instead of leaving old sessions valid.
        revoke_user_sessions(redis_client, user.id)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("failed to change password for user %s", user.id)
        raise

    # Every existing session is revoked, so the user must sign in with the new
    # password; the current cookies are cleared in the same response.
    clear_auth_cookies(response, settings)
    return PasswordChangedResponse(ok=True, message="密码已修改，请重新登录")


def _limit_sensitive(request: Request, redis_client, operation: str, user_id: int | None = None) -> None:
    actions.rate_limit(redis_client, operation, "ip:" + (request.client.host if request.client else "unknown"))
    if user_id is not None:
        actions.rate_limit(redis_client, operation, f"user:{user_id}")


def get_wechat_client(request: Request) -> WechatClient:
    return request.app.state.wechat_client


@router.post("/wechat/verification-request", dependencies=[Depends(require_wechat_environment)])
def create_verification(
    payload: WechatActionRequest, request: Request,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings), redis_client=Depends(get_redis),
    wechat: WechatClient = Depends(get_wechat_client),
) -> dict:
    user = lock_active_user(db, user.id)
    if not settings.account_deletion_enabled:
        raise ApiError(404, "NOT_FOUND")
    if user.is_admin:
        raise ApiError(403, "ACCOUNT_DELETION_FORBIDDEN")
    if not user.wechat_openid:
        raise ApiError(409, "WECHAT_IDENTITY_REQUIRED")
    ensure_no_public_responsibility(db, user.id)
    busy = active_types(db, user.id)
    if busy:
        raise ApiError(409, "ACCOUNT_BUSY", details={"activity_types": busy})
    _limit_sensitive(request, redis_client, "wechat-verification", user.id)
    result = actions.new_action(redis_client, user.id, request.state.session_id, settings.jwt_secret)
    try:
        image = wechat.mini_program_qrcode(result["scene"])
    except WechatApiError:
        redis_client.delete(actions.action_key(result["scene"]))
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from None
    return {**result, "qrcode_data": base64.b64encode(image).decode("ascii")}


@router.post("/wechat/verification-confirm", dependencies=[Depends(require_wechat_environment)])
def confirm_verification(
    payload: WechatActionConfirm, request: Request,
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings),
    redis_client=Depends(get_redis), wechat: WechatClient = Depends(get_wechat_client),
) -> dict:
    if not settings.account_deletion_enabled:
        raise ApiError(404, "NOT_FOUND")
    actions.rate_limit(redis_client, "wechat-confirm", request.client.host if request.client else "unknown", 30)
    row = actions.confirmation_action(redis_client, payload.scene)
    user = lock_active_user(db, int(row["uid"]))
    try:
        openid = wechat.code_to_openid(payload.code)
    except WechatApiError:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from None
    if not user.wechat_openid or user.wechat_openid != openid:
        raise ApiError(403, "WECHAT_IDENTITY_MISMATCH")
    state = redis_client.eval(actions.TRANSITION_SCRIPT, 1, actions.action_key(payload.scene), "verify")
    if state != "verified":
        raise ApiError(409, "ACCOUNT_CONFIRMATION_UNAVAILABLE")
    return {"ok": True}


@router.post("/wechat/verification-status", dependencies=[Depends(require_wechat_environment)])
def verification_status(
    payload: WechatActionPoll, request: Request,
    user: User = Depends(get_current_user), settings: Settings = Depends(get_settings),
    redis_client=Depends(get_redis),
) -> dict:
    return actions.status(redis_client, payload.scene, payload.poll_token, user.id, request.state.session_id, settings.jwt_secret)


@router.post("/wechat/verification-cancel", dependencies=[Depends(require_wechat_environment)])
def cancel_verification(
    payload: WechatActionPoll, request: Request,
    user: User = Depends(get_current_user), redis_client=Depends(get_redis),
) -> dict:
    actions.owned_action(redis_client, payload.scene, payload.poll_token, user.id, request.state.session_id)
    return {"status": redis_client.eval(actions.TRANSITION_SCRIPT, 1, actions.action_key(payload.scene), "cancel")}


@router.post("/deletion", status_code=202)
def delete_account(
    payload: AccountDeletionRequest, request: Request, response: Response,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings), redis_client=Depends(get_redis),
) -> dict:
    _limit_sensitive(request, redis_client, "deletion", user.id)
    result = request_deletion(
        db, user_id=user.id, sid=request.state.session_id, payload=payload,
        settings=settings, redis_client=redis_client,
    )
    # The persisted deletion marker already denies all old credentials even
    # if Redis is temporarily unavailable after this committed transaction.
    try:
        revoke_user_sessions(redis_client, user.id)
    except redis.RedisError:
        logger.warning("account session cleanup deferred", extra={"user_id": user.id})
    clear_auth_cookies(response, settings)
    return result


@router.post("/deletion-status")
def get_deletion_status(
    payload: AccountDeletionStatusRequest, request: Request,
    db: Session = Depends(get_db), redis_client=Depends(get_redis),
) -> dict:
    actions.rate_limit(redis_client, "deletion-status", request.client.host if request.client else "unknown", 60)
    return deletion_status(db, payload.job_id, payload.receipt_token)
