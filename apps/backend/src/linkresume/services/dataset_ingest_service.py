"""Unified dataset ingest: document uploads buffer+validate, media stream.

Both library uploads and interview-session uploads produce the same
``UserDataset`` + ``DocumentParseTask`` pair; interview uploads additionally
link the row to a session. Media assets land in a terminal parse task state
(``succeeded``/``succeeded`` with ``parse_duration_ms=0``) so join-based
queries keep working while no parse work is dispatched.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePath
from time import monotonic
from typing import Any, Callable

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.core.config import Settings
from linkresume.core.errors import ApiError
from linkresume.core.storage import (
    AssetStorage,
    EmptyUpload,
    UploadTooLarge,
    build_dataset_object_name,
)
from linkresume.modules.datasets.models import (
    DatasetReplacement,
    UserDataset,
    UserDatasetFolder,
)
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkresume.services import dataset_content_service as content_service
from linkresume.services.dataset_replacement_service import check_name
from linkresume.services.dataset_upload_service import (
    safe_dataset_filename,
    validate_dataset_file,
)

logger = logging.getLogger(__name__)

DOCUMENT_FORMATS = frozenset({"docx", "pdf", "md", "txt"})

# extension -> (asset_kind, allowed declared content types)
SUPPORTED_DATASET_MEDIA_TYPES: dict[str, tuple[str, frozenset[str]]] = {
    "webm": ("audio", frozenset({"audio/webm", "video/webm"})),
    "m4a": ("audio", frozenset({"audio/mp4", "audio/x-m4a"})),
    "mp3": ("audio", frozenset({"audio/mpeg", "audio/mp3"})),
    "wav": ("audio", frozenset({"audio/wav", "audio/x-wav"})),
    "ogg": ("audio", frozenset({"audio/ogg", "application/ogg"})),
    "mp4": ("video", frozenset({"video/mp4", "audio/mp4"})),
    "mov": ("video", frozenset({"video/quicktime"})),
}


@dataclass(frozen=True, slots=True)
class DeclaredMediaFile:
    file_name: str
    file_format: str
    asset_kind: str
    content_type: str
    declared_size: int | None
    request_fingerprint: str


@dataclass(frozen=True, slots=True)
class IngestResult:
    dataset: UserDataset
    task: DocumentParseTask
    replayed: bool


def dataset_asset_kind(file_format: str) -> str:
    if file_format in DOCUMENT_FORMATS:
        return "document"
    if file_format in SUPPORTED_DATASET_MEDIA_TYPES:
        return SUPPORTED_DATASET_MEDIA_TYPES[file_format][0]
    raise ApiError(400, "UNSUPPORTED_DATASET_FILE")


def is_media_filename(filename: str) -> bool:
    """Cheap pre-read check used to pick the streaming branch."""
    extension = PurePath(filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip())
    return extension.suffix.lower().lstrip(".") in SUPPORTED_DATASET_MEDIA_TYPES


def validate_declared_media(
    *,
    filename: str,
    declared_content_type: str | None,
    declared_size: int | None,
    max_bytes: int,
) -> DeclaredMediaFile:
    """Validate extension + declared MIME only; content is trusted per file type."""
    safe_filename = safe_dataset_filename(filename)
    extension = PurePath(safe_filename).suffix.lower().lstrip(".")
    contract = SUPPORTED_DATASET_MEDIA_TYPES.get(extension)
    if contract is None:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
    declared_type = (declared_content_type or "application/octet-stream").lower()
    declared_type = declared_type.split(";", 1)[0].strip()
    if declared_type not in contract[1]:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
    if declared_size is not None and declared_size > max_bytes:
        raise ApiError(413, "DATASET_FILE_TOO_LARGE")
    fingerprint_payload = {
        "version": 1,
        "file_name": safe_filename,
        "file_format": extension,
        "content_type": declared_type,
        "file_size": declared_size,
    }
    encoded = json.dumps(
        fingerprint_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return DeclaredMediaFile(
        file_name=safe_filename,
        file_format=extension,
        asset_kind=contract[0],
        content_type=declared_type,
        declared_size=declared_size,
        request_fingerprint=hashlib.sha256(encoded).hexdigest(),
    )


def media_fingerprint_for(
    *,
    file_name: str,
    file_format: str,
    content_type: str,
    file_size: int | None,
) -> str:
    """Weak fingerprint for media: no content hash (unknown before streaming)."""
    payload = {
        "version": 1,
        "file_name": file_name,
        "file_format": file_format,
        "content_type": content_type,
        "file_size": file_size,
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def check_media_capacity(
    db: Session,
    *,
    user_id: int,
    incoming_bytes: int,
    max_count: int,
    max_total_bytes: int,
) -> None:
    content_service.lock_user(db, user_id)
    count, total_bytes = db.execute(
        select(
            func.count(UserDataset.id),
            func.coalesce(func.sum(UserDataset.file_size), 0),
        )
        .join(
            DocumentParseTask,
            DocumentParseTask.id == UserDataset.parse_task_id,
        )
        .where(
            UserDataset.user_id == user_id,
            UserDataset.asset_kind.in_(("audio", "video")),
            DocumentParseTask.user_id == user_id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
            DocumentParseTask.upload_status != "failed",
        )
        .with_for_update()
    ).one()
    if int(count) >= max_count:
        raise ApiError(409, "DATASET_MEDIA_COUNT_LIMIT_REACHED")
    if int(total_bytes) + incoming_bytes > max_total_bytes:
        raise ApiError(409, "DATASET_MEDIA_STORAGE_LIMIT_REACHED")


def check_document_capacity(
    db: Session,
    *,
    user_id: int,
    incoming_bytes: int,
    max_count: int,
    max_total_bytes: int,
) -> None:
    content_service.lock_user(db, user_id)
    count, total_bytes = db.execute(
        select(
            func.count(UserDataset.id),
            func.coalesce(func.sum(UserDataset.file_size), 0),
        )
        .join(
            DocumentParseTask,
            DocumentParseTask.id == UserDataset.parse_task_id,
        )
        .where(
            UserDataset.user_id == user_id,
            UserDataset.asset_kind == "document",
            DocumentParseTask.user_id == user_id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
            DocumentParseTask.upload_status != "failed",
        )
        .with_for_update()
    ).one()
    if int(count) >= max_count:
        raise ApiError(409, "DATASET_COUNT_LIMIT_REACHED")
    pending_bytes = (
        db.scalar(
            select(func.coalesce(func.sum(DatasetReplacement.source_file_size), 0))
            .where(
                DatasetReplacement.user_id == user_id,
                DatasetReplacement.active_dataset_id.is_not(None),
            )
            .with_for_update()
        )
        or 0
    )
    if int(total_bytes) + int(pending_bytes) + incoming_bytes > max_total_bytes:
        raise ApiError(409, "DATASET_STORAGE_LIMIT_REACHED")


def _require_folder(
    db: Session, user_id: int, folder_id: int | None
) -> None:
    """Enforce the folder requirement inside the caller's locked section."""
    if folder_id is None:
        return
    folder_exists = db.execute(
        select(UserDatasetFolder.id)
        .where(
            UserDatasetFolder.id == folder_id,
            UserDatasetFolder.user_id == user_id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if folder_exists is None:
        raise ApiError(404, "FOLDER_NOT_FOUND")


def find_idempotent_dataset(
    db: Session,
    *,
    user_id: int,
    idempotency_key: str,
):
    return db.execute(
        select(UserDataset, DocumentParseTask)
        .join(
            DocumentParseTask,
            DocumentParseTask.id == UserDataset.parse_task_id,
        )
        .where(
            UserDataset.user_id == user_id,
            UserDataset.idempotency_key == idempotency_key,
            DocumentParseTask.user_id == user_id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
        )
    ).one_or_none()


def _replay_guard(
    existing,
    *,
    request_fingerprint: str,
    folder_id: int | None,
) -> IngestResult | None:
    if existing is None:
        return None
    dataset, task = existing
    if folder_id is not None and dataset.folder_id != folder_id:
        raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
    if dataset.request_fingerprint != request_fingerprint:
        raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
    if task.upload_status == "failed":
        raise ApiError(409, "DATASET_UPLOAD_PREVIOUSLY_FAILED")
    return IngestResult(dataset, task, True)


async def ingest_document_upload(
    db: Session,
    *,
    user: User,
    settings: Settings,
    storage: AssetStorage,
    upload: UploadFile,
    file_name_override: str | None,
    folder_id: int | None,
    interview_session_id: int | None,
    interview_source_type: str | None,
    duration_ms: int | None,
    idempotency_key: str,
) -> IngestResult:
    try:
        content = await upload.read(settings.dataset_upload_max_bytes + 1)
    finally:
        await upload.close()
    if (
        file_name_override
        and PurePath(file_name_override).suffix.lower()
        != PurePath(upload.filename or "").suffix.lower()
    ):
        raise ApiError(422, "DATASET_FILE_EXTENSION_MISMATCH")
    validated = await asyncio.to_thread(
        validate_dataset_file,
        filename=file_name_override or upload.filename or "",
        content=content,
        max_bytes=settings.dataset_upload_max_bytes,
    )

    content_service.lock_user(db, user.id)
    _require_folder(db, user.id, folder_id)
    existing = find_idempotent_dataset(
        db, user_id=user.id, idempotency_key=idempotency_key
    )
    replay = _replay_guard(
        existing,
        request_fingerprint=validated.request_fingerprint,
        folder_id=folder_id,
    )
    if replay is not None:
        return replay

    check_name(db, user.id, folder_id, validated.file_name)
    check_document_capacity(
        db,
        user_id=user.id,
        incoming_bytes=validated.file_size,
        max_count=settings.dataset_max_count_per_user,
        max_total_bytes=settings.dataset_max_total_bytes_per_user,
    )

    object_name = build_dataset_object_name(user.id, validated.file_name)
    task = DocumentParseTask(
        source_type=DATASET_SOURCE_TYPE,
        user_id=user.id,
        file_name=validated.file_name,
        file_format=validated.file_format,
        object_name=object_name,
        upload_status="uploading",
        upload_duration_ms=None,
        parse_status=None,
    )
    dataset = UserDataset(
        user_id=user.id,
        folder_id=folder_id,
        file_name=validated.file_name,
        file_format=validated.file_format,
        content_type=validated.content_type,
        file_size=validated.file_size,
        object_name=object_name,
        sha256=validated.sha256,
        idempotency_key=idempotency_key,
        request_fingerprint=validated.request_fingerprint,
        asset_kind="document",
        interview_session_id=interview_session_id,
        interview_source_type=interview_source_type,
        duration_ms=duration_ms,
    )
    db.add(task)
    try:
        db.flush()
        dataset.parse_task_id = task.id
        db.add(dataset)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = find_idempotent_dataset(
            db, user_id=user.id, idempotency_key=idempotency_key
        )
        replay = _replay_guard(
            existing,
            request_fingerprint=validated.request_fingerprint,
            folder_id=folder_id,
        )
        if replay is not None:
            return replay
        raise ApiError(500, "DATASET_RECORD_FAILED")
    except Exception as error:
        db.rollback()
        raise ApiError(500, "DATASET_RECORD_FAILED") from error

    upload_started = monotonic()
    try:
        await asyncio.to_thread(
            storage.upload_stream,
            object_name,
            BytesIO(validated.content),
            validated.content_type,
            max_bytes=settings.dataset_upload_max_bytes,
        )
    except Exception as error:
        task.upload_status = "failed"
        task.upload_duration_ms = min(
            max(0, round((monotonic() - upload_started) * 1000)),
            2**32 - 1,
        )
        task.failure_reason = "storage_unavailable"
        db.commit()
        try:
            await asyncio.to_thread(storage.delete, object_name)
        except Exception:
            logger.warning(
                "dataset failed upload cleanup failed",
                extra={"dataset_id": dataset.id},
            )
        raise ApiError(502, "DATASET_STORAGE_UNAVAILABLE") from error

    upload_duration_ms = min(
        max(0, round((monotonic() - upload_started) * 1000)),
        2**32 - 1,
    )
    try:
        task.upload_status = "succeeded"
        task.upload_duration_ms = upload_duration_ms
        task.parse_status = "queued"
        task.failure_reason = None
        db.commit()
    except Exception as error:
        db.rollback()
        try:
            await asyncio.to_thread(storage.delete, object_name)
        except Exception:
            pass
        try:
            failed_task = db.get(DocumentParseTask, task.id)
            if failed_task is not None and failed_task.upload_status == "uploading":
                failed_task.upload_status = "failed"
                failed_task.upload_duration_ms = upload_duration_ms
                failed_task.failure_reason = "record_failed"
                db.commit()
        except Exception:
            db.rollback()
        raise ApiError(500, "DATASET_RECORD_FAILED") from error

    db.refresh(dataset)
    db.refresh(task)
    return IngestResult(dataset, task, False)


async def ingest_media_upload(
    db: Session,
    *,
    user: User,
    settings: Settings,
    storage: AssetStorage,
    upload: UploadFile,
    file_name_override: str | None,
    folder_id: int | None,
    interview_session_id: int | None,
    interview_source_type: str | None,
    duration_ms: int | None,
    idempotency_key: str,
) -> IngestResult:
    """Stream a media file into the library; object lands before the row."""
    declared = validate_declared_media(
        filename=file_name_override or upload.filename or "",
        declared_content_type=upload.content_type,
        declared_size=upload.size,
        max_bytes=settings.interview_asset_upload_max_bytes,
    )
    # Phase A (short lock): replay check + name uniqueness + quota pre-check.
    try:
        content_service.lock_user(db, user.id)
        _require_folder(db, user.id, folder_id)
        existing = find_idempotent_dataset(
            db, user_id=user.id, idempotency_key=idempotency_key
        )
        replay = _replay_guard(
            existing,
            request_fingerprint=declared.request_fingerprint,
            folder_id=folder_id,
        )
        if replay is not None:
            await upload.close()
            return replay
        check_name(db, user.id, folder_id, declared.file_name)
        check_media_capacity(
            db,
            user_id=user.id,
            incoming_bytes=declared.declared_size or 0,
            max_count=settings.media_max_count_per_user,
            max_total_bytes=settings.media_max_total_bytes_per_user,
        )
        db.commit()  # release the user lock before slow object I/O
    except ApiError:
        db.rollback()
        await upload.close()
        raise
    except Exception:
        db.rollback()
        await upload.close()
        raise

    object_name = build_dataset_object_name(user.id, declared.file_name)
    upload_started = monotonic()
    try:
        result = await asyncio.to_thread(
            storage.upload_stream,
            object_name,
            upload.file,
            declared.content_type,
            max_bytes=settings.interview_asset_upload_max_bytes,
        )
    except UploadTooLarge as error:
        raise ApiError(413, "DATASET_FILE_TOO_LARGE") from error
    except EmptyUpload as error:
        raise ApiError(400, "EMPTY_DATASET_FILE") from error
    except Exception as error:
        raise ApiError(502, "DATASET_STORAGE_UNAVAILABLE") from error
    finally:
        await upload.close()
    upload_duration_ms = min(
        max(0, round((monotonic() - upload_started) * 1000)),
        2**32 - 1,
    )

    # Phase B (short lock): authoritative capacity on actual bytes, then insert.
    try:
        content_service.lock_user(db, user.id)
        check_media_capacity(
            db,
            user_id=user.id,
            incoming_bytes=result.file_size,
            max_count=settings.media_max_count_per_user,
            max_total_bytes=settings.media_max_total_bytes_per_user,
        )
        task = DocumentParseTask(
            source_type=DATASET_SOURCE_TYPE,
            user_id=user.id,
            file_name=declared.file_name,
            file_format=declared.file_format,
            object_name=object_name,
            upload_status="succeeded",
            upload_duration_ms=upload_duration_ms,
            parse_status="succeeded",
            parse_duration_ms=0,
        )
        dataset = UserDataset(
            user_id=user.id,
            folder_id=folder_id,
            file_name=declared.file_name,
            file_format=declared.file_format,
            content_type=declared.content_type,
            file_size=result.file_size,
            object_name=object_name,
            sha256=result.sha256,
            idempotency_key=idempotency_key,
            request_fingerprint=declared.request_fingerprint,
            asset_kind=declared.asset_kind,
            interview_session_id=interview_session_id,
            interview_source_type=interview_source_type,
            duration_ms=duration_ms,
        )
        db.add(task)
        db.flush()
        dataset.parse_task_id = task.id
        db.add(dataset)
        db.commit()
        db.refresh(dataset)
        db.refresh(task)
        return IngestResult(dataset, task, False)
    except IntegrityError:
        db.rollback()
        existing = find_idempotent_dataset(
            db, user_id=user.id, idempotency_key=idempotency_key
        )
        try:
            await asyncio.to_thread(storage.delete, object_name)
        except Exception:
            pass
        replay = _replay_guard(
            existing,
            request_fingerprint=declared.request_fingerprint,
            folder_id=folder_id,
        )
        if replay is not None:
            return replay
        raise ApiError(500, "DATASET_RECORD_FAILED")
    except ApiError:
        db.rollback()
        try:
            await asyncio.to_thread(storage.delete, object_name)
        except Exception:
            logger.warning("media over-quota object cleanup failed")
        raise
    except Exception as error:
        db.rollback()
        try:
            await asyncio.to_thread(storage.delete, object_name)
        except Exception:
            pass
        raise ApiError(500, "DATASET_RECORD_FAILED") from error


async def ingest_dataset_upload(
    db: Session,
    *,
    user: User,
    settings: Settings,
    storage: AssetStorage,
    upload: UploadFile,
    file_name_override: str | None,
    folder_id: int | None,
    interview_session_id: int | None = None,
    interview_source_type: str | None = None,
    duration_ms: int | None = None,
    idempotency_key: str,
) -> IngestResult:
    """Route the upload to the buffered document path or the streaming media path."""
    probe = file_name_override or upload.filename or ""
    if is_media_filename(probe):
        return await ingest_media_upload(
            db,
            user=user,
            settings=settings,
            storage=storage,
            upload=upload,
            file_name_override=file_name_override,
            folder_id=folder_id,
            interview_session_id=interview_session_id,
            interview_source_type=interview_source_type,
            duration_ms=duration_ms,
            idempotency_key=idempotency_key,
        )
    return await ingest_document_upload(
        db,
        user=user,
        settings=settings,
        storage=storage,
        upload=upload,
        file_name_override=file_name_override,
        folder_id=folder_id,
        interview_session_id=interview_session_id,
        interview_source_type=interview_source_type,
        duration_ms=duration_ms,
        idempotency_key=idempotency_key,
    )
