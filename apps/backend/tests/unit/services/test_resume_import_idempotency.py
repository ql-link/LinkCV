import asyncio
from uuid import uuid4

import pytest

from linkcv.services.resume_import_idempotency import (
    IdempotencyBindingLostError,
    IdempotencyUnavailableError,
    ResumeImportIdempotency,
)
from tests.fakes import FakeRedis


def service(redis=None) -> ResumeImportIdempotency:
    return ResumeImportIdempotency(
        redis or FakeRedis(),
        bind_ttl_seconds=30,
        ttl_seconds=900,
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


def test_new_request_binds_import_and_replays_mapping() -> None:
    redis = FakeRedis()
    instance = service(redis)
    key = str(uuid4())

    first = acquire(instance, key=key)
    assert first.status == "new"
    assert first.state.import_id is None
    assert redis.ttls[instance.redis_key(1, key)] == 30

    asyncio.run(
        instance.bind_import_id(
            user_id=1,
            idempotency_key=key,
            fingerprint="fingerprint",
            owner="owner",
            import_id="42",
        )
    )
    replay = acquire(instance, key=key, owner="second")
    assert replay.status == "processing"
    assert replay.state.import_id == "42"
    assert redis.ttls[instance.redis_key(1, key)] == 900


def test_conflict_and_user_namespace_are_isolated() -> None:
    instance = service()
    key = str(uuid4())
    acquire(instance, key=key)

    conflict = acquire(instance, key=key, fingerprint="different")
    other_user = acquire(instance, user_id=2, key=key, owner="other-owner")

    assert conflict.status == "conflict"
    assert other_user.status == "new"


def test_binding_requires_original_owner() -> None:
    instance = service()
    key = str(uuid4())
    acquire(instance, key=key)

    with pytest.raises(IdempotencyBindingLostError):
        asyncio.run(
            instance.bind_import_id(
                user_id=1,
                idempotency_key=key,
                fingerprint="fingerprint",
                owner="other-owner",
                import_id="42",
            )
        )


def test_redis_failure_is_wrapped() -> None:
    class FailingRedis:
        def eval(self, *_args):
            raise OSError("unavailable")

    with pytest.raises(IdempotencyUnavailableError):
        acquire(service(FailingRedis()))
