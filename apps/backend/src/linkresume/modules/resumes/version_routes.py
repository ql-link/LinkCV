from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.resumes.copy_service import copy_resume
from linkresume.application.resumes.service import find_owned_resume, parse_persisted_resume_snapshot
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.domain.resume import compile_layout_plan
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import ResumeVersion
from linkresume.modules.resumes.routes import resume_record
from linkresume.modules.resumes.schemas import (
    LegacyResumeCopyRequest, ResumeResponse, ResumeVersionListResponse,
    ResumeVersionRecord, ResumeVersionResponse, ResumeVersionSummary,
)

router = APIRouter(prefix="/resumes/{resume_id}/versions", tags=["resume-versions"])


def version_summary(version: ResumeVersion) -> ResumeVersionSummary:
    return ResumeVersionSummary(
        id=str(version.id),
        version_no=version.version_no,
        name=version.name,
        reason=version.reason,
        template_id=str(version.template_id),
        created_at=version.created_at,
    )


def version_record(version: ResumeVersion) -> ResumeVersionRecord:
    try:
        snapshot = parse_persisted_resume_snapshot(
            version.data_json,
            version.style_json,
        )
    except (TypeError, ValueError) as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    return ResumeVersionRecord(
        **version_summary(version).model_dump(),
        data=snapshot.data,
        style=snapshot.style,
        layout_plan=compile_layout_plan(
            snapshot.data,
            snapshot.style.template_snapshot,
            snapshot.style,
        ),
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


@router.post("")
@router.patch("/{version_no}")
@router.delete("/{version_no}")
@router.post("/{version_no}/restore")
def retired_version_write(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_owned_resume_id(db, resume_id, user.id)
    raise ApiError(410, "RESUME_VERSION_RETIRED")


@router.post("/{version_no}/copy", response_model=ResumeResponse, status_code=201)
def copy_legacy_resume(resume_id: str, version_no: int, payload: LegacyResumeCopyRequest,
                       response: Response, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user), storage: AssetStorage = Depends(get_storage)):
    result, created = copy_resume(db, storage, user_id=user.id, resume_id=resume_id,
        title=payload.title, version_no=version_no, client_request_id=str(payload.client_request_id))
    response.status_code = 201 if created else 200
    return ResumeResponse(resume=resume_record(result))
