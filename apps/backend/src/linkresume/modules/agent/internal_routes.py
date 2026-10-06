from fastapi import APIRouter, Depends, Request, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import parse_persisted_resume_snapshot
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.storage import get_storage, AssetStorage
from linkresume.modules.agent.message_scope import active_message, source_sequence_no, persist_reply
from linkresume.modules.agent.steering import activate, acknowledge
from linkresume.modules.agent.context_service import list_contexts
from linkresume.modules.agent.schemas import (
    AgentReadinessResponse,
    AgentTaskPlanRequest,
    AgentTaskStatusRequest,
    AgentResourceListRequest,
    AgentResourceListResponse,
    ContextReadRequest,
    DiagnosisRequest,
    DiagnosisResponse,
    MaterialSearchRequest,
    MaterialSearchResponse,
    ProposalCreateRequest,
    ProposalResponse,
    ProposalV2CreateRequest,
    ResumeContextResponse,
    ResumeReferenceResolveRequest,
    ResumeReferenceResolveResponse,
    ResourceReferenceResolveRequest,
    ResourceReferenceResolveResponse,
    RuntimeConfigResponse,
    RuntimeRouteConfig,
    ScopedResumeContextResponse,
    TargetResolveRequest,
    TargetResolveResponse,
    ToolEventRequest,
    TranslationProposalCreateRequest,
    SteeringActivation, SteeringAck, ReplyCompletion, SubmissionReceipt,
)
from linkresume.modules.agent.resume_tools import (
    diagnose_content,
    diagnosis_fingerprint,
    resolve_job,
    resolve_target,
    search_materials,
    scoped_blocks,
    target_content,
    validate_source_ids,
)
from linkresume.modules.agent.security import require_pi_service
from linkresume.modules.agent.models import AgentRun, AgentSession
from linkresume.modules.agent.service import (
    create_proposal,
    create_scoped_proposal,
    create_translation_proposal,
    authorize_resolved_task_resume,
    get_task_materials,
    get_active_run,
    proposal_record,
    resolve_task_resume_reference,
    resolve_task_resource_reference,
    save_task_plan,
    require_task_resource,
    require_task_sources,
    task_authorized_refs,
    update_task_status,
    upsert_tool_event,
)
from linkresume.modules.llm.models import LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute, get_use_case_route
from linkresume.modules.llm.providers import pi_api
from linkresume.modules.llm.resolver import ASSISTANT_CONVERSATION, RoutePlan, resolve_candidates
from linkresume.modules.llm.schemas import PiCallRecord
from linkresume.modules.llm.gateway import GatewayUsage
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.resumes.models import Resume

async def request_scope(x_agent_user_sequence: int | None = Header(default=None)):
    token = source_sequence_no.set(x_agent_user_sequence)
    try:
        yield
    finally:
        source_sequence_no.reset(token)


router = APIRouter(
    prefix="/internal/agent",
    tags=["internal-agent"],
    dependencies=[Depends(require_pi_service), Depends(request_scope)],
    include_in_schema=False,
)


@router.post("/runs/{run_id}/steering:activate")
def activate_steering(run_id: str, payload: SteeringActivation, request: Request,
                      db: Session = Depends(get_db), storage: AssetStorage = Depends(get_storage)):
    return activate(db, run_id, payload, storage=storage, settings=request.app.state.settings)


@router.post("/runs/{run_id}/steering:ack", response_model=SubmissionReceipt)
def ack_steering(run_id: str, payload: SteeringAck, db: Session = Depends(get_db)):
    return acknowledge(db, run_id, payload)


@router.post("/runs/{run_id}/messages:complete")
def complete_reply(run_id: str, payload: ReplyCompletion, db: Session = Depends(get_db)):
    if source_sequence_no.get() != payload.user_sequence_no:
        raise ApiError(409, "AGENT_REQUEST_SCOPE_STALE")
    message = persist_reply(db, run_id, source=payload.user_sequence_no, content=payload.content,
                            clarification=payload.clarification.model_dump(mode="json") if payload.clarification else None)
    return {"sequence_no": message.sequence_no}

