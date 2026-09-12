from dataclasses import dataclass

import redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import utc_now
from linkcv.core.security import (
    build_refresh_token,
    create_access_token,
    hash_secret,
    new_refresh_secret,
    new_session_id,
    parse_refresh_token,
    refresh_max_age_seconds,
    session_key,
    user_sessions_key,
)
from linkcv.modules.identity.models import User

WEB_CHANNEL = "web"
MINIPROGRAM_CHANNEL = "miniprogram"

ROTATE_REFRESH_SCRIPT = """-- auth_rotate_refresh
local channel = redis.call('HGET', KEYS[1], 'channel')
if channel ~= ARGV[3] and not (ARGV[3] == 'web' and not channel) then return 'invalid' end
if redis.call('HGET', KEYS[1], 'rhash') ~= ARGV[1] then return 'mismatch' end
redis.call('HSET', KEYS[1], 'rhash', ARGV[2], 'channel', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 'rotated'
"""


@dataclass(frozen=True)
class SessionCredentials:
    sid: str
    access_token: str
    refresh_token: str


def issue_session(
    user: User,
    settings: Settings,
    redis_client: "redis.Redis",
    *,
    channel: str,
) -> SessionCredentials:
    if channel not in {WEB_CHANNEL, MINIPROGRAM_CHANNEL}:
        raise ValueError("unsupported session channel")
    sid = new_session_id()
    secret = new_refresh_secret()
    key = session_key(sid)
    redis_client.hset(
        key,
        mapping={
            "uid": str(user.id),
            "rhash": hash_secret(secret),
            "channel": channel,
            "created_at": utc_now().isoformat(),
        },
    )
    redis_client.expire(key, refresh_max_age_seconds(settings))
    redis_client.sadd(user_sessions_key(user.id), sid)
    return SessionCredentials(
        sid=sid,
        access_token=create_access_token(user.id, sid, settings, channel),
        refresh_token=build_refresh_token(sid, secret),
    )


def rotate_session(
    refresh_token: str | None,
    expected_channel: str,
    db: Session,
    settings: Settings,
    redis_client: "redis.Redis",
) -> tuple[User, SessionCredentials] | None:
    parsed = parse_refresh_token(refresh_token)
    if parsed is None:
        return None
    sid, secret = parsed
    key = session_key(sid)
    session = redis_client.hgetall(key)
    session_channel = session.get("channel") or WEB_CHANNEL
    if not session or session_channel != expected_channel:
        return None
    uid = session.get("uid", "")
    if not uid.isdecimal():
        revoke_session(redis_client, sid)
        return None
    user = db.scalar(select(User).where(User.id == int(uid)))
    if user is None or user.status != 1:
        revoke_session(redis_client, sid, int(uid))
        return None

    new_secret = new_refresh_secret()
    rotated = redis_client.eval(
        ROTATE_REFRESH_SCRIPT,
        1,
        key,
        hash_secret(secret),
        hash_secret(new_secret),
        expected_channel,
        refresh_max_age_seconds(settings),
    )
    if rotated != "rotated":
        if rotated == "mismatch":
            revoke_session(redis_client, sid, user.id)
        return None
    return user, SessionCredentials(
        sid=sid,
        access_token=create_access_token(user.id, sid, settings, expected_channel),
        refresh_token=build_refresh_token(sid, new_secret),
    )


def revoke_session(
    redis_client: "redis.Redis",
    sid: str,
    known_user_id: int | None = None,
) -> None:
    uid = str(known_user_id) if known_user_id is not None else redis_client.hget(
        session_key(sid), "uid"
    )
    redis_client.delete(session_key(sid))
    if uid and uid.isdecimal():
        redis_client.srem(user_sessions_key(int(uid)), sid)


def revoke_refresh_token(
    redis_client: "redis.Redis",
    refresh_token: str | None,
    *,
    expected_channel: str,
) -> None:
    parsed = parse_refresh_token(refresh_token)
    if parsed is None:
        return
    sid, _secret = parsed
    if redis_client.hget(session_key(sid), "channel") != expected_channel:
        return
    revoke_session(redis_client, sid)
