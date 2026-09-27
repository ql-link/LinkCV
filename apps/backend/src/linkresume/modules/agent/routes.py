from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from linkresume.core.database import get_db, utc_now
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.modules.agent.context_service import list_contexts, resolve_contexts
from linkresume.modules.agent.models import (
    AgentMessage,
    AgentRun,
    AgentSession,
    ResumeChangeProposal,
)
from linkresume.modules.agent.pi_client import (
    cancel_pi_run,
    check_pi_readiness,
    sse_event,
    stream_pi_run,
)
from linkresume.modules.agent.schemas import (
    ActiveRunRecord,
    ActiveRunResponse,
    AgentContextRef,
    AgentContextListResponse,
    AgentModelResponse,
    AgentReadinessResponse,
    MessageCreateRequest,
    ProposalListResponse,
    ProposalResponse,
    RunResponse,
    SessionCreateRequest,
    SessionListResponse,
    SessionResponse,
    SessionUpdateRequest,
)
from linkresume.modules.agent.run_stream import get_agent_run_stream_hub
from linkresume.modules.agent.trace import (
    begin_operation, event_key, fail_run_creation, finish_preflight,
    operation_for_run, record_event,
)
from linkresume.modules.agent.service import (
    clarification_context_state,
    confirm_proposal,
    create_run,
    create_session,
    delete_session,
    get_owned_session,
    proposal_record,
    revision_source,
    reject_proposal,
    session_record,
    update_session,
)
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User
from linkresume.modules.llm.service import LLMError
from linkresume.modules.resumes.routes import resume_record
from linkresume.modules.resumes.pdf_service import (
    clone_resume_private_assets,
    validate_resume_pdf_asset_contract,
)
from linkresume.modules.resumes.schemas import ResumeResponse


def _merge_message_contexts(
    explicit: list[AgentContextRef] | None,
    inherited: list[AgentContextRef],
    *,
    replace_inherited_resume: bool = False,
) -> list[AgentContextRef]:
    if replace_inherited_resume and not any(
        item.type == "resume" for item in explicit or []
    ):
        raise ApiError(422, "AGENT_RESUME_REQUIRED")
    merged = {item.type: item for item in inherited}
    for item in explicit or []:
        inherited_item = merged.get(item.type)
        if inherited_item is not None and (
            inherited_item.id != item.id
            or inherited_item.version_id != item.version_id
        ):
            if not (replace_inherited_resume and item.type == "resume"):
                raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_CONFLICT")
        if inherited_item is None or (replace_inherited_resume and item.type == "resume"):
            merged[item.type] = item
    return list(merged.values())


def _message_operation_id(session: AgentSession, idempotency_key: str) -> str:
    """Keep concurrent retries on the same observable operation chain."""

    return str(
        uuid5(
            NAMESPACE_URL,
            f"linkresume:agent-message:{session.public_id}:{idempotency_key}",
        )
    )


router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/readiness", response_model=AgentReadinessResponse)
async def get_agent_readiness(request: Request) -> AgentReadinessResponse:
    await check_pi_readiness(request.app)
    return AgentReadinessResponse(ready=True)


@router.get("/model", response_model=AgentModelResponse)
async def get_agent_model(
    request: Request,
    _user: User = Depends(get_current_user),
) -> AgentModelResponse:
    llm_service = request.app.state.llm_service
    try:
        model = await llm_service.agent_model_summary()
    except LLMError as error:
        raise ApiError(503, error.code) from error
    return AgentModelResponse(model={"provider": model.provider, "name": model.name})


