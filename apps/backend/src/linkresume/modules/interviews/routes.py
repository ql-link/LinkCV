from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePath
from typing import Any, Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.interviews.service import (
    DatasetAlreadyLinked,
    InterviewApplicationNotEmpty,
    InterviewApplicationAlreadyExists,
    InterviewAnswerPlanInvalidTime,
    InterviewAnswerPlanNotSupported,
    InterviewAnswerPlanOutsideWindow,
    InterviewAssetNotLinked,
    InterviewEditConflict,
    InterviewInvalidTransition,
    InterviewNotFound,
    InterviewResumeVersionRequired,
    InterviewScheduleKindNotSupported,
    InterviewSessionNotEmpty,
    InvalidInterviewRequest,
    InvalidInterviewCursor,
    InvalidInterviewTime,
    SessionWithApplication,
    add_application_stage,
    advance_application,
    application_logo_url,
    attach_dataset_to_session,
    cancel_interview,
    close_application,
    complete_interview,
    create_application,
    create_session,
    delete_application,
    delete_session,
    find_owned_asset,
    list_applications,
    list_application_stages,
    list_assets,
    list_sessions,
    overview,
    record_offer,
    require_owned_application,
    require_owned_session,
    reschedule_session,
    set_application_archived,
    terminate_application,
    unlink_owned_dataset,
    unlink_session_dataset,
    update_application,
    update_answer_plan,
    update_session,
)
from linkresume.application.job_descriptions.service import hard_delete_owned_job
from linkresume.application.resumes.service import parse_decimal_id
from linkresume.core.config import Settings
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.mq import DatasetParseMessage, MQPublishError
from linkresume.core.storage import (
    AssetStorage,
    get_storage,
)
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.datasets.routes import (
    canonical_dataset_idempotency_key,
    get_dataset_admission,
    get_dataset_publisher,
)
from linkresume.modules.datasets.schemas import DatasetAttachRequest
from linkresume.services import dataset_ingest_service as ingest
from linkresume.services.import_admission import (
    ImportAdmissionController,
    ImportAdmissionRejected,
)
from linkresume.modules.identity.dependencies import get_current_user, get_settings
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import (
    InterviewSession,
    JobApplication,
)
from linkresume.modules.interviews.schemas import (
    AddApplicationStageRequest,
    AdvanceApplicationRequest,
    ApplicationStageType,
    ApplicationStageRecord,
    ApplicationStatus,
    AssetSourceType,
    CancelInterviewRequest,
    CloseApplicationRequest,
    CompleteInterviewRequest,
    DeleteResponse,
    DeleteSessionResponse,
    InterviewAssetListResponse,
    InterviewAssetRecord,
    InterviewAssetResponse,
    InterviewOverviewResponse,
    InterviewSessionCreateRequest,
    InterviewSessionListResponse,
    InterviewSessionRecord,
    InterviewSessionResponse,
    InterviewSessionSummary,
    InterviewSessionUpdateRequest,
    JobApplicationCreateRequest,
    JobApplicationListResponse,
    JobApplicationRecord,
    JobApplicationResponse,
    JobApplicationSummary,
    JobApplicationUpdateRequest,
    LifecycleRequest,
    OfferApplicationRequest,
    OverviewMetrics,
    RescheduleInterviewRequest,
    SessionStatus,
    TerminateApplicationRequest,
    UpdateAnswerPlanRequest,
)
from linkresume.modules.observability.audit import bind_audit_target


router = APIRouter(tags=["interviews"])
logger = logging.getLogger(__name__)

def _database_id(
    value: str,
    error_code: str = "INTERVIEW_NOT_FOUND",
    *,
    status_code: int = 404,
) -> int:
    parsed = parse_decimal_id(value)
    if parsed is None:
        raise ApiError(status_code, error_code)
    return parsed


def _utc_iso(value: datetime) -> str:
    normalized = (
        value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    )
    return normalized.isoformat()


def _application_record(
    db: Session, application: JobApplication, *, include_history: bool = True
) -> JobApplicationRecord:
    stages = list_application_stages(db, application.id)
    current = next((stage for stage in stages if stage.current_marker == 1), None)
    return JobApplicationRecord.model_validate(application).model_copy(
        update={
            "company_logo_url": application_logo_url(application),
            "current_stage": (
                ApplicationStageRecord.model_validate(current) if current else None
            ),
            "stages": (
                [ApplicationStageRecord.model_validate(stage) for stage in stages]
                if include_history
                else []
            ),
        }
    )


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
        **_application_record(db, application, include_history=False).model_dump(),
        next_session_id=next_session.id if next_session else None,
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


