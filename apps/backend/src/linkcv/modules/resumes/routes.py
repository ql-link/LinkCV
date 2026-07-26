import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, load_only

from fastapi import APIRouter, Depends

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.application.resumes.service import (
    create_resume_with_initial_version,
    find_owned_resume,
    parse_decimal_id,
    update_resume_snapshot,
)
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, get_storage
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.domain.resume_style import default_resume_style
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume, ResumeTemplate, ResumeVersion
from linkcv.modules.resumes.schemas import (
    DeleteResumeResponse,
    ResumeCreateRequest,
    ResumeListResponse,
    ResumeRecord,
    ResumeResponse,
    ResumeSummary,
    ResumeUpdateRequest,
)

router = APIRouter(prefix="/resumes", tags=["resumes"])
logger = logging.getLogger(__name__)


def require_owned_resume(db: Session, resume_id: str, user_id: int) -> Resume:
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume


def resume_summary(resume: Resume) -> ResumeSummary:
    return ResumeSummary(
        id=str(resume.id),
        title=resume.title,
        source_type=resume.source_type,
        lock_version=resume.lock_version,
        created_at=resume.created_at,
        updated_at=resume.updated_at,
    )


def resume_record(resume: Resume) -> ResumeRecord:
    try:
        snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    return ResumeRecord(
        **resume_summary(resume).model_dump(),
        template_id=str(resume.template_id) if resume.template_id is not None else None,
        data=snapshot.data,
        style=snapshot.style,
        source_filename=resume.source_filename,
    )


@router.get("", response_model=ResumeListResponse)
def list_resumes(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeListResponse:
    resumes = db.scalars(
        select(Resume)
        .options(
            load_only(
                Resume.id,
                Resume.title,
                Resume.source_type,
                Resume.lock_version,
                Resume.created_at,
                Resume.updated_at,
            )
        )
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id.desc())
    ).all()
    return ResumeListResponse(resumes=[resume_summary(resume) for resume in resumes])


@router.post("", response_model=ResumeResponse, status_code=201)
def create_resume(
    payload: ResumeCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    title = payload.title or "未命名简历"
    data = default_resume_document()
    style = default_resume_style()
    source_type = "blank"
    template_id: int | None = None

    if payload.template_id is not None:
        template_id = parse_decimal_id(payload.template_id)
        template = (
            db.scalar(
                select(ResumeTemplate).where(
                    ResumeTemplate.id == template_id,
                    ResumeTemplate.is_active == 1,
                )
            )
            if template_id is not None
            else None
        )
        if template is None:
            raise ApiError(422, "TEMPLATE_INACTIVE")
        try:
            snapshot = parse_resume_snapshot(template.data_json, template.style_json)
        except ValueError as error:
            raise ApiError(422, "TEMPLATE_INACTIVE") from error
        data = snapshot.data
        style = snapshot.style
        source_type = "template"

    resume = create_resume_with_initial_version(
        CreateResumeCommand(
            user_id=user.id,
            title=title,
            data=data,
            style=style,
            source_type=source_type,
            template_id=template_id,
        ),
        db,
    )
    return ResumeResponse(resume=resume_record(resume))


@router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    return ResumeResponse(resume=resume_record(require_owned_resume(db, resume_id, user.id)))


@router.put("/{resume_id}", response_model=ResumeResponse)
def update_resume(
    resume_id: str,
    payload: ResumeUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    resume = require_owned_resume(db, resume_id, user.id)
    try:
        updated = update_resume_snapshot(
            db=db,
            resume=resume,
            user_id=user.id,
            base_lock_version=payload.base_lock_version,
            title=payload.title,
            data=payload.data,
            style=payload.style,
        )
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    if updated is None:
        raise ApiError(409, "RESUME_EDIT_CONFLICT")
    return ResumeResponse(resume=resume_record(updated))


@router.delete("/{resume_id}", response_model=DeleteResumeResponse)
def delete_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> DeleteResumeResponse:
    parsed_id = parse_decimal_id(resume_id)
    if parsed_id is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    source_object_key = resume.source_object_key
    db.execute(delete(ResumeVersion).where(ResumeVersion.resume_id == resume.id))
    result = db.execute(delete(Resume).where(Resume.id == resume.id))
    db.commit()
    try:
        if source_object_key:
            storage.delete(source_object_key)
        storage.delete_prefix(f"users/{user.id}/resumes/{resume.id}/")
    except Exception:
        logger.error(
            "resume resource cleanup failed",
            extra={"resume_id": resume.id, "user_id": user.id},
        )
    return DeleteResumeResponse(deleted=bool(result.rowcount))
