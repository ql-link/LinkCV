import hashlib
import logging
from pathlib import PurePath
from time import monotonic

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy import delete, select, update
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
    UserDatasetListResponse,
    UserDatasetRenameRequest,
    UserDatasetRecord,
)
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask

router = APIRouter(prefix="/datasets", tags=["datasets"])
logger = logging.getLogger(__name__)

SUPPORTED_DATASET_FORMATS = {"docx", "pdf", "md", "txt"}


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


def safe_dataset_filename(filename: str) -> str:
    safe_filename = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    if (
        not safe_filename
        or len(safe_filename) > 255
        or any(ord(character) < 32 for character in safe_filename)
    ):
        raise ApiError(400, "INVALID_DATASET_FILENAME")
    return safe_filename


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
    if task.converted_object_name and task.converted_object_name != (
        dataset_converted_object_name(user_id, task.id)
    ):
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


def mark_dataset_parse_failed(
    db: Session,
    task_id: int,
    *,
    failure_reason: str,
) -> None:
    db.execute(
        update(DocumentParseTask)
        .where(
            DocumentParseTask.id == task_id,
            DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
            DocumentParseTask.parse_status == "processing",
        )
        .values(
            parse_status="failed",
            parse_duration_ms=0,
            failure_reason=failure_reason,
        )
    )
    db.commit()


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


@router.post("", response_model=UserDatasetRecord, status_code=201)
async def upload_dataset(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
) -> UserDatasetRecord:
    filename = safe_dataset_filename(file.filename or "")
    extension = PurePath(filename).suffix.lower().lstrip(".")
    if extension not in SUPPORTED_DATASET_FORMATS:
        raise ApiError(400, "UNSUPPORTED_DATASET_FORMAT")

    content_type = (file.content_type or "application/octet-stream").lower()
    content = await file.read(settings.dataset_upload_max_bytes + 1)
    await file.close()
    if not content:
        raise ApiError(400, "EMPTY_DATASET_FILE")
    if len(content) > settings.dataset_upload_max_bytes:
        raise ApiError(413, "DATASET_TOO_LARGE")

    object_name = build_dataset_object_name(user.id, filename)
    upload_started = monotonic()
    try:
        storage.upload(object_name, content, content_type)
    except Exception as error:
        raise ApiError(502, "DATASET_UPLOAD_FAILED") from error
    upload_duration_ms = min(
        max(0, round((monotonic() - upload_started) * 1000)),
        2**32 - 1,
    )

    task = DocumentParseTask(
        source_type=DATASET_SOURCE_TYPE,
        user_id=user.id,
        file_name=filename,
        file_format=extension,
        object_name=object_name,
        upload_status="succeeded",
        upload_duration_ms=upload_duration_ms,
        parse_status="processing",
    )
    dataset = UserDataset(
        user_id=user.id,
        file_name=filename,
        file_format=extension,
        content_type=content_type,
        file_size=len(content),
        object_name=object_name,
        sha256=hashlib.sha256(content).hexdigest(),
    )
    db.add(task)
    try:
        db.flush()
        dataset.parse_task_id = task.id
        db.add(dataset)
        db.commit()
    except Exception as error:
        db.rollback()
        try:
            storage.delete(object_name)
        except Exception:
            pass
        raise ApiError(500, "DATASET_RECORD_FAILED") from error
    db.refresh(dataset)
    db.refresh(task)

    try:
        publisher = get_dataset_publisher(request, settings)
        await publisher.publish(DatasetParseMessage.create(parse_task_id=task.id))
    except MQPublishError as error:
        mark_dataset_parse_failed(
            db,
            task.id,
            failure_reason="service_unavailable",
        )
        raise ApiError(502, "DATASET_QUEUE_UNAVAILABLE") from error
    return dataset_record(dataset, task)


@router.get("", response_model=UserDatasetListResponse)
def list_datasets(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
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
        )
        .order_by(UserDataset.created_at.desc(), UserDataset.id.desc())
    ).all()
    return UserDatasetListResponse(
        datasets=[dataset_record(dataset, task) for dataset, task in rows]
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


@router.post("/{dataset_id}/retry", response_model=UserDatasetRecord)
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

    task.parse_status = "processing"
    task.parse_duration_ms = None
    task.failure_reason = None
    db.commit()

    try:
        publisher = get_dataset_publisher(request, settings)
        await publisher.publish(DatasetParseMessage.create(parse_task_id=task.id))
    except MQPublishError as error:
        mark_dataset_parse_failed(
            db,
            task.id,
            failure_reason="service_unavailable",
        )
        raise ApiError(503, "DATASET_QUEUE_UNAVAILABLE") from error

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
    if task.upload_status == "uploading" or task.parse_status == "processing":
        raise ApiError(409, "DATASET_IN_PROGRESS")
    try:
        validate_dataset_object_keys(dataset, task, user.id)
        storage.delete(dataset.object_name)
        # The converted key is deterministic. Clean it even when a previous upload
        # failed before the task could persist converted_object_name.
        storage.delete(dataset_converted_object_name(user.id, task.id))
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