def _asset_record(dataset: UserDataset) -> InterviewAssetRecord:
    return InterviewAssetRecord(
        id=str(dataset.id),
        interview_session_id=str(dataset.interview_session_id),
        source_type=dataset.interview_source_type or "uploaded",
        asset_type=dataset.asset_kind,  # type: ignore[arg-type]
        original_file_name=dataset.file_name,
        content_type=dataset.content_type,
        file_size=dataset.file_size,
        duration_ms=dataset.duration_ms,
        sha256=dataset.sha256,
        created_at=dataset.created_at,
    )


def _raise_service_error(error: Exception) -> None:
    if isinstance(error, InterviewNotFound):
        raise ApiError(404, "INTERVIEW_NOT_FOUND") from error
    if isinstance(error, InterviewResumeVersionRequired):
        raise ApiError(409, "INTERVIEW_RESUME_VERSION_REQUIRED") from error
    if isinstance(error, InterviewApplicationAlreadyExists):
        raise ApiError(
            409,
            "APPLICATION_ALREADY_EXISTS",
            {"application_id": str(error.application_id)},
        ) from error
    if isinstance(error, InterviewEditConflict):
        raise ApiError(409, "INTERVIEW_EDIT_CONFLICT") from error
    if isinstance(error, InterviewInvalidTransition):
        raise ApiError(409, "INTERVIEW_INVALID_TRANSITION") from error
    if isinstance(error, InterviewScheduleKindNotSupported):
        raise ApiError(400, "INTERVIEW_SCHEDULE_KIND_NOT_SUPPORTED") from error
    if isinstance(error, InterviewAnswerPlanNotSupported):
        raise ApiError(400, "INTERVIEW_ANSWER_PLAN_NOT_SUPPORTED") from error
    if isinstance(error, InterviewAnswerPlanInvalidTime):
        raise ApiError(400, "INTERVIEW_ANSWER_PLAN_INVALID_TIME") from error
    if isinstance(error, InterviewAnswerPlanOutsideWindow):
        raise ApiError(400, "INTERVIEW_ANSWER_PLAN_OUTSIDE_WINDOW") from error
    if isinstance(error, InvalidInterviewRequest):
        raise ApiError(400, "INVALID_INTERVIEW_REQUEST") from error
    if isinstance(error, InvalidInterviewTime):
        raise ApiError(400, "INVALID_INTERVIEW_TIME") from error
    if isinstance(error, InvalidInterviewCursor):
        raise ApiError(400, "INVALID_INTERVIEW_QUERY") from error
    if isinstance(error, InterviewApplicationNotEmpty):
        raise ApiError(409, "INTERVIEW_APPLICATION_NOT_EMPTY") from error
    if isinstance(error, InterviewSessionNotEmpty):
        raise ApiError(409, "INTERVIEW_SESSION_NOT_EMPTY") from error
    if isinstance(error, DatasetAlreadyLinked):
        raise ApiError(409, "DATASET_ALREADY_LINKED") from error
    if isinstance(error, InterviewAssetNotLinked):
        raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND") from error
    raise error


