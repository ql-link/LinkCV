"""Name conflicts and one in-flight replacement per dataset."""

import unicodedata
from datetime import timedelta
from hashlib import sha256
from pathlib import PurePath
from sqlalchemy import select
from linkcv.core.database import utc_now
from linkcv.core.errors import ApiError
from linkcv.modules.datasets.models import UserDataset, DatasetReplacement
from linkcv.modules.resumes.models import DocumentParseTask, DATASET_SOURCE_TYPE
from linkcv.services.dataset_content_service import enqueue_cleanup, lock_user


def check_name(db, user_id, folder_id, name, exclude_id=None):
    lock_user(db, user_id)
    rows = list(
        db.scalars(
            select(UserDataset)
            .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
            .where(
                UserDataset.user_id == user_id,
                UserDataset.folder_id == folder_id,
                DocumentParseTask.upload_status != "failed",
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    normalize = lambda value: unicodedata.normalize("NFC", value)
    matches = [
        r
        for r in rows
        if r.id != exclude_id and normalize(r.file_name) == normalize(name)
    ]
    if not matches:
        return
    occupied = {normalize(r.file_name) for r in rows}
    extension = PurePath(name).suffix
    stem = name[: -len(extension)] if extension else name
    stem = stem[: max(1, 240 - len(extension))]
    n = 1
    while normalize(f"{stem} ({n}){extension}") in occupied:
        n += 1
    raise ApiError(
        409,
        "DATASET_NAME_CONFLICT",
        details={
            "candidates": [
                {
                    "id": str(r.id),
                    "file_name": r.file_name,
                    "created_at": r.created_at.isoformat(),
                    "content_revision": str(r.content_revision),
                    "replaceable": not db.scalar(
                        select(DatasetReplacement.id).where(
                            DatasetReplacement.active_dataset_id == r.id
                        )
                    )
                    and db.get(DocumentParseTask, r.parse_task_id).parse_status
                    == "succeeded",
                }
                for r in matches
            ],
            "suggested_name": f"{stem} ({n}){extension}",
        },
    )


def summary(db, op, dataset):
    if op is None:
        return None
    task = db.get(DocumentParseTask, op.parse_task_id) if op.parse_task_id else None
    return {
        "id": str(op.id),
        "status": op.status,
        "upload_status": task.upload_status if task else None,
        "parse_status": task.parse_status if task else None,
        "failure_code": op.failure_code,
        "retryable": op.status in ("failed", "conflict")
        and task is not None
        and task.upload_status == "succeeded",
        "current_revision": str(dataset.content_revision),
    }


def retire_task(db, task):
    enqueue_cleanup(db, task.user_id, task.object_name)
    enqueue_cleanup(db, task.user_id, task.converted_object_name)
    enqueue_cleanup(
        db, task.user_id, f"users/{task.user_id}/datasets/converted/{task.id}.md"
    )
    for op in db.scalars(
        select(DatasetReplacement).where(DatasetReplacement.parse_task_id == task.id)
    ):
        op.parse_task_id = None
    db.delete(task)


def apply_replacement(db, op, dataset, task, markdown=None):
    if op.status != "pending" or op.active_dataset_id != dataset.id:
        return False
    if dataset.content_revision != op.base_revision:
        op.status = "conflict"
        op.failure_code = "DATASET_CONTENT_CONFLICT"
        return False
    old_task = db.get(DocumentParseTask, dataset.parse_task_id)
    if old_task and old_task.id != task.id:
        retire_task(db, old_task)
    enqueue_cleanup(db, dataset.user_id, dataset.content_object_name)
    dataset.parse_task_id = task.id
    dataset.object_name = task.object_name
    dataset.file_name = task.file_name
    dataset.file_format = task.file_format
    dataset.content_type = op.source_content_type
    dataset.file_size = op.source_file_size
    dataset.sha256 = op.source_sha256
    dataset.content_object_name = task.converted_object_name
    dataset.content_sha256 = (
        sha256(markdown.encode("utf-8")).hexdigest() if markdown is not None else None
    )
    dataset.content_updated_at = utc_now()
    dataset.content_revision += 1
    dataset.last_content_request_id = None
    op.status = "applied"
    op.active_dataset_id = None
    op.failure_code = None
    op.updated_at = utc_now()
    return True


def reconcile_replacements(session_factory):
    """Reflect terminal parse failures and reclaim old operational receipts."""
    with session_factory() as db:
        ids = list(
            db.scalars(
                select(DatasetReplacement.id)
                .where(DatasetReplacement.status == "pending")
                .limit(100)
            )
        )
    for identifier in ids:
        with session_factory() as db:
            op = db.get(DatasetReplacement, identifier)
            if op is None:
                continue
            lock_user(db, op.user_id)
            db.refresh(op, with_for_update=True)
            task = db.get(
                DocumentParseTask,
                op.parse_task_id,
                with_for_update=True,
                populate_existing=True,
            )
            if (
                op.status == "pending"
                and task
                and (task.upload_status == "failed" or task.parse_status == "failed")
            ):
                op.status = "failed"
                op.failure_code = task.failure_reason or "DATASET_UPLOAD_FAILED"
                op.updated_at = utc_now()
            db.commit()
    with session_factory() as db:
        for op in db.scalars(
            select(DatasetReplacement)
            .where(
                DatasetReplacement.status.in_(("applied", "discarded")),
                DatasetReplacement.updated_at < utc_now() - timedelta(hours=24),
            )
            .limit(100)
        ):
            db.delete(op)
        db.commit()
