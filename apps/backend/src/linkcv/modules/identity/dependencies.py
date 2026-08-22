from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

import redis

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.core.security import decode_access_token, session_key
from linkcv.modules.identity.models import User
from linkcv.modules.identity.session_service import MINIPROGRAM_CHANNEL, WEB_CHANNEL
from linkcv.modules.observability.audit import bind_audit_actor


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def _load_user(
    token: str | None,
    expected_channel: str,
    request: Request,
    db: Session,
    settings: Settings,
    redis_client: "redis.Redis",
) -> User | None:
    decoded = decode_access_token(token, settings)
    if decoded is None:
        return None
    user_id, sid, channel = decoded
    if channel != expected_channel:
        return None
    session = redis_client.hgetall(session_key(sid))
    session_channel = session.get("channel") or WEB_CHANNEL
    if not session or session.get("uid") != str(user_id) or session_channel != channel:
        return None
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or user.status != 1:
        return None
    if expected_channel == MINIPROGRAM_CHANNEL and user.is_admin:
        return None
    bind_audit_actor(request, user.id, is_admin=bool(user.is_admin))
    return user


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization")
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value or " " in value:
        return None
    return value


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User | None:
    # Existing Web routes accept only HttpOnly cookies. Supplying Authorization
    # never upgrades a mini-program session into the full Web user surface.
    if request.headers.get("authorization"):
        return None
    return _load_user(
        request.cookies.get(settings.access_cookie_name),
        WEB_CHANNEL,
        request,
        db,
        settings,
        redis_client,
    )


def get_optional_miniprogram_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User | None:
    if request.cookies.get(settings.access_cookie_name):
        return None
    return _load_user(
        _bearer_token(request),
        MINIPROGRAM_CHANNEL,
        request,
        db,
        settings,
        redis_client,
    )


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_miniprogram_user(
    user: User | None = Depends(get_optional_miniprogram_user),
) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise ApiError(403, "FORBIDDEN")
    return user
