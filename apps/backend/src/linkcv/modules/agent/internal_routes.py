from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.modules.agent.schemas import (
    AgentReadinessResponse,
    ContextReadRequest,
    DiagnosisRequest,
    DiagnosisResponse,
    MaterialSearchRequest,
    MaterialSearchResponse,
    ProposalCreateRequest,
    ProposalResponse,
    ProposalV2CreateRequest,
    ResumeContextResponse,
    ScopedResumeContextResponse,
    TargetResolveRequest,
    TargetResolveResponse,
    RuntimeConfigResponse,
    ToolEventRequest,
)
from linkcv.modules.agent.resume_tools import (
    diagnose_content,
    diagnosis_fingerprint,
    resolve_job,
    resolve_target,
    search_materials,
    scoped_blocks,
    target_content,
    validate_source_ids,
)
from linkcv.modules.agent.security import require_pi_service
from linkcv.modules.agent.service import (
    create_proposal,
    create_scoped_proposal,
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


def _run_resume(db: Session, run_id: str) -> tuple[object, object, Resume, object]:
    run, session = get_active_run(db, run_id)
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
    return run, session, resume, snapshot


def _fingerprint_secret(request: Request) -> str:
    configured = request.app.state.settings.linkcv_internal_agent_token
    if configured is None:
        raise ApiError(503, "AGENT_NOT_READY")
    return configured.get_secret_value()


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


@router.post("/runs/{run_id}/targets:resolve", response_model=TargetResolveResponse)
def resolve_run_target(
    run_id: str,
    payload: TargetResolveRequest,
    db: Session = Depends(get_db),
) -> TargetResolveResponse:
    _, _, resume, snapshot = _run_resume(db, run_id)
    return TargetResolveResponse.model_validate(
        resolve_target(
            resume,
            snapshot.data,
            selection_context=payload.selection_context,
            quoted_text=payload.quoted_text,
            scope_hint=payload.scope_hint,
        )
    )


@router.post("/runs/{run_id}/context:read", response_model=ScopedResumeContextResponse)
def read_scoped_run_context(
    run_id: str,
    payload: ContextReadRequest,
    db: Session = Depends(get_db),
) -> ScopedResumeContextResponse:
    _, _, resume, snapshot = _run_resume(db, run_id)
    content = target_content(resume, snapshot.data, payload.target, payload.scope)
    return ScopedResumeContextResponse(
        run_id=run_id,
        resume_id=str(resume.id),
        title=resume.title,
        lock_version=resume.lock_version,
        target=payload.target,
        scope=payload.scope,
        content=content,
        blocks=scoped_blocks(resume, snapshot.data, payload.target, payload.scope),
        data=snapshot.data if payload.scope == "resume" else None,
        style=snapshot.style,
    )


@router.post("/runs/{run_id}/materials:search", response_model=MaterialSearchResponse)
def search_run_materials(
    run_id: str,
    payload: MaterialSearchRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MaterialSearchResponse:
    _, session = get_active_run(db, run_id)
    return MaterialSearchResponse(
        sources=search_materials(
            db,
            user_id=session.user_id,
            query=payload.query,
            types=payload.types,
            limit=payload.limit,
            storage=request.app.state.storage,
            max_bytes=request.app.state.settings.dataset_upload_max_bytes,
        )
    )


@router.post("/runs/{run_id}/diagnoses", response_model=DiagnosisResponse)
def diagnose_run_target(
    run_id: str,
    payload: DiagnosisRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> DiagnosisResponse:
    _, session, resume, snapshot = _run_resume(db, run_id)
    content = target_content(resume, snapshot.data, payload.target, payload.scope)
    source_refs = validate_source_ids(
        db, user_id=session.user_id, source_ids=payload.source_ids
    )
    job = resolve_job(db, user_id=session.user_id, job_id=payload.job_id)
    diagnosis = diagnose_content(content, payload.target.model_dump(mode="json"), job)
    diagnosis["scope"] = payload.scope
    diagnosis["source_refs"] = source_refs
    if job is not None:
        job_ref = f"job:{job.id}:{job.lock_version}"
        diagnosis["job_ref"] = job_ref
        if all(item["source_id"] != job_ref for item in source_refs):
            source_refs.append(
                {
                    "source_id": job_ref,
                    "source_type": "job",
                    "title": f"{job.company_name} · {job.job_title}",
                }
            )
    return DiagnosisResponse(
        diagnosis=diagnosis,
        diagnosis_fingerprint=diagnosis_fingerprint(
            diagnosis, _fingerprint_secret(request)
        ),
    )


@router.post(
    "/runs/{run_id}/proposals", response_model=ProposalResponse, status_code=201
)
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


@router.post(
    "/runs/{run_id}/proposals:v2", response_model=ProposalResponse, status_code=201
)
def create_scoped_run_proposal(
    run_id: str,
    payload: ProposalV2CreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ProposalResponse:
    run, session = get_active_run(db, run_id)
    proposal = create_scoped_proposal(
        db,
        run=run,
        session=session,
        payload=payload,
        ttl_days=request.app.state.settings.agent_proposal_ttl_days,
        fingerprint_secret=_fingerprint_secret(request),
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
