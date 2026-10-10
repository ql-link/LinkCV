"""Editor section focus review: analyze one resume section, rewrite one line,
and read or update the saved results."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import find_owned_resume
from linkresume.application.section_review import store
from linkresume.application.section_review.service import (
    SectionReviewJobNotFound,
    SectionReviewResumeNotFound,
    analyze_section,
    rewrite_line,
)
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User
from linkresume.modules.llm.service import LLMError
from linkresume.modules.resumes.section_review_schemas import (
    SectionReviewAnalyzeRequest,
    SectionReviewAnalyzeResponse,
    SectionReviewItem,
    SectionReviewItemUpdate,
    SectionReviewListResponse,
    SectionReviewRewriteRequest,
    SectionReviewRewriteResponse,
)

router = APIRouter(tags=["resume-section-review"])


def _raise(error: Exception) -> None:
    if isinstance(error, SectionReviewResumeNotFound):
        raise ApiError(404, "RESUME_NOT_FOUND") from error
    if isinstance(error, SectionReviewJobNotFound):
        raise ApiError(404, "JOB_NOT_FOUND") from error
    if isinstance(error, store.SectionReviewNotFound):
        raise ApiError(404, "SECTION_REVIEW_NOT_FOUND") from error
    if isinstance(error, store.SectionReviewItemApplied):
        raise ApiError(409, "SECTION_REVIEW_ITEM_APPLIED") from error
    if isinstance(error, store.SectionReviewItemLimit):
        raise ApiError(409, "SECTION_REVIEW_ITEM_LIMIT") from error
    if isinstance(error, store.SectionReviewInvalidTransition):
        raise ApiError(409, "SECTION_REVIEW_INVALID_TRANSITION") from error
    if isinstance(error, LLMError):
        status = 503 if error.code == "LLM_MODEL_NOT_CONFIGURED" else 502
        raise ApiError(status, error.code) from error
    raise error


@router.post(
    "/resumes/{resume_id}/section-review:analyze",
    response_model=SectionReviewAnalyzeResponse,
)
async def post_section_review_analyze(
    request: Request,
    resume_id: str,
    payload: SectionReviewAnalyzeRequest,
    user: User = Depends(get_current_user),
) -> SectionReviewAnalyzeResponse:
    state = request.app.state
    try:
        return await analyze_section(
            state.session_factory, state.llm_service, user.id, resume_id, payload
        )
    except (SectionReviewResumeNotFound, SectionReviewJobNotFound, LLMError) as error:
        _raise(error)
        raise AssertionError("unreachable")


@router.post(
    "/resumes/{resume_id}/section-review:rewrite",
    response_model=SectionReviewRewriteResponse,
)
async def post_section_review_rewrite(
    request: Request,
    resume_id: str,
    payload: SectionReviewRewriteRequest,
    user: User = Depends(get_current_user),
) -> SectionReviewRewriteResponse:
    state = request.app.state
    try:
        return await rewrite_line(
            state.session_factory, state.llm_service, user.id, resume_id, payload
        )
    except (
        SectionReviewResumeNotFound,
        SectionReviewJobNotFound,
        store.SectionReviewNotFound,
        store.SectionReviewItemApplied,
        store.SectionReviewItemLimit,
        store.SectionReviewInvalidTransition,
        LLMError,
    ) as error:
        _raise(error)
        raise AssertionError("unreachable")


@router.get(
    "/resumes/{resume_id}/section-reviews",
    response_model=SectionReviewListResponse,
)
def get_section_reviews(
    resume_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SectionReviewListResponse:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return SectionReviewListResponse(reviews=store.list_reviews(db, user.id, resume.id))


@router.patch(
    "/resumes/{resume_id}/section-reviews/{review_id}/items/{item_id}",
    response_model=SectionReviewItem,
)
def patch_section_review_item(
    resume_id: str,
    review_id: str,
    item_id: str,
    payload: SectionReviewItemUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SectionReviewItem:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    try:
        return store.update_item(db, user.id, resume.id, review_id, item_id, payload)
    except (store.SectionReviewNotFound, store.SectionReviewInvalidTransition) as error:
        db.rollback()
        _raise(error)
        raise AssertionError("unreachable")