@router.get("/contexts", response_model=AgentContextListResponse)
def list_agent_contexts(
    type: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    search: str | None = Query(default=None, max_length=200),
    prefix: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentContextListResponse:
    return AgentContextListResponse(
        contexts=list_contexts(
            db,
            user_id=user.id,
            context_type=type,
            query=q or search,
            prefix_match=prefix,
            limit=limit,
        )
    )


@router.get("/proposals", response_model=ProposalListResponse)
def list_agent_proposals(
    resume_id: str | None = None,
    session_id: str | None = None,
    include_history: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProposalListResponse:
    if resume_id is None and session_id is None:
        raise ApiError(400, "AGENT_PROPOSAL_SCOPE_REQUIRED")
    if resume_id is not None and (
        not resume_id.isascii() or not resume_id.isdecimal()
    ):
        raise ApiError(404, "RESUME_NOT_FOUND")
    query = (
        select(ResumeChangeProposal, AgentRun)
        .join(AgentRun, AgentRun.id == ResumeChangeProposal.run_id)
        .where(
            ResumeChangeProposal.user_id == user.id,
        )
        .order_by(ResumeChangeProposal.created_at.desc())
        .limit(200 if include_history else 20)
    )
    if not include_history:
        query = query.where(ResumeChangeProposal.status == "pending")
    if resume_id is not None:
        query = query.where(ResumeChangeProposal.resume_id == int(resume_id))
    if session_id is not None:
        session = get_owned_session(db, session_id, user.id)
        query = query.where(AgentRun.session_id == session.id)
    rows = db.execute(query).all()
    return ProposalListResponse(
        proposals=[proposal_record(proposal, run.public_id) for proposal, run in rows]
    )


@router.post("/sessions", response_model=SessionResponse, status_code=201)
def create_agent_session(
    payload: SessionCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionResponse:
    return SessionResponse(
        session=session_record(
            create_session(
                db,
                user_id=user.id,
                title=payload.title,
            )
        )
    )


@router.get("/sessions", response_model=SessionListResponse)
def list_agent_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionListResponse:
    query = select(AgentSession).where(AgentSession.user_id == user.id)
    records = db.scalars(
        query.order_by(
            AgentSession.pinned.desc(),
            AgentSession.updated_at.desc(),
            AgentSession.id.desc(),
        ).limit(50)
    ).all()
    return SessionListResponse(sessions=[session_record(item) for item in records])


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
def update_agent_session(
    session_id: str,
    payload: SessionUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionResponse:
    return SessionResponse(
        session=session_record(
            update_session(
                db,
                public_id=session_id,
                user_id=user.id,
                fields=payload.model_fields_set,
                title=payload.title,
                pinned=payload.pinned,
            )
        )
    )


@router.delete("/sessions/{session_id}", status_code=204)
def delete_agent_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    delete_session(db, public_id=session_id, user_id=user.id)
    return Response(status_code=204)


@router.get("/sessions/{session_id}", response_model=SessionResponse)
def get_agent_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionResponse:
    record = get_owned_session(db, session_id, user.id)
    messages = db.scalars(
        select(AgentMessage)
        .where(AgentMessage.session_id == record.id)
        .order_by(AgentMessage.sequence_no.desc())
        .limit(100)
    ).all()
    return SessionResponse(session=session_record(record, list(reversed(messages))))


@router.get(
    "/sessions/{session_id}/active-run",
    response_model=ActiveRunResponse,
)
def get_active_agent_run(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ActiveRunResponse:
    session = get_owned_session(db, session_id, user.id)
    run = db.scalar(
        select(AgentRun)
        .where(AgentRun.session_id == session.id, AgentRun.status == "running")
        .order_by(AgentRun.id.desc())
        .limit(1)
    )
    return ActiveRunResponse(
        run=(
            ActiveRunRecord(
                run_id=run.public_id,
                status="running",
                started_at=run.started_at,
            )
            if run is not None
            else None
        )
    )


@router.get("/runs/{run_id}/events")
async def reconnect_agent_run(
    run_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    row = db.execute(
        select(AgentRun, AgentSession)
        .join(AgentSession, AgentSession.id == AgentRun.session_id)
        .where(AgentRun.public_id == run_id, AgentSession.user_id == user.id)
    ).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND")
    run, _ = row
    hub = get_agent_run_stream_hub(request.app)
    if hub.contains(run.public_id):
        return StreamingResponse(
            hub.subscribe(run.public_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    if run.status == "running":
        result = db.execute(
            update(AgentRun)
            .where(AgentRun.id == run.id, AgentRun.status == "running")
            .values(
                status="failed",
                error_code="AGENT_STREAM_INCOMPLETE",
                completed_at=utc_now(),
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()
        if result.rowcount:
            event_status = "failed"
            event_payload = {
                "runId": run.public_id,
                "error": "AGENT_STREAM_INCOMPLETE",
            }
        else:
            db.refresh(run)
            event_status = "completed" if run.status == "succeeded" else run.status
            event_payload = {"runId": run.public_id, "replayed": True}
    else:
        event_status = "completed" if run.status == "succeeded" else run.status
        event_payload = {"runId": run.public_id, "replayed": True}

    async def replay_terminal():
        yield sse_event(f"run.{event_status}", event_payload)

    return StreamingResponse(replay_terminal(), media_type="text/event-stream")


@router.post("/sessions/{session_id}/messages")
async def send_agent_message(
    session_id: str,
    payload: MessageCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    session = get_owned_session(db, session_id, user.id)
    if session.status != "active":
        raise ApiError(409, "AGENT_SESSION_ARCHIVED")
    # Idempotent retries must replay the original run even if one of the
    # referenced records has since changed or been removed.  The session was
    # already resolved through the authenticated owner, and create_run keeps
    # the locked second lookup for the concurrent-create race.
    existing_run = db.scalar(
        select(AgentRun).where(
            AgentRun.session_id == session.id,
            AgentRun.idempotency_key == payload.idempotency_key,
        )
    )
    operation_id = (
        existing_run.public_id
        if existing_run is not None
        else _message_operation_id(session, payload.idempotency_key)
    )
    request.state.operation_id = operation_id
    resolved_contexts = None
    resolved_selection = payload.selection_context
    trace_operation = None
    if existing_run is None:
        trace_operation = begin_operation(
            db, public_id=operation_id, session_id=session.id,
            request_id=request.state.request_id,
        )
        request.app.state.event_emitter.system(
            "INFO",
            "agent context preflight",
            logger="linkresume.agent",
            actor_user_id=user.id,
            operation_id=operation_id,
            action="send_agent_message",
            stage="context_preflight",
            result="started",
            scope=(
                "clarification_reply"
                if payload.reply_to_sequence_no is not None
                else "message"
            ),
            selection_present=payload.selection_context is not None,
        )
        try:
            inherited_contexts, inherited_selection = clarification_context_state(
                db,
                session=session,
                reply_to_sequence_no=payload.reply_to_sequence_no,
            )
            if payload.replace_inherited_resume and payload.reply_to_sequence_no is None:
                raise ApiError(422, "AGENT_CLARIFICATION_INVALID")
            inherited_resume = next(
                (item for item in inherited_contexts if item.type == "resume"), None
            )
            explicit_resume = next(
                (item for item in payload.contexts or [] if item.type == "resume"), None
            )
            resume_switched = bool(
                payload.replace_inherited_resume
                and inherited_resume is not None
                and explicit_resume is not None
                and inherited_resume.id != explicit_resume.id
            )
            if (
                inherited_selection is not None and not resume_switched
                and payload.selection_context is not None
                and inherited_selection != payload.selection_context
            ):
                raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_CONFLICT")
            resolved_selection = (
                payload.selection_context if resume_switched
                else inherited_selection or payload.selection_context
            )
            context_refs = _merge_message_contexts(
                payload.contexts, inherited_contexts,
                replace_inherited_resume=payload.replace_inherited_resume,
            )
            if payload.revision_proposal_id:
                source = revision_source(db, session, payload.revision_proposal_id)
                context_refs = [AgentContextRef(type="resume", id=str(source.resume_id)),
                                *(item for item in context_refs if item.type != "resume")]
                resolved_selection = None
            if resolved_selection is not None and not any(
                item.type == "resume" for item in context_refs
            ):
                raise ApiError(422, "AGENT_RESUME_REQUIRED")
            resolved_contexts = resolve_contexts(
                db,
                user_id=user.id,
                refs=context_refs,
                storage=request.app.state.storage,
                settings=request.app.state.settings,
            )
        except Exception as error:
            public_error = isinstance(error, ApiError)
            db.rollback()
            trace_operation = begin_operation(
                db, public_id=operation_id, session_id=session.id,
                request_id=request.state.request_id,
            )
            finish_preflight(
                db, trace_operation, request_id=request.state.request_id,
                error_code=error.code if public_error else "AGENT_CONTEXT_PREFLIGHT_FAILED",
            )
            request.app.state.event_emitter.system(
                "WARNING" if public_error else "ERROR",
                "agent context preflight",
                logger="linkresume.agent",
                actor_user_id=user.id,
                operation_id=operation_id,
                action="send_agent_message",
                stage="context_preflight",
                result="failed",
                error_code=(
                    error.code if public_error else "AGENT_CONTEXT_PREFLIGHT_FAILED"
                ),
                exception_type=None if public_error else type(error).__name__,
                scope=(
                    "clarification_reply"
                    if payload.reply_to_sequence_no is not None
                    else "message"
                ),
                selection_present=payload.selection_context is not None,
            )
            raise
        finish_preflight(db, trace_operation, request_id=request.state.request_id)
        request.app.state.event_emitter.system(
            "INFO",
            "agent context preflight",
            logger="linkresume.agent",
            actor_user_id=user.id,
            operation_id=operation_id,
            action="send_agent_message",
            stage="context_preflight",
            result="succeeded",
            scope=(
                "clarification_reply"
                if payload.reply_to_sequence_no is not None
                else "message"
            ),
            selection_present=payload.selection_context is not None,
            candidate_count=len(resolved_contexts.snapshots),
        )
    try:
        run, created = create_run(
            db,
            session=session,
            content=payload.content,
            idempotency_key=payload.idempotency_key,
            timeout_seconds=request.app.state.settings.agent_run_timeout_seconds,
            public_id=operation_id,
            reply_to_sequence_no=payload.reply_to_sequence_no,
            clarification_answers=payload.clarification_answers,
            context_snapshots=(
                resolved_contexts.snapshots if resolved_contexts else None
            ),
            selection_context=resolved_selection,
            revision_proposal_id=payload.revision_proposal_id,
            operation=trace_operation,
            trace_request_id=request.state.request_id if trace_operation else None,
        )
    except Exception as error:
        public_error = isinstance(error, ApiError)
        if trace_operation is not None:
            db.rollback()
            trace_operation = begin_operation(
                db, public_id=operation_id, session_id=session.id,
                request_id=request.state.request_id,
            )
            fail_run_creation(
                db, trace_operation, request_id=request.state.request_id,
                error_code=error.code if public_error else "AGENT_RUN_CREATION_FAILED",
            )
        request.app.state.event_emitter.system(
            "WARNING" if public_error else "ERROR",
            "agent run creation",
            logger="linkresume.agent",
            actor_user_id=user.id,
            operation_id=operation_id,
            action="send_agent_message",
            stage="run_creation",
            result="failed",
            error_code=error.code if public_error else "AGENT_RUN_CREATION_FAILED",
            exception_type=None if public_error else type(error).__name__,
        )
        raise
    request.state.operation_id = run.public_id
    request.app.state.event_emitter.system(
        "INFO",
        "agent run creation",
        logger="linkresume.agent",
        actor_user_id=user.id,
        operation_id=run.public_id,
        action="send_agent_message",
        stage="run_creation",
        result="created" if created else "replayed",
    )
    if not created:

        async def replay():
            event_status = "completed" if run.status == "succeeded" else run.status
            payload: dict[str, object] = {"runId": run.public_id, "replayed": True}
            if run.status == "running":
                event_status = "failed"
                payload["error"] = "AGENT_RUN_IN_PROGRESS"
            yield sse_event(f"run.{event_status}", payload)

        return StreamingResponse(replay(), media_type="text/event-stream")
    hub = get_agent_run_stream_hub(request.app)
    hub.start(
        run.public_id,
        stream_pi_run(
            request.app,
            run.public_id,
            payload.content.strip(),
            resolved_selection,
            resolved_contexts.materials if resolved_contexts is not None else None,
            actor_user_id=user.id,
        ),
    )
    return StreamingResponse(
        hub.subscribe(run.public_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/runs/{run_id}/cancel", response_model=RunResponse)
async def cancel_agent_run(
    run_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RunResponse:
    row = db.execute(
        select(AgentRun, AgentSession)
        .join(AgentSession, AgentSession.id == AgentRun.session_id)
        .where(AgentRun.public_id == run_id, AgentSession.user_id == user.id)
    ).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND")
    run, _ = row
    if run.status == "running":
        await cancel_pi_run(request.app, run.public_id)
        db.execute(
            update(AgentRun)
            .where(AgentRun.id == run.id, AgentRun.status == "running")
            .values(status="cancelled", completed_at=utc_now())
            .execution_options(synchronize_session=False)
        )
        db.commit()
    current_status = db.scalar(
        select(AgentRun.status)
        .join(AgentSession, AgentSession.id == AgentRun.session_id)
        .where(AgentRun.public_id == run_id, AgentSession.user_id == user.id)
    )
    if current_status is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND")
    return RunResponse(run_id=run.public_id, status=current_status)


@router.post("/proposals/{proposal_id}/confirm", response_model=ResumeResponse)
def confirm_agent_proposal(
    proposal_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> ResumeResponse:
    try:
        _, resume = confirm_proposal(
            db,
            public_id=proposal_id,
            user_id=user.id,
            validate_resume_data=lambda data, resume_id: validate_resume_pdf_asset_contract(
                storage,
                data,
                user_id=user.id,
                resume_id=resume_id,
            ),
            prepare_translation_assets=lambda data, source_resume_id, target_resume_id: clone_resume_private_assets(
                storage,
                data,
                user_id=user.id,
                source_resume_id=source_resume_id,
                target_resume_id=target_resume_id,
            ),
            delete_asset=storage.delete,
            trace_request_id=request.state.request_id,
        )
    except Exception as error:
        db.rollback()
        proposal = db.scalar(select(ResumeChangeProposal).where(
            ResumeChangeProposal.public_id == proposal_id,
            ResumeChangeProposal.user_id == user.id,
        ))
        if proposal is not None:
            source_run = db.get(AgentRun, proposal.run_id)
            operation = operation_for_run(db, source_run.public_id) if source_run else None
            if operation is not None:
                code = error.code if isinstance(error, ApiError) else "AGENT_CONFIRMATION_FAILED"
                record_event(
                    db, operation,
                    key=event_key(request.state.request_id, proposal.public_id, "failed", code),
                    stage="proposal_confirmation", result="failed",
                    proposal_id=proposal.id, error_code=code,
                )
                db.commit()
        raise
    return ResumeResponse(resume=resume_record(resume))


@router.post("/proposals/{proposal_id}/reject", response_model=ProposalResponse)
def reject_agent_proposal(
    proposal_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProposalResponse:
    proposal = reject_proposal(db, public_id=proposal_id, user_id=user.id)
    run = db.get(AgentRun, proposal.run_id)
    assert run is not None
    return ProposalResponse(proposal=proposal_record(proposal, run.public_id))
