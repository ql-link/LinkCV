from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

ACQUIRE_SCRIPT = r"""
local raw = redis.call('GET', KEYS[1])
if not raw then
  local value = cjson.encode({status='processing', fingerprint=ARGV[1], owner=ARGV[2]})
  redis.call('SET', KEYS[1], value, 'PX', ARGV[3])
  return {'new', value}
end
local state = cjson.decode(raw)
if state.fingerprint ~= ARGV[1] then
  return {'conflict', raw}
end
return {'processing', raw}
"""

BIND_SCRIPT = r"""
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.status ~= 'processing' or state.fingerprint ~= ARGV[1]
  or state.owner ~= ARGV[2] or state.import_id then
  return 0
end
state.import_id = ARGV[3]
state.owner = nil
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
return 1
"""


class IdempotencyUnavailableError(Exception):
    pass


class IdempotencyBindingLostError(Exception):
    pass


class StoredImportState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["processing"]
    fingerprint: str
    owner: str | None = None
    import_id: str | None = None


@dataclass(frozen=True)
class AcquireResult:
    status: Literal["new", "processing", "conflict"]
    state: StoredImportState


def import_fingerprint(
    *,
    filename: str,
    source_format: str,
    content_type: str,
    template_id: str,
    content: bytes,
) -> str:
    payload = {
        "version": 2,
        "filename": filename,
        "source_format": source_format,
        "content_type": content_type.partition(";")[0].strip().lower(),
        "template_id": template_id,
        "content_sha256": hashlib.sha256(content).hexdigest(),
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class ResumeImportIdempotency:
    def __init__(
        self,
        redis,
        *,
        bind_ttl_seconds: int,
        ttl_seconds: int,
    ) -> None:
        self._redis = redis
        self._bind_ttl_ms = bind_ttl_seconds * 1000
        self._ttl_ms = ttl_seconds * 1000

    @staticmethod
    def redis_key(user_id: int, idempotency_key: str) -> str:
        digest = hashlib.sha256(idempotency_key.encode("ascii")).hexdigest()
        return f"resume-import:idempotency:v1:{user_id}:{digest}"

    async def acquire_or_replay(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        fingerprint: str,
        owner: str,
    ) -> AcquireResult:
        key = self.redis_key(user_id, idempotency_key)
        try:
            if hasattr(self._redis, "resume_import_acquire"):
                result = await asyncio.to_thread(
                    self._redis.resume_import_acquire,
                    key,
                    fingerprint,
                    owner,
                    self._bind_ttl_ms,
                )
            else:
                result = await asyncio.to_thread(
                    self._redis.eval,
                    ACQUIRE_SCRIPT,
                    1,
                    key,
                    fingerprint,
                    owner,
                    self._bind_ttl_ms,
                )
            status, raw = result
            state = StoredImportState.model_validate_json(raw)
            return AcquireResult(status=status, state=state)
        except (ValidationError, ValueError, TypeError, OSError) as error:
            raise IdempotencyUnavailableError from error
        except Exception as error:
            raise IdempotencyUnavailableError from error

    async def bind_import_id(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        fingerprint: str,
        owner: str,
        import_id: str,
    ) -> None:
        key = self.redis_key(user_id, idempotency_key)
        try:
            if hasattr(self._redis, "resume_import_bind"):
                bound = await asyncio.to_thread(
                    self._redis.resume_import_bind,
                    key,
                    fingerprint,
                    owner,
                    import_id,
                    self._ttl_ms,
                )
            else:
                bound = await asyncio.to_thread(
                    self._redis.eval,
                    BIND_SCRIPT,
                    1,
                    key,
                    fingerprint,
                    owner,
                    import_id,
                    self._ttl_ms,
                )
        except Exception as error:
            raise IdempotencyUnavailableError from error
        if int(bound) != 1:
            raise IdempotencyBindingLostError

    async def read_state(
        self,
        *,
        user_id: int,
        idempotency_key: str,
    ) -> StoredImportState | None:
        key = self.redis_key(user_id, idempotency_key)
        try:
            raw = await asyncio.to_thread(self._redis.get, key)
            if raw is None:
                return None
            return StoredImportState.model_validate_json(raw)
        except (ValidationError, ValueError, TypeError, OSError) as error:
            raise IdempotencyUnavailableError from error
        except Exception as error:
            raise IdempotencyUnavailableError from error

    async def wait_for_binding(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        timeout_seconds: float = 1,
    ) -> StoredImportState | None:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        while True:
            state = await self.read_state(
                user_id=user_id,
                idempotency_key=idempotency_key,
            )
            if state is None or state.import_id is not None:
                return state
            if asyncio.get_running_loop().time() >= deadline:
                return state
            await asyncio.sleep(0.05)
