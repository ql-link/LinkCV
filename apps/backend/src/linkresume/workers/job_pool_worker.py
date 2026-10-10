from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from sqlalchemy import and_, or_, select

from linkresume.application.job_pool import service
from linkresume.application.job_pool.adapters import OfficialAdapter, OfficialHTTP
from linkresume.application.job_pool.types import SyncResult
from linkresume.core.database import utc_now
from linkresume.modules.job_pool.models import GlobalJobSource

logger = logging.getLogger(__name__)


class JobPoolProcessor:
    def __init__(self, session_factory, settings, http_factory=OfficialHTTP, storage=None):
        self.session_factory = session_factory
        self.settings = settings
        self.http_factory = http_factory
        self.storage = storage

    async def process(self, source_id):
        with self.session_factory() as db:
            task = service.claim_source(db, source_id, interval_seconds=self.settings.job_pool_sync_interval_seconds)
        if task is None:
            return
        source_id, generation, adapter_key, tenant, config = task
        http = self.http_factory(timeout=self.settings.job_pool_sync_timeout_seconds, max_bytes=self.settings.job_pool_sync_max_response_bytes)
        reader = OfficialAdapter(http, max_pages=self.settings.job_pool_sync_max_pages, scoped=True)
        collection = asyncio.create_task(reader.collect(adapter_key, tenant, config))

        async def heartbeat():
            while True:
                await asyncio.sleep(30)
                try:
                    with self.session_factory() as db:
                        valid = service.renew(db, source_id, generation)
                except Exception:
                    logger.warning("job_pool_sync source_id=%s generation=%s error_code=JOB_SOURCE_LEASE_UNAVAILABLE", source_id, generation)
                    valid = False
                if not valid:
                    collection.cancel()
                    return

        lease_task = asyncio.create_task(heartbeat())
        result = SyncResult(error_code="JOB_SOURCE_INVALID_RESPONSE")
        try:
            try:
                result = await collection
            except asyncio.CancelledError:
                # Ownership changed or Worker is shutting down; never finalize another task.
                raise
            except Exception:
                result = SyncResult(error_code="JOB_SOURCE_INVALID_RESPONSE")
            for offset in range(0, len(result.jobs), 100):
                with self.session_factory() as db:
                    if not service.write_observations(db, source_id, generation, result.jobs[offset:offset + 100]):
                        return
                await asyncio.sleep(0)
            with self.session_factory() as db:
                committed = service.finish(db, source_id, generation, result, storage=self.storage)
            if committed:
                logger.info("job_pool_sync source_id=%s generation=%s count=%s complete=%s error_code=%s",
                    source_id, generation, len(result.jobs), result.is_complete, result.error_code)
        except asyncio.CancelledError:
            collection.cancel()
            with suppress(asyncio.CancelledError):
                await collection
            raise
        except Exception:
            # No payload, URL, credentials or exception response is written to logs.
            logger.error("job_pool_sync source_id=%s generation=%s error_code=JOB_SOURCE_WRITE_FAILED", source_id, generation)
            result.is_complete = False
            result.error_code = "JOB_SOURCE_WRITE_FAILED"
            result.company_logo_bytes = None
            with self.session_factory() as db:
                service.finish(db, source_id, generation, result)
        finally:
            lease_task.cancel()
            with suppress(asyncio.CancelledError):
                await lease_task
            await http.close()


async def run_job_pool_loop(processor):
    active: dict[int, asyncio.Task] = {}
    try:
        while True:
            for source_id, task in list(active.items()):
                if task.done():
                    with suppress(asyncio.CancelledError):
                        try:
                            task.result()
                        except Exception:
                            logger.error("job_pool_loop source_id=%s error_code=JOB_SOURCE_TASK_FAILED", source_id)
                    del active[source_id]
            if len(active) < 2:
                try:
                    with processor.session_factory() as db:
                        now = utc_now()
                        due = or_(GlobalJobSource.sync_status == "queued",
                            and_(GlobalJobSource.sync_status == "running", GlobalJobSource.lease_until <= now),
                            and_(GlobalJobSource.sync_status != "running", or_(GlobalJobSource.next_sync_at.is_(None), GlobalJobSource.next_sync_at <= now)))
                        ids = list(db.scalars(select(GlobalJobSource.id).where(GlobalJobSource.is_enabled == 1,
                            GlobalJobSource.adapter_key != "pending", due).order_by(GlobalJobSource.next_sync_at, GlobalJobSource.id)))
                    for source_id in ids:
                        if source_id not in active and len(active) < 2:
                            active[source_id] = asyncio.create_task(processor.process(source_id))
                except Exception:
                    logger.error("job_pool_loop error_code=JOB_SOURCE_DATABASE_UNAVAILABLE")
            await asyncio.sleep(processor.settings.job_pool_sync_poll_seconds)
    finally:
        for task in active.values():
            task.cancel()
        await asyncio.gather(*active.values(), return_exceptions=True)
