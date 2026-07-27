import asyncio
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import monotonic


class ImportAdmissionRejected(Exception):
    pass


class ImportAdmissionController:
    def __init__(
        self,
        *,
        requests_per_minute: int,
        global_concurrency: int,
        user_concurrency: int,
    ) -> None:
        self._requests_per_minute = requests_per_minute
        self._global_concurrency = global_concurrency
        self._user_concurrency = user_concurrency
        self._lock = asyncio.Lock()
        self._request_times: dict[int, deque[float]] = defaultdict(deque)
        self._global_active = 0
        self._user_active: dict[int, int] = defaultdict(int)

    @asynccontextmanager
    async def acquire(self, user_id: int) -> AsyncIterator[None]:
        async with self._lock:
            now = monotonic()
            request_times = self._request_times[user_id]
            while request_times and request_times[0] <= now - 60:
                request_times.popleft()
            if (
                len(request_times) >= self._requests_per_minute
                or self._global_active >= self._global_concurrency
                or self._user_active[user_id] >= self._user_concurrency
            ):
                raise ImportAdmissionRejected
            request_times.append(now)
            self._global_active += 1
            self._user_active[user_id] += 1

        try:
            yield
        finally:
            async with self._lock:
                self._global_active -= 1
                self._user_active[user_id] -= 1
                if self._user_active[user_id] == 0:
                    del self._user_active[user_id]
