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


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User | None:
    # 1. Access self-check: signature, expiry and sane sub/sid.
    decoded = decode_access_token(
        request.cookies.get(settings.access_cookie_name), settings
    )
    if decoded is None:
        return None
    user_id, sid = decoded
    # 2. Session lives only in Redis; deleted key means revoked or expired.
    if not redis_client.exists(session_key(sid)):
        return None
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or user.status != 1:
        return None
    return user


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise ApiError(403, "FORBIDDEN")
    return user
