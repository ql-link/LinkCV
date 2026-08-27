import asyncio
import logging
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePath
from time import monotonic
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, Request, Response, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.mq import DatasetParseMessage, MQPublishError
from linkcv.core.mq.factory import build_mq_publisher
from linkcv.core.storage import (
    AssetStorage,
    build_dataset_object_name,
    get_storage,
)
from linkcv.modules.datasets.models import UserDataset
from linkcv.modules.datasets.schemas import (
    UserDatasetContentResponse,
    UserDatasetDeleteResponse,
    UserDatasetLimits,
    UserDatasetListResponse,
    UserDatasetRenameRequest,
    UserDatasetRecord,
)
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkcv.services.dataset_upload_service import validate_dataset_file
from linkcv.services.import_admission import (
    ImportAdmissionController,
    ImportAdmissionRejected,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])
logger = logging.getLogger(__name__)

ALLOWED_DATASET_EXTENSIONS = [".pdf", ".docx", ".md", ".txt"]


def read_dataset_markdown(
    storage: AssetStorage,
    object_name: str,
    max_bytes: int,
) -> str:
    response = storage.get(object_name)
    if isinstance(response, bytes):
        content = response
    else:
        chunks: list[bytes] = []
        size = 0
        try:
            for chunk in response.stream(64 * 1024):
                if not isinstance(chunk, bytes):
                    raise TypeError("storage response did not return bytes")
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError("dataset markdown exceeds configured limit")
                chunks.append(chunk)
            content = b"".join(chunks)
        finally:
            response.close()
            response.release_conn()
    if len(content) > max_bytes:
        raise ValueError("dataset markdown exceeds configured limit")
    return content.decode("utf-8")


def dataset_extension(dataset: UserDataset) -> str:
    suffix = PurePath(dataset.file_name).suffix
    if suffix and suffix.lower() == f".{dataset.file_format}":
        return suffix
    return f".{dataset.file_format}"


def safe_dataset_display_filename(name: str, dataset: UserDataset) -> str:
    display_name = name.strip()
    extension = dataset_extension(dataset)
    if display_name.lower().endswith(extension.lower()) and len(display_name) > len(
        extension
    ):
        display_name = display_name[: -len(extension)].rstrip()
    if (
        not display_name
        or "/" in display_name
        or "\\" in display_name
        or any(ord(character) < 32 or ord(character) == 127 for character in display_name)
        or len(f"{display_name}{extension}") > 255
    ):
        raise ApiError(400, "INVALID_DATASET_NAME")
    return f"{display_name}{extension}"


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


def get_dataset_publisher(request: Request, settings: Settings):
    publisher = request.app.state.mq_publisher
    if publisher is not None:
        return publisher
    try:
        publisher = build_mq_publisher(settings)
    except ValueError as error:
        raise MQPublishError("dataset queue unavailable") from error
    request.app.state.mq_publisher = publisher
    return publisher


def get_dataset_admission(request: Request) -> ImportAdmissionController:
    return request.app.state.dataset_admission


def canonical_dataset_idempotency_key(value: str | None) -> str:
    try:
        parsed = UUID(value or "")
    except (ValueError, AttributeError) as error:
        raise ApiError(400, "INVALID_IDEMPOTENCY_KEY") from error
    canonical = str(parsed)
    if value != canonical:
        raise ApiError(400, "INVALID_IDEMPOTENCY_KEY")
    return canonical


def load_dataset_by_idempotency(
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


def replay_dataset_upload(
    row,
    *,
    request_fingerprint: str,
    response: Response,
) -> UserDatasetRecord:
    dataset, task = row
    if dataset.request_fingerprint != request_fingerprint:
        raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
    if task.upload_status == "failed":
        raise ApiError(409, "DATASET_UPLOAD_PREVIOUSLY_FAILED")
    response.status_code = (
        200
        if task.upload_status == "succeeded" and task.parse_status == "succeeded"
        else 202
    )
    return dataset_record(dataset, task)


def ensure_dataset_capacity(
    db: Session,
    *,
    user_id: int,
    incoming_bytes: int,
    max_count: int,
    max_total_bytes: int,
) -> None:
    db.scalar(select(User.id).where(User.id == user_id).with_for_update())
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
            DocumentParseTask.user_id == user_id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
            DocumentParseTask.upload_status != "failed",
        )
    ).one()
    if int(count) >= max_count:
        raise ApiError(409, "DATASET_COUNT_LIMIT_REACHED")
    if int(total_bytes) + incoming_bytes > max_total_bytes:
        raise ApiError(409, "DATASET_STORAGE_LIMIT_REACHED")


def load_owned_dataset(
    db: Session,
    dataset_id: int,
    user_id: int,
):
    return db.execute(
        select(UserDataset, DocumentParseTask)
        .join(
            DocumentParseTask,
            DocumentParseTask.id == UserDataset.parse_task_id,
        )
        .where(
            UserDataset.id == dataset_id,
            UserDataset.user_id == user_id,
            DocumentParseTask.user_id == user_id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
        )
        .with_for_update()
    ).one_or_none()


