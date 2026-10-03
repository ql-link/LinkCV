"""Current dataset content, source revisions and synchronous file removal."""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.core.errors import ApiError
from linkresume.modules.datasets.models import UserDataset, DatasetTranscriptionTask, TRANSCRIPTION_ACTIVE
from linkresume.modules.identity.models import User
from linkresume.modules.identity.dependencies import lock_active_user
from linkresume.modules.resumes.models import DocumentParseTask, DATASET_SOURCE_TYPE


def lock_user(db: Session, user_id: int):
    lock_active_user(db, user_id)


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


def ensure_not_busy(db, dataset, task):
    if db.scalar(select(DatasetTranscriptionTask.id).where(
        DatasetTranscriptionTask.dataset_id == dataset.id,
        DatasetTranscriptionTask.status.in_(TRANSCRIPTION_ACTIVE)).limit(1)):
        raise ApiError(409, "DATASET_BUSY")
    if task.upload_status == "uploading" or task.parse_status in ("queued", "processing"):
        raise ApiError(409, "DATASET_BUSY")


def dataset_source_prefix(user_id: int) -> str:
    return f"users/{user_id}/datasets/"


def dataset_converted_prefix(user_id: int) -> str:
    return f"users/{user_id}/datasets/converted/"


def dataset_converted_object_name(user_id: int, task_id: int) -> str:
    return f"{dataset_converted_prefix(user_id)}{task_id}.md"


def dataset_converted_attempt_object_name(
    user_id: int,
    task_id: int,
    attempt: int,
) -> str:
    return f"{dataset_converted_prefix(user_id)}{task_id}-{attempt}.md"


def validate_dataset_object_keys(
    dataset: UserDataset,
    task: DocumentParseTask,
    user_id: int,
) -> None:
    if (
        dataset.object_name != task.object_name
        or not dataset.object_name.startswith(dataset_source_prefix(user_id))
        or task.object_name.startswith(dataset_converted_prefix(user_id))
    ):
        raise ApiError(502, "ASSET_DELETE_FAILED")
    if dataset.content_object_name and not dataset.content_object_name.startswith(
        dataset_converted_prefix(user_id)
    ):
        raise ApiError(502, "ASSET_DELETE_FAILED")
    if task.converted_object_name:
        allowed_converted_names = {
            dataset_converted_object_name(user_id, task.id),
            dataset_converted_attempt_object_name(
                user_id,
                task.id,
                task.parse_attempt_count,
            ),
        }
        if task.converted_object_name not in allowed_converted_names:
            raise ApiError(502, "ASSET_DELETE_FAILED")


def delete_files(storage, dataset, task):
    """Delete the source and every known content key before changing the row."""
    validate_dataset_object_keys(dataset, task, dataset.user_id)
    keys = dict.fromkeys(
        key for key in (
            dataset.object_name,
            dataset.content_object_name,
            task.converted_object_name,
            f"users/{dataset.user_id}/datasets/converted/{task.id}.md",
        ) if key
    )
    try:
        for key in keys:
            storage.delete(key)
    except Exception as error:
        raise ApiError(502, "ASSET_DELETE_FAILED") from error


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
