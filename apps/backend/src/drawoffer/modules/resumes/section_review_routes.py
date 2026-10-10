"""Editor section focus review: analyze one resume section or rewrite one line."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from drawoffer.application.section_review.service import (
    SectionReviewJobNotFound,
    SectionReviewResumeNotFound,
    analyze_section,
    rewrite_line,
)
from drawoffer.core.errors import ApiError
from drawoffer.modules.identity.dependencies import get_current_user
from drawoffer.modules.identity.models import User
from drawoffer.modules.llm.service import LLMError
from drawoffer.modules.resumes.section_review_schemas import (
    SectionReviewAnalyzeRequest,
    SectionReviewAnalyzeResponse,
    SectionReviewRewriteRequest,
    SectionReviewRewriteResponse,
)

router = APIRouter(tags=["resume-section-review"])


def _raise(error: Exception) -> None:
    if isinstance(error, SectionReviewResumeNotFound):
        raise ApiError(404, "RESUME_NOT_FOUND") from error
    if isinstance(error, SectionReviewJobNotFound):
        raise ApiError(404, "JOB_NOT_FOUND") from error
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
    except (SectionReviewResumeNotFound, SectionReviewJobNotFound, LLMError) as error:
        _raise(error)
        raise AssertionError("unreachable")
