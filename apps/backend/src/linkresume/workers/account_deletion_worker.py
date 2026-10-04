"""Durable, retryable account cleanup inside the existing worker process."""
from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import timedelta, timezone
from threading import Event, RLock, Thread

from sqlalchemy import delete, or_, select, update

from linkresume.core.database import utc_now
from linkresume.core.security import revoke_user_sessions
from linkresume.modules.identity.account_deletion_service import clear_personal_rows, personal_object_prefixes
from linkresume.modules.identity.models import AccountDeletionJob
from linkresume.workers.leases import LeaseLost, RedisLease
from linkresume.workers.rag_sync_worker import LOCK_KEY as RAG_LOCK_KEY

logger = logging.getLogger(__name__)


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class _JobLease:
    def __init__(self, factory, job_id: int, until, seconds: int) -> None:
        self.factory, self.job_id, self.until, self.seconds = factory, job_id, until, seconds
        self.lock, self.stop, self.lost = RLock(), Event(), Event()
        self.thread = Thread(target=self._renew, daemon=True)
        self.thread.start()

    def _renew(self) -> None:
        while not self.stop.wait(self.seconds / 3):
            try:
                with self.lock, self.factory() as db:
                    next_until = utc_now() + timedelta(seconds=self.seconds)
                    result = db.execute(update(AccountDeletionJob).where(
                        AccountDeletionJob.id == self.job_id,
                        AccountDeletionJob.status == "processing",
                        AccountDeletionJob.lease_until == self.until,
                        AccountDeletionJob.lease_until > utc_now(),
                    ).values(lease_until=next_until))
                    db.commit()
                    if result.rowcount != 1:
                        raise LeaseLost()
                    self.until = next_until
            except Exception:
                self.lost.set()
                return

    def check(self) -> None:
        if self.lost.is_set() or utc_now() >= _utc(self.until):
            raise LeaseLost("ACCOUNT_CLEANUP_LEASE_LOST")

    def owned(self, db):
        self.check()
        row = db.scalar(select(AccountDeletionJob).where(
            AccountDeletionJob.id == self.job_id,
            AccountDeletionJob.status == "processing",
            AccountDeletionJob.lease_until == self.until,
        ).with_for_update())
        if row is None:
            raise LeaseLost("ACCOUNT_CLEANUP_LEASE_LOST")
        return row

    def close(self) -> None:
        self.stop.set()
        self.thread.join(timeout=1)


