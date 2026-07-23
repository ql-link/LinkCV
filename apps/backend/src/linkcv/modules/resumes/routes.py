from copy import deepcopy

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.core.security import create_id
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.defaults import (
    DEFAULT_RESUME_MARKDOWN,
    DEFAULT_RESUME_SETTINGS,
)
from linkcv.modules.resumes.models import Resume
from linkcv.modules.resumes.schemas import (
    DeleteResumeResponse,
    ResumeListResponse,
    ResumeRecord,
    ResumeResponse,
    ResumeSummary,
    ResumeWrite,
)

router = APIRouter(prefix="/resumes", tags=["resumes"])


def owned_resume(db: Session, resume_id: str, user_id: str) -> Resume:
    resume = db.scalar(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user_id)
    )
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume


def normalized_settings(value: dict[str, object] | None) -> dict[str, object]:
    result = deepcopy(DEFAULT_RESUME_SETTINGS)
    if value:
        result.update(value)
    result["showSource"] = False
    return result


@router.get("", response_model=ResumeListResponse)
def list_resumes(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeListResponse:
    resumes = db.scalars(
        select(Resume)
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc())
    ).all()
    return ResumeListResponse(
        resumes=[ResumeSummary.model_validate(resume) for resume in resumes]
    )


@router.post("", response_model=ResumeResponse, status_code=201)
def create_resume(
    payload: ResumeWrite,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    title = (payload.title or "未命名简历").strip() or "未命名简历"
    resume = Resume(
        id=create_id("resume"),
        user_id=user.id,
        title=title,
        markdown=payload.markdown
        if payload.markdown is not None
        else DEFAULT_RESUME_MARKDOWN,
        settings=normalized_settings(payload.settings),
        split_ratio=payload.split_ratio if payload.split_ratio is not None else 0.4,
        preview_scale=payload.preview_scale
        if payload.preview_scale is not None
        else 1.0,
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)
    return ResumeResponse(resume=ResumeRecord.model_validate(resume))


@router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    resume = owned_resume(db, resume_id, user.id)
    return ResumeResponse(resume=ResumeRecord.model_validate(resume))


@router.put("/{resume_id}", response_model=ResumeResponse)
def update_resume(
    resume_id: str,
    payload: ResumeWrite,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    resume = owned_resume(db, resume_id, user.id)
    if payload.title is not None:
        resume.title = payload.title.strip() or "未命名简历"
    if payload.markdown is not None:
        resume.markdown = payload.markdown
    if payload.settings is not None:
        resume.settings = normalized_settings(payload.settings)
    if payload.split_ratio is not None:
        resume.split_ratio = payload.split_ratio
    if payload.preview_scale is not None:
        resume.preview_scale = payload.preview_scale
    resume.updated_at = utc_now()
    db.commit()
    db.refresh(resume)
    return ResumeResponse(resume=ResumeRecord.model_validate(resume))


@router.delete("/{resume_id}", response_model=DeleteResumeResponse)
def delete_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteResumeResponse:
    result = db.execute(
        delete(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    db.commit()
    return DeleteResumeResponse(deleted=bool(result.rowcount))
