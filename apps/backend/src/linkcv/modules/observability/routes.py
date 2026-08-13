from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request

from linkcv.application.resumes.service import find_owned_resume
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import (
    get_current_admin,
    get_current_user,
    get_settings,
)
from linkcv.modules.identity.models import User
from linkcv.modules.observability.audit import AUDIT_ACTION_NAMES_WITH_CLIENT
from linkcv.modules.observability.logging import StructuredLogEmitter
from linkcv.modules.observability.loki import (
    InvalidLogCursorError,
    LokiClient,
    LokiUnavailableError,
)
from linkcv.modules.observability.schemas import (
    AcceptedResponse,
    AuditEventRequest,
    ClientLogEventRequest,
    LogListResponse,
    LogSummaryResponse,
)
from sqlalchemy.orm import Session

router = APIRouter(tags=["observability"])
MAX_WINDOW = timedelta(days=7)
DEFAULT_WINDOW = timedelta(hours=24)


def get_emitter(request: Request) -> StructuredLogEmitter:
    return request.app.state.event_emitter


def get_loki(request: Request) -> LokiClient:
    client = request.app.state.loki_client
    if client is None:
        raise ApiError(503, "LOG_QUERY_UNAVAILABLE")
    return client


def _window(
    from_at: datetime | None,
    to_at: datetime | None,
    *,
    error_code: str,
) -> tuple[datetime, datetime]:
    end = to_at or datetime.now(UTC)
    start = from_at or end - DEFAULT_WINDOW
    if (
        start.tzinfo is None
        or end.tzinfo is None
        or start >= end
        or end - start > MAX_WINDOW
    ):
        raise ApiError(400, error_code)
    return start.astimezone(UTC), end.astimezone(UTC)


def _query_logs(
    *,
    client: LokiClient,
    environment: str,
    log_type: str,
    from_at: datetime | None,
    to_at: datetime | None,
    filters: dict[str, str | None],
    keyword: str | None,
    cursor: str | None,
    limit: int,
    error_code: str,
) -> LogListResponse:
    start, end = _window(from_at, to_at, error_code=error_code)
    try:
        result = client.query_logs(
            environment=environment,
            log_type=log_type,
            start_ns=int(start.timestamp() * 1_000_000_000),
            end_ns=int(end.timestamp() * 1_000_000_000) - 1,
            filters={key: value for key, value in filters.items() if value is not None},
            keyword=keyword,
            cursor=cursor,
            limit=limit,
        )
        return LogListResponse.model_validate(result)
    except InvalidLogCursorError as error:
        raise ApiError(400, error_code) from error
    except LokiUnavailableError as error:
        raise ApiError(503, "LOG_QUERY_UNAVAILABLE") from error


@router.post(
    "/observability/client-events",
    response_model=AcceptedResponse,
    status_code=202,
)
def report_client_event(
    payload: ClientLogEventRequest,
    request: Request,
    user: User = Depends(get_current_user),
    emitter: StructuredLogEmitter = Depends(get_emitter),
) -> AcceptedResponse:
    recorded, event = emitter.emit(
        log_type="system",
        level="ERROR",
        logger="linkcv.web",
        message=payload.message,
        source="web",
        actor_user_id=user.id,
        error_code=payload.event_type.upper(),
        exception_type=payload.error_name,
        exception_stack=payload.stack,
        request_id=payload.request_id or request.state.request_id,
    )
    if not recorded:
        raise ApiError(503, "LOG_EVENT_UNAVAILABLE")
    return AcceptedResponse(event_id=str(event["event_id"]))


@router.post("/audit/events", response_model=AcceptedResponse, status_code=202)
def report_audit_event(
    payload: AuditEventRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    emitter: StructuredLogEmitter = Depends(get_emitter),
) -> AcceptedResponse:
    if payload.action not in AUDIT_ACTION_NAMES_WITH_CLIENT:
        raise ApiError(400, "INVALID_AUDIT_EVENT")
    resume = find_owned_resume(db, payload.target_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    recorded, event_id = emitter.audit(
        action=payload.action,
        actor_user_id=user.id,
        actor_type="user",
        target_type=payload.target_type,
        target_id=str(resume.id),
        result=payload.result,
        error_code=payload.error_code,
        source="web",
        http_method=request.method,
        http_route="/api/audit/events",
    )
    if not recorded:
        raise ApiError(503, "AUDIT_EVENT_UNAVAILABLE")
    return AcceptedResponse(event_id=event_id)


@router.get("/admin/logs/system", response_model=LogListResponse)
def list_system_logs(
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] | None = None,
    source: Literal["backend", "web"] | None = None,
    dependency: Literal["mysql", "redis", "minio", "linkparse", "llm"] | None = None,
    request_id: str | None = Query(default=None, alias="requestId", max_length=64),
    task_id: str | None = Query(default=None, alias="taskId", max_length=128),
    operation_id: str | None = Query(default=None, alias="operationId", max_length=128),
    error_code: str | None = Query(default=None, alias="errorCode", max_length=64),
    keyword: str | None = Query(default=None, max_length=200),
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: User = Depends(get_current_admin),
    settings=Depends(get_settings),
    client: LokiClient = Depends(get_loki),
) -> LogListResponse:
    return _query_logs(
        client=client,
        environment=settings.app_environment,
        log_type="system",
        from_at=from_at,
        to_at=to_at,
        filters={
            "level": level,
            "source": source,
            "dependency": dependency,
            "request_id": request_id,
            "task_id": task_id,
            "operation_id": operation_id,
            "error_code": error_code,
        },
        keyword=keyword,
        cursor=cursor,
        limit=limit,
        error_code="INVALID_SYSTEM_LOG_QUERY",
    )


@router.get("/admin/logs/audit", response_model=LogListResponse)
def list_audit_logs(
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    action: str | None = Query(default=None, max_length=128),
    actor_user_id: str | None = Query(default=None, alias="actorUserId", max_length=32),
    target_type: str | None = Query(default=None, alias="targetType", max_length=64),
    target_id: str | None = Query(default=None, alias="targetId", max_length=128),
    result: Literal["succeeded", "failed"] | None = None,
    request_id: str | None = Query(default=None, alias="requestId", max_length=64),
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: User = Depends(get_current_admin),
    settings=Depends(get_settings),
    client: LokiClient = Depends(get_loki),
) -> LogListResponse:
    if action is not None and action not in AUDIT_ACTION_NAMES_WITH_CLIENT:
        raise ApiError(400, "INVALID_AUDIT_LOG_QUERY")
    return _query_logs(
        client=client,
        environment=settings.app_environment,
        log_type="audit",
        from_at=from_at,
        to_at=to_at,
        filters={
            "action": action,
            "actor_user_id": actor_user_id,
            "target_type": target_type,
            "target_id": target_id,
            "result": result,
            "request_id": request_id,
        },
        keyword=None,
        cursor=cursor,
        limit=limit,
        error_code="INVALID_AUDIT_LOG_QUERY",
    )


@router.get("/admin/logs/summary", response_model=LogSummaryResponse)
def log_summary(
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    _admin: User = Depends(get_current_admin),
    settings=Depends(get_settings),
    client: LokiClient = Depends(get_loki),
) -> LogSummaryResponse:
    start, end = _window(from_at, to_at, error_code="INVALID_LOG_SUMMARY_QUERY")
    try:
        return LogSummaryResponse.model_validate(
            client.query_summary(
                environment=settings.app_environment,
                start=start,
                end=end,
            )
        )
    except LokiUnavailableError as error:
        raise ApiError(503, "LOG_QUERY_UNAVAILABLE") from error
