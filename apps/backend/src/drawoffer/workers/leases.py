"""Renewed, token-checked Redis lease shared by bounded worker rounds."""
from threading import Event, Thread
from uuid import uuid4

RENEW_SCRIPT = """-- worker_lease_renew
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('EXPIRE', KEYS[1], ARGV[2])
"""
UNLOCK_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""


class LeaseLost(RuntimeError):
    pass


class RedisLease:
    def __init__(self, redis, key: str, seconds: int) -> None:
        self.redis, self.key, self.seconds = redis, key, seconds
        self.token = uuid4().hex
        self.stop = Event()
        self.lost = Event()
        self.thread = None

    def acquire(self) -> bool:
        if not self.redis.set(self.key, self.token, nx=True, ex=self.seconds):
            return False
        self.thread = Thread(target=self._renew, daemon=True)
        self.thread.start()
        return True

    def _renew(self) -> None:
        while not self.stop.wait(self.seconds / 3):
            try:
                if self.redis.eval(RENEW_SCRIPT, 1, self.key, self.token, self.seconds):
                    continue
            except Exception:
                pass
            self.lost.set()
            return

    def check(self) -> None:
        if self.lost.is_set() or self.redis.get(self.key) != self.token:
            raise LeaseLost("WORKER_LEASE_LOST")

    def close(self) -> None:
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=1)
        self.redis.eval(UNLOCK_SCRIPT, 1, self.key, self.token)
