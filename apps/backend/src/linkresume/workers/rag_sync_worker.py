"""Periodic LinkRag reconciliation inside the existing Worker process."""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from linkresume.services.rag_sync_service import RagSyncService
from linkresume.workers.resume_import_worker import UNLOCK_SCRIPT

logger = logging.getLogger(__name__)

LOCK_KEY = "linkresume:linkrag-sync:lock"


async def run_rag_sync_once(service: RagSyncService, redis, *, lock_seconds: int) -> bool:
    """Run one round if no other Worker replica holds the lock."""
    token = uuid4().hex
    acquired = await asyncio.to_thread(redis.set, LOCK_KEY, token, nx=True, ex=lock_seconds)
    if not acquired:
        return False
    try:
        await asyncio.to_thread(service.run_once)
    finally:
        try:
            await asyncio.to_thread(redis.eval, UNLOCK_SCRIPT, 1, LOCK_KEY, token)
        except Exception:
            logger.warning("linkrag sync lock release failed", exc_info=True)
    return True


async def run_rag_sync_loop(service: RagSyncService, redis, *, interval_seconds: int) -> None:
    # The lock outlives one slow round so replicas never overlap.
    lock_seconds = max(interval_seconds * 10, 600)
    while True:
        try:
            await run_rag_sync_once(service, redis, lock_seconds=lock_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A failed round must not stop the Worker; the next one retries.
            logger.exception("linkrag sync round failed")
        await asyncio.sleep(interval_seconds)
