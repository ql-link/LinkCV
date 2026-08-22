from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.modules.agent.models import AgentMessage, AgentRun, AgentSession, ResumeChangeProposal
from linkcv.modules.agent.pi_client import (
    cancel_pi_run,
    check_pi_readiness,
    sse_event,
    stream_pi_run,
)
from linkcv.modules.agent.schemas import (
    AgentReadinessResponse,
    MessageCreateRequest,
    ProposalListResponse,
    ProposalResponse,
    RunResponse,
    SessionCreateRequest,
    SessionListResponse,
    SessionResponse,
)
from linkcv.modules.agent.service import (
    confirm_proposal,
    create_run,
    create_session,
    get_owned_session,
    proposal_record,
    reject_proposal,
    session_record,
)
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.routes import resume_record
from linkcv.modules.resumes.schemas import ResumeResponse

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/readiness", response_model=AgentReadinessResponse)
async def get_agent_readiness(request: Request) -> AgentReadinessResponse:
    await check_pi_readiness(request.app)
    return AgentReadinessResponse(ready=True)


@router.get("/proposals", response_model=ProposalListResponse)
def list_agent_proposals(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProposalListResponse:
    if not resume_id.isascii() or not resume_id.isdecimal():
        raise ApiError(404, "RESUME_NOT_FOUND")
    rows = db.execute(
        select(ResumeChangeProposal, AgentRun)
        .join(AgentRun, AgentRun.id == ResumeChangeProposal.run_id)
        .where(
            ResumeChangeProposal.resume_id == int(resume_id),
            ResumeChangeProposal.user_id == user.id,
            ResumeChangeProposal.status == "pending",
        )
        .order_by(ResumeChangeProposal.created_at.desc())
        .limit(20)
    ).all()
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
                resume_id=payload.resume_id,
                title=payload.title,
            )
        )
    )


@router.get("/sessions", response_model=SessionListResponse)
def list_agent_sessions(
    resume_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionListResponse:
    query = select(AgentSession).where(AgentSession.user_id == user.id)
    if resume_id is not None:
        if not resume_id.isascii() or not resume_id.isdecimal():
            raise ApiError(404, "RESUME_NOT_FOUND")
        query = query.where(AgentSession.resume_id == int(resume_id))
    records = db.scalars(
        query.order_by(AgentSession.updated_at.desc(), AgentSession.id.desc()).limit(50)
    ).all()
    return SessionListResponse(sessions=[session_record(item) for item in records])


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


@router.post("/sessions/{session_id}/messages")
def send_agent_message(
    session_id: str,
    payload: MessageCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    session = get_owned_session(db, session_id, user.id)
    if session.status != "active":
        raise ApiError(409, "AGENT_SESSION_ARCHIVED")
    run, created = create_run(
        db,
        session=session,
        content=payload.content,
        idempotency_key=payload.idempotency_key,
        timeout_seconds=request.app.state.settings.agent_run_timeout_seconds,
    )
    if not created:
        async def replay():
            event_status = "completed" if run.status == "succeeded" else run.status
            payload: dict[str, object] = {"runId": run.public_id, "replayed": True}
            if run.status == "running":
                event_status = "failed"
                payload["error"] = "AGENT_RUN_IN_PROGRESS"
            yield sse_event(
                f"run.{event_status}", payload
            )
        return StreamingResponse(replay(), media_type="text/event-stream")
    return StreamingResponse(
        stream_pi_run(request.app, run.public_id, payload.content.strip()),
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
) -> ResumeResponse:
    _, resume = confirm_proposal(
        db,
        public_id=proposal_id,
        user_id=user.id,
        version_limit=request.app.state.settings.resume_version_limit,
    )
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
