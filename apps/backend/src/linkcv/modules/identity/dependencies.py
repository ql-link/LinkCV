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
from linkcv.modules.observability.audit import bind_audit_actor


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User | None:
    cookie_token = request.cookies.get(settings.access_cookie_name)
    authorization = request.headers.get("authorization")
    bearer_token = None
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() != "bearer" or not value or " " in value:
            return None
        bearer_token = value

    # A request must use exactly one credential carrier. This prevents a browser
    # cookie and an injected Bearer token from silently selecting different users.
    if cookie_token and bearer_token:
        return None
    token = bearer_token or cookie_token
    expected_channel = "miniprogram" if bearer_token else "web"
    decoded = decode_access_token(token, settings)
    if decoded is None:
        return None
    user_id, sid, channel = decoded
    if channel != expected_channel:
        return None
    session = redis_client.hgetall(session_key(sid))
    if (
        not session
        or session.get("uid") != str(user_id)
        or session.get("channel") != channel
    ):
        return None
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or user.status != 1:
        return None
    if bearer_token and user.is_admin:
        return None
    bind_audit_actor(request, user.id, is_admin=bool(user.is_admin))
    return user


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise ApiError(403, "FORBIDDEN")
    return user
