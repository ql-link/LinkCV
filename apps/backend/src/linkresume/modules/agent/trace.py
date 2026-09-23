"""Durable, content-free Agent execution trace."""

from __future__ import annotations

import re
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.agent.models import AgentOperation, AgentStageEvent

STAGES = frozenset({
    "context_preflight", "run_creation", "pi_dispatch", "context_loading",
    "target_resolution", "scope_read", "diagnosis", "proposal_creation",
    "model_execution", "stream_terminal", "run_finalize", "proposal_confirmation",
})
RESULTS = frozenset({"started", "succeeded", "failed", "cancelled"})
SAFE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")

TOOL_STAGES = {
    "list_user_resources": "context_loading",
    "resolve_resume_reference": "target_resolution",
    "resolve_resume_target": "target_resolution",
    "get_resume_context": "scope_read",
    "search_resume_materials": "scope_read",
    "analyze_resume_content": "diagnosis",
    "create_resume_change_proposal": "proposal_creation",
    "create_resume_proposal": "proposal_creation",
    "execute_local_resume_edit_plan": "proposal_creation",
    "create_resume_translation_proposal": "proposal_creation",
    "request_user_input": "model_execution",
}


def event_key(*parts: object) -> str:
    """Bounded deterministic key; never persist the raw source parts."""
    return str(uuid5(NAMESPACE_URL, "linkresume:agent-event:" + ":".join(map(str, parts))))


def record_event(
    db: Session,
    operation: AgentOperation,
    *,
    key: str,
    stage: str,
    result: str,
    error_code: str | None = None,
    duration_ms: int | None = None,
    tool_call_key: str | None = None,
    proposal_id: int | None = None,
) -> AgentStageEvent:
    if stage not in STAGES or result not in RESULTS:
        raise ValueError("invalid agent trace stage or result")
    if error_code is not None and not SAFE_CODE.fullmatch(error_code):
        raise ValueError("invalid agent trace error code")
    if duration_ms is not None and duration_ms < 0:
        raise ValueError("invalid agent trace duration")
    if len(key) > 160 or not key:
        raise ValueError("invalid agent trace event key")
    existing = db.scalar(select(AgentStageEvent).where(
        AgentStageEvent.agent_operation_id == operation.id,
        AgentStageEvent.event_key == key,
    ))
    if existing is not None:
        if (
            existing.stage != stage or existing.result != result
            or existing.error_code != error_code
            or existing.tool_call_key != tool_call_key
            or existing.proposal_id != proposal_id
        ):
            raise ApiError(409, "AGENT_TRACE_EVENT_CONFLICT")
        return existing
    row = AgentStageEvent(
        agent_operation_id=operation.id,
        event_key=key,
        stage=stage,
        result=result,
        error_code=error_code,
        duration_ms=duration_ms,
        tool_call_key=tool_call_key,
        proposal_id=proposal_id,
        occurred_at=utc_now(),
    )
    db.add(row)
    return row


def operation_for_run(db: Session, run_public_id: str) -> AgentOperation | None:
    return db.scalar(select(AgentOperation).where(AgentOperation.public_id == run_public_id))


def begin_operation(
    db: Session, *, public_id: str, session_id: int, request_id: str
) -> AgentOperation:
    row = operation_for_run(db, public_id)
    if row is None:
        row = AgentOperation(
            public_id=public_id, session_id=session_id, state="preflighting",
            created_at=utc_now(),
        )
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            row = operation_for_run(db, public_id)
            if row is None:
                raise
    if row.session_id != session_id or row.state == "run_created":
        raise ApiError(409, "AGENT_TRACE_OPERATION_CONFLICT")
    row.state = "preflighting"
    row.error_code = None
    row.failure_stage = None
    record_event(db, row, key=event_key(request_id, "preflight", "started"),
                 stage="context_preflight", result="started")
    db.commit()
    return row


def finish_preflight(
    db: Session, operation: AgentOperation, *, request_id: str,
    error_code: str | None = None,
) -> None:
    result = "failed" if error_code else "succeeded"
    record_event(db, operation,
                 key=event_key(request_id, "preflight", result),
                 stage="context_preflight", result=result, error_code=error_code)
    if error_code:
        operation.state = "failed"
        operation.error_code = error_code
        operation.failure_stage = "context_preflight"
    db.commit()


def fail_run_creation(
    db: Session, operation: AgentOperation, *, request_id: str, error_code: str
) -> None:
    record_event(db, operation, key=event_key(request_id, "run_creation", "failed"),
                 stage="run_creation", result="failed", error_code=error_code)
    operation.state = "failed"
    operation.error_code = error_code
    operation.failure_stage = "run_creation"
    db.commit()
