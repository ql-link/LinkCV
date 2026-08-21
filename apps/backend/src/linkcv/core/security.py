import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Response
from pwdlib import PasswordHash
from pwdlib.exceptions import PwdlibError
from pwdlib.hashers.argon2 import Argon2Hasher
from pwdlib.hashers.bcrypt import BcryptHasher

from linkcv.core.config import Settings

_argon2_hasher = Argon2Hasher()
_password_hash = PasswordHash((_argon2_hasher, BcryptHasher()))

SESSION_KEY_PREFIX = "auth:session:"
USER_SESSIONS_KEY_PREFIX = "auth:user_sessions:"


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hash.verify(password, password_hash)
    except (PwdlibError, ValueError, TypeError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    # Upgrade legacy bcrypt hashes and Argon2 hashes with stale parameters.
    try:
        if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
            return True
        if password_hash.startswith("$argon2"):
            return _argon2_hasher.check_needs_rehash(password_hash)
        return False
    except (ValueError, TypeError):
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_session_id() -> str:
    return secrets.token_urlsafe(16)


def new_refresh_secret() -> str:
    return secrets.token_urlsafe(32)


def build_refresh_token(sid: str, secret: str) -> str:
    return f"{sid}.{secret}"


def parse_refresh_token(token: str | None) -> tuple[str, str] | None:
    if not token or "." not in token:
        return None
    sid, _, secret = token.partition(".")
    if not sid or not secret:
        return None
    return sid, secret


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def session_key(sid: str) -> str:
    return f"{SESSION_KEY_PREFIX}{sid}"


def user_sessions_key(user_id: int) -> str:
    return f"{USER_SESSIONS_KEY_PREFIX}{user_id}"


def revoke_user_sessions(redis_client, user_id: int, except_sid: str | None = None) -> int:
    # Delete every session for this user; used by change-password / disable.
    key = user_sessions_key(user_id)
    sids = redis_client.smembers(key)
    removed = 0
    for sid in sids:
        if except_sid is not None and sid == except_sid:
            continue
        redis_client.delete(session_key(sid))
        redis_client.srem(key, sid)
        removed += 1
    if not except_sid:
        redis_client.delete(key)
    return removed


def create_access_token(user_id: int, sid: str, settings: Settings) -> str:
    now = _now()
    expires_at = now + timedelta(minutes=settings.access_ttl_minutes)
    return jwt.encode(
        {"sub": str(user_id), "sid": sid, "iat": now, "exp": expires_at},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(
    token: str | None, settings: Settings
) -> tuple[int, str] | None:
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except (ValueError, jwt.PyJWTError):
        return None
    subject = payload.get("sub")
    sid = payload.get("sid")
    if not isinstance(subject, str) or not subject.isdecimal():
        return None
    if not isinstance(sid, str) or not sid:
        return None
    user_id = int(subject)
    if user_id <= 0 or str(user_id) != subject:
        return None
    return user_id, sid


def access_max_age_seconds(settings: Settings) -> int:
    return settings.access_ttl_minutes * 60


def refresh_max_age_seconds(settings: Settings) -> int:
    return settings.session_ttl_days * 24 * 60 * 60


def set_access_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.access_cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=access_max_age_seconds(settings),
        path="/",
    )


def set_refresh_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=refresh_max_age_seconds(settings),
        path="/api/auth",
    )


def clear_auth_cookies(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.access_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path="/api/auth",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
