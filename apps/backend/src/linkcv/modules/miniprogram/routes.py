from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from linkcv.application.resumes.service import find_owned_resume
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_miniprogram_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume
from linkcv.modules.resumes.routes import resume_record, resume_summary
from linkcv.modules.resumes.schemas import ResumeListResponse, ResumeResponse

router = APIRouter(prefix="/miniprogram/resumes", tags=["miniprogram"])


@router.get("", response_model=ResumeListResponse)
def list_resumes(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
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
                Resume.data_json,
                Resume.style_json,
            )
        )
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id.desc())
    ).all()
    return ResumeListResponse(resumes=[resume_summary(resume) for resume in resumes])


@router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> ResumeResponse:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return ResumeResponse(resume=resume_record(resume))
