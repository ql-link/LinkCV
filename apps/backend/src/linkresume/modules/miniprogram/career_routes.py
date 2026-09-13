from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Literal
from collections.abc import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.interviews.service import (
    InterviewEditConflict,
    InterviewInvalidTransition,
    InterviewNotFound,
    InterviewSessionNotEmpty,
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
    add_application_stage,
    list_application_stages,
    create_session,
    update_session,
    reschedule_session,
    cancel_interview,
    terminate_application,
    record_offer,
    InvalidInterviewRequest,
    InterviewResumeVersionRequired,
)
from linkresume.application.resumes.service import parse_decimal_id
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.modules.identity.dependencies import get_current_miniprogram_user
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import InterviewSession, JobApplication
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.modules.resumes.models import Resume, ResumeVersion
from linkresume.modules.miniprogram.pdf_service import (
    ResumePdfRenderer,
    ResumePreviewRenderer,
)
from linkresume.modules.miniprogram.routes import (
    _render_pdf,
    get_pdf_renderer,
    get_preview_renderer,
)
from linkresume.modules.interviews.schemas import (
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
    ApplicationStageRecord,
    AddApplicationStageRequest,
    TerminateApplicationRequest,
    OfferApplicationRequest,
    InterviewSessionCreateRequest,
    InterviewSessionUpdateRequest,
    RescheduleInterviewRequest,
    CancelInterviewRequest,
)

router = APIRouter(prefix="/miniprogram/career", tags=["miniprogram-career"])


class CareerApplicationSummary(JobApplicationSummary):
    current_session_status: SessionStatus | None = None


class CareerApplicationListResponse(JobApplicationListResponse):
    items: list[CareerApplicationSummary]


def _application_record(
    db: Session, application: JobApplication
) -> JobApplicationRecord:
    stages = list_application_stages(db, application.id)
    current = next((stage for stage in stages if stage.current_marker == 1), None)
    return JobApplicationRecord.model_validate(application).model_copy(
        update={
            "current_stage": ApplicationStageRecord.model_validate(current)
            if current
            else None,
            "stages": [
                ApplicationStageRecord.model_validate(stage) for stage in stages
            ],
        }
    )