@router.get("/interview-overview", response_model=InterviewOverviewResponse)
def get_interview_overview(
    week_start: date | None = None,
    timezone: str = Query(default="Asia/Shanghai", max_length=64),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
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


@router.get("/job-applications", response_model=JobApplicationListResponse)
def get_job_applications(
    scope: Literal["active", "archived", "all"] = "active",
    keyword: str | None = Query(default=None, max_length=200),
    status: ApplicationStatus | None = None,
    stage_type: ApplicationStageType | None = None,
    phase: Literal["pending", "applied"] | None = None,
    lifecycle_status: Literal["active", "terminated"] | None = None,
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationListResponse:
    try:
        items, next_cursor = list_applications(
            db,
            user.id,
            scope=scope,
            keyword=keyword,
            status=status,
            stage_type=stage_type,
            phase=phase,
            lifecycle_status=lifecycle_status,
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


@router.post(
    "/job-applications", response_model=JobApplicationResponse, status_code=201
)
def post_job_application(
    request: Request,
    payload: JobApplicationCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    try:
        application = create_application(db, user.id, payload)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    bind_audit_target(request, application.id)
    return JobApplicationResponse(application=_application_record(db, application))


@router.get("/job-applications/{application_id}", response_model=JobApplicationResponse)
def get_job_application(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    try:
        application = require_owned_application(
            db, user.id, _database_id(application_id)
        )
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return JobApplicationResponse(application=_application_record(db, application))


@router.put("/job-applications/{application_id}", response_model=JobApplicationResponse)
def put_job_application(
    application_id: str,
    payload: JobApplicationUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    try:
        application = update_application(
            db, user.id, _database_id(application_id), payload
        )
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return JobApplicationResponse(application=_application_record(db, application))


@router.post(
    "/job-applications/{application_id}/stages",
    response_model=JobApplicationResponse,
)
def post_application_stage(
    application_id: str,
    payload: AddApplicationStageRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    try:
        result = add_application_stage(
            db, user.id, _database_id(application_id), payload
        )
    except Exception as error:
        _raise_service_error(error)
        raise
    bind_audit_target(request, result.application.id)
    return JobApplicationResponse(
        application=_application_record(db, result.application)
    )


@router.post(
    "/job-applications/{application_id}/terminate",
    response_model=JobApplicationResponse,
)
def post_terminate_application(
    application_id: str,
    payload: TerminateApplicationRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    try:
        result = terminate_application(
            db, user.id, _database_id(application_id), payload
        )
    except Exception as error:
        _raise_service_error(error)
        raise
    bind_audit_target(request, result.application.id)
    return JobApplicationResponse(
        application=_application_record(db, result.application)
    )


def _application_command(
    command: Any,
    db: Session,
    user_id: int,
    application_id: str,
    payload: Any,
) -> JobApplicationResponse:
    try:
        application = command(db, user_id, _database_id(application_id), payload)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return JobApplicationResponse(application=_application_record(db, application))


@router.post(
    "/job-applications/{application_id}/advance",
    response_model=JobApplicationResponse,
)
def post_advance_application(
    application_id: str,
    payload: AdvanceApplicationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    return _application_command(
        advance_application, db, user.id, application_id, payload
    )


@router.post(
    "/job-applications/{application_id}/offer",
    response_model=JobApplicationResponse,
)
def post_application_offer(
    application_id: str,
    payload: OfferApplicationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    return _application_command(record_offer, db, user.id, application_id, payload)


@router.post(
    "/job-applications/{application_id}/close",
    response_model=JobApplicationResponse,
)
def post_close_application(
    application_id: str,
    payload: CloseApplicationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    return _application_command(close_application, db, user.id, application_id, payload)


def _archive_command(
    db: Session,
    user_id: int,
    application_id: str,
    payload: LifecycleRequest,
    *,
    archived: bool,
) -> JobApplicationResponse:
    try:
        application = set_application_archived(
            db,
            user_id,
            _database_id(application_id),
            payload.base_lock_version,
            archived=archived,
        )
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return JobApplicationResponse(application=_application_record(db, application))


@router.post(
    "/job-applications/{application_id}/archive",
    response_model=JobApplicationResponse,
)
def archive_application_route(
    application_id: str,
    payload: LifecycleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    return _archive_command(db, user.id, application_id, payload, archived=True)


@router.post(
    "/job-applications/{application_id}/restore",
    response_model=JobApplicationResponse,
)
def restore_application_route(
    application_id: str,
    payload: LifecycleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobApplicationResponse:
    return _archive_command(db, user.id, application_id, payload, archived=False)


@router.delete("/job-applications/{application_id}", response_model=DeleteResponse)
def delete_application_route(
    application_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteResponse:
    try:
        parsed_application_id = _database_id(application_id)
        application = require_owned_application(db, user.id, parsed_application_id)
        if application.job_description_id is not None:
            if application.lifecycle_status != "terminated":
                raise InterviewApplicationNotEmpty
            deleted = hard_delete_owned_job(
                db,
                str(application.job_description_id),
                user.id,
            )
            if not deleted:
                raise InterviewNotFound
        else:
            delete_application(db, user.id, parsed_application_id)
    except S3Error as error:
        raise ApiError(502, "INTERVIEW_APPLICATION_DELETE_FAILED") from error
    except Exception as error:
        if not isinstance(error, (InterviewNotFound, InterviewApplicationNotEmpty)):
            raise ApiError(502, "INTERVIEW_APPLICATION_DELETE_FAILED") from error
        _raise_service_error(error)
    return DeleteResponse(deleted=True)


@router.get("/interview-sessions", response_model=InterviewSessionListResponse)
def get_interview_sessions(
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    status: SessionStatus | None = None,
    application_id: str | None = Query(default=None, max_length=20),
    include_archived: bool = False,
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionListResponse:
    if (start_at is not None and start_at.tzinfo is None) or (
        end_at is not None and end_at.tzinfo is None
    ):
        raise ApiError(400, "INVALID_INTERVIEW_QUERY")
    if start_at is not None and end_at is not None and end_at <= start_at:
        raise ApiError(400, "INVALID_INTERVIEW_QUERY")
    try:
        items, next_cursor = list_sessions(
            db,
            user.id,
            start_at=start_at,
            end_at=end_at,
            status=status,
            application_id=(
                _database_id(
                    application_id,
                    "INVALID_INTERVIEW_QUERY",
                    status_code=400,
                )
                if application_id is not None
                else None
            ),
            include_archived=include_archived,
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


@router.post(
    "/job-applications/{application_id}/interview-sessions",
    response_model=InterviewSessionResponse,
    status_code=201,
)
def post_interview_session(
    request: Request,
    application_id: str,
    payload: InterviewSessionCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionResponse:
    try:
        parsed_application_id = _database_id(application_id)
        session = create_session(db, user.id, parsed_application_id, payload)
        application = require_owned_application(db, user.id, parsed_application_id)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    bind_audit_target(request, session.id)
    return InterviewSessionResponse(
        session=InterviewSessionRecord.model_validate(session),
        application=_application_record(db, application),
    )


@router.get("/interview-sessions/{session_id}", response_model=InterviewSessionResponse)
def get_interview_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionResponse:
    try:
        parsed_session_id = _database_id(session_id)
        item = require_owned_session(db, user.id, parsed_session_id)
        assets = list_assets(db, user.id, parsed_session_id)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return InterviewSessionResponse(
        session=InterviewSessionRecord.model_validate(item.session),
        application=_application_record(db, item.application),
        assets=[_asset_record(asset) for asset in assets],
    )


def _session_command(
    command: Any,
    db: Session,
    user_id: int,
    session_id: str,
    payload: Any,
) -> InterviewSessionResponse:
    try:
        parsed_session_id = _database_id(session_id)
        session = command(db, user_id, parsed_session_id, payload)
        item = require_owned_session(db, user_id, parsed_session_id)
        assets = list_assets(db, user_id, parsed_session_id)
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return InterviewSessionResponse(
        session=InterviewSessionRecord.model_validate(session),
        application=_application_record(db, item.application),
        assets=[_asset_record(asset) for asset in assets],
    )


@router.put("/interview-sessions/{session_id}", response_model=InterviewSessionResponse)
def put_interview_session(
    session_id: str,
    payload: InterviewSessionUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionResponse:
    return _session_command(update_session, db, user.id, session_id, payload)


@router.post(
    "/interview-sessions/{session_id}/reschedule",
    response_model=InterviewSessionResponse,
)
def post_reschedule_interview(
    session_id: str,
    payload: RescheduleInterviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionResponse:
    return _session_command(reschedule_session, db, user.id, session_id, payload)


@router.put(
    "/interview-sessions/{session_id}/answer-plan",
    response_model=InterviewSessionResponse,
)
def put_interview_answer_plan(
    session_id: str,
    payload: UpdateAnswerPlanRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionResponse:
    return _session_command(update_answer_plan, db, user.id, session_id, payload)


@router.post(
    "/interview-sessions/{session_id}/complete",
    response_model=InterviewSessionResponse,
)
def post_complete_interview(
    session_id: str,
    payload: CompleteInterviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionResponse:
    return _session_command(complete_interview, db, user.id, session_id, payload)


@router.post(
    "/interview-sessions/{session_id}/cancel",
    response_model=InterviewSessionResponse,
)
def post_cancel_interview(
    session_id: str,
    payload: CancelInterviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewSessionResponse:
    return _session_command(cancel_interview, db, user.id, session_id, payload)


@router.delete("/interview-sessions/{session_id}", response_model=DeleteSessionResponse)
def delete_interview_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteSessionResponse:
    try:
        application = delete_session(db, user.id, _database_id(session_id))
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return DeleteSessionResponse(
        deleted=True, application=_application_record(db, application)
    )


@router.get(
    "/interview-sessions/{session_id}/assets",
    response_model=InterviewAssetListResponse,
)
def get_interview_assets(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewAssetListResponse:
    try:
        assets = list_assets(db, user.id, _database_id(session_id))
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return InterviewAssetListResponse(items=[_asset_record(asset) for asset in assets])


@router.post(
    "/interview-sessions/{session_id}/assets",
    response_model=InterviewAssetResponse,
    status_code=201,
)
async def post_interview_asset(
    request: Request,
    session_id: str,
    file: UploadFile = File(...),
    source_type: AssetSourceType = Form(...),
    duration_ms: int | None = Form(default=None, ge=1),
    idempotency_key_header: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
    dataset_admission: ImportAdmissionController = Depends(get_dataset_admission),
) -> InterviewAssetResponse:
    try:
        item = require_owned_session(
            db, user.id, _database_id(session_id), for_update=True
        )
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    idempotency_key = canonical_dataset_idempotency_key(idempotency_key_header)
    try:
        admission_context = dataset_admission.acquire(user.id)
        await admission_context.__aenter__()
    except ImportAdmissionRejected as error:
        await file.close()
        raise ApiError(
            429,
            "DATASET_UPLOAD_RATE_LIMITED",
            headers={"Retry-After": "60"},
        ) from error
    try:
        result = await ingest.ingest_dataset_upload(
            db,
            user=user,
            settings=settings,
            storage=storage,
            upload=file,
            file_name_override=None,
            folder_id=None,
            interview_session_id=item.session.id,
            interview_source_type=source_type,
            duration_ms=duration_ms,
            idempotency_key=idempotency_key,
        )
    finally:
        await admission_context.__aexit__(None, None, None)
    if not result.replayed and result.task.parse_status == "queued":
        try:
            publisher = get_dataset_publisher(request, settings)
            await publisher.publish(
                DatasetParseMessage.create(parse_task_id=result.task.id)
            )
        except MQPublishError:
            logger.warning(
                "dataset parse publish deferred",
                extra={
                    "dataset_id": result.dataset.id,
                    "parse_task_id": result.task.id,
                },
            )
        else:
            result.task.last_dispatched_at = datetime.now(UTC)
            db.commit()
            db.refresh(result.task)
    bind_audit_target(request, result.dataset.id)
    return InterviewAssetResponse(asset=_asset_record(result.dataset))


@router.post(
    "/interview-sessions/{session_id}/assets/attach",
    response_model=InterviewAssetResponse,
    status_code=201,
)
def attach_interview_asset(
    request: Request,
    session_id: str,
    payload: DatasetAttachRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewAssetResponse:
    try:
        parsed_dataset_id = _database_id(payload.dataset_id, "DATASET_NOT_FOUND")
        dataset = attach_dataset_to_session(
            db,
            user.id,
            _database_id(session_id),
            parsed_dataset_id,
        )
    except ApiError:
        raise
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    bind_audit_target(request, dataset.id)
    return InterviewAssetResponse(asset=_asset_record(dataset))


@router.delete(
    "/interview-sessions/{session_id}/assets/{dataset_id}",
    response_model=None,
    status_code=200,
)
def unlink_interview_asset(
    session_id: str,
    dataset_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        unlink_session_dataset(
            db,
            user.id,
            _database_id(session_id),
            _database_id(dataset_id, "INTERVIEW_ASSET_NOT_FOUND"),
        )
    except ApiError:
        raise
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return {"unlinked": True}


def _stream_object(response: Any) -> Iterator[bytes]:
    try:
        for chunk in response.stream(64 * 1024):
            yield chunk
    finally:
        response.close()
        response.release_conn()


@router.get("/interview-assets/{asset_id}/content", response_model=None)
def get_interview_asset_content(
    asset_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> StreamingResponse:
    owned = find_owned_asset(
        db, user.id, _database_id(asset_id, "INTERVIEW_ASSET_NOT_FOUND")
    )
    if owned is None or owned[0].interview_session_id is None:
        raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND")
    dataset, _task = owned
    try:
        response = storage.get(dataset.object_name)
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND") from error
        raise ApiError(502, "INTERVIEW_ASSET_READ_FAILED") from error
    except Exception as error:
        raise ApiError(502, "INTERVIEW_ASSET_READ_FAILED") from error
    encoded = quote(dataset.file_name)
    disposition = (
        "inline" if dataset.asset_kind in {"audio", "video"} else "attachment"
    )
    return StreamingResponse(
        _stream_object(response),
        media_type=dataset.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded}",
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/interview-assets/{asset_id}", response_model=DeleteResponse)
def delete_interview_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteResponse:
    try:
        unlink_owned_dataset(
            db, user.id, _database_id(asset_id, "INTERVIEW_ASSET_NOT_FOUND")
        )
    except ApiError as error:
        if error.code == "DATASET_NOT_FOUND":
            raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND") from error
        raise
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    return DeleteResponse(deleted=True)
