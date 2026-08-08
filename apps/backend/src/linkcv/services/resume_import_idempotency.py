from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

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
if state.status == 'processing' then
  return {'processing', raw}
end
if state.status == 'succeeded' then
  return {'succeeded', raw}
end
return {'failed', raw}
"""

RENEW_SCRIPT = r"""
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.status ~= 'processing' or state.fingerprint ~= ARGV[1] or state.owner ~= ARGV[2] then
  return 0
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
"""

FINISH_SCRIPT = r"""
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.status ~= 'processing' or state.fingerprint ~= ARGV[1] or state.owner ~= ARGV[2] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
return 1
"""


class IdempotencyUnavailableError(Exception):
    pass


class IdempotencyLeaseLostError(Exception):
    pass


class StoredImportState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["processing", "succeeded", "failed"]
    fingerprint: str
    owner: str | None = None
    resume_id: str | None = None
    source_file_name: str | None = None
    source_file_format: Literal["md", "docx", "pdf"] | None = None
    warnings: list[str] = Field(default_factory=list)
    error_status: int | None = None
    error_code: str | None = None


@dataclass(frozen=True)
class AcquireResult:
    status: Literal["new", "processing", "succeeded", "failed", "conflict"]
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
        processing_ttl_seconds: int,
        success_ttl_seconds: int,
        failure_ttl_seconds: int,
    ) -> None:
        self._redis = redis
        self._processing_ttl_ms = processing_ttl_seconds * 1000
        self._success_ttl_ms = success_ttl_seconds * 1000
        self._failure_ttl_ms = failure_ttl_seconds * 1000

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
                    self._processing_ttl_ms,
                )
            else:
                result = await asyncio.to_thread(
                    self._redis.eval,
                    ACQUIRE_SCRIPT,
                    1,
                    key,
                    fingerprint,
                    owner,
                    self._processing_ttl_ms,
                )
            status, raw = result
            state = StoredImportState.model_validate_json(raw)
            return AcquireResult(status=status, state=state)
        except (ValidationError, ValueError, TypeError, OSError) as error:
            raise IdempotencyUnavailableError from error
        except Exception as error:
            raise IdempotencyUnavailableError from error

    async def renew_and_assert_owner(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        fingerprint: str,
        owner: str,
    ) -> None:
        key = self.redis_key(user_id, idempotency_key)
        try:
            if hasattr(self._redis, "resume_import_renew"):
                renewed = await asyncio.to_thread(
                    self._redis.resume_import_renew,
                    key,
                    fingerprint,
                    owner,
                    self._processing_ttl_ms,
                )
            else:
                renewed = await asyncio.to_thread(
                    self._redis.eval,
                    RENEW_SCRIPT,
                    1,
                    key,
                    fingerprint,
                    owner,
                    self._processing_ttl_ms,
                )
        except Exception as error:
            raise IdempotencyUnavailableError from error
        if int(renewed) != 1:
            raise IdempotencyLeaseLostError

    async def mark_succeeded(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        fingerprint: str,
        owner: str,
        resume_id: str,
        source_file_name: str,
        source_file_format: str,
        warnings: list[str],
    ) -> None:
        state = StoredImportState(
            status="succeeded",
            fingerprint=fingerprint,
            resume_id=resume_id,
            source_file_name=source_file_name,
            source_file_format=source_file_format,
            warnings=warnings,
        )
        await self._finish(
            user_id=user_id,
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            owner=owner,
            state=state,
            ttl_ms=self._success_ttl_ms,
        )

    async def mark_failed(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        fingerprint: str,
        owner: str,
        error_status: int,
        error_code: str,
    ) -> None:
        state = StoredImportState(
            status="failed",
            fingerprint=fingerprint,
            error_status=error_status,
            error_code=error_code,
        )
        await self._finish(
            user_id=user_id,
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            owner=owner,
            state=state,
            ttl_ms=self._failure_ttl_ms,
        )

    async def _finish(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        fingerprint: str,
        owner: str,
        state: StoredImportState,
        ttl_ms: int,
    ) -> None:
        key = self.redis_key(user_id, idempotency_key)
        payload = state.model_dump_json()
        try:
            if hasattr(self._redis, "resume_import_finish"):
                finished = await asyncio.to_thread(
                    self._redis.resume_import_finish,
                    key,
                    fingerprint,
                    owner,
                    payload,
                    ttl_ms,
                )
            else:
                finished = await asyncio.to_thread(
                    self._redis.eval,
                    FINISH_SCRIPT,
                    1,
                    key,
                    fingerprint,
                    owner,
                    payload,
                    ttl_ms,
                )
        except Exception as error:
            raise IdempotencyUnavailableError from error
        if int(finished) != 1:
            raise IdempotencyLeaseLostError
