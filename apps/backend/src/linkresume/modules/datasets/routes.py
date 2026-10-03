from linkresume.modules.identity.dependencies import lock_active_user
import asyncio
import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import PurePath
from urllib.parse import quote
import unicodedata
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session

from linkresume.core.config import Settings
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.mq import DatasetParseMessage, MQPublishError
from linkresume.core.mq.factory import build_mq_publisher
from linkresume.core.storage import (
    AssetStorage,
    get_storage,
)
from linkresume.modules.datasets.models import UserDataset, UserDatasetFolder
from linkresume.modules.datasets.schemas import (
    DatasetBatchMoveRequest,
    DatasetBatchMoveResponse,
    DatasetFolderCreateRequest,
    DatasetFolderDeleteResponse,
    DatasetFolderListResponse,
    DatasetFolderRecord,
    DatasetFolderRenameRequest,
    DatasetMoveRequest,
    UserDatasetContentResponse,
    UserDatasetDeleteResponse,
    UserDatasetLimits,
    UserDatasetListResponse,
    UserDatasetRenameRequest,
    UserDatasetRecord,
)
from linkresume.modules.identity.dependencies import get_current_dataset_user, get_settings
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import InterviewSession, JobApplication
from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkresume.services import dataset_ingest_service as ingest
from linkresume.services import dataset_content_service as content_service
from linkresume.services.dataset_content_service import (
    dataset_source_prefix,
    dataset_converted_prefix,
    validate_dataset_object_keys,
)
from linkresume.services import dataset_name_service as name_service
from linkresume.services.import_admission import (
    ImportAdmissionController,
    ImportAdmissionRejected,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])
logger = logging.getLogger(__name__)

ALLOWED_DATASET_EXTENSIONS = [".pdf", ".docx", ".md", ".txt"]
ALLOWED_MEDIA_EXTENSIONS = [".webm", ".m4a", ".mp3", ".wav", ".ogg", ".mp4", ".mov"]


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
        or any(
            ord(character) < 32 or ord(character) == 127 for character in display_name
        )
        or len(f"{display_name}{extension}") > 255
    ):
        raise ApiError(400, "INVALID_DATASET_NAME")
    return f"{display_name}{extension}"


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


def load_owned_dataset(
    db: Session,
    dataset_id: int,
    user_id: int,
):
    content_service.lock_user(db, user_id)
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


def interview_label_for(db: Session, session_id: int) -> str | None:
    row = db.execute(
        select(
            JobApplication.company_name_snapshot,
            InterviewSession.stage_label,
        )
        .join(
            JobApplication,
            JobApplication.id == InterviewSession.application_id,
        )
        .where(InterviewSession.id == session_id)
    ).one_or_none()
    if row is None:
        return None
    return f"{row[0]}·{row[1]}"


def dataset_record(
    dataset: UserDataset,
    task: DocumentParseTask,
) -> UserDatasetRecord:
    db = object_session(dataset)
    label = None
    if db is not None and dataset.interview_session_id is not None:
        label = interview_label_for(db, dataset.interview_session_id)
    return UserDatasetRecord(
        id=str(dataset.id),
        folder_id=str(dataset.folder_id) if dataset.folder_id is not None else None,
        file_name=dataset.file_name,
        file_format=dataset.file_format,
        file_size=dataset.file_size,
        upload_status=task.upload_status,
        parse_status=task.parse_status,
        failure_reason=task.failure_reason,
        created_at=dataset.created_at,
        content_revision=str(dataset.content_revision or 0),
        content_updated_at=dataset.content_updated_at,
        asset_kind=dataset.asset_kind,
        interview_session_id=dataset.interview_session_id,
        interview_source_type=dataset.interview_source_type,
        duration_ms=dataset.duration_ms,
        interview_label=label,
    )


