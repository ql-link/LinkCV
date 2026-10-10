"""Interview recording transcription rounds inside the existing Worker process."""

from __future__ import annotations

import asyncio
import logging

from drawoffer.application.interviews.transcription_service import TranscriptionRunner
from drawoffer.workers.leases import RedisLease

logger = logging.getLogger(__name__)

LOCK_KEY = "linkresume:interview-transcription:lock"


async def run_transcription_once(runner: TranscriptionRunner, redis, *, lock_seconds: int) -> bool:
    """Run one round if no other Worker replica holds the lock."""
    lease = RedisLease(redis, LOCK_KEY, lock_seconds)
    if not await asyncio.to_thread(lease.acquire):
        return False
    try:
        await runner.run_once()
        lease.check()
    finally:
        try:
            await asyncio.to_thread(lease.close)
        except Exception:
            logger.warning("interview transcription lock release failed", exc_info=True)
    return True


async def run_transcription_loop(runner: TranscriptionRunner, redis, *, interval_seconds: int) -> None:
    # A round makes at most a few provider calls per job, so the lock covers
    # even a slow round and replicas never overlap.
    lock_seconds = max(interval_seconds * 10, 300)
    while True:
        try:
            await run_transcription_once(runner, redis, lock_seconds=lock_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A failed round must not stop the Worker; the next one retries.
            logger.exception("interview transcription round failed")
        await asyncio.sleep(interval_seconds)