class AccountDeletionProcessor:
    def __init__(self, *, session_factory, storage, redis, rag_client, settings) -> None:
        self.factory, self.storage, self.redis = session_factory, storage, redis
        self.rag_client, self.settings = rag_client, settings

    def run_once(self) -> bool:
        now = utc_now()
        with self.factory() as db:
            db.execute(delete(AccountDeletionJob).where(
                AccountDeletionJob.status == "completed",
                AccountDeletionJob.completed_at < now - timedelta(days=7),
            ))
            job = db.scalar(select(AccountDeletionJob).where(
                AccountDeletionJob.status.in_(["pending", "retry_wait", "processing"]),
                or_(AccountDeletionJob.next_attempt_at.is_(None), AccountDeletionJob.next_attempt_at <= now),
                or_(AccountDeletionJob.lease_until.is_(None), AccountDeletionJob.lease_until <= now),
            ).order_by(AccountDeletionJob.id).with_for_update(skip_locked=True).limit(1))
            if job is None:
                db.commit()
                return False
            job.status = "processing"
            job.lease_until = now + timedelta(seconds=self.settings.account_deletion_lease_seconds)
            db.commit()
            job_id, until = job.id, job.lease_until
        lease = _JobLease(self.factory, job_id, until, self.settings.account_deletion_lease_seconds)
        try:
            self._process(lease)
        except LeaseLost:
            # Another lease holder owns recovery; never overwrite its result.
            logger.warning("account cleanup lease lost", extra={"error_code": "ACCOUNT_CLEANUP_LEASE_LOST"})
        except Exception:
            logger.warning("account cleanup deferred", extra={"error_code": "ACCOUNT_CLEANUP_FAILED"})
            with lease.lock, self.factory() as db:
                try:
                    job = lease.owned(db)
                except LeaseLost:
                    return True
                job.attempt_count += 1
                missing_rag = job.phase == "rag" and self.rag_client is None
                job.status = "needs_attention" if missing_rag or job.attempt_count >= 10 else "retry_wait"
                job.last_error_code = "ACCOUNT_CLEANUP_RAG_UNAVAILABLE" if missing_rag else "ACCOUNT_CLEANUP_FAILED"
                job.next_attempt_at = utc_now() + timedelta(seconds=min(3600, 30 * 2 ** min(job.attempt_count - 1, 7)))
                job.lease_until = None
                db.commit()
        finally:
            lease.close()
        return True

    def _process(self, lease: _JobLease) -> None:
        with lease.lock, self.factory() as db:
            job = lease.owned(db)
            phase, uid = job.phase, job.user_id
        if phase == "database":
            rag_lease = RedisLease(self.redis, RAG_LOCK_KEY, 60)
            if not rag_lease.acquire():
                raise RuntimeError("ACCOUNT_CLEANUP_RAG_LOCK_BUSY")
            try:
                with lease.lock, self.factory() as db:
                    job = lease.owned(db)
                    rag_lease.check()
                    clear_personal_rows(db, job)
            finally:
                rag_lease.close()
            phase = "objects"
        lease.check()
        revoke_user_sessions(self.redis, uid)
        if phase == "objects":
            for prefix in personal_object_prefixes(uid):
                lease.check()
                if hasattr(self.storage, "list_names"):
                    for name in self.storage.list_names(prefix):
                        lease.check()
                        if not name.startswith(prefix):
                            raise RuntimeError("ACCOUNT_CLEANUP_INVALID_OBJECT")
                        self.storage.delete(name)
                else:
                    self.storage.delete_prefix(prefix)
            with lease.lock, self.factory() as db:
                job = lease.owned(db)
                job.phase = "rag"
                db.commit()
            phase = "rag"
        if phase == "rag":
            with lease.lock, self.factory() as db:
                job = lease.owned(db)
                file_ids = list(job.cleanup_manifest.get("rag_file_ids", []))
            if file_ids and self.rag_client is None:
                raise RuntimeError("ACCOUNT_CLEANUP_RAG_UNAVAILABLE")
            for file_id in file_ids:
                lease.check()
                self.rag_client.delete_file(uid, int(file_id))
            with lease.lock, self.factory() as db:
                job = lease.owned(db)
                job.status, job.phase = "completed", "complete"
                job.completed_at, job.lease_until = utc_now(), None
                job.cleanup_manifest, job.last_error_code = {}, None
                db.commit()


async def run_account_deletion_loop(processor: AccountDeletionProcessor) -> None:
    while True:
        try:
            processed = await asyncio.to_thread(processor.run_once)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("account cleanup loop deferred", extra={"error_code": "ACCOUNT_CLEANUP_WORKER_UNAVAILABLE"})
            processed = False
        await asyncio.sleep(0 if processed else processor.settings.account_deletion_poll_seconds)


def retry_job(factory, public_id: str) -> bool:
    with factory() as db:
        result = db.execute(update(AccountDeletionJob).where(
            AccountDeletionJob.public_id == public_id, AccountDeletionJob.status == "needs_attention",
        ).values(status="retry_wait", attempt_count=0, last_error_code=None, next_attempt_at=utc_now(), lease_until=None))
        db.commit()
        return result.rowcount == 1


if __name__ == "__main__":
    from linkresume.core.config import load_settings
    from linkresume.core.database import build_engine, build_session_factory
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["retry"])
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()
    factory = build_session_factory(build_engine(load_settings().sqlalchemy_url))
    if not retry_job(factory, args.job_id):
        parser.exit(1, "No matching task requiring attention.\n")
    print("Cleanup task queued for retry.")
