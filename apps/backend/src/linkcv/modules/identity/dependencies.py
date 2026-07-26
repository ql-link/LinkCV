"""身份鉴权依赖与三层校验链路。

校验顺序：
  ① Access Token JWT 自洽（解码拿到 user_id + sid）
  ② Redis 会话存活（session 未被删除 / 未绝对过期）
  ③ Refresh Token 哈希一致（用于 Access 过期时自动轮换）
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.security import (
    AccessClaims,
    create_access_token,
    decode_access_token,
    generate_refresh_secret,
    hash_refresh_secret,
    parse_refresh_token,
    set_access_cookie,
    set_refresh_cookie,
    sign_refresh_token,
)
from linkcv.core.sessions import SessionStore
from linkcv.modules.identity.models import User

logger = logging.getLogger(__name__)


def get_settings() -> Settings:
    from linkcv.core.config import load_settings

    return load_settings()


def _load_user(db: Session, user_id: int) -> User | None:
    return db.scalar(select(User).where(User.id == user_id))


# -- 主入口 ------------------------------------------------------------------


async def get_optional_user(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> User | None:
    """三层校验链路，返回 User 或 None。

    第①层：解析 Access Token JWT → 拿到 (user_id, sid)
    第②层：Redis 会话存活检查 + 滑动续期
    第③层：Access 失效时尝试 Refresh Token 自动轮换
    """
    session_store: SessionStore = request.app.state.session_store
    access_token = request.cookies.get(settings.session_cookie_name)
    refresh_token_value = request.cookies.get(settings.refresh_cookie_name)

    # -- 第①层：Access 自洽 --
    claims: AccessClaims | None = decode_access_token(access_token, settings)

    if claims is not None:
        # -- 第②层：Session 存活 --
        session = await session_store.get(claims.sid)
        if session:
            # 校验绝对过期
            abs_raw = session.get("absolute_expires_at")
            if abs_raw and int(abs_raw) > int(datetime.now(timezone.utc).timestamp() * 1000):
                # 滑动续期
                await session_store.touch(claims.sid, settings)
                user = _load_user(db, int(claims.user_id))
                return user

    # -- 第③层：尝试 Refresh Token 自动轮换 --
    if refresh_token_value:
        parsed = parse_refresh_token(refresh_token_value)
        if parsed:
            sid, secret = parsed
            session = await session_store.get(sid)
            if session:
                stored_hash = session.get("refresh_hash")
                if stored_hash and stored_hash == hash_refresh_secret(secret):
                    # 刷新绝对过期
                    abs_raw = session.get("absolute_expires_at")
                    if abs_raw and int(abs_raw) > int(
                        datetime.now(timezone.utc).timestamp() * 1000
                    ):
                        # 生成新 secret 并更新 Redis
                        new_secret = generate_refresh_secret()
                        new_refresh_hash = hash_refresh_secret(new_secret)
                        await session_store._client.hset(  # noqa: SLF001
                            f"auth:session:{sid}",
                            mapping={"refresh_hash": new_refresh_hash},
                        )
                        # 签发新令牌
                        new_access = create_access_token(
                            int(session["user_id"]), sid, settings
                        )
                        new_refresh = sign_refresh_token(sid, new_secret)
                        # 滑动续期
                        await session_store.touch(sid, settings)
                        # 写入 Cookie
                        set_access_cookie(response, new_access, settings)
                        set_refresh_cookie(response, new_refresh, settings)
                        # 加载用户
                        user = _load_user(db, int(session["user_id"]))
                        return user

    # 全部校验失败
    return None


async def get_current_user(
    optional_user: Annotated[User | None, Depends(get_optional_user)],
) -> User:
    """要求当前请求必须已登录。"""
    if optional_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return optional_user


# -- 兼容别名 ----------------------------------------------------------------
# 保留 'get_current_user_admin' 签名（暂不实现 admin 检查）
get_current_user_admin = get_current_user
