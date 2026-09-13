import asyncio
import logging
from datetime import UTC, datetime
from io import BytesIO
from pathlib import PurePath
from time import monotonic
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
    build_dataset_object_name,
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
from linkresume.modules.identity.dependencies import get_current_user, get_settings
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkresume.services.dataset_upload_service import validate_dataset_file
from linkresume.services import dataset_content_service as content_service
from linkresume.services import dataset_replacement_service as replacement_service
from linkresume.modules.datasets.models import DatasetReplacement
from linkresume.modules.datasets.schemas import (
    DatasetReplacementRetryRequest,
)
from linkresume.services.import_admission import (
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
        or any(
            ord(character) < 32 or ord(character) == 127 for character in display_name
        )
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


def dataset_record(
    dataset: UserDataset,
    task: DocumentParseTask,
) -> UserDatasetRecord:
    db = object_session(dataset)
    operation = content_service.active_replacement(db, dataset) if db else None
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
        replacement=replacement_service.summary(db, operation, dataset) if db else None,
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
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    dataset_admission: ImportAdmissionController = Depends(get_dataset_admission),
) -> UserDatasetRecord:
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
        try:
            content = await file.read(settings.dataset_upload_max_bytes + 1)
        finally:
            await file.close()
        if (
            file_name
            and PurePath(file_name).suffix.lower()
            != PurePath(file.filename or "").suffix.lower()
        ):
            raise ApiError(422, "DATASET_FILE_EXTENSION_MISMATCH")
        validated = await asyncio.to_thread(
            validate_dataset_file,
            filename=file_name or file.filename or "",
            content=content,
            max_bytes=settings.dataset_upload_max_bytes,
        )

        content_service.lock_user(db, user.id)
        folder_exists = db.execute(
            select(UserDatasetFolder.id)
            .where(
                UserDatasetFolder.id == assigned_folder_id,
                UserDatasetFolder.user_id == user.id,
            )
            .with_for_update()
        ).scalar_one_or_none()
        if folder_exists is None:
            raise ApiError(404, "FOLDER_NOT_FOUND")

        existing = load_dataset_by_idempotency(
            db,
            user_id=user.id,
            idempotency_key=idempotency_key,
        )
        if existing is not None:
            if existing[0].folder_id != assigned_folder_id:
                raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
            return replay_dataset_upload(
                existing,
                request_fingerprint=validated.request_fingerprint,
                response=response,
            )

        replacement_service.check_name(
            db, user.id, assigned_folder_id, validated.file_name
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
            folder_id=assigned_folder_id,
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
                    extra={
                        "dataset_id": dataset.id,
                        "error_code": "ASSET_DELETE_FAILED",
                    },
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
    folder_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
) -> DatasetFolderRecord:
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
    user: User = Depends(get_current_user),
) -> DatasetFolderRecord:
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
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> DatasetFolderDeleteResponse:
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
            storage.delete(dataset.object_name)
            legacy_name = dataset_converted_object_name(user.id, task.id)
            if task.converted_object_name:
                storage.delete(task.converted_object_name)
            if task.converted_object_name != legacy_name:
                storage.delete(legacy_name)
    except Exception as error:
        db.rollback()
        raise ApiError(502, "ASSET_DELETE_FAILED") from error
    for dataset, task in rows:
        cleanup_dataset_extras(db, dataset)
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
    user: User = Depends(get_current_user),
) -> UserDatasetRecord:
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

    content_service.ensure_not_replacing(db, dataset)
    replacement_service.check_name(
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
    user: User = Depends(get_current_user),
) -> DatasetBatchMoveResponse:
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
        content_service.ensure_not_replacing(db, dataset)
        replacement_service.check_name(
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
    user: User = Depends(get_current_user),
) -> UserDatasetRecord:
    row = load_owned_dataset(db, dataset_id, user.id)
    if row is None:
        raise ApiError(404, "DATASET_NOT_FOUND")
    dataset, task = row
    content_service.ensure_not_replacing(db, dataset)
    name = safe_dataset_display_filename(payload.name, dataset)
    replacement_service.check_name(db, user.id, dataset.folder_id, name, dataset.id)
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
    content_service.ensure_not_busy(db, dataset, task)
    if task.upload_status == "uploading" or task.parse_status in {
        "queued",
        "processing",
    }:
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
        cleanup_dataset_extras(db, dataset)
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


