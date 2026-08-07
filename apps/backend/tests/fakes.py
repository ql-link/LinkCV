from __future__ import annotations

import json
from threading import RLock


class FakeRedis:
    """In-memory Redis stand-in mirroring the subset used by auth sessions."""

    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}
        self.ttls: dict[str, float | None] = {}
        self._lock = RLock()

    def resume_import_acquire(
        self,
        key: str,
        fingerprint: str,
        owner: str,
        ttl_ms: int,
    ) -> tuple[str, str]:
        with self._lock:
            raw = self.strings.get(key)
            if raw is None:
                state = {
                    "status": "processing",
                    "fingerprint": fingerprint,
                    "owner": owner,
                }
                raw = json.dumps(state)
                self.strings[key] = raw
                self.ttls[key] = ttl_ms / 1000
                return "new", raw
            state = json.loads(raw)
            if state["fingerprint"] != fingerprint:
                return "conflict", raw
            return state["status"], raw

    def resume_import_renew(
        self,
        key: str,
        fingerprint: str,
        owner: str,
        ttl_ms: int,
    ) -> int:
        with self._lock:
            raw = self.strings.get(key)
            if raw is None:
                return 0
            state = json.loads(raw)
            if (
                state["status"] != "processing"
                or state["fingerprint"] != fingerprint
                or state["owner"] != owner
            ):
                return 0
            self.ttls[key] = ttl_ms / 1000
            return 1

    def resume_import_finish(
        self,
        key: str,
        fingerprint: str,
        owner: str,
        payload: str,
        ttl_ms: int,
    ) -> int:
        with self._lock:
            raw = self.strings.get(key)
            if raw is None:
                return 0
            state = json.loads(raw)
            if (
                state["status"] != "processing"
                or state["fingerprint"] != fingerprint
                or state["owner"] != owner
            ):
                return 0
            self.strings[key] = payload
            self.ttls[key] = ttl_ms / 1000
            return 1

    def hset(
        self,
        name: str,
        key: str | None = None,
        value: str | None = None,
        mapping: dict[str, str] | None = None,
    ) -> int:
        data = self.hashes.setdefault(name, {})
        merged: dict[str, str] = dict(mapping or {})
        if key is not None:
            merged[key] = "" if value is None else str(value)
        count = 0
        for field, val in merged.items():
            if field not in data:
                count += 1
            data[field] = str(val)
        return count

    def hget(self, name: str, key: str) -> str | None:
        return self.hashes.get(name, {}).get(key)

    def hgetall(self, name: str) -> dict[str, str]:
        return dict(self.hashes.get(name, {}))

    def get(self, name: str) -> str | None:
        return self.strings.get(name)

    def getset(self, name: str, value: str) -> str | None:
        previous = self.strings.get(name)
        self.strings[name] = str(value)
        return previous

    def incr(self, name: str, amount: int = 1) -> int:
        current = int(self.strings.get(name) or 0)
        self.strings[name] = str(current + amount)
        return current + amount

    def set(self, name: str, value: str, **kwargs: object) -> int:
        self.strings[name] = str(value)
        ttl = kwargs.get("ex")
        if isinstance(ttl, (int, float)):
            self.ttls[name] = float(ttl)
        return 1

    def exists(self, name: str) -> int:
        return int(
            name in self.strings or name in self.hashes or name in self.sets
        )

    def delete(self, *names: str) -> int:
        removed = 0
        for name in names:
            removed += int(
                self.strings.pop(name, None) is not None
                or self.hashes.pop(name, None) is not None
                or self.sets.pop(name, None) is not None
            )
            self.ttls.pop(name, None)
        return removed

    def expire(self, name: str, ttl: float) -> int:
        if name in self.strings or name in self.hashes or name in self.sets:
            self.ttls[name] = ttl
            return 1
        return 0

    def sadd(self, name: str, *values: str) -> int:
        target = self.sets.setdefault(name, set())
        before = len(target)
        target.update(values)
        return len(target) - before

    def srem(self, name: str, *values: str) -> int:
        target = self.sets.get(name, set())
        removed = 0
        for value in values:
            if value in target:
                target.remove(value)
                removed += 1
        if not target:
            self.sets.pop(name, None)
        return removed

    def smembers(self, name: str) -> set[str]:
        return set(self.sets.get(name, set()))

    def ping(self, **_kwargs) -> bool:
        return True

    def close(self, **_kwargs) -> None:
        pass
