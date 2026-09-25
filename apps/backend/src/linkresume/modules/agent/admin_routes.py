"""Read-only administrator view of content-free Agent execution traces."""

from __future__ import annotations

import base64
import binascii
import json
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, case, func, literal, or_, select, union_all
from sqlalchemy.orm import Session

from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.modules.agent.models import (
    AgentOperation,
    AgentRun,
    AgentSession,
    AgentStageEvent,
    AgentToolCall,
    ResumeChangeProposal,
)
from linkresume.modules.identity.dependencies import get_current_admin
from linkresume.modules.identity.models import User

router = APIRouter(prefix="/admin/agent-operations", tags=["admin-agent"])
MAX_WINDOW = timedelta(days=31)


def _encode_cursor(created_at: datetime, source: int, row_id: int) -> str:
    raw = json.dumps([created_at.isoformat(), source, row_id], separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, int, int]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        values = json.loads(raw)
        if (not isinstance(values, list) or len(values) != 3
                or values[1] not in (0, 1) or not isinstance(values[2], int)):
            raise ValueError
        at = datetime.fromisoformat(values[0])
        if at.tzinfo is None or values[2] < 0:
            raise ValueError
        return at, values[1], values[2]
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error) as error:
        raise ApiError(400, "INVALID_AGENT_TRACE_QUERY") from error