def _run_resume(
    db: Session, run_id: str, resume_id: str | None = None
) -> tuple[object, object, Resume, object]:
    run, session = get_active_run(db, run_id)
    if resume_id is None:
        raise ApiError(409, "AGENT_RESUME_REQUIRED")
    if not resume_id.isascii() or not resume_id.isdecimal():
        raise ApiError(404, "RESUME_NOT_FOUND")
    require_task_resource(
        db, run=run, resource_type="resume", resource_id=resume_id,
    )
    resume = db.scalar(
        select(Resume).where(
            Resume.id == int(resume_id), Resume.user_id == session.user_id
        )
    )
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    snapshot = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
    return run, session, resume, snapshot


def _fingerprint_secret(request: Request) -> str:
    configured = request.app.state.settings.linkresume_internal_agent_token
    if configured is None:
        raise ApiError(503, "AGENT_NOT_READY")
    return configured.get_secret_value()


def _model_limit(metadata: dict, key: str) -> int | None:
    value = metadata.get(key)
    return value if type(value) is int and 0 < value <= 10_000_000 else None


@router.get("/readiness", response_model=AgentReadinessResponse)
async def get_internal_agent_readiness(request: Request) -> AgentReadinessResponse:
    llm_service: LLMService = request.app.state.llm_service
    try:
        config = await llm_service.agent_runtime_model()
        pi_api(config.plan.protocol_code)
    except (LLMError, KeyError) as error:
        raise ApiError(503, "AGENT_NOT_READY") from error
    return AgentReadinessResponse(ready=True, steering=True)


