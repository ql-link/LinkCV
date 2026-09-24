from copy import deepcopy
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import (
    InvalidResumeTitle, ResumeTitleConflict, ensure_unique_resume_title,
    has_resume_capacity, normalize_resume_title, parse_decimal_id, parse_persisted_resume_snapshot,
)
from linkresume.core.errors import ApiError
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import Resume, ResumeTemplate, ResumeVersion
from linkresume.modules.resumes.pdf_service import clone_resume_private_assets, validate_resume_pdf_asset_contract


def copy_resume(db: Session, storage, *, user_id: int, resume_id: str, title: str,
                client_request_id: str, base_lock_version: int | None = None,
                version_no: int | None = None) -> tuple[Resume, bool]:
    db.scalar(select(User.id).where(User.id == user_id).with_for_update())
    source = db.scalar(select(Resume).where(
        Resume.id == parse_decimal_id(resume_id), Resume.user_id == user_id,
    ).with_for_update())
    if source is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    legacy = None
    if version_no is not None:
        legacy = db.scalar(select(ResumeVersion).where(
            ResumeVersion.resume_id == source.id, ResumeVersion.version_no == version_no))
        if legacy is None:
            raise ApiError(404, "RESUME_VERSION_NOT_FOUND")
    try:
        title = normalize_resume_title(title)
    except InvalidResumeTitle as error:
        raise ApiError(422, "INVALID_RESUME_TITLE") from error
    parameters = {"source": "legacy" if legacy else "current", "id": legacy.id if legacy else source.id,
                  "base_lock_version": None if legacy else base_lock_version, "title": title}
    request_hash = hashlib.sha256(json.dumps(parameters, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    existing = db.scalar(select(Resume).where(Resume.user_id == user_id,
                                              Resume.creation_request_id == client_request_id))
    if existing:
        if existing.creation_request_hash != request_hash:
            raise ApiError(409, "RESUME_COPY_REQUEST_CONFLICT")
        return existing, False
    if legacy is None and source.lock_version != base_lock_version:
        raise ApiError(409, "RESUME_EDIT_CONFLICT")
    if not has_resume_capacity(db, user_id):
        raise ApiError(409, "RESUME_LIMIT_REACHED")
    try:
        ensure_unique_resume_title(db, user_id=user_id, title=title)
    except ResumeTitleConflict as error:
        raise ApiError(409, "RESUME_TITLE_CONFLICT") from error
    content = legacy or source
    try:
        snapshot = parse_persisted_resume_snapshot(content.data_json, content.style_json)
        template = db.get(ResumeTemplate, content.template_id)
        if template is None or snapshot.style.template_snapshot.template_key != template.key:
            raise ValueError("template identity mismatch")
    except (TypeError, ValueError) as error:
        raise ApiError(422, "RESUME_SCHEMA_INVALID") from error
    copied = []
    try:
        result = Resume(user_id=user_id, template_id=content.template_id, title=title,
                        data_json=deepcopy(snapshot.data_json), style_json=deepcopy(snapshot.style_json),
                        source_type=source.source_type, creation_request_id=client_request_id,
                        creation_request_hash=request_hash)
        db.add(result)
        db.flush()
        try:
            result.data_json, copied = clone_resume_private_assets(
                storage, snapshot.data_json, user_id=user_id, source_resume_id=source.id,
                target_resume_id=result.id)
            validate_resume_pdf_asset_contract(storage, result.data_json, user_id=user_id, resume_id=result.id)
        except Exception as error:
            raise ApiError(502, "RESUME_COPY_ASSET_FAILED") from error
        # Flush all database writes while rollback still guarantees that no
        # committed resume references the assets being compensated below.
        db.flush()
    except Exception:
        db.rollback()
        for key in copied:
            try:
                storage.delete(key)
            except Exception:
                pass
        raise

    # Once COMMIT starts, a connection error can mean a lost acknowledgement,
    # not a failed write. Keep assets on uncertain commit outcomes (potential
    # orphans are safer than deleting a committed resume's images). Refresh
    # failures likewise must never enter the pre-commit asset compensation.
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(result)
    return result, True
