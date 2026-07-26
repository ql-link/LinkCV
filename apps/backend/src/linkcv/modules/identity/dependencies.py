from __future__ import annotations

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.security import (
    AccessClaims,
    create_access_token,
    decode_access_token,
    hash_refresh_secret,
    parse_refresh_token,
    set_access_cookie,
    set_refresh_cookie,
    sign_refresh_token,
)
from linkcv.core.sessions import SessionStore, get_session_store
from linkcv.modules.identity.models import User


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def _load_active_user(db: Session, user_id: str) -> User | None:
    user = db.get(User, int(user_id))
    if user is None or user.status != 1:
        return None
    return user


def _issue_cookies(
    response: Response, user_id: str, sid: str, settings: Settings
) -> None:
    access = create_access_token(user_id, sid, settings)
    set_access_cookie(response, access, settings)


def get_optional_user(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    session_store: SessionStore = Depends(get_session_store),
) -> User | None:
    """统一鉴权依赖:依次执行三校验,任一成功即放行并按需滑动续期。"""
    access_cookie = request.cookies.get(settings.session_cookie_name)
    claims = decode_access_token(access_cookie, settings)

    # 校验1 (Access JWT 自洽) + 校验2 (Redis 会话存活)。
    if claims is not None:
        session = session_store.get(claims.sid)
        if session is not None and session.user_id == claims.user_id:
            user = _load_active_user(db, session.user_id)
            if user is not None:
                session_store.touch(claims.sid, settings)
                return user

    # 校验3:Refresh 通行串一致。仅当 Access 不可用时触发,成功时轮换 refresh。
    refresh_cookie = request.cookies.get(settings.refresh_cookie_name)
    parsed = parse_refresh_token(refresh_cookie)
    if parsed is not None:
        sid, secret = parsed
        session = session_store.get(sid)
        if (
            session is not None
            and hash_refresh_secret(secret) == session.refresh_token_hash
        ):
            user = _load_active_user(db, session.user_id)
            if user is not None:
                rotated = session_store.rotate(sid, settings)
                if rotated is not None:
                    _issue_cookies(response, str(user.id), sid, settings)
                    set_refresh_cookie(
                        response, sign_refresh_token(sid, rotated.secret), settings
                    )
                    return user

    return None


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


__all__ = [
    "AccessClaims",
    "get_current_user",
    "get_optional_user",
    "get_settings",
]