@router.get("/{dataset_id}/content", response_model=UserDatasetContentResponse)
def get_dataset_content(
    dataset_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
):
    dataset, task = content_service.owned(db, user.id, dataset_id)
    record = dataset_record(dataset, task)
    folder = db.get(UserDatasetFolder, dataset.folder_id) if dataset.folder_id else None
    record.folder_name = folder.name if folder else None
    response.headers["ETag"] = content_service.etag(dataset)
    return record




@router.post("/{dataset_id}/replacements", status_code=202)
async def create_replacement(
    dataset_id: int,
    file: UploadFile,
    confirm_replace: bool = Form(...),
    if_match: str | None = Header(default=None),
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    dataset_admission: ImportAdmissionController = Depends(get_dataset_admission),
):
    try:
        admission_context = dataset_admission.acquire(user.id)
        await admission_context.__aenter__()
    except ImportAdmissionRejected as error:
        await file.close()
        raise ApiError(
            429, "DATASET_UPLOAD_RATE_LIMITED", headers={"Retry-After": "60"}
        ) from error
    try:
        from hashlib import sha256
        from unicodedata import normalize

        key = canonical_dataset_idempotency_key(idempotency_key)
        if not confirm_replace:
            raise ApiError(422, "REPLACEMENT_CONFIRMATION_REQUIRED")
        try:
            data = await file.read(settings.dataset_upload_max_bytes + 1)
            validated = await asyncio.to_thread(
                validate_dataset_file,
                filename=file.filename or "",
                content=data,
                max_bytes=settings.dataset_upload_max_bytes,
            )
        finally:
            await file.close()
        dataset, task = content_service.owned(db, user.id, dataset_id, lock=True)
        fingerprint = sha256(
            f"{dataset_id}|{if_match}|{validated.request_fingerprint}".encode()
        ).hexdigest()
        operation = db.scalar(
            select(DatasetReplacement)
            .where(
                DatasetReplacement.user_id == user.id,
                DatasetReplacement.idempotency_key == key,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if operation:
            if (
                operation.dataset_id != dataset_id
                or operation.request_fingerprint != fingerprint
            ):
                raise ApiError(409, "IDEMPOTENCY_KEY_REUSED")
            return replacement_service.summary(db, operation, dataset)
        content_service.check_match(dataset, if_match)
        content_service.ensure_not_busy(db, dataset, task)
        if content_service.active_replacement(db, dataset, lock=True):
            raise ApiError(409, "DATASET_REPLACEMENT_EXISTS")
        if normalize("NFC", dataset.file_name) != normalize("NFC", validated.file_name):
            raise ApiError(409, "DATASET_REPLACEMENT_NAME_MISMATCH")
        if not dataset.folder_id:
            raise ApiError(400, "DATASET_FOLDER_REQUIRED")
        ensure_dataset_capacity(
            db,
            user_id=user.id,
            incoming_bytes=validated.file_size,
            max_count=settings.dataset_max_count_per_user + 1,
            max_total_bytes=settings.dataset_max_total_bytes_per_user,
        )
        candidate = DocumentParseTask(
            source_type=DATASET_SOURCE_TYPE,
            user_id=user.id,
            file_name=validated.file_name,
            file_format=validated.file_format,
            object_name=build_dataset_object_name(user.id, validated.file_name),
            upload_status="uploading",
            parse_status=None,
        )
        db.add(candidate)
        db.flush()
        operation = DatasetReplacement(
            user_id=user.id,
            dataset_id=dataset.id,
            parse_task_id=candidate.id,
            source_content_type=validated.content_type,
            source_file_size=validated.file_size,
            source_sha256=validated.sha256,
            idempotency_key=key,
            request_fingerprint=fingerprint,
            base_revision=dataset.content_revision,
            status="pending",
            active_dataset_id=dataset.id,
        )
        db.add(operation)
        db.commit()
        upload_started = monotonic()
        try:
            await asyncio.to_thread(
                storage.upload,
                candidate.object_name,
                validated.content,
                validated.content_type,
            )
        except Exception:
            candidate.upload_status = "failed"
            candidate.upload_duration_ms = min(
                2**32 - 1, max(0, round((monotonic() - upload_started) * 1000))
            )
            operation.status = "failed"
            operation.failure_code = "DATASET_UPLOAD_FAILED"
            db.commit()
            return replacement_service.summary(db, operation, dataset)
        candidate.upload_status = "succeeded"
        candidate.upload_duration_ms = min(
            2**32 - 1, max(0, round((monotonic() - upload_started) * 1000))
        )
        candidate.parse_status = "queued"
        db.commit()
        # Existing worker recovery scan reliably dispatches queued tasks.
        return replacement_service.summary(db, operation, dataset)
    finally:
        await admission_context.__aexit__(None, None, None)


def owned_replacement(db, user_id, dataset_id, replacement_id):
    dataset, task = content_service.owned(db, user_id, dataset_id, lock=True)
    op = db.scalar(
        select(DatasetReplacement)
        .where(
            DatasetReplacement.id == replacement_id,
            DatasetReplacement.dataset_id == dataset_id,
            DatasetReplacement.user_id == user_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if op is None:
        raise ApiError(404, "DATASET_REPLACEMENT_NOT_FOUND")
    return dataset, task, op


@router.get("/{dataset_id}/replacements/{replacement_id}")
def get_replacement(
    dataset_id: int,
    replacement_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    dataset, _, op = owned_replacement(db, user.id, dataset_id, replacement_id)
    return replacement_service.summary(db, op, dataset)


@router.post("/{dataset_id}/replacements/{replacement_id}/retry", status_code=202)
def retry_replacement(
    dataset_id: int,
    replacement_id: int,
    payload: DatasetReplacementRetryRequest,
    response: Response,
    if_match: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    dataset, _, op = owned_replacement(db, user.id, dataset_id, replacement_id)
    if not payload.confirm_replace:
        raise ApiError(422, "REPLACEMENT_CONFIRMATION_REQUIRED")
    if op.last_retry_request_id == payload.request_id:
        return replacement_service.summary(db, op, dataset)
    content_service.check_match(dataset, if_match)
    if op.status not in ("failed", "conflict"):
        raise ApiError(409, "DATASET_NOT_RETRYABLE")
    candidate = db.get(DocumentParseTask, op.parse_task_id)
    if (
        not candidate
        or candidate.user_id != user.id
        or candidate.source_type != DATASET_SOURCE_TYPE
        or candidate.upload_status != "succeeded"
    ):
        raise ApiError(409, "DATASET_NOT_RETRYABLE")
    if not candidate.object_name.startswith(f"users/{user.id}/datasets/"):
        raise ApiError(502, "DATASET_SOURCE_UNAVAILABLE")
    try:
        storage.stat(candidate.object_name)
    except Exception as error:
        raise ApiError(502, "DATASET_SOURCE_UNAVAILABLE") from error
    op.base_revision = dataset.content_revision
    op.last_retry_request_id = payload.request_id
    op.status = "pending"
    op.failure_code = None
    if candidate.parse_status == "succeeded":
        if (
            not candidate.converted_object_name
            or not candidate.converted_object_name.startswith(
                f"users/{user.id}/datasets/converted/"
            )
        ):
            raise ApiError(502, "DATASET_CONTENT_READ_FAILED")
        markdown = content_service.read_markdown(
            storage, candidate.converted_object_name, settings.resume_markdown_max_bytes
        )
        replacement_service.apply_replacement(db, op, dataset, candidate, markdown)
        response.status_code = 200
    else:
        candidate.parse_status = "queued"
        candidate.parse_duration_ms = None
        candidate.failure_reason = None
        candidate.last_dispatched_at = None
        candidate.updated_at = datetime.now(UTC)
    db.commit()
    return replacement_service.summary(db, op, dataset)


@router.delete("/{dataset_id}/replacements/{replacement_id}")
def discard_replacement(
    dataset_id: int,
    replacement_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    dataset, _, op = owned_replacement(db, user.id, dataset_id, replacement_id)
    if op.status == "pending":
        raise ApiError(409, "DATASET_BUSY")
    if op.status == "applied":
        raise ApiError(409, "DATASET_NOT_RETRYABLE")
    candidate = (
        db.get(DocumentParseTask, op.parse_task_id) if op.parse_task_id else None
    )
    if candidate:
        replacement_service.retire_task(db, candidate)
    op.status = "discarded"
    op.active_dataset_id = None
    db.commit()
    return {"discarded": True}


def cleanup_dataset_extras(db, dataset):
    content_service.enqueue_cleanup(db, dataset.user_id, dataset.content_object_name)
    for op in list(
        db.scalars(
            select(DatasetReplacement).where(
                DatasetReplacement.dataset_id == dataset.id
            )
        )
    ):
        if op.status == "pending":
            raise ApiError(409, "DATASET_BUSY")
        if op.parse_task_id and op.parse_task_id != dataset.parse_task_id:
            task = db.get(DocumentParseTask, op.parse_task_id)
            if task:
                replacement_service.retire_task(db, task)
        db.delete(op)
    db.flush()
