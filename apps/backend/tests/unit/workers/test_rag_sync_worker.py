"""The LinkRag sync round runs under a Redis lock and survives failures."""

import asyncio

from drawoffer.workers import rag_sync_worker
from drawoffer.workers.rag_sync_worker import LOCK_KEY, run_rag_sync_loop, run_rag_sync_once


class LockRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def set(self, key, value, *, nx=False, ex=None):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    def get(self, key):
        return self.values.get(key)

    def eval(self, _script, _numkeys, key, token, *args):
        if args: return int(self.values.get(key) == token)
        if self.values.get(key) == token:
            del self.values[key]
            return 1
        return 0


class Service:
    def __init__(self, error: Exception | None = None) -> None:
        self.rounds = 0
        self.error = error

    def run_once(self) -> int:
        self.rounds += 1
        if self.error:
            raise self.error
        return 0


def test_round_skips_when_another_replica_holds_the_lock() -> None:
    redis, service = LockRedis(), Service()
    redis.values[LOCK_KEY] = "other"
    assert asyncio.run(run_rag_sync_once(service, redis, lock_seconds=60)) is False
    assert service.rounds == 0
    del redis.values[LOCK_KEY]
    assert asyncio.run(run_rag_sync_once(service, redis, lock_seconds=60)) is True
    assert service.rounds == 1 and LOCK_KEY not in redis.values  # released


def test_loop_keeps_running_after_a_failed_round(monkeypatch) -> None:
    redis, service = LockRedis(), Service(RuntimeError("boom"))
    sleeps: list[int] = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(rag_sync_worker.asyncio, "sleep", fake_sleep)
    try:
        asyncio.run(run_rag_sync_loop(service, redis, interval_seconds=30))
    except asyncio.CancelledError:
        pass
    assert service.rounds == 2 and sleeps == [30, 30]
    assert LOCK_KEY not in redis.values  # released even when the round raised
