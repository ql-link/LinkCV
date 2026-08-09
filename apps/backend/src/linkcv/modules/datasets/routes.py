import hashlib
from pathlib import PurePath

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
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


def dataset_record(dataset: UserDataset) -> UserDatasetRecord:
    return UserDatasetRecord(
        id=str(dataset.id),
        file_name=dataset.file_name,
        file_format=dataset.file_format,
        file_size=dataset.file_size,
        sha256=dataset.sha256,
        created_at=dataset.created_at,
    )


@router.post("", response_model=UserDatasetRecord, status_code=201)
async def upload_dataset(
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
    try:
        storage.upload(object_name, content, content_type)
    except Exception as error:
        raise ApiError(502, "DATASET_UPLOAD_FAILED") from error

    dataset = UserDataset(
        user_id=user.id,
        file_name=filename,
        file_format=extension,
        content_type=content_type,
        file_size=len(content),
        object_name=object_name,
        sha256=hashlib.sha256(content).hexdigest(),
    )
    db.add(dataset)
    try:
        db.commit()
    except Exception as error:
        db.rollback()
        try:
            storage.delete(object_name)
        except Exception:
            pass
        raise ApiError(500, "DATASET_RECORD_FAILED") from error
    db.refresh(dataset)
    return dataset_record(dataset)


@router.get("", response_model=UserDatasetListResponse)
def list_datasets(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserDatasetListResponse:
    datasets = db.scalars(
        select(UserDataset)
        .where(UserDataset.user_id == user.id)
        .order_by(UserDataset.created_at.desc(), UserDataset.id.desc())
    ).all()
    return UserDatasetListResponse(
        datasets=[dataset_record(dataset) for dataset in datasets]
    )
