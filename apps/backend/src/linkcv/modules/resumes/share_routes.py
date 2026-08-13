from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from linkcv.application.resumes.share_service import (
    ShareLinkUnavailable,
    create_or_overwrite_share,
    delete_share,
    resolve_public_share,
    share_state_of,
    update_share,
)
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_user, get_optional_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume
from linkcv.modules.resumes.schemas import (
    DeleteResumeShareResponse,
    PublicSharePayload,
    ResumeShareCreateRequest,
    ResumeShareResponse,
    ResumeShareUpdateRequest,
)
from linkcv.application.resumes.service import find_owned_resume

router = APIRouter(prefix="/resumes/{resume_id}/share", tags=["resume-share"])
public_router = APIRouter(prefix="/share", tags=["resume-share"])


def _require_owned_resume(db: Session, resume_id: str, user_id: int) -> Resume:
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume


@router.get("", response_model=ResumeShareResponse)
def get_share_state(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeShareResponse:
    resume = _require_owned_resume(db, resume_id, user.id)
    return ResumeShareResponse(share=share_state_of(resume))


@router.post("", response_model=ResumeShareResponse)
def create_share(
    resume_id: str,
    request: ResumeShareCreateRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeShareResponse:
    _require_owned_resume(db, resume_id, user.id)
    updated = create_or_overwrite_share(
        db,
        resume_id,
        user.id,
        visibility=request.visibility if request else None,
        expires_at=request.expires_at if request else None,
    )
    if updated is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return ResumeShareResponse(share=share_state_of(updated))


@router.patch("", response_model=ResumeShareResponse)
def update_share_state(
    resume_id: str,
    request: ResumeShareUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeShareResponse:
    _require_owned_resume(db, resume_id, user.id)
    try:
        updated = update_share(
            db,
            resume_id,
            user.id,
            visibility=request.visibility,
            expires_at=request.expires_at,
            provided_fields=request.model_fields_set,
        )
    except ShareLinkUnavailable as error:
        raise ApiError(404, "SHARE_LINK_UNAVAILABLE") from error
    return ResumeShareResponse(share=share_state_of(updated))


@router.delete("", response_model=DeleteResumeShareResponse)
def delete_share_state(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteResumeShareResponse:
    _require_owned_resume(db, resume_id, user.id)
    deleted = delete_share(db, resume_id, user.id)
    if deleted is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return DeleteResumeShareResponse(deleted=deleted)


@public_router.get("/{token}", response_model=PublicSharePayload)
def get_public_share(
    token: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
) -> PublicSharePayload:
    try:
        return resolve_public_share(db, token, viewer)
    except ShareLinkUnavailable as error:
        raise ApiError(404, "SHARE_LINK_UNAVAILABLE") from error
