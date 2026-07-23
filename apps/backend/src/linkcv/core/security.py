import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Response

from linkcv.core.config import Settings


def create_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(16)}"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode(
        "ascii"
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except (TypeError, ValueError):
        return False


def create_session_token(user_id: str, auth_version: int, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=settings.session_ttl_days)
    return jwt.encode(
        {
            "sub": user_id,
            "ver": auth_version,
            "iat": now,
            "exp": expires_at,
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_session_token(
    token: str | None, settings: Settings
) -> tuple[str, int] | None:
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        subject = payload.get("sub")
        version = payload.get("ver")
        if not isinstance(subject, str) or not isinstance(version, int):
            return None
        return subject, version
    except jwt.PyJWTError:
        return None


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_days * 24 * 60 * 60,
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
