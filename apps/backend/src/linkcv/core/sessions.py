"""Redis 鉴权会话仓储。会话只存活于 Redis,不落 MySQL,不建立 Session 表。

  auth:session:{sid}            Hash(user_id, refresh_token_hash, absolute_expires_at)
  auth:user:{user_id}:sessions  Set(该用户全部 sid)

Key 存在即有效,删除即撤销;Redis TTL 提供 SESSION_TTL_DAYS 滑动有效期,
absolute_expires_at 限制单会话最长持续 REFRESH_TOKEN_ABSOLUTE_DAYS 天。
提供 RedisSessionStore(生产)与 InMemorySessionStore(测试)两套实现。
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from fastapi import Request

from linkcv.core.config import Settings

SESSION_HASH_FIELDS = ("user_id", "refresh_token_hash", "absolute_expires_at")


@dataclass(frozen=True)
class SessionData:
    sid: str
    user_id: str
    refresh_token_hash: str
    absolute_expires_at: int  # 毫秒
    secret: str  # 仅在创建/轮换时持有,不会写入 Redis


def _now_ms(*, injected: float | None = None) -> int:
    return int(injected if injected is not None else time.time() * 1000)


def absolute_expires_at_ms(settings: Settings, *, now_ms: float | None = None) -> int:
    return _now_ms(injected=now_ms) + int(
        settings.refresh_token_absolute_days * 24 * 60 * 60 * 1000
    )


def sliding_ttl_seconds(settings: Settings) -> int:
    return settings.session_ttl_days * 24 * 60 * 60


def _is_absolute_expired(session: SessionData, *, now_ms: float | None = None) -> bool:
    return _now_ms(injected=now_ms) >= session.absolute_expires_at


def second_probe_until(
    sliding_ttl: int, absolute_expires_ms: int, *, now_ms: float | None = None
) -> int:
    remaining_ms = absolute_expires_ms - _now_ms(injected=now_ms)
    if remaining_ms <= 0:
        return 0
    sliding_ms = sliding_ttl * 1000
    capped = min(sliding_ms, remaining_ms) // 1000
    return int(capped)


def _import_session_id() -> str:
    from linkcv.core.security import generate_session_id

    return generate_session_id()


def _import_refresh_secret() -> str:
    from linkcv.core.security import generate_refresh_secret

    return generate_refresh_secret()


def _import_hash_secret(secret: str) -> str:
    from linkcv.core.security import hash_refresh_secret

    return hash_refresh_secret(secret)


class SessionStore:
    """会话仓储抽象。实现需保证校验2/3在并发刷新下原子一致。"""

    def create(self, user_id: int | str, settings: Settings) -> SessionData | None:
        raise NotImplementedError

    def get(self, sid: str) -> SessionData | None:
        raise NotImplementedError

    def touch(self, sid: str, settings: Settings) -> bool:
        raise NotImplementedError

    def rotate(
        self, sid: str, settings: Settings, *, now_ms: float | None = None
    ) -> SessionData | None:
        raise NotImplementedError

    def revoke(self, sid: str) -> None:
        raise NotImplementedError

    def revoke_user(self, user_id: int | str) -> None:
        raise NotImplementedError

    def close(self) -> None:
        return


class RedisSessionStore(SessionStore):
    def __init__(self, client) -> None:
        self._redis = client

    @staticmethod
    def _session_key(sid: str) -> str:
        return f"auth:session:{sid}"

    @staticmethod
    def _user_set_key(user_id: str) -> str:
        return f"auth:user:{user_id}:sessions"

    def _store(
        self, sid: str, uid: str, refresh_hash: str, abs_expires: int, ttl: int
    ) -> None:
        pipe = self._redis.pipeline()
        pipe.hset(
            self._session_key(sid),
            mapping={
                "user_id": uid,
                "refresh_token_hash": refresh_hash,
                "absolute_expires_at": str(abs_expires),
            },
        )
        pipe.sadd(self._user_set_key(uid), sid)
        pipe.expire(self._session_key(sid), ttl)
        pipe.expire(self._user_set_key(uid), ttl)
        pipe.execute()

    def create(self, user_id: int | str, settings: Settings) -> SessionData | None:
        sid = _import_session_id()
        secret = _import_refresh_secret()
        uid = str(user_id)
        abs_expires = absolute_expires_at_ms(settings)
        self._store(
            sid, uid, _import_hash_secret(secret), abs_expires, sliding_ttl_seconds(settings)
        )
        return SessionData(sid, uid, _import_hash_secret(secret), abs_expires, secret)

    def _load(self, sid: str) -> SessionData | None:
        raw = self._redis.hgetall(self._session_key(sid))
        if not raw or len(raw) != len(SESSION_HASH_FIELDS):
            return None
        return SessionData(
            sid=sid,
            user_id=raw["user_id"],
            refresh_token_hash=raw["refresh_token_hash"],
            absolute_expires_at=int(raw["absolute_expires_at"]),
            secret="",
        )

    def get(self, sid: str) -> SessionData | None:
        return self._load(sid)

    def touch(self, sid: str, settings: Settings) -> bool:
        session = self._load(sid)
        if session is None or _is_absolute_expired(session):
            if session is not None:
                self._drop(sid, session.user_id)
            return False
        ttl = second_probe_until(sliding_ttl_seconds(settings), session.absolute_expires_at)
        if ttl <= 0:
            self._drop(sid, session.user_id)
            return False
        pipe = self._redis.pipeline()
        pipe.expire(self._session_key(sid), ttl)
        pipe.expire(self._user_set_key(session.user_id), ttl)
        pipe.execute()
        return True

    def rotate(
        self, sid: str, settings: Settings, *, now_ms: float | None = None
    ) -> SessionData | None:
        session = self._load(sid)
        if session is None or _is_absolute_expired(session, now_ms=now_ms):
            return None
        new_secret = _import_refresh_secret()
        new_hash = _import_hash_secret(new_secret)
        ttl = second_probe_until(
            sliding_ttl_seconds(settings), session.absolute_expires_at, now_ms=now_ms
        )
        if ttl <= 0:
            self._drop(sid, session.user_id)
            return None
        key = self._session_key(sid)
        pipe = self._redis.pipeline()
        pipe.hset(key, mapping={"refresh_token_hash": new_hash})
        pipe.expire(key, ttl)
        pipe.expire(self._user_set_key(session.user_id), ttl)
        pipe.execute()
        return SessionData(
            sid, session.user_id, new_hash, session.absolute_expires_at, new_secret
        )

    def _drop(self, sid: str, user_id: str) -> None:
        pipe = self._redis.pipeline()
        pipe.delete(self._session_key(sid))
        pipe.srem(self._user_set_key(user_id), sid)
        pipe.execute()

    def revoke(self, sid: str) -> None:
        session = self._load(sid)
        if session is None:
            return
        self._drop(sid, session.user_id)

    def revoke_user(self, user_id: int | str) -> None:
        uid = str(user_id)
        set_key = self._user_set_key(uid)
        sids = self._redis.smembers(set_key)
        if sids:
            self._redis.delete(*[self._session_key(sid) for sid in sids])
        self._redis.delete(set_key)

    def close(self) -> None:
        self._redis.close()


class InMemorySessionStore(SessionStore):
    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, str]] = {}
        self._user_sessions: dict[str, set[str]] = {}

    def create(self, user_id: int | str, settings: Settings) -> SessionData | None:
        sid = _import_session_id()
        secret = _import_refresh_secret()
        uid = str(user_id)
        abs_expires = absolute_expires_at_ms(settings)
        self._sessions[sid] = {
            "user_id": uid,
            "refresh_token_hash": _import_hash_secret(secret),
            "absolute_expires_at": str(abs_expires),
        }
        self._user_sessions.setdefault(uid, set()).add(sid)
        return SessionData(sid, uid, self._sessions[sid]["refresh_token_hash"], abs_expires, secret)

    def _load(self, sid: str) -> SessionData | None:
        raw = self._sessions.get(sid)
        if raw is None:
            return None
        return SessionData(
            sid=sid,
            user_id=raw["user_id"],
            refresh_token_hash=raw["refresh_token_hash"],
            absolute_expires_at=int(raw["absolute_expires_at"]),
            secret="",
        )

    def get(self, sid: str) -> SessionData | None:
        return self._load(sid)

    def touch(self, sid: str, settings: Settings) -> bool:
        session = self._load(sid)
        if session is None or _is_absolute_expired(session):
            return False
        return True

    def rotate(
        self, sid: str, settings: Settings, *, now_ms: float | None = None
    ) -> SessionData | None:
        session = self._load(sid)
        if session is None or _is_absolute_expired(session, now_ms=now_ms):
            return None
        new_secret = _import_refresh_secret()
        new_hash = _import_hash_secret(new_secret)
        self._sessions[sid]["refresh_token_hash"] = new_hash
        return SessionData(
            sid, session.user_id, new_hash, session.absolute_expires_at, new_secret
        )

    def _drop(self, sid: str, user_id: str) -> None:
        self._sessions.pop(sid, None)
        sids = self._user_sessions.get(user_id)
        if sids is not None:
            sids.discard(sid)

    def revoke(self, sid: str) -> None:
        session = self._load(sid)
        if session is None:
            return
        self._drop(sid, session.user_id)

    def revoke_user(self, user_id: int | str) -> None:
        uid = str(user_id)
        sids = self._user_sessions.pop(uid, set())
        for sid in sids:
            self._sessions.pop(sid, None)


def build_session_store(settings: Settings) -> SessionStore:
    """生产环境默认构建 Redis 会话仓储。"""
    import redis

    client = redis.Redis.from_url(
        settings.redis_url, decode_responses=True, health_check_interval=30
    )
    return RedisSessionStore(client)


def get_session_store(request: Request) -> SessionStore:
    """FastAPI 依赖:从应用状态读取已装配的会话仓储。"""
    store = getattr(request.app.state, "session_store", None)
    if store is None:
        raise RuntimeError("SessionStore is not configured on app.state")
    return store
