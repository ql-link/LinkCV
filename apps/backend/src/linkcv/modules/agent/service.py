from datetime import timedelta, timezone
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from linkcv.core.database import utc_now
from linkcv.core.errors import ApiError
from linkcv.application.resumes.service import (
    ResumeVersionLimitExceeded,
    append_resume_version,
)
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.modules.agent.models import (
    AgentMessage,
    AgentRun,
    AgentSession,
    AgentToolCall,
    ResumeChangeProposal,
)
from linkcv.modules.agent.schemas import (
    AgentMessageRecord,
    AgentSessionRecord,
    ProposalRecord,
    ResumeTargetLocator,
)
from linkcv.modules.agent.resume_tools import (
    apply_operations,
    editor_markdown,
    replace_editor_markdown,
    target_content,
    validate_source_ids,
    verify_diagnosis_fingerprint,
)
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume


def session_record(
    session: AgentSession, messages: list[AgentMessage] | None = None
) -> AgentSessionRecord:
    return AgentSessionRecord(
        id=session.public_id,
        resume_id=str(session.resume_id) if session.resume_id is not None else None,
        title=session.title,
        status=session.status,
        last_message_at=session.last_message_at,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[
            AgentMessageRecord(
                sequence_no=item.sequence_no,
                role=item.role,
                message_type=item.message_type,
                content=item.content,
                clarification=(
                    item.metadata_json
                    if item.message_type == "clarification"
                    else None
                ),
                created_at=item.created_at,
            )
            for item in (messages or [])
        ],
    )


def proposal_record(
    proposal: ResumeChangeProposal, run_public_id: str
) -> ProposalRecord:
    snapshot = parse_resume_snapshot(
        proposal.proposed_data_json, proposal.proposed_style_json
    )
    return ProposalRecord(
        id=proposal.public_id,
        run_id=run_public_id,
        resume_id=str(proposal.resume_id),
        base_lock_version=proposal.base_lock_version,
        data=snapshot.data,
        style=snapshot.style,
        summary=proposal.summary,
        proposal_mode=proposal.proposal_mode,
        target=proposal.target_locator_json,
        diagnosis=proposal.diagnosis_json,
        operations=proposal.operations_json or [],
        rationale=proposal.rationale_json or [],
        source_refs=proposal.source_refs_json or [],
        status=proposal.status,
        applied_lock_version=proposal.applied_lock_version,
        expires_at=proposal.expires_at,
        created_at=proposal.created_at,
    )


def get_owned_session(db: Session, public_id: str, user_id: int) -> AgentSession:
    record = db.scalar(
        select(AgentSession).where(
            AgentSession.public_id == public_id, AgentSession.user_id == user_id
        )
    )
    if record is None:
        raise ApiError(404, "AGENT_SESSION_NOT_FOUND")
    return record