@router.get("/runtime-config", response_model=RuntimeConfigResponse)
async def get_runtime_config(
    run_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> RuntimeConfigResponse:
    run, session = get_active_run(db, run_id)
    llm_service: LLMService = request.app.state.llm_service
    if (
        run.resolved_llm_route_id is None or run.resolved_llm_model_id is None
        or run.runtime_config_version is None or run.protocol_code is None
    ):
        raise ApiError(503, "LLM_MODEL_NOT_CONFIGURED")
    route = db.get(LLMModelRoute, run.resolved_llm_route_id)
    connection = db.get(LLMProviderConnection, route.connection_id) if route else None
    model = db.get(LLMModel, run.resolved_llm_model_id)
    if (
        route is None or connection is None or model is None
        or route.model_id != model.id
        or connection.runtime_config_version != run.runtime_config_version
    ):
        raise ApiError(409, "LLM_CONFIG_CHANGED")
    plan = RoutePlan(
        use_case=ASSISTANT_CONVERSATION,
        route_id=route.id,
        model_id=model.id,
        display_name=run.model_name or model.display_name,
        provider_code=connection.provider_code,
        connection_id=connection.id,
        runtime_config_version=run.runtime_config_version,
        target_kind=route.target_kind,
        invoke_target=route.invoke_target,
        protocol_code=run.protocol_code,
        settings=dict(connection.settings_json or {}),
        credential_ciphertext=connection.credential_ciphertext,
        pricing=dict(run.resolved_price_snapshot_json) if run.resolved_price_snapshot_json else None,
        selection_source=run.selection_source or "default",
    )
    try:
        config = llm_service.runtime_model_for_plan(plan)
        api = pi_api(plan.protocol_code)
    except LLMError as error:
        raise ApiError(503, error.code) from error
    primary = RuntimeRouteConfig(
        provider=plan.provider_code,
        api=api,
        model=plan.invoke_target,
        api_base=config.base_url,
        api_key=config.api_key,
        route_id=str(plan.route_id),
        config_version=plan.runtime_config_version,
        pricing=plan.pricing,
        context_window=_model_limit(route.metadata_json or {}, "context_length"),
        max_output_tokens=_model_limit(route.metadata_json or {}, "max_output"),
    )
    routes = [primary]
    for candidate in resolve_candidates(db, ASSISTANT_CONVERSATION, model_id=model.id):
        if candidate.route_id == plan.route_id:
            continue
        try:
            candidate_runtime = llm_service.runtime_model_for_plan(candidate)
            candidate_api = pi_api(candidate.protocol_code)
        except (LLMError, ValueError):
            continue
        candidate_route = db.get(LLMModelRoute, candidate.route_id)
        metadata = candidate_route.metadata_json or {} if candidate_route else {}
        routes.append(RuntimeRouteConfig(
            provider=candidate.provider_code,
            api=candidate_api,
            model=candidate.invoke_target,
            api_base=candidate_runtime.base_url,
            api_key=candidate_runtime.api_key,
            route_id=str(candidate.route_id),
            config_version=candidate.runtime_config_version,
            pricing=candidate.pricing,
            context_window=_model_limit(metadata, "context_length"),
            max_output_tokens=_model_limit(metadata, "max_output"),
        ))
    return RuntimeConfigResponse(**primary.model_dump(), model_id=str(plan.model_id), routes=routes)


@router.post("/runs/{run_id}/llm-calls")
def record_run_llm_call(
    run_id: str,
    payload: PiCallRecord,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    row = db.execute(
        select(AgentRun, AgentSession)
        .join(AgentSession, AgentSession.id == AgentRun.session_id)
        .where(AgentRun.public_id == run_id)
    ).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND")
    run, session = row
    if run.resolved_llm_route_id is None or run.runtime_config_version is None or run.protocol_code is None:
        raise ApiError(409, "LLM_MODEL_NOT_CONFIGURED")
    route_id = int(payload.route_id) if payload.route_id is not None else run.resolved_llm_route_id
    route = db.get(LLMModelRoute, route_id)
    connection = db.get(LLMProviderConnection, route.connection_id) if route else None
    binding = get_use_case_route(db, ASSISTANT_CONVERSATION, route_id)
    if (route is None or connection is None or binding is None
            or route.model_id != run.resolved_llm_model_id):
        raise ApiError(409, "LLM_CALL_CONFLICT")
    is_primary = route_id == run.resolved_llm_route_id
    price_snapshot = run.resolved_price_snapshot_json if is_primary else (
        payload.price_snapshot if payload.price_snapshot is not None else route.pricing_json
    )
    config_version = run.runtime_config_version if is_primary else (
        payload.config_version or connection.runtime_config_version
    )
    existing = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == payload.call_id))
    if existing is not None:
        if existing.agent_run_id != run.id or existing.route_id != route_id:
            raise ApiError(409, "LLM_CALL_CONFLICT")
        return {"recorded": True}
    usage = GatewayUsage(
        input_tokens=payload.input_tokens,
        output_tokens=payload.output_tokens,
        details=payload.usage,
    )
    from linkresume.modules.llm.service import _metering
    metering_status, estimated_cost, currency = _metering(usage, price_snapshot)
    db.add(LLMCallLog(
        call_id=payload.call_id,
        use_case=ASSISTANT_CONVERSATION,
        source="pi_agent",
        user_id=session.user_id,
        agent_run_id=run.id,
        route_id=route_id,
        runtime_config_version=config_version,
        protocol_code=binding.protocol_code,
        response_model_id=payload.response_model_id,
        upstream_request_id=payload.upstream_request_id,
        selection_source=(run.selection_source or "default") if is_primary else "fallback",
        status=payload.status,
        usage_json=payload.usage,
        input_tokens=payload.input_tokens,
        output_tokens=payload.output_tokens,
        metering_status=metering_status,
        price_snapshot_json=price_snapshot,
        estimated_cost=estimated_cost,
        cost_currency=currency,
        latency_ms=payload.latency_ms,
        error_code=payload.error_code,
    ))
    db.commit()
    return {"recorded": True}


@router.get("/runs/{run_id}/context", response_model=ResumeContextResponse)
def get_run_context(
    run_id: str, resume_id: str, db: Session = Depends(get_db)
) -> ResumeContextResponse:
    _, _, resume, snapshot = _run_resume(db, run_id, resume_id)
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
    if payload.scope_hint == "resume" and payload.quoted_text:
        raise ApiError(422, "TARGET_REQUEST_INVALID")
    run, _, resume, snapshot = _run_resume(db, run_id, payload.resume_id)
    result = resolve_target(
        resume,
        snapshot.data,
        selection_context=payload.selection_context,
        quoted_text=payload.quoted_text,
        scope_hint=payload.scope_hint,
    )
    if result["status"] == "resolved":
        message = active_message(db, run)
        selected = next((item for item in ((message.metadata_json or {}) if message else {}).get("contexts", [])
                         if item.get("type") == "resume" and item.get("id") == str(resume.id)), None)
        authorize_resolved_task_resume(db, run=run, resume_id=str(resume.id), label=resume.title,
                                      source="implicit" if selected and selected.get("presentation") == "implicit" else "explicit")
    return TargetResolveResponse.model_validate(result)


