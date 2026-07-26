from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.core.security import (
    clear_session_cookies,
    create_access_token,
    decode_access_token,
    hash_password,
    parse_refresh_token,
    set_access_cookie,
    set_refresh_cookie,
    sign_refresh_token,
    verify_password,
)
from linkcv.core.sessions import SessionStore, get_session_store
from linkcv.modules.identity.dependencies import get_optional_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import (
    AuthResponse,
    Credentials,
    MeResponse,
    OkResponse,
)
from linkcv.modules.identity.views import build_user_response

router = APIRouter(prefix="/auth", tags=["identity"])
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_email(value: str) -> str:
    return value.strip().lower()


def random_nickname() -> str:
    return f"用户{secrets.token_hex(3)}"


def _start_session(
    response: Response, user: User, settings: Settings, session_store: SessionStore
) -> None:
    session = session_store.create(user.id, settings)
    if session is None:
        raise ApiError(500, "SESSION_CREATE_FAILED")
    access = create_access_token(user.id, session.sid, settings)
    set_access_cookie(response, access, settings)
    set_refresh_cookie(
        response, sign_refresh_token(session.sid, session.secret), settings
    )


@router.get("/me", response_model=MeResponse)
def me(user: User | None = Depends(get_optional_user)) -> MeResponse:
    return MeResponse(user=build_user_response(user) if user else None)


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: Credentials,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    session_store: SessionStore = Depends(get_session_store),
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
        nickname=random_nickname(),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ApiError(409, "EMAIL_EXISTS") from error
    db.refresh(user)

    _start_session(response, user, settings, session_store)
    return AuthResponse(user=build_user_response(user))


@router.post("/login", response_model=AuthResponse)
def login(
    payload: Credentials,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    session_store: SessionStore = Depends(get_session_store),
) -> AuthResponse:
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise ApiError(401, "INVALID_CREDENTIALS")
    if user.status != 1:
        raise ApiError(401, "INVALID_CREDENTIALS")

    user.last_login_at = utc_now()
    db.commit()
    db.refresh(user)

    _start_session(response, user, settings, session_store)
    return AuthResponse(user=build_user_response(user))


@router.post("/logout", response_model=OkResponse)
def logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    session_store: SessionStore = Depends(get_session_store),
) -> OkResponse:
    # 撤销当前 sid 对应会话并清理两个 Cookie,重复退出保持幂等。
    for cookie_name, parser, kind in (
        (settings.session_cookie_name, decode_access_token, "access"),
        (settings.refresh_cookie_name, parse_refresh_token, "refresh"),
    ):
        cookie = request.cookies.get(cookie_name)
        if cookie:
            parsed = parser(cookie, settings) if kind == "access" else parser(cookie)
            sid = parsed.sid if kind == "access" else (parsed[0] if parsed else None)
            if sid:
                session_store.revoke(sid)
                break
    clear_session_cookies(response, settings)
    return OkResponse(ok=True)