def dataset_record(
    dataset: UserDataset,
    task: DocumentParseTask,
) -> UserDatasetRecord:
    return UserDatasetRecord(
        id=str(dataset.id),
        file_name=dataset.file_name,
        file_format=dataset.file_format,
        file_size=dataset.file_size,
        upload_status=task.upload_status,
        parse_status=task.parse_status,
        failure_reason=task.failure_reason,
        created_at=dataset.created_at,
    )


@router.post("", response_model=UserDatasetRecord, status_code=202)
async def upload_dataset(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    idempotency_key_header: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    dataset_admission: ImportAdmissionController = Depends(get_dataset_admission),
) -> UserDatasetRecord:
    idempotency_key = canonical_dataset_idempotency_key(idempotency_key_header)
    try:
        admission_context = dataset_admission.acquire(user.id)
        await admission_context.__aenter__()
    except ImportAdmissionRejected as error:
        raise ApiError(
            429,
            "DATASET_UPLOAD_RATE_LIMITED",
            headers={"Retry-After": "60"},
        ) from error

    try:
        try:
            content = await file.read(settings.dataset_upload_max_bytes + 1)
        finally:
            await file.close()
        validated = await asyncio.to_thread(
            validate_dataset_file,
            filename=file.filename or "",
            content=content,
            max_bytes=settings.dataset_upload_max_bytes,
        )

        existing = load_dataset_by_idempotency(
            db,
            user_id=user.id,
            idempotency_key=idempotency_key,
        )
        if existing is not None:
            return replay_dataset_upload(
                existing,
                request_fingerprint=validated.request_fingerprint,
                response=response,
            )

        ensure_dataset_capacity(
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
            file_name=validated.file_name,
            file_format=validated.file_format,
            content_type=validated.content_type,
            file_size=validated.file_size,
            object_name=object_name,
            sha256=validated.sha256,
            idempotency_key=idempotency_key,
            request_fingerprint=validated.request_fingerprint,
        )
        db.add(task)
        try:
            db.flush()
            dataset.parse_task_id = task.id
            db.add(dataset)
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = load_dataset_by_idempotency(
                db,
                user_id=user.id,
                idempotency_key=idempotency_key,
            )
            if existing is None:
                raise ApiError(500, "DATASET_RECORD_FAILED")
            return replay_dataset_upload(
                existing,
                request_fingerprint=validated.request_fingerprint,
                response=response,
            )
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
            upload_duration_ms = min(
                max(0, round((monotonic() - upload_started) * 1000)),
                2**32 - 1,
            )
            task.upload_status = "failed"
            task.upload_duration_ms = upload_duration_ms
            task.failure_reason = "storage_unavailable"
            db.commit()
            try:
                await asyncio.to_thread(storage.delete, object_name)
            except Exception:
                logger.warning(
                    "dataset failed upload cleanup failed",
                    extra={"dataset_id": dataset.id, "error_code": "ASSET_DELETE_FAILED"},
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

        try:
            publisher = get_dataset_publisher(request, settings)
            await publisher.publish(DatasetParseMessage.create(parse_task_id=task.id))
        except MQPublishError:
            logger.warning(
                "dataset parse publish deferred",
                extra={"dataset_id": dataset.id, "parse_task_id": task.id},
            )
        else:
            task.last_dispatched_at = datetime.now(UTC)
            try:
                db.commit()
            except Exception:
                db.rollback()
                logger.warning(
                    "dataset dispatch timestamp update failed",
                    extra={"dataset_id": dataset.id, "parse_task_id": task.id},
                )

        db.refresh(dataset)
        db.refresh(task)
        response.status_code = 202
        return dataset_record(dataset, task)
    finally:
        await admission_context.__aexit__(None, None, None)


@router.get("", response_model=UserDatasetListResponse)
def list_datasets(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> UserDatasetListResponse:
    rows = db.execute(
        select(UserDataset, DocumentParseTask)
        .join(
            DocumentParseTask,
            DocumentParseTask.id == UserDataset.parse_task_id,
        )
        .where(
            UserDataset.user_id == user.id,
            DocumentParseTask.user_id == user.id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
            DocumentParseTask.upload_status == "succeeded",
        )
        .order_by(UserDataset.created_at.desc(), UserDataset.id.desc())
    ).all()
    return UserDatasetListResponse(
        datasets=[dataset_record(dataset, task) for dataset, task in rows],
        limits=UserDatasetLimits(
            max_file_bytes=settings.dataset_upload_max_bytes,
            max_files_per_batch=settings.dataset_max_files_per_batch,
            allowed_extensions=ALLOWED_DATASET_EXTENSIONS,
        ),
    )


@router.patch("/{dataset_id}", response_model=UserDatasetRecord)
def rename_dataset(
    dataset_id: int,
    payload: UserDatasetRenameRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserDatasetRecord:
    row = load_owned_dataset(db, dataset_id, user.id)
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    dataset, task = row
    dataset.file_name = safe_dataset_display_filename(payload.name, dataset)
    db.commit()
    db.refresh(dataset)
    db.refresh(task)
    return dataset_record(dataset, task)


def source_object_is_owned(
    dataset: UserDataset,
    task: DocumentParseTask,
    user_id: int,
) -> bool:
    return (
        dataset.object_name == task.object_name
        and task.object_name.startswith(dataset_source_prefix(user_id))
        and not task.object_name.startswith(dataset_converted_prefix(user_id))
    )


@router.post("/{dataset_id}/retry", response_model=UserDatasetRecord, status_code=202)
async def retry_dataset(
    dataset_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
) -> UserDatasetRecord:
    row = load_owned_dataset(db, dataset_id, user.id)
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    dataset, task = row
    if task.upload_status != "succeeded" or task.parse_status != "failed":
        raise ApiError(409, "DATASET_NOT_RETRYABLE")
    if not source_object_is_owned(dataset, task, user.id):
        raise ApiError(502, "DATASET_SOURCE_UNAVAILABLE")
    try:
        storage.stat(task.object_name)
    except Exception as error:
        raise ApiError(502, "DATASET_SOURCE_UNAVAILABLE") from error

    task.parse_status = "queued"
    task.parse_duration_ms = None
    task.failure_reason = None
    task.last_dispatched_at = None
    db.commit()

    try:
        publisher = get_dataset_publisher(request, settings)
        await publisher.publish(DatasetParseMessage.create(parse_task_id=task.id))
    except MQPublishError:
        logger.warning(
            "dataset retry publish deferred",
            extra={"dataset_id": dataset.id, "parse_task_id": task.id},
        )
    else:
        task.last_dispatched_at = datetime.now(UTC)
        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.warning(
                "dataset retry dispatch timestamp update failed",
                extra={"dataset_id": dataset.id, "parse_task_id": task.id},
            )

    db.refresh(dataset)
    db.refresh(task)
    return dataset_record(dataset, task)


@router.delete("/{dataset_id}", response_model=UserDatasetDeleteResponse)
def delete_dataset(
    dataset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> UserDatasetDeleteResponse:
    row = load_owned_dataset(db, dataset_id, user.id)
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    dataset, task = row
    if task.upload_status == "uploading" or task.parse_status in {"queued", "processing"}:
        raise ApiError(409, "DATASET_BUSY")
    try:
        validate_dataset_object_keys(dataset, task, user.id)
        storage.delete(dataset.object_name)
        legacy_converted_name = dataset_converted_object_name(user.id, task.id)
        if task.converted_object_name:
            storage.delete(task.converted_object_name)
        # Clean the legacy deterministic key as well. It may exist after an
        # older worker or a partial pre-0043 write.
        if task.converted_object_name != legacy_converted_name:
            storage.delete(legacy_converted_name)
    except ApiError:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        logger.warning(
            "dataset storage cleanup failed",
            extra={
                "dataset_id": dataset.id,
                "error_type": type(error).__name__,
            },
        )
        raise ApiError(502, "ASSET_DELETE_FAILED") from error

    try:
        dataset_result = db.execute(
            delete(UserDataset).where(
                UserDataset.id == dataset.id,
                UserDataset.user_id == user.id,
            )
        )
        task_result = db.execute(
            delete(DocumentParseTask).where(
                DocumentParseTask.id == task.id,
                DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                DocumentParseTask.user_id == user.id,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return UserDatasetDeleteResponse(
        deleted=dataset_result.rowcount == 1 and task_result.rowcount == 1
    )


@router.get("/{dataset_id}/content", response_model=UserDatasetContentResponse)
def get_dataset_content(
    dataset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
) -> UserDatasetContentResponse:
    row = db.execute(
        select(UserDataset, DocumentParseTask)
        .join(
            DocumentParseTask,
            DocumentParseTask.id == UserDataset.parse_task_id,
        )
        .where(
            UserDataset.id == dataset_id,
            UserDataset.user_id == user.id,
            DocumentParseTask.user_id == user.id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")

    dataset, task = row
    if task.parse_status != "succeeded" or not task.converted_object_name:
        raise ApiError(409, "DATASET_CONTENT_UNAVAILABLE")
    expected_prefix = f"users/{user.id}/datasets/converted/"
    if not task.converted_object_name.startswith(expected_prefix):
        raise ApiError(502, "DATASET_CONTENT_READ_FAILED")
    try:
        markdown = read_dataset_markdown(
            storage,
            task.converted_object_name,
            settings.resume_markdown_max_bytes,
        )
    except Exception as error:
        raise ApiError(502, "DATASET_CONTENT_READ_FAILED") from error
    return UserDatasetContentResponse(
        id=dataset.id,
        file_name=dataset.file_name,
        file_format=dataset.file_format,
        markdown=markdown,
    )
