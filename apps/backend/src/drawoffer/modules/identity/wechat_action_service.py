"""Short-lived, session-bound WeChat proof for a destructive account action."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta

from drawoffer.core.database import utc_now
from drawoffer.core.errors import ApiError
from drawoffer.core.security import hash_secret, session_key

TTL_SECONDS = 300
PREFIX = "account:wechat-action:"

CREATE_SCRIPT = """-- account_action_create
local previous = redis.call('GET', KEYS[1])
if previous then
  local state = redis.call('HGET', previous, 'state')
  if state == 'pending' or state == 'verified' then
    redis.call('HSET', previous, 'state', 'cancelled')
  end
end
redis.call('HSET', KEYS[2], 'uid', ARGV[1], 'sid', ARGV[2],
  'action', 'delete_account', 'state', 'pending', 'poll_hash', ARGV[3],
  'action_hash', ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[5])
redis.call('SET', KEYS[1], KEYS[2], 'EX', ARGV[5])
return 1
"""
TRANSITION_SCRIPT = """-- account_action_transition
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'expired' end
if ARGV[1] == 'verify' and state == 'pending' then
  redis.call('HSET', KEYS[1], 'state', 'verified')
  return 'verified'
end
if ARGV[1] == 'cancel' and (state == 'pending' or state == 'verified') then
  redis.call('HSET', KEYS[1], 'state', 'cancelled')
  return 'cancelled'
end
return state
"""
CONSUME_SCRIPT = """-- account_action_consume
if redis.call('HGET', KEYS[1], 'state') ~= 'verified' then return 0 end
if redis.call('HGET', KEYS[1], 'uid') ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[1], 'sid') ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[1], 'action') ~= 'delete_account' then return 0 end
if redis.call('HGET', KEYS[1], 'action_hash') ~= ARGV[3] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'consumed')
redis.call('HDEL', KEYS[1], 'action_hash')
return 1
"""


def rate_limit(redis_client, operation: str, identity: str, limit: int = 5) -> None:
    key = f"account:rate:{operation}:{identity}"
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 60)
    if count > limit:
        raise ApiError(429, "ACCOUNT_RATE_LIMITED")


def action_key(scene: str) -> str:
    return PREFIX + scene


def _token(scene: str, poll_token: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), f"account-action/{scene}/{poll_token}".encode(), hashlib.sha256).hexdigest()
    return f"{scene}.{digest}"


def new_action(redis_client, user_id: int, sid: str, secret: str) -> dict:
    scene = "del:" + secrets.token_hex(12)
    poll_token = secrets.token_urlsafe(32)
    redis_client.eval(
        CREATE_SCRIPT, 2, f"{PREFIX}current:{user_id}:{sid}", action_key(scene),
        str(user_id), sid, hash_secret(poll_token),
        hash_secret(_token(scene, poll_token, secret)), TTL_SECONDS,
    )
    return {
        "scene": scene, "poll_token": poll_token,
        "expires_at": (utc_now() + timedelta(seconds=TTL_SECONDS)).isoformat(),
    }


def owned_action(redis_client, scene: str, poll_token: str, user_id: int, sid: str) -> dict:
    row = redis_client.hgetall(action_key(scene))
    if not row:
        raise ApiError(410, "ACCOUNT_CONFIRMATION_EXPIRED")
    if row.get("uid") != str(user_id) or row.get("sid") != sid or not hmac.compare_digest(
        row.get("poll_hash", ""), hash_secret(poll_token)
    ):
        raise ApiError(404, "NOT_FOUND")
    return row


def confirmation_action(redis_client, scene: str) -> dict:
    row = redis_client.hgetall(action_key(scene))
    if not row:
        raise ApiError(410, "ACCOUNT_CONFIRMATION_EXPIRED")
    if row.get("state") not in {"pending", "verified"}:
        raise ApiError(409, "ACCOUNT_CONFIRMATION_UNAVAILABLE")
    session = redis_client.hgetall(session_key(row["sid"]))
    if session.get("uid") != row["uid"] or session.get("channel", "web") != "web":
        raise ApiError(410, "ACCOUNT_CONFIRMATION_EXPIRED")
    return row


def status(redis_client, scene: str, poll_token: str, user_id: int, sid: str, secret: str) -> dict:
    row = owned_action(redis_client, scene, poll_token, user_id, sid)
    result = {"status": row["state"]}
    if row["state"] == "verified":
        result["action_token"] = _token(scene, poll_token, secret)
    return result


def validate_token(redis_client, token: str, user_id: int, sid: str) -> str:
    scene, separator, _digest = token.partition(".")
    row = redis_client.hgetall(action_key(scene)) if separator else {}
    if not row:
        raise ApiError(410, "ACCOUNT_CONFIRMATION_EXPIRED")
    if (
        row.get("state") != "verified" or row.get("uid") != str(user_id)
        or row.get("sid") != sid or row.get("action") != "delete_account"
        or not hmac.compare_digest(row.get("action_hash", ""), hash_secret(token))
    ):
        raise ApiError(403, "ACCOUNT_CONFIRMATION_INVALID")
    return scene


def consume(redis_client, token: str, user_id: int, sid: str) -> None:
    scene = validate_token(redis_client, token, user_id, sid)
    if not redis_client.eval(CONSUME_SCRIPT, 1, action_key(scene), str(user_id), sid, hash_secret(token)):
        raise ApiError(403, "ACCOUNT_CONFIRMATION_INVALID")
