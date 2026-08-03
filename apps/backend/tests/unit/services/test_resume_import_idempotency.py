import asyncio
from uuid import uuid4

import pytest

from linkcv.services.resume_import_idempotency import (
    IdempotencyUnavailableError,
    ResumeImportIdempotency,
)
from tests.fakes import FakeRedis


def service(redis=None) -> ResumeImportIdempotency:
    return ResumeImportIdempotency(
        redis or FakeRedis(),
        processing_ttl_seconds=180,
        success_ttl_seconds=3600,
        failure_ttl_seconds=60,
    )


def acquire(instance, *, user_id=1, key=None, fingerprint="fingerprint", owner="owner"):
    return asyncio.run(
        instance.acquire_or_replay(
            user_id=user_id,
            idempotency_key=key or str(uuid4()),
            fingerprint=fingerprint,
            owner=owner,
        )
    )


def test_new_processing_success_replay_and_conflict() -> None:
    redis = FakeRedis()
    instance = service(redis)
    key = str(uuid4())
    first = acquire(instance, key=key)
    processing = acquire(instance, key=key, owner="second")
    assert first.status == "new"
    assert processing.status == "processing"

    asyncio.run(
        instance.mark_succeeded(
            user_id=1,
            idempotency_key=key,
            fingerprint="fingerprint",
            owner="owner",
            resume_id="42",
            source_file_name="resume.pdf",
            source_file_format="pdf",
            warnings=["pdf_ocr_applied"],
        )
    )
    replay = acquire(instance, key=key, owner="third")
    conflict = acquire(instance, key=key, fingerprint="different", owner="third")
    assert replay.status == "succeeded"
    assert replay.state.resume_id == "42"
    assert replay.state.warnings == ["pdf_ocr_applied"]
    assert conflict.status == "conflict"
    redis_key = instance.redis_key(1, key)
    assert redis.ttls[redis_key] == 3600


def test_failed_state_and_user_namespace_are_isolated() -> None:
    instance = service()
    key = str(uuid4())
    acquire(instance, key=key)
    asyncio.run(
        instance.mark_failed(
            user_id=1,
            idempotency_key=key,
            fingerprint="fingerprint",
            owner="owner",
            error_status=502,
            error_code="DOCUMENT_CONVERSION_FAILED",
        )
    )
    failed = acquire(instance, key=key, owner="new-owner")
    other_user = acquire(instance, user_id=2, key=key, owner="other-owner")
    assert failed.status == "failed"
    assert failed.state.error_code == "DOCUMENT_CONVERSION_FAILED"
    assert other_user.status == "new"


def test_redis_failure_is_wrapped() -> None:
    class FailingRedis:
        def eval(self, *_args):
            raise OSError("unavailable")

    with pytest.raises(IdempotencyUnavailableError):
        acquire(service(FailingRedis()))
