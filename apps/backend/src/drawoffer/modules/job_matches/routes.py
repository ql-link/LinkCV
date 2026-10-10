from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session, sessionmaker

from drawoffer.application.job_matches import service
from drawoffer.application.job_matches.recommendations import (
    JobMatchRunner,
    read_recommendations,
)
from drawoffer.core.database import get_db
from drawoffer.core.errors import ApiError
from drawoffer.modules.identity.dependencies import (
    get_current_career_user as get_current_user,
)
from drawoffer.modules.identity.models import User
from drawoffer.modules.job_matches.schemas import (
    AnalyzeRequest,
    MatchResponse,
    RecommendationsResponse,
)
from drawoffer.modules.llm.service import LLMError

router = APIRouter(tags=["job-matches"])


def get_job_match_runner(request: Request) -> JobMatchRunner:
    runner = getattr(request.app.state, "job_match_runner", None)
    if runner is None:
        runner = JobMatchRunner(
            request.app.state.session_factory, request.app.state.llm_service
        )
        request.app.state.job_match_runner = runner
    return runner


def _raise_service_error(error: Exception) -> None:
    if isinstance(error, service.JobMatchNotFound):
        raise ApiError(404, "JOB_NOT_FOUND") from error
    if isinstance(error, service.ResumeMatchNotFound):
        raise ApiError(404, "RESUME_NOT_FOUND") from error
    if isinstance(error, service.JobMatchNoDescription):
        raise ApiError(400, "JOB_MATCH_NO_DESCRIPTION") from error
    if isinstance(error, service.JobMatchInProgress):
        raise ApiError(409, "JOB_MATCH_IN_PROGRESS") from error
    if isinstance(error, LLMError):
        status = 503 if error.code == "LLM_MODEL_NOT_CONFIGURED" else 502
        raise ApiError(status, error.code) from error
    raise error


def _read_match(
    session_factory: sessionmaker[Session], user_id: int, job_id: str, resume_id: str
) -> MatchResponse:
    with session_factory() as db:
        return MatchResponse(
            match=service.get_match(db, user_id, job_id, resume_id)
        )


@router.get("/job-descriptions/{job_id}/match", response_model=MatchResponse)
def get_job_match(
    job_id: str,
    resume_id: str = Query(min_length=1, max_length=20),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MatchResponse:
    try:
        return MatchResponse(match=service.get_match(db, user.id, job_id, resume_id))
    except (
        service.JobMatchNotFound,
        service.ResumeMatchNotFound,
    ) as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")


@router.post("/job-descriptions/{job_id}/match:analyze", response_model=MatchResponse)
async def post_analyze_job_match(
    request: Request,
    job_id: str,
    payload: AnalyzeRequest,
    user: User = Depends(get_current_user),
) -> MatchResponse:
    state = request.app.state
    try:
        await service.analyze_job(
            state.session_factory, state.llm_service, user.id, job_id, payload.resume_id
        )
        return await asyncio.to_thread(
            _read_match, state.session_factory, user.id, job_id, payload.resume_id
        )
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")


@router.get("/job-matches/recommendations", response_model=RecommendationsResponse)
def get_recommendations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RecommendationsResponse:
    return read_recommendations(db, user.id)


@router.post(
    "/job-matches/recommendations:ensure", response_model=RecommendationsResponse
)
async def post_ensure_recommendations(
    runner: JobMatchRunner = Depends(get_job_match_runner),
    user: User = Depends(get_current_user),
) -> RecommendationsResponse:
    return await runner.ensure(user.id)
