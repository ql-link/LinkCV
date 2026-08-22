import re
import secrets

import redis
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.core.security import (
    clear_auth_cookies,
    hash_password,
    parse_refresh_token,
    password_needs_rehash,
    session_key,
    set_access_cookie,
    set_refresh_cookie,
    verify_password,
)
from linkcv.modules.identity.dependencies import get_optional_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.session_service import (
    WEB_CHANNEL,
    issue_session as create_session,
    revoke_session,
    rotate_session,
)
from linkcv.modules.identity.schemas import (
    AuthCapabilitiesResponse,
    AuthResponse,
    Credentials,
    MeResponse,
    OkResponse,
    UserResponse,
)
from linkcv.modules.observability.audit import bind_audit_actor, bind_audit_target

router = APIRouter(prefix="/auth", tags=["identity"])
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_email(value: str) -> str:
    return value.strip().lower()


def issue_session(
    response: Response,
    user: User,
    settings: Settings,
    redis_client: "redis.Redis",
) -> None:
    credentials = create_session(
        user, settings, redis_client, channel=WEB_CHANNEL
    )
    set_access_cookie(response, credentials.access_token, settings)
    set_refresh_cookie(response, credentials.refresh_token, settings)


@router.get("/me", response_model=MeResponse)
def me(user: User | None = Depends(get_optional_user)) -> MeResponse:
    return MeResponse(user=UserResponse.model_validate(user) if user else None)


@router.get("/capabilities", response_model=AuthCapabilitiesResponse)
def auth_capabilities(
    settings: Settings = Depends(get_settings),
) -> AuthCapabilitiesResponse:
    return AuthCapabilitiesResponse(
        password_login_enabled=password_login_enabled(settings)
    )


def password_login_enabled(settings: Settings) -> bool:
    return settings.app_environment.strip().lower() in {"local", "development"}


def require_password_registration_enabled(
    request: Request,
    settings: Settings,
) -> None:
    if (
        not password_login_enabled(settings)
        and not getattr(request.app.state, "legacy_identity_test_routes", False)
    ):
        raise ApiError(404, "NOT_FOUND")


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=201,
    include_in_schema=False,
)
def register(
    payload: Credentials,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> AuthResponse:
    require_password_registration_enabled(request, settings)
    email = normalize_email(payload.email)
    if not EMAIL_PATTERN.fullmatch(email):
        raise ApiError(400, "INVALID_EMAIL")
    if len(payload.password) < 8:
        raise ApiError(400, "WEAK_PASSWORD")
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise ApiError(409, "EMAIL_EXISTS")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        nickname=f"用户{secrets.token_hex(3)}",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "EMAIL_EXISTS") from error
    db.refresh(user)

    issue_session(response, user, settings, redis_client)
    bind_audit_actor(request, user.id)
    bind_audit_target(request, user.id)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthResponse, include_in_schema=False)
def login(
    payload: Credentials,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> AuthResponse:
    if (
        not password_login_enabled(settings)
        and not getattr(request.app.state, "legacy_identity_test_routes", False)
    ):
        raise ApiError(404, "NOT_FOUND")
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if (
        user is None
        or user.status != 1
        or not user.password_hash
        or not verify_password(payload.password, user.password_hash)
    ):
        raise ApiError(401, "INVALID_CREDENTIALS")

    # Keep current Argon2 hashes aligned with the configured parameters.
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    user.last_login_at = utc_now()
    db.commit()
    db.refresh(user)

    issue_session(response, user, settings, redis_client)
    bind_audit_actor(request, user.id)
    bind_audit_target(request, user.id)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/admin-login", response_model=AuthResponse)
def admin_login(
    payload: Credentials,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> AuthResponse:
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if (
        user is None
        or user.status != 1
        or not verify_password(payload.password, user.password_hash)
    ):
        raise ApiError(401, "INVALID_CREDENTIALS")
    bind_audit_actor(request, user.id, is_admin=bool(user.is_admin))
    bind_audit_target(request, user.id)
    if not user.is_admin:
        raise ApiError(403, "FORBIDDEN")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    user.last_login_at = utc_now()
    db.commit()
    db.refresh(user)

    issue_session(response, user, settings, redis_client)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/refresh", response_model=AuthResponse)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> AuthResponse:
    rotated = rotate_session(
        request.cookies.get(settings.refresh_cookie_name),
        WEB_CHANNEL,
        db,
        settings,
        redis_client,
    )
    if rotated is None:
        raise ApiError(401, "INVALID_CREDENTIALS")
    user, credentials = rotated
    bind_audit_actor(request, user.id, is_admin=bool(user.is_admin))
    bind_audit_target(request, credentials.sid)
    set_access_cookie(response, credentials.access_token, settings)
    set_refresh_cookie(response, credentials.refresh_token, settings)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/logout", response_model=OkResponse)
def logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> OkResponse:
    parsed = parse_refresh_token(request.cookies.get(settings.refresh_cookie_name))
    if parsed is not None:
        sid, _ = parsed
        key = session_key(sid)
        uid = redis_client.hget(key, "uid")
        bind_audit_target(request, sid)
        if uid and uid.isdecimal():
            bind_audit_actor(request, int(uid))
        revoke_session(
            redis_client,
            sid,
            int(uid) if uid and uid.isdecimal() else None,
        )
    clear_auth_cookies(response, settings)
    return OkResponse(ok=True)
