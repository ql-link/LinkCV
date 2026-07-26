from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import (
    create_manual_version,
    find_owned_resume,
    restore_resume_version,
)
from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import ResumeVersion
from linkcv.modules.resumes.routes import resume_record
from linkcv.modules.resumes.schemas import (
    ResumeResponse,
    ResumeVersionListResponse,
    ResumeVersionRecord,
    ResumeVersionResponse,
    ResumeVersionSummary,
)

router = APIRouter(prefix="/resumes/{resume_id}/versions", tags=["resume-versions"])


def version_summary(version: ResumeVersion) -> ResumeVersionSummary:
    return ResumeVersionSummary(
        id=str(version.id),
        version_no=version.version_no,
        reason=version.reason,
        created_at=version.created_at,
    )


def version_record(version: ResumeVersion) -> ResumeVersionRecord:
    try:
        snapshot = parse_resume_snapshot(version.data_json, version.style_json)
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    return ResumeVersionRecord(
        **version_summary(version).model_dump(),
        data=snapshot.data,
        style=snapshot.style,
    )


def require_owned_resume_id(db: Session, resume_id: str, user_id: int) -> int:
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume.id


@router.get("", response_model=ResumeVersionListResponse)
def list_versions(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeVersionListResponse:
    parsed_id = require_owned_resume_id(db, resume_id, user.id)
    versions = db.scalars(
        select(ResumeVersion)
        .where(ResumeVersion.resume_id == parsed_id)
        .order_by(ResumeVersion.version_no.desc())
    ).all()
    return ResumeVersionListResponse(
        versions=[version_summary(version) for version in versions]
    )


@router.post("", response_model=ResumeVersionResponse, status_code=201)
def create_version(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ResumeVersionResponse:
    try:
        version = create_manual_version(
            db,
            resume_id,
            user.id,
            settings.resume_version_limit,
        )
    except IntegrityError as error:
        raise ApiError(409, "VERSION_CONFLICT") from error
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    if version is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return ResumeVersionResponse(version=version_record(version))


@router.get("/{version_no}", response_model=ResumeVersionResponse)
def get_version(
    resume_id: str,
    version_no: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeVersionResponse:
    parsed_id = require_owned_resume_id(db, resume_id, user.id)
    version = db.scalar(
        select(ResumeVersion).where(
            ResumeVersion.resume_id == parsed_id,
            ResumeVersion.version_no == version_no,
        )
    )
    if version is None:
        raise ApiError(404, "RESUME_VERSION_NOT_FOUND")
    return ResumeVersionResponse(version=version_record(version))


@router.post("/{version_no}/restore", response_model=ResumeResponse)
def restore_version(
    resume_id: str,
    version_no: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> ResumeResponse:
    try:
        resume = restore_resume_version(
            db,
            resume_id,
            version_no,
            user.id,
            settings.resume_version_limit,
        )
    except IntegrityError as error:
        raise ApiError(409, "VERSION_CONFLICT") from error
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    if resume is None:
        if find_owned_resume(db, resume_id, user.id) is None:
            raise ApiError(404, "RESUME_NOT_FOUND")
        raise ApiError(404, "RESUME_VERSION_NOT_FOUND")
    return ResumeResponse(resume=resume_record(resume))
