import asyncio
import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from linkcv.core.database import utc_now
from linkcv.core.storage import AssetStorage
from linkcv.modules.resumes.models import StorageCleanupJob

logger = logging.getLogger(__name__)


def enqueue_storage_cleanup(
    db: Session,
    *,
    operation: str,
    object_key: str,
) -> StorageCleanupJob:
    if operation not in {"object", "prefix"}:
        raise ValueError("unsupported storage cleanup operation")
    existing = db.scalar(
        select(StorageCleanupJob).where(
            StorageCleanupJob.operation == operation,
            StorageCleanupJob.object_key == object_key,
        )
    )
    if existing is not None:
        return existing
    job = StorageCleanupJob(operation=operation, object_key=object_key)
    db.add(job)
    db.flush()
    return job


def process_storage_cleanup_jobs(
    db: Session,
    storage: AssetStorage,
    *,
    job_ids: Sequence[int] | None = None,
    limit: int = 50,
) -> int:
    query = select(StorageCleanupJob).order_by(
        StorageCleanupJob.created_at,
        StorageCleanupJob.id,
    )
    if job_ids is not None:
        if not job_ids:
            return 0
        query = query.where(StorageCleanupJob.id.in_(job_ids))
    jobs = db.scalars(query.limit(limit)).all()
    completed = 0
    for job in jobs:
        try:
            if job.operation == "object":
                storage.delete(job.object_key)
            else:
                storage.delete_prefix(job.object_key)
        except Exception as error:
            job.attempts += 1
            job.last_error_type = type(error).__name__[:128]
            job.last_attempt_at = utc_now()
            try:
                db.commit()
            except Exception as commit_error:
                db.rollback()
                logger.warning(
                    "storage cleanup failure metadata could not be saved",
                    extra={
                        "cleanup_job_id": job.id,
                        "error_type": type(commit_error).__name__,
                    },
                )
            logger.warning(
                "storage cleanup attempt failed",
                extra={
                    "cleanup_job_id": job.id,
                    "operation": job.operation,
                    "error_type": type(error).__name__,
                },
            )
        else:
            db.delete(job)
            try:
                db.commit()
            except Exception as error:
                db.rollback()
                logger.warning(
                    "completed storage cleanup job could not be removed",
                    extra={
                        "cleanup_job_id": job.id,
                        "error_type": type(error).__name__,
                    },
                )
            else:
                completed += 1
    return completed


async def run_storage_cleanup_worker(
    session_factory: sessionmaker[Session],
    storage: AssetStorage,
    *,
    interval_seconds: float = 60,
) -> None:
    while True:
        def process_batch() -> None:
            with session_factory() as db:
                process_storage_cleanup_jobs(db, storage)

        try:
            await asyncio.to_thread(process_batch)
        except Exception:
            logger.exception("storage cleanup worker batch failed")
        await asyncio.sleep(interval_seconds)
