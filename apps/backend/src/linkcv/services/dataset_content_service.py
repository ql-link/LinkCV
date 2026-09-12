"""Current dataset content, source revisions and deferred object reclamation."""

from datetime import timedelta
import re

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from linkcv.core.database import utc_now
from linkcv.core.errors import ApiError
from linkcv.modules.datasets.models import (
    UserDataset,
    DatasetReplacement,
    DatasetObjectCleanup,
)
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import DocumentParseTask, DATASET_SOURCE_TYPE


def lock_user(db: Session, user_id: int):
    db.scalar(select(User.id).where(User.id == user_id).with_for_update())


def owned(db: Session, user_id: int, dataset_id: int, *, lock=False):
    if lock:
        lock_user(db, user_id)
    q = select(UserDataset).where(
        UserDataset.id == dataset_id, UserDataset.user_id == user_id
    )
    dataset = db.scalar(
        q.with_for_update().execution_options(populate_existing=True) if lock else q
    )
    if dataset is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    task_query = select(DocumentParseTask).where(
        DocumentParseTask.id == dataset.parse_task_id,
        DocumentParseTask.user_id == user_id,
        DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
    )
    task = db.scalar(
        task_query.with_for_update().execution_options(populate_existing=True)
        if lock
        else task_query
    )
    if task is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    return dataset, task


def etag(dataset):
    return f'"dataset-{dataset.id}-{dataset.content_revision}"'


def check_match(dataset, value):
    if value is None:
        raise ApiError(428, "PRECONDITION_REQUIRED")
    if value != etag(dataset):
        raise ApiError(412, "DATASET_CONTENT_CONFLICT")


def active_replacement(db, dataset, *, lock=False):
    query = select(DatasetReplacement).where(
        DatasetReplacement.active_dataset_id == dataset.id,
        DatasetReplacement.user_id == dataset.user_id,
    )
    return db.scalar(
        query.with_for_update().execution_options(populate_existing=True)
        if lock
        else query
    )


def ensure_not_replacing(db, dataset):
    operation = active_replacement(db, dataset, lock=True)
    if operation and operation.status == "pending":
        raise ApiError(409, "DATASET_BUSY")


def ensure_not_busy(db, dataset, task):
    operation = active_replacement(db, dataset, lock=True)
    if (
        task.upload_status == "uploading"
        or task.parse_status in ("queued", "processing")
        or (operation and operation.status == "pending")
    ):
        raise ApiError(409, "DATASET_BUSY")


def content_key(dataset, task):
    key = dataset.content_object_name or task.converted_object_name
    if task.parse_status != "succeeded" or not key:
        raise ApiError(409, "DATASET_CONTENT_UNAVAILABLE")
    if not key.startswith(f"users/{dataset.user_id}/datasets/converted/"):
        raise ApiError(502, "DATASET_CONTENT_READ_FAILED")
    return key


def source_version(dataset):
    return (
        f"content-{dataset.content_revision}"
        if dataset.content_revision
        else dataset.sha256
    )


def strip_word_page_markers(markdown: str) -> str:
    """Remove standalone parser page metadata, preserving literal code examples."""
    output = []
    fence = None
    for line in markdown.splitlines(keepends=True):
        if fence:
            output.append(line)
            closing = re.fullmatch(r" {0,3}(`{3,}|~{3,})[ \t\r\n]*", line)
            if closing and closing[1][0] == fence[0] and len(closing[1]) >= len(fence):
                fence = None
            continue
        opening = re.match(r" {0,3}(`{3,}|~{3,})", line)
        if opening:
            fence = opening[1]
        if not re.fullmatch(
            r" {0,3}<!--[ \t]*WORD_PAGE:[ \t]*[0-9]+[ \t]*-->[ \t\r\n]*",
            line,
            re.IGNORECASE,
        ):
            output.append(line)
    return "".join(output)


def read_markdown(storage, key, max_bytes):
    response = storage.get(key)
    if isinstance(response, bytes):
        data = response
    else:
        data = bytearray()
        try:
            for chunk in response.stream(65536):
                data.extend(chunk)
                if len(data) > max_bytes:
                    raise ValueError("content too large")
        finally:
            response.close()
            response.release_conn()
    if len(data) > max_bytes:
        raise ValueError("content too large")
    return strip_word_page_markers(data.decode("utf-8"))


def enqueue_cleanup(db, user_id, key, task_id=None, delay=300):
    if not key:
        return
    if any(
        isinstance(item, DatasetObjectCleanup) and item.object_name == key
        for item in db.new
    ):
        return
    existing = db.scalar(
        select(DatasetObjectCleanup).where(DatasetObjectCleanup.object_name == key)
    )
    if existing is None:
        db.add(
            DatasetObjectCleanup(
                user_id=user_id,
                object_name=key,
                parse_task_id=task_id,
                not_before=utc_now() + timedelta(seconds=delay),
            )
        )




def cleanup_objects(session_factory, storage):
    with session_factory() as db:
        ids = list(
            db.scalars(
                select(DatasetObjectCleanup.id)
                .where(DatasetObjectCleanup.not_before <= utc_now())
                .order_by(DatasetObjectCleanup.id)
                .limit(100)
            )
        )
    for identifier in ids:
        with session_factory() as db:
            entry = db.get(DatasetObjectCleanup, identifier)
            if not entry:
                continue
            uid, key = entry.user_id, entry.object_name
            if not key.startswith(f"users/{uid}/datasets/"):
                continue
            lock_user(db, uid)
            # All writers lock the same user before making an object current.
            current = db.scalar(
                select(UserDataset.id)
                .where(
                    UserDataset.user_id == uid,
                    or_(
                        UserDataset.object_name == key,
                        UserDataset.content_object_name == key,
                    ),
                )
                .with_for_update()
            )
            task_ref = db.scalar(
                select(DocumentParseTask.id)
                .where(
                    DocumentParseTask.user_id == uid,
                    DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                    or_(
                        DocumentParseTask.object_name == key,
                        DocumentParseTask.converted_object_name == key,
                    ),
                )
                .with_for_update()
            )
            if current or task_ref:
                entry.not_before = utc_now() + timedelta(minutes=5)
                db.commit()
                continue
            # Claim this exact immutable key before releasing the user lock.
            # Writers reject a claimed ticket, so object I/O needs no open transaction.
            entry.attempt_count += 1
            attempt = entry.attempt_count
            entry.not_before = utc_now() + timedelta(minutes=5)
            db.commit()
        try:
            storage.delete(key)
        except Exception:
            with session_factory() as db:
                entry = db.get(DatasetObjectCleanup, identifier)
                if entry and entry.attempt_count == attempt:
                    entry.not_before = utc_now() + timedelta(
                        seconds=min(3600, 30 * 2 ** min(attempt, 7))
                    )
                    db.commit()
            continue
        with session_factory() as db:
            entry = db.get(DatasetObjectCleanup, identifier)
            if entry and entry.attempt_count == attempt:
                db.delete(entry)
                db.commit()