def _application_summary(
    db: Session, application: JobApplication
) -> CareerApplicationSummary:
    next_session = db.scalar(
        select(InterviewSession)
        .where(
            InterviewSession.application_id == application.id,
            InterviewSession.status == "scheduled",
            InterviewSession.end_at > datetime.now(UTC),
        )
        .order_by(InterviewSession.start_at.asc(), InterviewSession.id.asc())
    )
    record = _application_record(db, application)
    current_session = (
        db.scalar(
            select(InterviewSession)
            .where(
                InterviewSession.application_id == application.id,
                InterviewSession.application_stage_id == int(record.current_stage.id),
                InterviewSession.status != "cancelled",
            )
            .order_by(InterviewSession.start_at.desc(), InterviewSession.id.desc())
        )
        if record.current_stage
        else None
    )
    return CareerApplicationSummary(
        **record.model_dump(),
        current_session_status=current_session.status if current_session else None,
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
    if isinstance(error, InvalidInterviewRequest):
        raise ApiError(400, "INVALID_INTERVIEW_REQUEST") from error
    if isinstance(error, InterviewResumeVersionRequired):
        raise ApiError(409, "INTERVIEW_RESUME_VERSION_REQUIRED") from error
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
    application_id: str | None = Query(default=None, pattern=r"^[1-9][0-9]{0,19}$"),
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionListResponse:
    if any(value is not None and value.tzinfo is None for value in (start_at, end_at)):
        raise ApiError(400, "INVALID_INTERVIEW_QUERY")
    if start_at is not None and end_at is not None and end_at <= start_at:
        raise ApiError(400, "INVALID_INTERVIEW_QUERY")
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
            application_id=int(application_id) if application_id else None,
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


@router.get("/applications", response_model=CareerApplicationListResponse)
def list_career_applications(
    scope: Literal["active", "archived", "all"] = "active",
    keyword: str | None = Query(default=None, max_length=200),
    status: ApplicationStatus | None = None,
    stage_type: ApplicationStageType | None = None,
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> CareerApplicationListResponse:
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
    return CareerApplicationListResponse(
        items=[_application_summary(db, item) for item in items],
        next_cursor=next_cursor,
    )


@router.post(
    "/applications/{application_id}/advance", response_model=JobApplicationResponse
)
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
    return JobApplicationResponse(application=_application_record(db, application))


@router.post(
    "/applications/{application_id}/close", response_model=JobApplicationResponse
)
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
    return JobApplicationResponse(application=_application_record(db, application))


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
        application=_application_record(db, result.application),
    )


def _database_id(value: str) -> int:
    parsed = parse_decimal_id(value)
    if parsed is None:
        raise ApiError(404, "INTERVIEW_NOT_FOUND")
    return parsed


@router.get("/applications/{application_id}", response_model=JobApplicationResponse)
def get_career_application(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> JobApplicationResponse:
    try:
        application = require_owned_application(
            db, user.id, _database_id(application_id)
        )
    except Exception as error:
        _raise_service_error(error)
        raise
    return JobApplicationResponse(application=_application_record(db, application))


@router.post(
    "/applications/{application_id}/stages", response_model=JobApplicationResponse
)
def add_career_stage(
    application_id: str,
    payload: AddApplicationStageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> JobApplicationResponse:
    try:
        result = add_application_stage(
            db, user.id, _database_id(application_id), payload
        )
    except Exception as error:
        _raise_service_error(error)
        raise
    return JobApplicationResponse(
        application=_application_record(db, result.application)
    )


@router.post(
    "/applications/{application_id}/terminate", response_model=JobApplicationResponse
)
def terminate_career_application(
    application_id: str,
    payload: TerminateApplicationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> JobApplicationResponse:
    try:
        result = terminate_application(
            db, user.id, _database_id(application_id), payload
        )
    except Exception as error:
        _raise_service_error(error)
        raise
    return JobApplicationResponse(
        application=_application_record(db, result.application)
    )


@router.post(
    "/applications/{application_id}/offer", response_model=JobApplicationResponse
)
def save_career_offer(
    application_id: str,
    payload: OfferApplicationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> JobApplicationResponse:
    try:
        application = record_offer(db, user.id, _database_id(application_id), payload)
    except Exception as error:
        _raise_service_error(error)
        raise
    return JobApplicationResponse(application=_application_record(db, application))


def _session_response(
    db: Session, user_id: int, session_id: int
) -> InterviewSessionResponse:
    item = require_owned_session(db, user_id, session_id)
    return InterviewSessionResponse(
        session=InterviewSessionRecord.model_validate(item.session),
        application=_application_record(db, item.application),
    )


@router.get("/sessions/{session_id}", response_model=InterviewSessionResponse)
def get_career_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionResponse:
    try:
        return _session_response(db, user.id, _database_id(session_id))
    except Exception as error:
        _raise_service_error(error)
        raise


@router.post(
    "/applications/{application_id}/sessions",
    response_model=InterviewSessionResponse,
    status_code=201,
)
def create_career_session(
    application_id: str,
    payload: InterviewSessionCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionResponse:
    try:
        session = create_session(db, user.id, _database_id(application_id), payload)
        return _session_response(db, user.id, session.id)
    except Exception as error:
        _raise_service_error(error)
        raise


def _session_command(
    command: Callable, db: Session, user: User, session_id: str, payload: object
) -> InterviewSessionResponse:
    try:
        session = command(db, user.id, _database_id(session_id), payload)
        return _session_response(db, user.id, session.id)
    except Exception as error:
        _raise_service_error(error)
        raise


@router.put("/sessions/{session_id}", response_model=InterviewSessionResponse)
def update_career_session(
    session_id: str,
    payload: InterviewSessionUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionResponse:
    return _session_command(update_session, db, user, session_id, payload)


@router.post(
    "/sessions/{session_id}/reschedule", response_model=InterviewSessionResponse
)
def reschedule_career_session(
    session_id: str,
    payload: RescheduleInterviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionResponse:
    return _session_command(reschedule_session, db, user, session_id, payload)


@router.post("/sessions/{session_id}/cancel", response_model=InterviewSessionResponse)
def cancel_career_session(
    session_id: str,
    payload: CancelInterviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> InterviewSessionResponse:
    return _session_command(cancel_interview, db, user, session_id, payload)


@router.get("/applications/{application_id}/resume-preview.png", response_model=None)
def preview_application_resume(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage),
    pdf_renderer: ResumePdfRenderer = Depends(get_pdf_renderer),
    preview_renderer: ResumePreviewRenderer = Depends(get_preview_renderer),
) -> Response:
    try:
        application = require_owned_application(
            db, user.id, _database_id(application_id)
        )
    except Exception as error:
        _raise_service_error(error)
        raise
    # Only the immutable version actually attached to this owned application is readable.
    # Never accept a caller-provided version or substitute today's latest resume.
    row = (
        db.execute(
            select(Resume, ResumeVersion)
            .join(ResumeVersion, ResumeVersion.resume_id == Resume.id)
            .where(
                Resume.user_id == user.id,
                ResumeVersion.id == application.resume_version_id,
            )
        ).first()
        if application.resume_version_id
        else None
    )
    if row is None:
        raise ApiError(409, "RESUME_VERSION_UNAVAILABLE")
    resume, version = row
    preview = preview_renderer.render(
        _render_pdf(resume, version, user, storage, pdf_renderer)
    )
    return Response(
        content=preview,
        media_type="image/png",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "X-LinkResume-Preview-Version-Id": str(version.id),
        },
    )
