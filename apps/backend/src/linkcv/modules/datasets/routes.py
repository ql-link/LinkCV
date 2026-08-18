import hashlib
from pathlib import PurePath
from time import monotonic

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy import select, update
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
    UserDatasetListResponse,
    UserDatasetRecord,
)
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask

router = APIRouter(prefix="/datasets", tags=["datasets"])

SUPPORTED_DATASET_FORMATS = {"docx", "pdf", "md", "txt"}


def safe_dataset_filename(filename: str) -> str:
    safe_filename = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    if (
        not safe_filename
        or len(safe_filename) > 255
        or any(ord(character) < 32 for character in safe_filename)
    ):
        raise ApiError(400, "INVALID_DATASET_FILENAME")
    return safe_filename


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
        upload_status="uploading",
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

    publisher = request.app.state.mq_publisher
    if publisher is None:
        try:
            publisher = build_mq_publisher(settings)
        except ValueError as error:
            publisher = None
            publish_error = error
        else:
            request.app.state.mq_publisher = publisher
            publish_error = None
    else:
        publish_error = None
    try:
        if publisher is None:
            raise MQPublishError("dataset queue unavailable") from publish_error
        await publisher.publish(DatasetParseMessage.create(parse_task_id=task.id))
    except MQPublishError as error:
        db.execute(
            update(DocumentParseTask)
            .where(
                DocumentParseTask.id == task.id,
                DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                DocumentParseTask.upload_status == "uploading",
                DocumentParseTask.parse_status.is_(None),
            )
            .values(
                upload_status="failed",
                upload_duration_ms=upload_duration_ms,
                parse_status=None,
                parse_duration_ms=None,
                failure_reason=None,
            )
        )
        db.commit()
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
