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
    build_refresh_token,
    clear_auth_cookies,
    create_access_token,
    hash_password,
    hash_secret,
    new_refresh_secret,
    new_session_id,
    parse_refresh_token,
    password_needs_rehash,
    refresh_max_age_seconds,
    session_key,
    set_access_cookie,
    set_refresh_cookie,
    user_sessions_key,
    verify_password,
)
from linkcv.modules.identity.dependencies import get_optional_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import (
    AuthResponse,
    Credentials,
    MeResponse,
    OkResponse,
    UserResponse,
)

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
    sid = new_session_id()
    secret = new_refresh_secret()
    key = session_key(sid)
    ttl = refresh_max_age_seconds(settings)
    # Session lives only in Redis; nothing is written to MySQL.
    redis_client.hset(
        key,
        mapping={
            "uid": str(user.id),
            "rhash": hash_secret(secret),
            "created_at": utc_now().isoformat(),
        },
    )
    redis_client.expire(key, ttl)
    redis_client.sadd(user_sessions_key(user.id), sid)
    set_access_cookie(response, create_access_token(user.id, sid, settings), settings)
    set_refresh_cookie(response, build_refresh_token(sid, secret), settings)


@router.get("/me", response_model=MeResponse)
def me(user: User | None = Depends(get_optional_user)) -> MeResponse:
    return MeResponse(user=UserResponse.model_validate(user) if user else None)


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: Credentials,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> AuthResponse:
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
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(
    payload: Credentials,
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

    # Keep current Argon2 hashes aligned with the configured parameters.
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    user.last_login_at = utc_now()
    db.commit()
    db.refresh(user)

    issue_session(response, user, settings, redis_client)
    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/admin-login", response_model=AuthResponse)
def admin_login(
    payload: Credentials,
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
    parsed = parse_refresh_token(request.cookies.get(settings.refresh_cookie_name))
    if parsed is None:
        raise ApiError(401, "INVALID_CREDENTIALS")
    sid, secret = parsed
    key = session_key(sid)
    session = redis_client.hgetall(key)
    if not session:
        raise ApiError(401, "INVALID_CREDENTIALS")
    # 3. Refresh hash must match the secret hashed in Redis.
    if session.get("rhash") != hash_secret(secret):
        # Hash mismatch hints at reuse; revoke the session immediately.
        redis_client.delete(key)
        raise ApiError(401, "INVALID_CREDENTIALS")

    user = db.scalar(select(User).where(User.id == int(session["uid"])))
    if user is None or user.status != 1:
        redis_client.delete(key)
        raise ApiError(401, "INVALID_CREDENTIALS")

    # Rotate the refresh secret; sid is stable so the session keeps its identity.
    new_secret = new_refresh_secret()
    redis_client.hset(key, "rhash", hash_secret(new_secret))
    redis_client.expire(key, refresh_max_age_seconds(settings))
    set_access_cookie(response, create_access_token(user.id, sid, settings), settings)
    set_refresh_cookie(response, build_refresh_token(sid, new_secret), settings)
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
        redis_client.delete(key)
        if uid and uid.isdecimal():
            redis_client.srem(user_sessions_key(int(uid)), sid)
    clear_auth_cookies(response, settings)
    return OkResponse(ok=True)
