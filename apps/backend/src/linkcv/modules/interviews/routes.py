from __future__ import annotations

import asyncio
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePath
from typing import Any, Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.application.interviews.service import (
    InterviewApplicationNotEmpty,
    InterviewApplicationAlreadyActive,
    InterviewEditConflict,
    InterviewInvalidTransition,
    InterviewNotFound,
    InterviewResumeVersionRequired,
    InterviewSessionNotEmpty,
    InterviewTimeConflict,
    InvalidInterviewRequest,
    InvalidInterviewCursor,
    InvalidInterviewTime,
    SessionWithApplication,
    add_application_stage,
    advance_application,
    cancel_interview,
    close_application,
    complete_interview,
    create_application,
    create_asset_record,
    create_session,
    delete_application,
    delete_asset_record,
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
    update_application,
    update_session,
)
from linkcv.application.resumes.service import parse_decimal_id
from linkcv.core.config import Settings
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import (
    AssetStorage,
    EmptyUpload,
    UploadTooLarge,
    build_interview_asset_object_name,
    get_storage,
)
from linkcv.modules.identity.dependencies import get_current_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.interviews.models import (
    InterviewAsset,
    InterviewSession,
    JobApplication,
)
from linkcv.modules.interviews.schemas import (
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
)
from linkcv.modules.observability.audit import bind_audit_target


router = APIRouter(tags=["interviews"])

