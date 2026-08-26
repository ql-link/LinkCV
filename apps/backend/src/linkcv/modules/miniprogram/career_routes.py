from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.application.interviews.service import (
    InterviewEditConflict,
    InterviewInvalidTransition,
    InterviewNotFound,
    InterviewSessionNotEmpty,
    InterviewTimeConflict,
    InvalidInterviewCursor,
    InvalidInterviewTime,
    SessionWithApplication,
    advance_application,
    close_application,
    complete_interview,
    list_applications,
    list_sessions,
    overview,
    require_owned_application,
    require_owned_session,
)
from linkcv.application.resumes.service import parse_decimal_id
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_miniprogram_user
from linkcv.modules.identity.models import User
from linkcv.modules.interviews.models import InterviewSession, JobApplication
from linkcv.modules.interviews.schemas import (
    AdvanceApplicationRequest,
    ApplicationStageType,
    ApplicationStatus,
    CloseApplicationRequest,
    CompleteInterviewRequest,
    InterviewOverviewResponse,
    InterviewSessionListResponse,
    InterviewSessionRecord,
    InterviewSessionResponse,
    InterviewSessionSummary,
    JobApplicationListResponse,
    JobApplicationRecord,
    JobApplicationResponse,
    JobApplicationSummary,
    OverviewMetrics,
    SessionStageType,
    SessionStatus,
)

router = APIRouter(prefix="/miniprogram/career", tags=["miniprogram-career"])


def _application_record(application: JobApplication) -> JobApplicationRecord:
    return JobApplicationRecord.model_validate(application)


def _application_summary(
    db: Session, application: JobApplication
) -> JobApplicationSummary:
    next_session = db.scalar(
        select(InterviewSession)
        .where(
            InterviewSession.application_id == application.id,
            InterviewSession.status == "scheduled",
            InterviewSession.end_at > datetime.now(UTC),
        )
        .order_by(InterviewSession.start_at.asc(), InterviewSession.id.asc())
    )
    return JobApplicationSummary(
        **_application_record(application).model_dump(),
        next_session_id=str(next_session.id) if next_session else None,
        next_session_start_at=next_session.start_at if next_session else None,
        next_session_end_at=next_session.end_at if next_session else None,
        next_session_mode=next_session.mode if next_session else None,
    )


def _session_summary(item: SessionWithApplication) -> InterviewSessionSummary:
    return InterviewSessionSummary(
        **InterviewSessionRecord.model_validate(item.session).model_dump(),
        company_name=item.application.company_name_snapshot,
        job_title=item.application.job_title_snapshot,
        calendar_color=item.application.calendar_color,
        application_stage_state=item.application.stage_state,
    )


def _raise_service_error(error: Exception) -> None:
    if isinstance(error, InterviewNotFound):
        raise ApiError(404, "INTERVIEW_NOT_FOUND") from error
    if isinstance(error, InterviewEditConflict):
        raise ApiError(409, "INTERVIEW_EDIT_CONFLICT") from error
    if isinstance(error, InterviewInvalidTransition):
        raise ApiError(409, "INTERVIEW_INVALID_TRANSITION") from error
    if isinstance(error, InvalidInterviewTime):
        raise ApiError(400, "INVALID_INTERVIEW_TIME") from error
    if isinstance(error, InvalidInterviewCursor):
        raise ApiError(400, "INVALID_INTERVIEW_QUERY") from error
    if isinstance(error, InterviewSessionNotEmpty):
        raise ApiError(409, "INTERVIEW_SESSION_NOT_EMPTY") from error
    if isinstance(error, InterviewTimeConflict):
        raise ApiError(409, "INTERVIEW_TIME_CONFLICT") from error
    raise error


@router.get("/overview", response_model=InterviewOverviewResponse)
def get_career_overview(
    week_start: date | None = None,
    timezone: str = Query(default="Asia/Shanghai", max_length=64),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewOverviewResponse:
    if week_start is None:
        try:
            today = datetime.now(ZoneInfo(timezone)).date()
        except ZoneInfoNotFoundError as error:
            raise ApiError(400, "INVALID_INTERVIEW_TIME") from error
        week_start = today - timedelta(days=today.weekday())
    try:
        metrics, pipeline, sessions = overview(db, user.id, week_start, timezone)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return InterviewOverviewResponse(
        metrics=OverviewMetrics(**metrics),
        pipeline=[_application_summary(db, item) for item in pipeline],
        week_sessions=[_session_summary(item) for item in sessions],
    )


@router.get("/sessions", response_model=InterviewSessionListResponse)
def list_career_sessions(
    scope: Literal["active", "archived", "all"] = "active",
    status: SessionStatus | None = None,
    stage_type: SessionStageType | None = None,
    upcoming: bool | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionListResponse:
    try:
        now = datetime.now(UTC)
        query_start_at = start_at
        query_end_at = end_at
        if upcoming is True and query_start_at is None:
            query_start_at = now
        items, next_cursor = list_sessions(
            db,
            user.id,
            start_at=query_start_at,
            end_at=query_end_at,
            status=status,
            include_archived=(scope in ("archived", "all")),
            cursor=cursor,
            limit=limit,
        )
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return InterviewSessionListResponse(
        items=[_session_summary(item) for item in items],
        next_cursor=next_cursor,
    )


@router.get("/applications", response_model=JobApplicationListResponse)
def list_career_applications(
    scope: Literal["active", "archived", "all"] = "active",
    keyword: str | None = Query(default=None, max_length=200),
    status: ApplicationStatus | None = None,
    stage_type: ApplicationStageType | None = None,
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> JobApplicationListResponse:
    try:
        items, next_cursor = list_applications(
            db,
            user.id,
            scope=scope,
            keyword=keyword,
            status=status,
            stage_type=stage_type,
            cursor=cursor,
            limit=limit,
        )
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return JobApplicationListResponse(
        items=[_application_summary(db, item) for item in items],
        next_cursor=next_cursor,
    )


@router.post("/applications/{application_id}/advance", response_model=JobApplicationResponse)
def advance_career_application(
    application_id: str,
    payload: AdvanceApplicationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> JobApplicationResponse:
    numeric_id = parse_decimal_id(application_id)
    if numeric_id is None:
        raise ApiError(404, "INTERVIEW_NOT_FOUND")
    try:
        application = advance_application(db, user.id, numeric_id, payload)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return JobApplicationResponse(application=_application_record(application))


@router.post("/applications/{application_id}/close", response_model=JobApplicationResponse)
def close_career_application(
    application_id: str,
    payload: CloseApplicationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> JobApplicationResponse:
    numeric_id = parse_decimal_id(application_id)
    if numeric_id is None:
        raise ApiError(404, "INTERVIEW_NOT_FOUND")
    try:
        application = close_application(db, user.id, numeric_id, payload)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return JobApplicationResponse(application=_application_record(application))


@router.post("/sessions/{session_id}/complete", response_model=InterviewSessionResponse)
def complete_career_session(
    session_id: str,
    payload: CompleteInterviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionResponse:
    numeric_id = parse_decimal_id(session_id)
    if numeric_id is None:
        raise ApiError(404, "INTERVIEW_NOT_FOUND")
    try:
        session = complete_interview(db, user.id, numeric_id, payload)
        result = require_owned_session(db, user.id, numeric_id)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return InterviewSessionResponse(
        session=InterviewSessionRecord.model_validate(session),
        application=_application_record(result.application),
    )
