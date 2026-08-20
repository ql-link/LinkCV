from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.modules.agent.models import AgentRun
from linkcv.modules.agent.schemas import (
    AgentReadinessResponse,
    ProposalCreateRequest,
    ProposalResponse,
    ResumeContextResponse,
    RuntimeConfigResponse,
    ToolEventRequest,
)
from linkcv.modules.agent.security import require_pi_service
from linkcv.modules.agent.service import (
    create_proposal,
    get_active_run,
    proposal_record,
    upsert_tool_event,
)
from linkcv.modules.llm.service import LLMError, LLMService
from linkcv.modules.resumes.models import Resume

router = APIRouter(
    prefix="/internal/agent",
    tags=["internal-agent"],
    dependencies=[Depends(require_pi_service)],
    include_in_schema=False,
)

PI_PROVIDER_BY_ADAPTER = {
    "openai": "openai",
    "anthropic": "anthropic",
    "deepseek": "deepseek",
    "openrouter": "openrouter",
    "gemini": "google",
    "xai": "xai",
    "groq": "groq",
    "mistral": "mistral",
}


@router.get("/readiness", response_model=AgentReadinessResponse)
async def get_internal_agent_readiness(request: Request) -> AgentReadinessResponse:
    llm_service: LLMService = request.app.state.llm_service
    try:
        config = await llm_service.agent_runtime_model()
    except LLMError as error:
        raise ApiError(503, "AGENT_NOT_READY") from error
    if PI_PROVIDER_BY_ADAPTER.get(config.adapter) is None:
        raise ApiError(503, "AGENT_NOT_READY")
    return AgentReadinessResponse(ready=True)


@router.get("/runtime-config", response_model=RuntimeConfigResponse)
async def get_runtime_config(
    run_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> RuntimeConfigResponse:
    run, _ = get_active_run(db, run_id)
    llm_service: LLMService = request.app.state.llm_service
    try:
        config = await llm_service.agent_runtime_model()
    except LLMError as error:
        raise ApiError(503, error.code) from error
    provider = PI_PROVIDER_BY_ADAPTER.get(config.adapter)
    if provider is None:
        raise ApiError(503, "AGENT_MODEL_UNSUPPORTED")
    run.model_config_id = config.id
    run.model_config_version = config.config_version
    db.commit()
    return RuntimeConfigResponse(
        provider=provider,
        model=config.model_call_name,
        api_base=config.api_base,
        api_key=config.api_key,
        config_id=str(config.id),
        config_version=config.config_version,
    )


@router.get("/runs/{run_id}/context", response_model=ResumeContextResponse)
def get_run_context(
    run_id: str, db: Session = Depends(get_db)
) -> ResumeContextResponse:
    _, session = get_active_run(db, run_id)
    if session.resume_id is None:
        raise ApiError(409, "AGENT_RESUME_REQUIRED")
    resume = db.scalar(
        select(Resume).where(
            Resume.id == session.resume_id, Resume.user_id == session.user_id
        )
    )
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
    return ResumeContextResponse(
        run_id=run_id,
        resume_id=str(resume.id),
        title=resume.title,
        lock_version=resume.lock_version,
        data=snapshot.data,
        style=snapshot.style,
    )


@router.post("/runs/{run_id}/proposals", response_model=ProposalResponse, status_code=201)
def create_run_proposal(
    run_id: str,
    payload: ProposalCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ProposalResponse:
    run, session = get_active_run(db, run_id)
    proposal = create_proposal(
        db,
        run=run,
        session=session,
        call_key=payload.call_key,
        data=payload.data,
        style=payload.style,
        summary=payload.summary,
        ttl_days=request.app.state.settings.agent_proposal_ttl_days,
    )
    return ProposalResponse(proposal=proposal_record(proposal, run.public_id))


@router.post("/runs/{run_id}/tool-events", status_code=204)
def record_tool_event(
    run_id: str,
    payload: ToolEventRequest,
    db: Session = Depends(get_db),
) -> None:
    run, _ = get_active_run(db, run_id)
    upsert_tool_event(db, run=run, payload=payload)