@router.get("")
def list_agent_operations(
    from_at: datetime | None = Query(default=None, alias="from"),
    to_at: datetime | None = Query(default=None, alias="to"),
    status: Literal["preflighting", "running", "succeeded", "failed", "cancelled"] | None = None,
    error_code: str | None = Query(default=None, alias="errorCode", max_length=64),
    cursor: str | None = Query(default=None, max_length=256),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> dict[str, object]:
    end = to_at or datetime.now(UTC)
    start = from_at or end - MAX_WINDOW
    if (start.tzinfo is None or end.tzinfo is None or start >= end
            or end - start > MAX_WINDOW):
        raise ApiError(400, "INVALID_AGENT_TRACE_QUERY")

    op_status = case(
        (AgentRun.id.is_not(None), AgentRun.status),
        (AgentOperation.state == "failed", literal("failed")),
        else_=literal("preflighting"),
    )
    new_rows = (
        select(
            literal(1).label("source"), AgentOperation.id.label("row_id"),
            AgentOperation.public_id.label("public_id"),
            AgentSession.user_id.label("user_id"),
            AgentOperation.created_at.label("created_at"),
            op_status.label("status"),
            func.coalesce(AgentRun.error_code, AgentOperation.error_code).label("error_code"),
            AgentOperation.failure_stage.label("failure_stage"),
            AgentRun.model_name.label("model_name"),
        )
        .join(AgentSession, AgentSession.id == AgentOperation.session_id)
        .outerjoin(AgentRun, AgentRun.public_id == AgentOperation.public_id)
    )
    old_rows = (
        select(
            literal(0).label("source"), AgentRun.id.label("row_id"),
            AgentRun.public_id.label("public_id"),
            AgentSession.user_id.label("user_id"),
            AgentRun.created_at.label("created_at"),
            AgentRun.status.label("status"),
            AgentRun.error_code.label("error_code"),
            literal(None).label("failure_stage"),
            AgentRun.model_name.label("model_name"),
        )
        .join(AgentSession, AgentSession.id == AgentRun.session_id)
        .outerjoin(AgentOperation, AgentOperation.public_id == AgentRun.public_id)
        .where(AgentOperation.id.is_(None))
    )
    rows = union_all(new_rows, old_rows).subquery()
    query = select(rows).where(rows.c.created_at >= start, rows.c.created_at <= end)
    if status is not None:
        query = query.where(rows.c.status == status)
    if error_code is not None:
        query = query.where(rows.c.error_code == error_code)
    if cursor is not None:
        at, source, row_id = _decode_cursor(cursor)
        query = query.where(or_(
            rows.c.created_at < at,
            and_(rows.c.created_at == at, rows.c.source < source),
            and_(rows.c.created_at == at, rows.c.source == source, rows.c.row_id < row_id),
        ))
    found = db.execute(query.order_by(
        rows.c.created_at.desc(), rows.c.source.desc(), rows.c.row_id.desc()
    ).limit(limit + 1)).all()
    items = [
        {
            "id": row.public_id,
            "user_id": str(row.user_id),
            "created_at": row.created_at,
            "status": row.status,
            "error_code": row.error_code,
            "failure_stage": row.failure_stage,
            "model_name": row.model_name,
            "legacy": row.source == 0,
        }
        for row in found[:limit]
    ]
    next_cursor = None
    if len(found) > limit:
        last = found[limit - 1]
        next_cursor = _encode_cursor(last.created_at, last.source, last.row_id)
    return {"items": items, "next_cursor": next_cursor}


@router.get("/{operation_id}")
def get_agent_operation(
    operation_id: str,
    cursor: int | None = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
) -> dict[str, object]:
    operation = db.scalar(select(AgentOperation).where(AgentOperation.public_id == operation_id))
    run = db.scalar(select(AgentRun).where(AgentRun.public_id == operation_id))
    if operation is None and run is None:
        raise ApiError(404, "AGENT_OPERATION_NOT_FOUND")
    session_id = operation.session_id if operation is not None else run.session_id
    session = db.get(AgentSession, session_id)
    if session is None:
        raise ApiError(404, "AGENT_OPERATION_NOT_FOUND")
    events: list[AgentStageEvent] = []
    next_cursor = None
    if operation is not None:
        query = select(AgentStageEvent).where(AgentStageEvent.agent_operation_id == operation.id)
        if cursor is not None:
            query = query.where(AgentStageEvent.id > cursor)
        found = list(db.scalars(query.order_by(AgentStageEvent.id).limit(limit + 1)).all())
        events = found[:limit]
        if len(found) > limit:
            next_cursor = events[-1].id
    tools = list(db.scalars(select(AgentToolCall).where(
        AgentToolCall.run_id == run.id
    ).order_by(AgentToolCall.id)).all()) if run else []
    proposals = list(db.scalars(select(ResumeChangeProposal).where(
        ResumeChangeProposal.run_id == run.id
    ).order_by(ResumeChangeProposal.id)).all()) if run else []
    terminal = bool(operation and db.scalar(select(AgentStageEvent.id).where(
        AgentStageEvent.agent_operation_id == operation.id,
        AgentStageEvent.stage == "run_finalize",
        AgentStageEvent.result.in_(("succeeded", "failed", "cancelled")),
    ).limit(1)))
    pre_run_failure = bool(operation and db.scalar(select(AgentStageEvent.id).where(
        AgentStageEvent.agent_operation_id == operation.id,
        AgentStageEvent.stage.in_(("context_preflight", "run_creation")),
        AgentStageEvent.result == "failed",
    ).limit(1)))
    timeline_status = (
        "legacy" if operation is None else
        "complete" if (terminal or (run is None and pre_run_failure))
        and next_cursor is None else "incomplete"
    )
    gap_reason = None
    if timeline_status == "incomplete":
        gap_reason = (
            "events_remaining" if next_cursor is not None else
            "run_not_created" if run is None else
            "run_in_progress" if run.status == "running" else
            "terminal_missing"
        )
    proposal_ids = {item.id: item.public_id for item in proposals}
    return {
        "id": operation_id,
        "user_id": str(session.user_id),
        "status": run.status if run else operation.state,
        "error_code": run.error_code if run else operation.error_code,
        "failure_stage": operation.failure_stage if operation else None,
        "model_name": run.model_name if run else None,
        "timeline_status": timeline_status,
        "gap_reason": gap_reason,
        "events": [{
            "id": str(item.id), "stage": item.stage, "result": item.result,
            "error_code": item.error_code, "duration_ms": item.duration_ms,
            "tool_call_key": item.tool_call_key,
            "proposal_id": proposal_ids.get(item.proposal_id),
            "occurred_at": item.occurred_at,
        } for item in events],
        "next_cursor": str(next_cursor) if next_cursor else None,
        "tools": [{
            "call_key": item.call_key, "tool_name": item.tool_name,
            "status": item.status, "error_code": item.error_code,
            "duration_ms": item.duration_ms,
        } for item in tools],
        "proposals": [{
            "id": item.public_id, "status": item.status,
            "created_at": item.created_at, "applied_at": item.applied_at,
        } for item in proposals],
    }