@router.post("", response_model=UserDatasetRecord, status_code=202)
async def upload_dataset(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    file_name: str | None = Form(default=None),
    folder_id: str | None = Form(default=None),
    idempotency_key_header: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    dataset_admission: ImportAdmissionController = Depends(get_dataset_admission),
) -> UserDatasetRecord:
    user = lock_active_user(db, user.id)
    idempotency_key = canonical_dataset_idempotency_key(idempotency_key_header)
    if folder_id is None or not folder_id.strip():
        raise ApiError(400, "DATASET_FOLDER_REQUIRED")
    try:
        assigned_folder_id = int(folder_id.strip())
    except ValueError as error:
        raise ApiError(404, "FOLDER_NOT_FOUND") from error
    if assigned_folder_id <= 0 or assigned_folder_id > 18446744073709551615:
        raise ApiError(404, "FOLDER_NOT_FOUND")
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
        result = await ingest.ingest_dataset_upload(
            db,
            user=user,
            settings=settings,
            storage=storage,
            upload=file,
            file_name_override=file_name,
            folder_id=assigned_folder_id,
            idempotency_key=idempotency_key,
        )
        dataset, task = result.dataset, result.task
        if not result.replayed and task.parse_status == "queued":
            try:
                publisher = get_dataset_publisher(request, settings)
                await publisher.publish(
                    DatasetParseMessage.create(parse_task_id=task.id)
                )
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

        response.status_code = (
            200
            if task.upload_status == "succeeded" and task.parse_status == "succeeded"
            else 202
        )
        return dataset_record(dataset, task)
    finally:
        await admission_context.__aexit__(None, None, None)


@router.get("", response_model=UserDatasetListResponse)
def list_datasets(
    folder_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
    settings: Settings = Depends(get_settings),
) -> UserDatasetListResponse:
    query = (
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
    )
    if folder_id is not None:
        trimmed = folder_id.strip().lower()
        if trimmed in ("uncategorized", "null", "none", ""):
            query = query.where(UserDataset.folder_id.is_(None))
        else:
            try:
                fid = int(folder_id.strip())
                query = query.where(UserDataset.folder_id == fid)
            except ValueError:
                raise ApiError(400, "INVALID_FOLDER_ID")
    rows = db.execute(
        query.order_by(UserDataset.created_at.desc(), UserDataset.id.desc())
    ).all()
    return UserDatasetListResponse(
        datasets=[dataset_record(dataset, task) for dataset, task in rows],
        limits=UserDatasetLimits(
            max_file_bytes=settings.dataset_upload_max_bytes,
            max_files_per_batch=settings.dataset_max_files_per_batch,
            allowed_extensions=ALLOWED_DATASET_EXTENSIONS,
            max_media_file_bytes=settings.interview_asset_upload_max_bytes,
            media_allowed_extensions=ALLOWED_MEDIA_EXTENSIONS,
            media_max_count=settings.media_max_count_per_user,
            media_max_total_bytes=settings.media_max_total_bytes_per_user,
        ),
    )


MAX_USER_DATASET_FOLDERS = 50


def validate_folder_name(name: str) -> str:
    cleaned = name.strip()
    if (
        not cleaned
        or "/" in cleaned
        or "\\" in cleaned
        or any(ord(character) < 32 or ord(character) == 127 for character in cleaned)
        or len(cleaned) > 64
    ):
        raise ApiError(400, "INVALID_FOLDER_NAME")
    return cleaned


@router.get("/folders", response_model=DatasetFolderListResponse)
def list_folders(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
) -> DatasetFolderListResponse:
    folders = (
        db.execute(
            select(UserDatasetFolder)
            .where(UserDatasetFolder.user_id == user.id)
            .order_by(UserDatasetFolder.created_at.asc(), UserDatasetFolder.id.asc())
        )
        .scalars()
        .all()
    )

    counts_query = db.execute(
        select(UserDataset.folder_id, func.count(UserDataset.id))
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
        .group_by(UserDataset.folder_id)
    ).all()

    counts_map = {row[0]: row[1] for row in counts_query}
    total_count = sum(counts_map.values())
    uncategorized_count = counts_map.get(None, 0)

    folder_records = [
        DatasetFolderRecord(
            id=str(f.id),
            name=f.name,
            dataset_count=counts_map.get(f.id, 0),
            created_at=f.created_at,
            updated_at=f.updated_at,
        )
        for f in folders
    ]
    return DatasetFolderListResponse(
        folders=folder_records,
        total_count=total_count,
        uncategorized_count=uncategorized_count,
    )


