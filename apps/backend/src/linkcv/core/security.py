"""密码摘要、Access/Refresh Token 与登录 Cookie 工具。

JWT Secret 仅来自环境配置，不进仓库、数据库和日志。
Access Token 为短寿 JWT，Refresh Token 为不透明随机串，只有 sha256 摘要写入 Redis 会话。
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Response
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from linkcv.core.config import Settings

_PASSWORD_HASH = PasswordHash((Argon2Hasher(),))


# -- 密码摘要 ----------------------------------------------------------------


def hash_password(password: str) -> str:
    """Argon2 密码哈希。"""
    return _PASSWORD_HASH.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """校验密码与哈希是否匹配。"""
    try:
        return _PASSWORD_HASH.verify(password, password_hash)
    except Exception:
        # 无效或无法识别的哈希（包括 pwdlib.UnknownHashError）统一视为校验失败。
        return False


# -- Access Token（短寿 JWT）------------------------------------------------


@dataclass(frozen=True)
class AccessClaims:
    user_id: str
    sid: str


def create_access_token(user_id: int | str, sid: str, settings: Settings) -> str:
    """签发短寿 Access Token（JWT）。"""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.access_token_ttl_minutes)
    return jwt.encode(
        {
            "sub": str(user_id),
            "sid": sid,
            "iat": now,
            "exp": expires_at,
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str | None, settings: Settings) -> AccessClaims | None:
    """解码 Access Token，返回 claims 或 None。"""
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        return None
    subject = payload.get("sub")
    sid = payload.get("sid")
    if not isinstance(subject, str) or not isinstance(sid, str) or not sid:
        return None
    return AccessClaims(user_id=subject, sid=sid)


# -- Refresh Token（不透明随机串）--------------------------------------------


def generate_session_id() -> str:
    """生成会话 ID（用于 Redis key 和 refresh token 组装）。"""
    return secrets.token_urlsafe(16)


def generate_refresh_secret() -> str:
    """生成 refresh token 密钥（不透明随机串）。"""
    return secrets.token_urlsafe(32)


def sign_refresh_token(sid: str, secret: str) -> str:
    """将 sid 与 secret 组装为 Cookie 值（sid.secret）。"""
    return f"{sid}.{secret}"


def parse_refresh_token(value: str | None) -> tuple[str, str] | None:
    """解析 Cookie 值，返回 (sid, secret) 或 None。"""
    if not value or "." not in value:
        return None
    sid, _, secret = value.partition(".")
    if not sid or not secret:
        return None
    return sid, secret


def hash_refresh_secret(secret: str) -> str:
    """SHA256 摘要 refresh secret（存入 Redis）。"""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


# -- Cookie 工具 ------------------------------------------------------------


def _cookie_options(settings: Settings, max_age: int) -> dict[str, object]:
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "max_age": max_age,
        "path": "/",
    }


def set_access_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        **_cookie_options(settings, settings.access_token_ttl_minutes * 60),
    )


def set_refresh_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        **_cookie_options(settings, settings.session_ttl_days * 24 * 60 * 60),
    )


def clear_session_cookies(response: Response, settings: Settings) -> None:
    """清除 Access 和 Refresh 双 Cookie。"""
    for name in (settings.session_cookie_name, settings.refresh_cookie_name):
        response.delete_cookie(
            key=name,
            path="/",
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
        )
