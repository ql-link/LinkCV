"""Run LinkRag reconciliation rounds on demand (backfill, or retry failures).

The Worker already reconciles every ``LINKRAG_SYNC_INTERVAL_SECONDS`` once
LinkRag credentials are configured; existing datasets are backfilled by those
rounds.
Use this command to speed the backfill up or to requeue failed records:

    uv run --directory apps/backend python scripts/release/sync_datasets_to_linkrag.py \\
        [--rounds N] [--reset-failed]

Rounds are idempotent and share the Worker's Redis lock, so running this next
to a live Worker never processes the same records twice at once.
"""

from __future__ import annotations

import argparse
import asyncio

from drawoffer.core.config import load_settings
from drawoffer.core.database import build_engine, build_session_factory
from drawoffer.core.redis import build_redis_client
from drawoffer.core.storage import AssetStorage
from drawoffer.integrations.linkrag_client import build_linkrag_client
from drawoffer.services.rag_sync_service import RagSyncService
from drawoffer.workers.rag_sync_worker import run_rag_sync_once


def build_service(settings) -> tuple[RagSyncService, object]:
    client = build_linkrag_client(settings, timeout_seconds=settings.linkrag_sync_timeout_seconds)
    if client is None:
        raise SystemExit(
            "LinkRag is not configured: set LINKRAG_CLIENT_ID and LINKRAG_CLIENT_SECRET "
            "(and keep LINKRAG_ENABLED=true)"
        )
    service = RagSyncService(
        session_factory=build_session_factory(build_engine(settings.sqlalchemy_url)),
        storage=AssetStorage(settings),
        client=client,
        batch_size=settings.linkrag_sync_batch_size,
        max_attempts=settings.linkrag_sync_max_attempts,
        markdown_max_bytes=settings.dataset_upload_max_bytes,
    )
    return service, client


async def run(service: RagSyncService, redis, *, rounds: int, reset_failed: bool) -> int:
    if reset_failed:
        print(f"reset failed records: {service.reset_failed()}")
    completed = 0
    for _ in range(rounds):
        if await run_rag_sync_once(service, redis, lock_seconds=600):
            completed += 1
        else:
            print("another reconciler holds the lock; skipped a round")
    return completed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--reset-failed", action="store_true")
    args = parser.parse_args()
    settings = load_settings()
    service, client = build_service(settings)
    redis = build_redis_client(settings)
    try:
        completed = asyncio.run(
            run(service, redis, rounds=max(1, args.rounds), reset_failed=args.reset_failed)
        )
        print(f"completed rounds: {completed}")
    finally:
        client.close()
        redis.close()


if __name__ == "__main__":
    main()
