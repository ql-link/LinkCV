"""Folder-scoped dataset name conflicts."""

import unicodedata
from pathlib import PurePath
from sqlalchemy import select
from linkresume.core.errors import ApiError
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.resumes.models import DocumentParseTask
from linkresume.services.dataset_content_service import lock_user


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
                    "created_at": r.create_time.isoformat(),
                    "content_revision": str(r.content_revision),
                    "replaceable": db.get(DocumentParseTask, r.parse_task_id).upload_status != "uploading"
                    and db.get(DocumentParseTask, r.parse_task_id).parse_status not in ("queued", "processing"),
                }
                for r in matches
            ],
            "suggested_name": f"{stem} ({n}){extension}",
        },
    )