@router.post("/folders", response_model=DatasetFolderRecord, status_code=201)
def create_folder(
    payload: DatasetFolderCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
) -> DatasetFolderRecord:
    user = lock_active_user(db, user.id)
    cleaned_name = validate_folder_name(payload.name)
    current_count = (
        db.execute(
            select(func.count(UserDatasetFolder.id)).where(
                UserDatasetFolder.user_id == user.id
            )
        ).scalar()
        or 0
    )
    if current_count >= MAX_USER_DATASET_FOLDERS:
        raise ApiError(429, "FOLDER_LIMIT_EXCEEDED")

    existing = db.execute(
        select(UserDatasetFolder).where(
            UserDatasetFolder.user_id == user.id,
            UserDatasetFolder.name == cleaned_name,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ApiError(409, "FOLDER_NAME_DUPLICATE")

    folder = UserDatasetFolder(
        user_id=user.id,
        name=cleaned_name,
    )
    db.add(folder)
    try:
        db.commit()
        db.refresh(folder)
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "FOLDER_NAME_DUPLICATE")

    return DatasetFolderRecord(
        id=str(folder.id),
        name=folder.name,
        dataset_count=0,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


@router.patch("/folders/{folder_id}", response_model=DatasetFolderRecord)
def rename_folder(
    folder_id: int,
    payload: DatasetFolderRenameRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
) -> DatasetFolderRecord:
    user = lock_active_user(db, user.id)
    cleaned_name = validate_folder_name(payload.name)
    content_service.lock_user(db, user.id)
    folder = db.execute(
        select(UserDatasetFolder).where(
            UserDatasetFolder.id == folder_id,
            UserDatasetFolder.user_id == user.id,
        )
    ).scalar_one_or_none()
    if folder is None:
        raise ApiError(404, "FOLDER_NOT_FOUND")

    if folder.name != cleaned_name:
        existing = db.execute(
            select(UserDatasetFolder).where(
                UserDatasetFolder.user_id == user.id,
                UserDatasetFolder.name == cleaned_name,
                UserDatasetFolder.id != folder_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ApiError(409, "FOLDER_NAME_DUPLICATE")
        folder.name = cleaned_name
        try:
            db.commit()
            db.refresh(folder)
        except IntegrityError:
            db.rollback()
            raise ApiError(409, "FOLDER_NAME_DUPLICATE")

    count = (
        db.execute(
            select(func.count(UserDataset.id))
            .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
            .where(
                UserDataset.user_id == user.id,
                UserDataset.folder_id == folder.id,
                DocumentParseTask.upload_status == "succeeded",
            )
        ).scalar()
        or 0
    )

    return DatasetFolderRecord(
        id=str(folder.id),
        name=folder.name,
        dataset_count=count,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


@router.delete("/folders/{folder_id}", response_model=DatasetFolderDeleteResponse)
def delete_folder(
    folder_id: int,
    confirm_contents: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
    storage: AssetStorage = Depends(get_storage),
) -> DatasetFolderDeleteResponse:
    user = lock_active_user(db, user.id)
    content_service.lock_user(db, user.id)
    folder = db.execute(
        select(UserDatasetFolder)
        .where(
            UserDatasetFolder.id == folder_id,
            UserDatasetFolder.user_id == user.id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if folder is None:
        raise ApiError(404, "FOLDER_NOT_FOUND")
    datasets = db.scalars(
        select(UserDataset)
        .where(
            UserDataset.user_id == user.id,
            UserDataset.folder_id == folder.id,
        )
        .with_for_update()
    ).all()
    if datasets and not confirm_contents:
        raise ApiError(409, "FOLDER_DELETE_CONFIRMATION_REQUIRED")
    rows = []
    for dataset in datasets:
        row = load_owned_dataset(db, dataset.id, user.id)
        if row is None:
            raise ApiError(409, "DATASET_CONTENT_UNAVAILABLE")
        _, task = row
        content_service.ensure_not_busy(db, dataset, task)
        if task.upload_status == "uploading" or task.parse_status in {
            "queued",
            "processing",
        }:
            raise ApiError(409, "DATASET_BUSY")
        validate_dataset_object_keys(dataset, task, user.id)
        rows.append((dataset, task))
    try:
        for dataset, task in rows:
            content_service.delete_files(storage, dataset, task)
    except Exception as error:
        db.rollback()
        raise ApiError(502, "ASSET_DELETE_FAILED") from error
    for dataset, task in rows:
        db.delete(dataset)
        db.delete(task)
    db.delete(folder)
    db.commit()
    return DatasetFolderDeleteResponse(deleted=True, affected_dataset_count=len(rows))


@router.patch("/{dataset_id}/folder", response_model=UserDatasetRecord)
def move_dataset(
    dataset_id: int,
    payload: DatasetMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
) -> UserDatasetRecord:
    user = lock_active_user(db, user.id)
    row = load_owned_dataset(db, dataset_id, user.id)
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    dataset, task = row

    try:
        fid = int(payload.folder_id)
    except (ValueError, TypeError):
        raise ApiError(400, "INVALID_FOLDER_ID")
    if fid <= 0 or fid > 18446744073709551615:
        raise ApiError(400, "INVALID_FOLDER_ID")
    content_service.lock_user(db, user.id)
    target_folder = db.execute(
        select(UserDatasetFolder)
        .where(
            UserDatasetFolder.id == fid,
            UserDatasetFolder.user_id == user.id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if target_folder is None:
        raise ApiError(404, "FOLDER_NOT_FOUND")
    target_folder_id = target_folder.id

    name_service.check_name(
        db, user.id, target_folder_id, dataset.file_name, dataset.id
    )
    dataset.content_revision += 1
    dataset.folder_id = target_folder_id
    db.commit()
    db.refresh(dataset)
    db.refresh(task)
    return dataset_record(dataset, task)


@router.post("/move-batch", response_model=DatasetBatchMoveResponse)
def move_datasets_batch(
    payload: DatasetBatchMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
) -> DatasetBatchMoveResponse:
    user = lock_active_user(db, user.id)
    if not payload.dataset_ids:
        raise ApiError(400, "DATASET_IDS_EMPTY")

    try:
        fid = int(payload.folder_id)
    except (ValueError, TypeError):
        raise ApiError(400, "INVALID_FOLDER_ID")
    if fid <= 0 or fid > 18446744073709551615:
        raise ApiError(400, "INVALID_FOLDER_ID")
    content_service.lock_user(db, user.id)
    target_folder = db.execute(
        select(UserDatasetFolder)
        .where(
            UserDatasetFolder.id == fid,
            UserDatasetFolder.user_id == user.id,
        )
        .with_for_update()
    ).scalar_one_or_none()
    if target_folder is None:
        raise ApiError(404, "FOLDER_NOT_FOUND")
    target_folder_id = target_folder.id

    parsed_ids: list[int] = []
    for sid in payload.dataset_ids:
        try:
            parsed_ids.append(int(sid))
        except (ValueError, TypeError):
            continue

    if not parsed_ids:
        raise ApiError(400, "DATASET_IDS_EMPTY")

    datasets = list(
        db.scalars(
            select(UserDataset).where(
                UserDataset.user_id == user.id, UserDataset.id.in_(parsed_ids)
            )
        )
    )
    for dataset in datasets:
        _, task = content_service.owned(db, user.id, dataset.id)
        name_service.check_name(
            db, user.id, target_folder_id, dataset.file_name, dataset.id
        )
        for other in datasets:
            if other.id != dataset.id and unicodedata.normalize(
                "NFC", other.file_name
            ) == unicodedata.normalize("NFC", dataset.file_name):
                raise ApiError(409, "DATASET_NAME_CONFLICT")
    for dataset in datasets:
        dataset.folder_id = target_folder_id
        dataset.content_revision += 1
    db.commit()
    return DatasetBatchMoveResponse(moved_count=len(datasets))


@router.patch("/{dataset_id}", response_model=UserDatasetRecord)
def rename_dataset(
    dataset_id: int,
    payload: UserDatasetRenameRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
) -> UserDatasetRecord:
    user = lock_active_user(db, user.id)
    row = load_owned_dataset(db, dataset_id, user.id)
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    dataset, task = row
    name = safe_dataset_display_filename(payload.name, dataset)
    name_service.check_name(db, user.id, dataset.folder_id, name, dataset.id)
    dataset.file_name = name
    dataset.content_revision += 1
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
    user: User = Depends(get_current_dataset_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
) -> UserDatasetRecord:
    user = lock_active_user(db, user.id)
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
    user: User = Depends(get_current_dataset_user),
    storage: AssetStorage = Depends(get_storage),
) -> UserDatasetDeleteResponse:
    user = lock_active_user(db, user.id)
    row = load_owned_dataset(db, dataset_id, user.id)
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    dataset, task = row
    content_service.ensure_not_busy(db, dataset, task)
    if task.upload_status == "uploading" or task.parse_status in {
        "queued",
        "processing",
    }:
        raise ApiError(409, "DATASET_BUSY")
    try:
        content_service.delete_files(storage, dataset, task)
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
        db.flush()
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


def _stream_object(response) -> Iterator[bytes]:
    try:
        for chunk in response.stream(64 * 1024):
            yield chunk
    finally:
        response.close()
        response.release_conn()


@router.get("/{dataset_id}/source", response_model=None)
def get_dataset_source(
    dataset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
    storage: AssetStorage = Depends(get_storage),
) -> StreamingResponse:
    dataset, task = content_service.owned(db, user.id, dataset_id)
    if task.upload_status != "succeeded":
        raise ApiError(409, "DATASET_CONTENT_UNAVAILABLE")
    if not source_object_is_owned(dataset, task, user.id):
        raise ApiError(502, "DATASET_SOURCE_UNAVAILABLE")
    try:
        response_object = storage.get(dataset.object_name)
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "DATASET_NOT_FOUND") from error
        raise ApiError(502, "DATASET_SOURCE_UNAVAILABLE") from error
    except Exception as error:
        raise ApiError(502, "DATASET_SOURCE_UNAVAILABLE") from error
    encoded = quote(dataset.file_name)
    disposition = (
        "inline" if dataset.asset_kind in {"audio", "video"} else "attachment"
    )
    return StreamingResponse(
        _stream_object(response_object),
        media_type=dataset.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded}",
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{dataset_id}/content", response_model=UserDatasetContentResponse)
def get_dataset_content(
    dataset_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
):
    dataset, task = content_service.owned(db, user.id, dataset_id)
    key = content_service.content_key(dataset, task)
    try:
        markdown = content_service.read_markdown(
            storage, key, settings.resume_markdown_max_bytes
        )
    except Exception as error:
        raise ApiError(502, "DATASET_CONTENT_READ_FAILED") from error
    response.headers["ETag"] = content_service.etag(dataset)
    return UserDatasetContentResponse(
        id=str(dataset.id),
        file_name=dataset.file_name,
        file_format=dataset.file_format,
        markdown=markdown,
        content_revision=str(dataset.content_revision),
        content_updated_at=dataset.content_updated_at,
    )


@router.get("/{dataset_id}", response_model=UserDatasetRecord)
def get_dataset(
    dataset_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
):
    dataset, task = content_service.owned(db, user.id, dataset_id)
    record = dataset_record(dataset, task)
    folder = db.get(UserDatasetFolder, dataset.folder_id) if dataset.folder_id else None
    record.folder_name = folder.name if folder else None
    response.headers["ETag"] = content_service.etag(dataset)
    return record




@router.put("/{dataset_id}/file", response_model=UserDatasetRecord, status_code=202)
async def replace_dataset_file(
    dataset_id: int,
    request: Request,
    response: Response,
    file: UploadFile,
    confirm_replace: bool = Form(...),
    if_match: str | None = Header(default=None),
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_dataset_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    dataset_admission: ImportAdmissionController = Depends(get_dataset_admission),
):
    user = lock_active_user(db, user.id)
    key = canonical_dataset_idempotency_key(idempotency_key)
    if not confirm_replace:
        raise ApiError(422, "REPLACEMENT_CONFIRMATION_REQUIRED")
    try:
        async with dataset_admission.acquire(user.id):
            result = await ingest.ingest_document_upload(
                db,
                user=user,
                settings=settings,
                storage=storage,
                upload=file,
                file_name_override=None,
                folder_id=None,
                interview_session_id=None,
                interview_source_type=None,
                duration_ms=None,
                idempotency_key=key,
                replace_id=dataset_id,
                if_match=if_match,
            )
            dataset, task = result.dataset, result.task
            if not result.replayed and task.parse_status == "queued":
                try:
                    await get_dataset_publisher(request, settings).publish(
                        DatasetParseMessage.create(parse_task_id=task.id)
                    )
                except MQPublishError:
                    logger.warning(
                        "dataset parse publish deferred",
                        extra={"parse_task_id": task.id},
                    )
            response.status_code = 200 if task.parse_status == "succeeded" else 202
            return dataset_record(dataset, task)
    except ImportAdmissionRejected as error:
        raise ApiError(
            429, "DATASET_UPLOAD_RATE_LIMITED", headers={"Retry-After": "60"}
        ) from error
    finally:
        await file.close()