@router.post("/runs/{run_id}/resources:resolve-reference", response_model=ResourceReferenceResolveResponse)
def resolve_run_resource_reference(
    run_id: str, payload: ResourceReferenceResolveRequest, request: Request,
    db: Session = Depends(get_db),
) -> ResourceReferenceResolveResponse:
    run, session = get_active_run(db, run_id)
    return ResourceReferenceResolveResponse.model_validate(resolve_task_resource_reference(
        db, run=run, session=session, payload=payload,
        storage=request.app.state.storage, settings=request.app.state.settings,
    ))


@router.post(
    "/runs/{run_id}/resumes:resolve-reference",
    response_model=ResumeReferenceResolveResponse,
)
def resolve_run_resume_reference(
    run_id: str,
    payload: ResumeReferenceResolveRequest,
    db: Session = Depends(get_db),
) -> ResumeReferenceResolveResponse:
    run, session = get_active_run(db, run_id)
    result = resolve_task_resume_reference(db, run=run, session=session, payload=payload)
    return ResumeReferenceResolveResponse.model_validate(result)


@router.post(
    "/runs/{run_id}/resources:list",
    response_model=AgentResourceListResponse,
)
def list_run_user_resources(
    run_id: str,
    payload: AgentResourceListRequest,
    db: Session = Depends(get_db),
) -> AgentResourceListResponse:
    _, session = get_active_run(db, run_id)
    selected_types = set(payload.types)
    resources = []
    for resource_type in ("resume", "dataset", "interview"):
        if resource_type not in selected_types:
            continue
        resources.extend(
            list_contexts(
                db,
                user_id=session.user_id,
                context_type=resource_type,
                query=payload.query,
                limit=payload.limit,
            )
        )
    return AgentResourceListResponse(resources=resources)