SUPPORTED_ASSET_TYPES: dict[str, tuple[str, frozenset[str]]] = {
    ".webm": ("audio", frozenset({"audio/webm", "video/webm"})),
    ".m4a": ("audio", frozenset({"audio/mp4", "audio/x-m4a"})),
    ".mp3": ("audio", frozenset({"audio/mpeg", "audio/mp3"})),
    ".wav": ("audio", frozenset({"audio/wav", "audio/x-wav"})),
    ".ogg": ("audio", frozenset({"audio/ogg", "application/ogg"})),
    ".mp4": ("video", frozenset({"video/mp4", "audio/mp4"})),
    ".mov": ("video", frozenset({"video/quicktime"})),
    ".pdf": ("document", frozenset({"application/pdf"})),
    ".docx": (
        "document",
        frozenset(
            {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
        ),
    ),
    ".txt": ("document", frozenset({"text/plain"})),
    ".md": ("document", frozenset({"text/markdown", "text/plain"})),
}


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
    normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return normalized.isoformat()


def _application_record(
    db: Session, application: JobApplication, *, include_history: bool = True
) -> JobApplicationRecord:
    stages = list_application_stages(db, application.id)
    current = next((stage for stage in stages if stage.current_marker == 1), None)
    return JobApplicationRecord.model_validate(application).model_copy(
        update={
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


def _asset_record(asset: InterviewAsset) -> InterviewAssetRecord:
    return InterviewAssetRecord.model_validate(asset)


def _raise_service_error(error: Exception) -> None:
    if isinstance(error, InterviewNotFound):
        raise ApiError(404, "INTERVIEW_NOT_FOUND") from error
    if isinstance(error, InterviewResumeVersionRequired):
        raise ApiError(409, "INTERVIEW_RESUME_VERSION_REQUIRED") from error
    if isinstance(error, InterviewApplicationAlreadyActive):
        raise ApiError(
            409,
            "APPLICATION_ALREADY_ACTIVE",
            {"application_id": str(error.application_id)},
        ) from error
    if isinstance(error, InterviewEditConflict):
        raise ApiError(409, "INTERVIEW_EDIT_CONFLICT") from error
    if isinstance(error, InterviewInvalidTransition):
        raise ApiError(409, "INTERVIEW_INVALID_TRANSITION") from error
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
    if isinstance(error, InterviewTimeConflict):
        raise ApiError(
            409,
            "INTERVIEW_TIME_CONFLICT",
            {
                "conflicts": [
                    {
                        "id": str(item.id),
                        "application_id": str(item.application_id),
                        "company_name": item.company_name,
                        "stage_label": item.stage_label,
                        "start_at": _utc_iso(item.start_at),
                        "end_at": _utc_iso(item.end_at),
                    }
                    for item in error.conflicts
                ]
            },
        ) from error
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
        delete_application(db, user.id, _database_id(application_id))
    except Exception as error:
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


def _safe_file_name(file_name: str) -> str:
    safe = file_name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    if not safe or len(safe) > 255 or any(ord(character) < 32 for character in safe):
        raise ApiError(400, "INVALID_INTERVIEW_ASSET")
    return safe


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
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    storage: AssetStorage = Depends(get_storage),
) -> InterviewAssetResponse:
    try:
        item = require_owned_session(db, user.id, _database_id(session_id))
    except Exception as error:
        _raise_service_error(error)
        raise AssertionError("unreachable")
    filename = _safe_file_name(file.filename or "")
    extension = PurePath(filename).suffix.lower()
    declared_type = (file.content_type or "application/octet-stream").lower()
    declared_type = declared_type.split(";", 1)[0].strip()
    type_contract = SUPPORTED_ASSET_TYPES.get(extension)
    if type_contract is None or declared_type not in type_contract[1]:
        raise ApiError(400, "UNSUPPORTED_INTERVIEW_ASSET")
    if file.size is not None and file.size > settings.interview_asset_upload_max_bytes:
        raise ApiError(413, "INTERVIEW_ASSET_TOO_LARGE")
    object_name = build_interview_asset_object_name(
        user.id, item.application.id, item.session.id, filename
    )
    try:
        upload = await asyncio.to_thread(
            storage.upload_stream,
            object_name,
            file.file,
            declared_type,
            max_bytes=settings.interview_asset_upload_max_bytes,
        )
    except UploadTooLarge as error:
        raise ApiError(413, "INTERVIEW_ASSET_TOO_LARGE") from error
    except EmptyUpload as error:
        raise ApiError(400, "EMPTY_INTERVIEW_ASSET") from error
    except Exception as error:
        raise ApiError(502, "INTERVIEW_ASSET_UPLOAD_FAILED") from error
    finally:
        await file.close()
    try:
        asset = create_asset_record(
            db,
            session_id=session_id,
            source_type=source_type,
            asset_type=(
                "video"
                if declared_type.startswith("video/")
                else "audio"
                if declared_type.startswith("audio/")
                else type_contract[0]
            ),
            original_file_name=filename,
            content_type=declared_type,
            file_size=upload.file_size,
            duration_ms=duration_ms,
            object_name=object_name,
            sha256=upload.sha256,
        )
    except Exception as error:
        db.rollback()
        try:
            storage.delete(object_name)
        except Exception:
            pass
        raise ApiError(500, "INTERVIEW_ASSET_RECORD_FAILED") from error
    bind_audit_target(request, asset.id)
    return InterviewAssetResponse(asset=_asset_record(asset))


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
    if owned is None:
        raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND")
    asset, _ = owned
    try:
        response = storage.get(asset.object_name)
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND") from error
        raise ApiError(502, "INTERVIEW_ASSET_READ_FAILED") from error
    except Exception as error:
        raise ApiError(502, "INTERVIEW_ASSET_READ_FAILED") from error
    encoded = quote(asset.original_file_name)
    disposition = "inline" if asset.asset_type in {"audio", "video"} else "attachment"
    return StreamingResponse(
        _stream_object(response),
        media_type=asset.content_type,
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
    storage: AssetStorage = Depends(get_storage),
) -> DeleteResponse:
    owned = find_owned_asset(
        db, user.id, _database_id(asset_id, "INTERVIEW_ASSET_NOT_FOUND")
    )
    if owned is None:
        raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND")
    asset, _ = owned
    try:
        storage.delete(asset.object_name)
    except S3Error as error:
        if error.code not in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(502, "INTERVIEW_ASSET_DELETE_FAILED") from error
    except Exception as error:
        raise ApiError(502, "INTERVIEW_ASSET_DELETE_FAILED") from error
    try:
        delete_asset_record(db, asset)
    except Exception as error:
        db.rollback()
        raise ApiError(500, "INTERVIEW_ASSET_RECORD_DELETE_FAILED") from error
    return DeleteResponse(deleted=True)
