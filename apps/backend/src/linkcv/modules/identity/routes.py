"""注册、登录、注销、令牌刷新与用户信息查询。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.security import (
    clear_session_cookies,
    create_access_token,
    hash_password,
    set_access_cookie,
    set_refresh_cookie,
    sign_refresh_token,
    verify_password,
)
from linkcv.core.sessions import SessionStore
from linkcv.modules.identity.dependencies import (
    get_current_user,
    get_settings,
)
from linkcv.modules.identity.models import User

router = APIRouter(tags=["identity"])


# -- 请求 / 响应模型 ----------------------------------------------------------


class Credentials(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 4 or len(v) > 72:
            raise ValueError("Password must be 4–72 characters")
        return v


class UserResponse(BaseModel):
    id: int
    email: str
    nickname: str | None = None
    avatar_url: str | None = None
    status: int
    is_admin: bool

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    user: UserResponse
    detail: str = "ok"


class MeResponse(BaseModel):
    id: int
    email: str
    nickname: str | None = None
    avatar_url: str | None = None
    status: int
    is_admin: bool

    model_config = {"from_attributes": True}


class OkResponse(BaseModel):
    detail: str = "ok"


# -- 辅助 --------------------------------------------------------------------


async def _build_session(
    user_id: int,
    response: Response,
    session_store: SessionStore,
    settings: Settings,
) -> tuple[str, str, str]:
    """创建 Redis 会话并设置双 Cookie。"""
    sid, refresh_token, refresh_hash = await session_store.create(user_id, settings)
    access_token = create_access_token(user_id, sid, settings)
    set_access_cookie(response, access_token, settings)
    set_refresh_cookie(response, refresh_token, settings)
    return sid, refresh_token, refresh_hash


# -- 注册 --------------------------------------------------------------------


@router.post("/auth/register", response_model=AuthResponse)
async def register(
    credentials: Credentials,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    """注册新用户。"""
    # 校验邮箱是否已被注册
    email = credentials.email.lower().strip()
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(email=email, nickname=email.split("@")[0], password_hash=hash_password(credentials.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    # 创建 Redis 会话并设置双 Cookie
    session_store: SessionStore = request.app.state.session_store
    await _build_session(user.id, response, session_store, settings)

    return AuthResponse(
        user=UserResponse.model_validate(user),
        detail="Registration successful",
    )


# -- 登录 --------------------------------------------------------------------


@router.post("/auth/login", response_model=AuthResponse)
async def login(
    credentials: Credentials,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> AuthResponse:
    """登录。"""
    email = credentials.email.lower().strip()
    user = db.scalar(select(User).where(User.email == email))

    if user is None or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # 更新最后登录时间
    from datetime import datetime, timezone

    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user)

    # 创建 Redis 会话并设置双 Cookie
    session_store: SessionStore = request.app.state.session_store
    await _build_session(user.id, response, session_store, settings)

    return AuthResponse(
        user=UserResponse.model_validate(user),
        detail="Login successful",
    )


# -- 注销 --------------------------------------------------------------------


@router.post("/auth/logout", response_model=OkResponse)
async def logout(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> OkResponse:
    """注销。清除 Redis 会话并删除双 Cookie。"""
    # 尝试从 access token 或 refresh token 中提取 sid
    access_token = request.cookies.get(settings.session_cookie_name)
    refresh_value = request.cookies.get(settings.refresh_cookie_name)

    from linkcv.core.security import decode_access_token, parse_refresh_token

    sid: str | None = None
    claims = decode_access_token(access_token, settings)
    if claims is not None:
        sid = claims.sid
    elif refresh_value:
        parsed = parse_refresh_token(refresh_value)
        if parsed:
            sid = parsed[0]

    if sid:
        session_store: SessionStore = request.app.state.session_store
        await session_store.delete(sid)

    clear_session_cookies(response, settings)
    return OkResponse(detail="Logged out")


# -- 获取当前用户 -------------------------------------------------------------


@router.get("/auth/me", response_model=MeResponse)
async def me(
    current_user: Annotated[User, Depends(get_current_user)],
) -> MeResponse:
    """返回已登录用户的信息。"""
    return MeResponse.model_validate(current_user)


# -- 显式刷新令牌 -------------------------------------------------------------


@router.post("/auth/refresh", response_model=OkResponse)
async def refresh(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> OkResponse:
    """显式刷新令牌。"""
    # 交由 get_optional_user 的 Refresh 兜底逻辑处理
    from linkcv.core.security import (
        create_access_token,
        generate_refresh_secret,
        hash_refresh_secret,
        parse_refresh_token,
    )

    session_store: SessionStore = request.app.state.session_store
    refresh_value = request.cookies.get(settings.refresh_cookie_name)
    parsed = parse_refresh_token(refresh_value) if refresh_value else None
    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token",
        )

    sid, secret = parsed
    session = await session_store.get(sid)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session not found",
        )

    stored_hash = session.get("refresh_hash")
    if not stored_hash or stored_hash != hash_refresh_secret(secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token invalid",
        )

    # 轮换
    new_secret = generate_refresh_secret()
    new_refresh_hash = hash_refresh_secret(new_secret)
    await session_store._client.hset(  # noqa: SLF001
        f"auth:session:{sid}",
        mapping={"refresh_hash": new_refresh_hash},
    )
    new_access = create_access_token(int(session["user_id"]), sid, settings)
    new_refresh = sign_refresh_token(sid, new_secret)
    await session_store.touch(sid, settings)

    set_access_cookie(response, new_access, settings)
    set_refresh_cookie(response, new_refresh, settings)

    return OkResponse(detail="Tokens refreshed")