@router.post("/runs/{run_id}/context:read", response_model=ScopedResumeContextResponse)
def read_scoped_run_context(
    run_id: str,
    payload: ContextReadRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ScopedResumeContextResponse:
    def log_read(result, error_code=None):
        request.app.state.event_emitter.system(
            "WARNING" if error_code else "INFO", "agent scoped context read", logger="linkresume.agent",
            operation_id=run_id, action="get_resume_context", stage="scope_read", result=result,
            scope=payload.scope, target_surface=payload.target.surface,
            target_section_kind="resume" if payload.target.section == "resume" else "other" if payload.target.section else "none",
            target_has_entry=payload.target.entry_id is not None,
            target_has_section=payload.target.section is not None,
            selection_present=payload.target.selected_text is not None, error_code=error_code,
        )
    log_read("started")
    try:
        _, _, resume, snapshot = _run_resume(db, run_id, payload.target.resume_id)
        content = target_content(resume, snapshot.data, payload.target, payload.scope)
        blocks = scoped_blocks(resume, snapshot.data, payload.target, payload.scope)
    except ApiError as error:
        log_read("failed", error.code)
        raise
    log_read("succeeded")
    return ScopedResumeContextResponse(
        run_id=run_id,
        resume_id=str(resume.id),
        title=resume.title,
        lock_version=resume.lock_version,
        target=payload.target,
        scope=payload.scope,
        content=content,
        blocks=blocks,
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
    run, session = get_active_run(db, run_id)
    allowed = task_authorized_refs(db, run=run)
    return MaterialSearchResponse(
        sources=search_materials(
            db,
            user_id=session.user_id,
            query=payload.query,
            types=payload.types,
            limit=payload.limit,
            storage=request.app.state.storage,
            max_bytes=request.app.state.settings.dataset_upload_max_bytes,
            allowed_refs=allowed,
            rag=getattr(request.app.state, "linkrag_recall", None),
        )
    )


@router.post("/runs/{run_id}/diagnoses", response_model=DiagnosisResponse)
def diagnose_run_target(
    run_id: str,
    payload: DiagnosisRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> DiagnosisResponse:
    run, session, resume, snapshot = _run_resume(
        db, run_id, payload.target.resume_id
    )
    if payload.job_id is not None:
        require_task_resource(
            db, run=run, resource_type="job", resource_id=payload.job_id,
        )
    require_task_sources(db, run=run, source_ids=payload.source_ids)
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
    require_task_resource(
        db, run=run, resource_type="resume", resource_id=payload.resume_id,
    )
    proposal = create_proposal(
        db,
        run=run,
        session=session,
        resume_id=payload.resume_id,
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
    require_task_resource(
        db, run=run, resource_type="resume", resource_id=payload.target.resume_id,
    )
    require_task_sources(db, run=run, source_ids=payload.source_ids)
    proposal = create_scoped_proposal(
        db,
        run=run,
        session=session,
        payload=payload,
        ttl_days=request.app.state.settings.agent_proposal_ttl_days,
        fingerprint_secret=_fingerprint_secret(request),
    )
    return ProposalResponse(proposal=proposal_record(proposal, run.public_id))


@router.post(
    "/runs/{run_id}/proposals:translation",
    response_model=ProposalResponse,
    status_code=201,
)
def create_translation_run_proposal(
    run_id: str,
    payload: TranslationProposalCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ProposalResponse:
    run, session = get_active_run(db, run_id)
    require_task_resource(
        db, run=run, resource_type="resume", resource_id=payload.target.resume_id,
    )
    proposal = create_translation_proposal(
        db,
        run=run,
        session=session,
        payload=payload,
        ttl_days=request.app.state.settings.agent_proposal_ttl_days,
    )
    return ProposalResponse(proposal=proposal_record(proposal, run.public_id))


@router.post("/runs/{run_id}/tasks:plan")
def plan_run_tasks(
    run_id: str,
    payload: AgentTaskPlanRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    run, _ = get_active_run(db, run_id)
    return {"tasks": save_task_plan(db, run=run, payload=payload)}


@router.post("/runs/{run_id}/intent:recognize")
async def recognize_intent(
    run_id: str, request: Request, db: Session = Depends(get_db),
) -> dict[str, object]:
    from linkresume.modules.agent.intent import recognize_run_intent
    return await recognize_run_intent(request, db, run_id)


@router.get("/runs/{run_id}/tasks/{task_id}/materials")
def read_run_task_materials(
    run_id: str,
    task_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    run, _ = get_active_run(db, run_id)
    return get_task_materials(
        db, run=run, task_id=task_id,
        storage=request.app.state.storage,
        settings=request.app.state.settings,
    )


@router.post("/runs/{run_id}/tasks/{task_id}:status")
def set_run_task_status(
    run_id: str,
    task_id: str,
    payload: AgentTaskStatusRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    run, _ = get_active_run(db, run_id)
    return {"tasks": update_task_status(
        db, run=run, task_id=task_id, payload=payload,
    )}


@router.post("/runs/{run_id}/tool-events", status_code=204)
def record_tool_event(
    run_id: str,
    payload: ToolEventRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    run, session = get_active_run(db, run_id)
    upsert_tool_event(db, run=run, payload=payload)
    request.app.state.event_emitter.system(
        "WARNING" if payload.status == "failed" else "INFO",
        "agent tool stage",
        logger="linkresume.agent",
        actor_user_id=session.user_id,
        operation_id=run.public_id,
        action=payload.tool_name,
        stage=payload.stage or payload.tool_name,
        result=payload.result or payload.status,
        target_type=payload.target_type,
        target_id=payload.target_id,
        error_code=payload.error_code,
        duration_ms=payload.duration_ms,
        scope=payload.scope,
        selection_present=payload.selection_present,
        candidate_count=payload.candidate_count,
        question_count=payload.question_count,
        target_field=payload.target_field,
        base_lock_version=payload.base_lock_version,
        skill_name=payload.skill_name,
    )
