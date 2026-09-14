from __future__ import annotations

import hashlib
from contextlib import contextmanager
from io import BytesIO
from typing import Iterator

from minio.error import S3Error
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage
from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.job_descriptions.models import JobDescription

MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_STORED_LOGO_BYTES = 256 * 1024


def normalize_logo(data: bytes) -> bytes:
    if len(data) > MAX_LOGO_BYTES:
        raise ApiError(413, "COMPANY_LOGO_TOO_LARGE")
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in {"PNG", "JPEG", "WEBP", "GIF"}:
                raise ValueError("unsupported image")
            if source.width * source.height > 16_000_000:
                raise ValueError("too many pixels")
            source.seek(0)
            normalized = ImageOps.exif_transpose(source).convert("RGBA")
            normalized.thumbnail((256, 256), Image.Resampling.LANCZOS)
            # Copy pixels into a clean image so EXIF/ICC and other source metadata
            # cannot affect storage or the content fingerprint.
            clean = Image.new("RGBA", normalized.size)
            clean.paste(normalized)
            output = BytesIO()
            clean.save(output, format="WEBP", quality=85, method=6)
            result = output.getvalue()
            if len(result) > MAX_STORED_LOGO_BYTES:
                raise ValueError("encoded image too large")
            return result
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as error:
        raise ApiError(422, "COMPANY_LOGO_INVALID") from error


def sync_application_logos(db: Session, job: JobDescription) -> None:
    applications = db.scalars(
        select(JobApplication)
        .where(JobApplication.job_description_id == job.id, JobApplication.user_id == job.user_id)
        .order_by(JobApplication.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    for application in applications:
        if application.job_snapshot.get("logo_url") == job.resolved_logo_url:
            continue
        application.job_snapshot = {**application.job_snapshot, "logo_url": job.resolved_logo_url}
        # Protect this JSON-only change from concurrent edits of the snapshot.
        application.lock_version += 1
        application.updated_at = utc_now()


@contextmanager
def _content_write_lock(db: Session, digest: str) -> Iterator[None]:
    connection = db.connection()
    if connection.dialect.name != "mysql":
        # SQLite is a test substitute; actual concurrent storage tests use MySQL.
        yield
        return
    # A connection-scoped lock has no expiring lease during a slow MinIO write.
    # Serialize first writes even when the bucket retains object versions.
    key = f"company-logo:{digest[:50]}"
    acquired = connection.scalar(text("SELECT GET_LOCK(:key, 10)"), {"key": key})
    if acquired != 1:
        raise ApiError(503, "COMPANY_LOGO_BUSY")
    try:
        yield
    finally:
        connection.execute(text("SELECT RELEASE_LOCK(:key)"), {"key": key})


def attach_logo(
    db: Session, storage: AssetStorage, job: JobDescription, data: bytes,
    *, mode: str, expected_revision: str | None,
) -> dict[str, str]:
    normalized = normalize_logo(data)
    digest = hashlib.sha256(normalized).hexdigest()
    try:
        locked = db.scalar(
            select(JobDescription)
            .where(JobDescription.id == job.id, JobDescription.user_id == job.user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if locked is None:
            raise ApiError(404, "JD_NOT_FOUND")
        if mode == "fill_missing" and locked.logo_sha256:
            return {"logo_url": locked.resolved_logo_url, "revision": locked.logo_sha256}
        if mode == "replace" and expected_revision != (locked.logo_sha256 or "none"):
            raise ApiError(409, "COMPANY_LOGO_CONFLICT")
        object_name = f"company-logos/{digest}.webp"
        with _content_write_lock(db, digest):
            try:
                storage.stat(object_name)
            except S3Error as error:
                if error.code not in {"NoSuchKey", "NoSuchObject"}:
                    raise
                # Never delete this shared object as compensation on failure.
                storage.put(object_name, normalized, "image/webp", cache_control="private, no-cache")
        locked.logo_sha256 = digest
        locked.lock_version += 1
        locked.updated_at = utc_now()
        sync_application_logos(db, locked)
        db.commit()
        return {"logo_url": locked.resolved_logo_url, "revision": digest}
    except ApiError:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        raise ApiError(503, "COMPANY_LOGO_SAVE_FAILED") from error