def create_session(
    db: Session, *, user_id: int, resume_id: str | None, title: str | None
) -> AgentSession:
    parsed_resume_id: int | None = None
    if resume_id is not None:
        if not resume_id.isascii() or not resume_id.isdecimal():
            raise ApiError(404, "RESUME_NOT_FOUND")
        parsed_resume_id = int(resume_id)
        resume = db.scalar(
            select(Resume)
            .where(Resume.id == parsed_resume_id, Resume.user_id == user_id)
            .with_for_update()
        )
        if resume is None:
            raise ApiError(404, "RESUME_NOT_FOUND")
        default_title = "新对话"
    else:
        default_title = "新对话"
    normalized_title = " ".join((title or default_title).split())
    if not normalized_title or len(normalized_title) > 128:
        raise ApiError(400, "INVALID_AGENT_SESSION")
    record = AgentSession(
        public_id=str(uuid4()),
        user_id=user_id,
        resume_id=parsed_resume_id,
        title=normalized_title,
        status="active",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def create_run(
    db: Session,
    *,
    session: AgentSession,
    content: str,
    idempotency_key: str,
    timeout_seconds: float,
    reply_to_sequence_no: int | None = None,
) -> tuple[AgentRun, bool]:
    # Serialize run creation for the whole account so opening multiple sessions
    # cannot bypass the concurrency guard and multiply model cost. The
    # idempotency lookup intentionally happens after this lock to close the race
    # between two simultaneous retries with the same key.
    db.execute(select(User.id).where(User.id == session.user_id).with_for_update())
    existing = db.scalar(
        select(AgentRun).where(
            AgentRun.session_id == session.id,
            AgentRun.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return existing, False
    if reply_to_sequence_no is not None:
        latest_message = db.scalar(
            select(AgentMessage)
            .where(AgentMessage.session_id == session.id)
            .order_by(AgentMessage.sequence_no.desc())
            .limit(1)
            .with_for_update()
        )
        if (
            latest_message is None
            or latest_message.sequence_no != reply_to_sequence_no
            or latest_message.role != "assistant"
            or latest_message.message_type != "clarification"
        ):
            raise ApiError(409, "AGENT_CLARIFICATION_STALE")
    running = db.scalars(
        select(AgentRun)
        .join(AgentSession, AgentSession.id == AgentRun.session_id)
        .where(
            AgentSession.user_id == session.user_id,
            AgentRun.status == "running",
        )
    ).all()
    now = utc_now()
    stale_before = now - timedelta(seconds=timeout_seconds)
    fresh_running = False
    for item in running:
        started_at = item.started_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        if started_at > stale_before:
            fresh_running = True
            continue
        item.status = "failed"
        item.error_code = "AGENT_TIMEOUT"
        item.completed_at = now
    if fresh_running:
        raise ApiError(409, "AGENT_RUN_IN_PROGRESS")
    run = AgentRun(
        public_id=str(uuid4()),
        session_id=session.id,
        idempotency_key=idempotency_key,
        status="running",
        started_at=now,
    )
    db.add(run)
    db.flush()
    sequence_no = (
        int(
            db.scalar(
                select(func.coalesce(func.max(AgentMessage.sequence_no), 0)).where(
                    AgentMessage.session_id == session.id
                )
            )
            or 0
        )
        + 1
    )
    db.add(
        AgentMessage(
            session_id=session.id,
            run_id=run.id,
            sequence_no=sequence_no,
            role="user",
            content=content.strip(),
        )
    )
    if sequence_no == 1 and session.title == "新对话":
        title_source = " ".join(content.split())
        session.title = title_source[:24] + ("…" if len(title_source) > 24 else "")
    session.last_message_at = now
    db.commit()
    db.refresh(run)
    return run, True


def get_active_run(db: Session, public_id: str) -> tuple[AgentRun, AgentSession]:
    row = db.execute(
        select(AgentRun, AgentSession)
        .join(AgentSession, AgentSession.id == AgentRun.session_id)
        .where(AgentRun.public_id == public_id)
    ).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND")
    run, session = row
    if run.status != "running" or session.status != "active":
        raise ApiError(409, "AGENT_RUN_NOT_ACTIVE")
    return run, session


def create_proposal(
    db: Session,
    *,
    run: AgentRun,
    session: AgentSession,
    call_key: str,
    data: object,
    style: object,
    summary: str,
    ttl_days: int,
) -> ResumeChangeProposal:
    if session.resume_id is None:
        raise ApiError(409, "AGENT_RESUME_REQUIRED")
    resume = db.scalar(
        select(Resume)
        .where(Resume.id == session.resume_id, Resume.user_id == session.user_id)
        .with_for_update()
    )
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    existing = db.scalar(
        select(ResumeChangeProposal).where(
            ResumeChangeProposal.run_id == run.id,
            ResumeChangeProposal.call_key == call_key,
        )
    )
    if existing is not None:
        return existing
    snapshot = parse_resume_snapshot(data, style)
    proposal = ResumeChangeProposal(
        public_id=str(uuid4()),
        run_id=run.id,
        call_key=call_key,
        resume_id=resume.id,
        user_id=session.user_id,
        base_lock_version=resume.lock_version,
        proposed_data_json=snapshot.data.model_dump(mode="json"),
        proposed_style_json=snapshot.style.model_dump(mode="json"),
        summary=summary.strip(),
        status="pending",
        expires_at=utc_now() + timedelta(days=ttl_days),
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)
    return proposal


def create_scoped_proposal(
    db: Session,
    *,
    run: AgentRun,
    session: AgentSession,
    payload: object,
    ttl_days: int,
    fingerprint_secret: str,
) -> ResumeChangeProposal:
    if session.resume_id is None:
        raise ApiError(409, "AGENT_RESUME_REQUIRED")
    resume = db.scalar(
        select(Resume)
        .where(Resume.id == session.resume_id, Resume.user_id == session.user_id)
        .with_for_update()
    )
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    existing = db.scalar(
        select(ResumeChangeProposal).where(
            ResumeChangeProposal.run_id == run.id,
            ResumeChangeProposal.call_key == payload.call_key,
        )
    )
    if existing is not None:
        return existing
    existing_mode = db.scalar(
        select(ResumeChangeProposal.proposal_mode).where(
            ResumeChangeProposal.run_id == run.id,
            ResumeChangeProposal.proposal_mode != "legacy_snapshot",
        )
    )
    if existing_mode is not None and existing_mode != payload.mode:
        raise ApiError(409, "SKILL_MODE_CONFLICT")
    if (
        payload.target.resume_id != str(resume.id)
        or payload.target.base_lock_version != resume.lock_version
    ):
        raise ApiError(409, "TARGET_STALE")
    verify_diagnosis_fingerprint(
        payload.diagnosis, payload.diagnosis_fingerprint, fingerprint_secret
    )
    if payload.diagnosis.get("target") != payload.target.model_dump(mode="json"):
        raise ApiError(422, "DIAGNOSIS_REQUIRED")
    source_refs = validate_source_ids(
        db, user_id=session.user_id, source_ids=payload.source_ids
    )
    diagnosed_source_ids = sorted(
        item.get("source_id")
        for item in payload.diagnosis.get("source_refs", [])
        if isinstance(item, dict) and isinstance(item.get("source_id"), str)
    )
    if diagnosed_source_ids != sorted(payload.source_ids):
        raise ApiError(422, "DIAGNOSIS_REQUIRED")
    if payload.mode == "generate_from_materials" and not source_refs:
        raise ApiError(422, "SOURCE_REQUIRED")
    snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
    target_content(resume, snapshot.data, payload.target, "target")
    markdown = editor_markdown(snapshot.data)
    if markdown is None:
        raise ApiError(422, "TARGET_INVALID")
    updated_markdown = apply_operations(
        markdown,
        mode=payload.mode,
        main_target=payload.target,
        operations=payload.operations,
    )
    updated_snapshot = parse_resume_snapshot(
        replace_editor_markdown(snapshot.data, updated_markdown), snapshot.style
    )
    proposal = ResumeChangeProposal(
        public_id=str(uuid4()),
        run_id=run.id,
        call_key=payload.call_key,
        resume_id=resume.id,
        user_id=session.user_id,
        base_lock_version=resume.lock_version,
        proposed_data_json=updated_snapshot.data.model_dump(mode="json"),
        proposed_style_json=updated_snapshot.style.model_dump(mode="json"),
        summary=payload.summary.strip(),
        proposal_mode=payload.mode,
        target_locator_json=payload.target.model_dump(mode="json"),
        target_content_hash=payload.target.expected_text_hash,
        diagnosis_json=payload.diagnosis,
        operations_json=[item.model_dump(mode="json") for item in payload.operations],
        rationale_json=payload.rationale,
        source_refs_json=source_refs,
        status="pending",
        expires_at=utc_now() + timedelta(days=ttl_days),
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)
    return proposal


def confirm_proposal(
    db: Session, *, public_id: str, user_id: int, version_limit: int
) -> tuple[ResumeChangeProposal, Resume]:
    proposal = db.scalar(
        select(ResumeChangeProposal)
        .where(
            ResumeChangeProposal.public_id == public_id,
            ResumeChangeProposal.user_id == user_id,
        )
        .with_for_update()
    )
    if proposal is None:
        raise ApiError(404, "AGENT_PROPOSAL_NOT_FOUND")
    resume = db.scalar(
        select(Resume)
        .where(Resume.id == proposal.resume_id, Resume.user_id == user_id)
        .with_for_update()
    )
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    if proposal.status == "applied":
        return proposal, resume
    if proposal.status != "pending":
        raise ApiError(409, "AGENT_PROPOSAL_NOT_PENDING")
    expires_at = proposal.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= utc_now():
        proposal.status = "expired"
        db.commit()
        raise ApiError(410, "AGENT_PROPOSAL_EXPIRED")
    if resume.lock_version != proposal.base_lock_version:
        proposal.status = "conflicted"
        db.commit()
        raise ApiError(409, "RESUME_EDIT_CONFLICT")
    if proposal.target_locator_json is not None:
        try:
            current = parse_resume_snapshot(resume.data_json, resume.style_json)
            target = ResumeTargetLocator.model_validate(proposal.target_locator_json)
            target_content(resume, current.data, target, "target")
        except (ApiError, ValueError):
            proposal.status = "conflicted"
            db.commit()
            raise ApiError(409, "TARGET_STALE")
    snapshot = parse_resume_snapshot(
        proposal.proposed_data_json, proposal.proposed_style_json
    )
    resume.data_json = snapshot.data.model_dump(mode="json")
    resume.style_json = snapshot.style.model_dump(mode="json")
    resume.lock_version += 1
    try:
        append_resume_version(
            db,
            resume,
            reason="agent",
            version_limit=version_limit,
            name="智能助手修改",
        )
    except ResumeVersionLimitExceeded as error:
        db.rollback()
        raise ApiError(409, "RESUME_VERSION_LIMIT_REACHED") from error
    proposal.status = "applied"
    proposal.applied_lock_version = resume.lock_version
    proposal.applied_at = utc_now()
    db.commit()
    db.refresh(resume)
    return proposal, resume


def reject_proposal(
    db: Session, *, public_id: str, user_id: int
) -> ResumeChangeProposal:
    proposal = db.scalar(
        select(ResumeChangeProposal)
        .where(
            ResumeChangeProposal.public_id == public_id,
            ResumeChangeProposal.user_id == user_id,
        )
        .with_for_update()
    )
    if proposal is None:
        raise ApiError(404, "AGENT_PROPOSAL_NOT_FOUND")
    if proposal.status == "pending":
        proposal.status = "rejected"
        db.commit()
        db.refresh(proposal)
    elif proposal.status != "rejected":
        raise ApiError(409, "AGENT_PROPOSAL_NOT_PENDING")
    return proposal


def delete_resume_agent_data(db: Session, *, resume_id: int, user_id: int) -> None:
    """Delete Agent-owned rows explicitly because the Agent schema has no FKs."""
    session_ids = list(
        db.scalars(
            select(AgentSession.id).where(
                AgentSession.resume_id == resume_id,
                AgentSession.user_id == user_id,
            )
        ).all()
    )
    db.execute(
        delete(ResumeChangeProposal).where(
            ResumeChangeProposal.resume_id == resume_id,
            ResumeChangeProposal.user_id == user_id,
        )
    )
    if not session_ids:
        return
    run_ids = list(
        db.scalars(
            select(AgentRun.id).where(AgentRun.session_id.in_(session_ids))
        ).all()
    )
    if run_ids:
        db.execute(delete(AgentToolCall).where(AgentToolCall.run_id.in_(run_ids)))
        db.execute(delete(AgentMessage).where(AgentMessage.run_id.in_(run_ids)))
        db.execute(delete(AgentRun).where(AgentRun.id.in_(run_ids)))
    db.execute(delete(AgentMessage).where(AgentMessage.session_id.in_(session_ids)))
    db.execute(delete(AgentSession).where(AgentSession.id.in_(session_ids)))


def upsert_tool_event(db: Session, *, run: AgentRun, payload: object) -> AgentToolCall:
    # A run-scoped lock serializes first-write retries as well as subsequent
    # transitions without introducing a database foreign key.
    locked_run_status = db.scalar(
        select(AgentRun.status).where(AgentRun.id == run.id).with_for_update()
    )
    if locked_run_status is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND")
    if locked_run_status != "running":
        raise ApiError(409, "AGENT_RUN_NOT_ACTIVE")
    call_key = payload.call_key
    record = db.scalar(
        select(AgentToolCall).where(
            AgentToolCall.run_id == run.id, AgentToolCall.call_key == call_key
        )
    )
    if record is None:
        record = AgentToolCall(
            run_id=run.id, call_key=call_key, tool_name=payload.tool_name
        )
        db.add(record)
    elif record.tool_name != payload.tool_name:
        raise ApiError(409, "AGENT_TOOL_CALL_CONFLICT")
    elif record.status in {"succeeded", "failed", "cancelled"}:
        if payload.status != record.status:
            raise ApiError(409, "AGENT_TOOL_CALL_TERMINAL")
        return record
    record.status = payload.status
    record.target_type = payload.target_type
    record.target_id = payload.target_id
    record.error_code = payload.error_code
    record.duration_ms = payload.duration_ms
    db.commit()
    db.refresh(record)
    return record
