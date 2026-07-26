"""基于 Redis 的会话存储层。

会话数据只活在 Redis，不写入 MySQL。
注销就是删 key，不改密令/状态等业务表。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import redis.asyncio as aioredis

from linkcv.core.config import Settings
from linkcv.core.security import (
    generate_refresh_secret,
    generate_session_id,
    hash_refresh_secret,
    sign_refresh_token,
)

# Redis 键前缀
_SESSION_PREFIX = "auth:session:"
_USER_SESSION_PREFIX = "auth:user:"


def _session_key(sid: str) -> str:
    return f"{_SESSION_PREFIX}{sid}"


def _user_sessions_key(user_id: int | str) -> str:
    return f"{_USER_SESSION_PREFIX}{user_id}:sessions"


class SessionStore:
    """Redis 会话仓库。"""

    def __init__(self, client: aioredis.Redis) -> None:
        self._client = client

    # -- 创建会话 -----------------------------------------------------------

    async def create(
        self, user_id: int, settings: Settings
    ) -> tuple[str, str, str]:
        """创建会话，返回 (sid, refresh_token, refresh_hash)。

        Redis 中存储:
          auth:session:{sid} → {user_id, refresh_hash, absolute_expires_at}
          auth:user:{user_id}:sessions → Set[{sid}, ...]
        """
        sid = generate_session_id()
        secret = generate_refresh_secret()
        refresh_hash = hash_refresh_secret(secret)
        absolute_expires_at = int(
            (
                datetime.now(timezone.utc)
                + timedelta(days=settings.refresh_token_absolute_days)
            ).timestamp()
            * 1000
        )
        ttl_seconds = settings.session_ttl_days * 24 * 60 * 60

        pipe = self._client.pipeline()
        pipe.hset(
            _session_key(sid),
            mapping={
                "user_id": str(user_id),
                "refresh_hash": refresh_hash,
                "absolute_expires_at": str(absolute_expires_at),
            },
        )
        pipe.expire(_session_key(sid), ttl_seconds)
        pipe.sadd(_user_sessions_key(user_id), sid)
        await pipe.execute()

        refresh_token = sign_refresh_token(sid, secret)
        return sid, refresh_token, refresh_hash

    # -- 查询会话 -----------------------------------------------------------

    async def get(self, sid: str) -> dict | None:
        """读取会话数据，不存在或过期返回 None。"""
        data = await self._client.hgetall(_session_key(sid))
        if not data:
            return None
        return {k.decode("utf-8"): v.decode("utf-8") for k, v in data.items()}

    async def get_absolute_expires_at(self, sid: str) -> int | None:
        data = await self.get(sid)
        if not data:
            return None
        raw = data.get("absolute_expires_at")
        if raw is None:
            return None
        return int(raw)

    # -- 滑动续期 -----------------------------------------------------------

    async def touch(self, sid: str, settings: Settings) -> None:
        """滑动过期 TTL。"""
        key = _session_key(sid)
        ttl_seconds = settings.session_ttl_days * 24 * 60 * 60
        await self._client.expire(key, ttl_seconds)

    # -- 校验 Refresh Hash --------------------------------------------------

    async def get_refresh_hash(self, sid: str) -> str | None:
        data = await self.get(sid)
        if not data:
            return None
        return data.get("refresh_hash")

    # -- 删除会话 -----------------------------------------------------------

    async def delete(self, sid: str) -> None:
        """删除单个会话（用于单点注销）。"""
        data = await self.get(sid)
        if not data:
            return
        user_id_str = data.get("user_id", "")
        pipe = self._client.pipeline()
        pipe.delete(_session_key(sid))
        if user_id_str:
            pipe.srem(_user_sessions_key(user_id_str), sid)
        await pipe.execute()

    async def delete_user_sessions(self, user_id: int) -> int:
        """删除用户的所有会话（用于全设备注销）。返回删除数。"""
        set_key = _user_sessions_key(user_id)
        # 先读所有 sid
        sids = [s.decode("utf-8") for s in (await self._client.smembers(set_key)) or []]
        if not sids:
            return 0
        pipe = self._client.pipeline()
        for sid in sids:
            pipe.delete(_session_key(sid))
        pipe.delete(set_key)
        await pipe.execute()
        return len(sids)


# -- Factory ------------------------------------------------------------------


async def build_session_store(settings: Settings) -> SessionStore:
    """创建 Redis 连接并返回 SessionStore 实例。"""
    client = aioredis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        password=settings.redis_password or None,
        db=settings.redis_db,
        decode_responses=False,
    )
    # 快速连通性检查
    await client.ping()
    return SessionStore(client)
