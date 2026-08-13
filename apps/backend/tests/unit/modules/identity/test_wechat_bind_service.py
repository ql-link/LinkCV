import pytest

from linkcv.modules.identity.wechat_bind_service import (
    bind_status,
    bind_ticket_user,
    mark_bind_success,
    new_bind_ticket,
)
from tests.fakes import FakeRedis


def test_new_ticket_starts_pending_and_resolves_to_user() -> None:
    redis_client = FakeRedis()
    ticket = new_bind_ticket(redis_client, user_id=42, ttl_seconds=300)

    assert len(ticket) == 32
    assert bind_ticket_user(redis_client, ticket) == 42
    assert bind_status(redis_client, ticket) == "pending"
    # The per-user pointer key is stored with the same TTL.
    assert redis_client.ttls.get("wechat:bind_user_ticket:42") == 300


def test_reissue_overrides_previous_ticket() -> None:
    redis_client = FakeRedis()
    first = new_bind_ticket(redis_client, user_id=7, ttl_seconds=300)
    second = new_bind_ticket(redis_client, user_id=7, ttl_seconds=300)

    assert first != second
    assert bind_ticket_user(redis_client, first) is None
    assert bind_ticket_user(redis_client, second) == 7
    assert bind_status(redis_client, first) == "expired"
    assert bind_status(redis_client, second) == "pending"


def test_missing_ticket_is_expired() -> None:
    redis_client = FakeRedis()
    assert bind_ticket_user(redis_client, "does-not-exist") is None
    assert bind_status(redis_client, "does-not-exist") == "expired"


def test_bound_status_persists_until_ttl() -> None:
    redis_client = FakeRedis()
    ticket = new_bind_ticket(redis_client, user_id=1, ttl_seconds=300)
    mark_bind_success(redis_client, ticket, ttl_seconds=300)
    assert bind_status(redis_client, ticket) == "bound"


def test_corrupted_ticket_payload_raises() -> None:
    redis_client = FakeRedis()
    redis_client.set("wechat:bind_ticket:bad", "not-json", ex=300)
    with pytest.raises(ValueError):
        bind_ticket_user(redis_client, "bad")
