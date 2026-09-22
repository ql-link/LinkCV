from collections.abc import Callable
from copy import deepcopy
from datetime import timedelta, timezone
import re
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.application.resumes.service import (
    InvalidResumeTitle,
    ResumeTitleConflict,
    ResumeVersionLimitExceeded,
    append_resume_version,
    ensure_unique_resume_title,
    has_resume_capacity,
    normalize_resume_title,
    parse_persisted_resume_snapshot,
    persist_resume_with_initial_version,
    resume_title_key,
)
from linkresume.application.resumes.commands import CreateResumeCommand
from linkresume.modules.agent.models import (
    AgentMessage,
    AgentRun,
    AgentSession,
    AgentToolCall,
    ResumeChangeProposal,
)
from linkresume.modules.agent.schemas import (
    AgentMessageRecord,
    AgentClarification,
    ClarificationAnswerSelection,
    AgentContextRef,
    AgentContextSnapshot,
    AgentSelectionContext,
    AgentSessionRecord,
    ProposalRecord,
    ResumeTargetLocator,
    TranslationProposalCreateRequest,
)
from linkresume.modules.agent.resume_tools import (
    apply_operations,
    editor_markdown,
    replace_editor_markdown,
    resolve_target,
    target_content,
    validate_source_ids,
    verify_diagnosis_fingerprint,
)
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import Resume, ResumeVersion


TRANSLATION_IMMUTABLE_KEYS = {
    "schema_version",
    "node_id",
    "inline_type",
    "block_type",
    "semantic_kind",
    "kind",
    "url",
    "source_refs",
    "start_date",
    "end_date",
}
TRANSLATION_IMMUTABLE_CONTACT_KINDS = {
    "phone",
    "email",
    "website",
    "github",
    "linkedin",
}
TRANSLATION_TOKEN_PATTERN = re.compile(
    r"https?://[^\s)'\"<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\d+(?:\.\d+)?",
    re.IGNORECASE,
)


def validate_translation_snapshot(
    source: object,
    translated: object,
    *,
    path: tuple[str, ...] = (),
    contact_kind: str | None = None,
) -> None:
    """Reject structural, identifier and factual-token changes in translations."""

    if type(source) is not type(translated):
        raise ApiError(422, "RESUME_TRANSLATION_INVALID")
    if isinstance(source, dict):
        if source.keys() != translated.keys():
            raise ApiError(422, "RESUME_TRANSLATION_INVALID")
        nested_contact_kind = source.get("kind") if isinstance(source.get("kind"), str) else contact_kind
        for key in source:
            validate_translation_snapshot(
                source[key],
                translated[key],
                path=(*path, key),
                contact_kind=nested_contact_kind,
            )
        return
    if isinstance(source, list):
        if len(source) != len(translated):
            raise ApiError(422, "RESUME_TRANSLATION_INVALID")
        for index, (source_item, translated_item) in enumerate(zip(source, translated, strict=True)):
            validate_translation_snapshot(
                source_item,
                translated_item,
                path=(*path, str(index)),
                contact_kind=contact_kind,
            )
        return
    if isinstance(source, str):
        leaf_key = path[-1] if path else ""
        immutable = any(key in TRANSLATION_IMMUTABLE_KEYS for key in path)
        immutable = immutable or leaf_key.endswith("_id") or leaf_key.endswith("_ids")
        immutable = immutable or leaf_key in {"document_id", "href"}
        immutable = immutable or (
            contact_kind in TRANSLATION_IMMUTABLE_CONTACT_KINDS and path[-1:] == ("value",)
        )
        if immutable and source != translated:
            raise ApiError(422, "RESUME_TRANSLATION_INVALID")
        if TRANSLATION_TOKEN_PATTERN.findall(source) != TRANSLATION_TOKEN_PATTERN.findall(translated):
            raise ApiError(422, "RESUME_TRANSLATION_INVALID")
        return
    if source != translated:
        raise ApiError(422, "RESUME_TRANSLATION_INVALID")


def session_record(
    session: AgentSession, messages: list[AgentMessage] | None = None
) -> AgentSessionRecord:
    def message_contexts(item: AgentMessage) -> list[AgentContextSnapshot] | None:
        if item.message_type != "text" or not isinstance(item.metadata_json, dict):
            return None
        raw = item.metadata_json.get("contexts")
        if not isinstance(raw, list):
            return None
        contexts: list[AgentContextSnapshot] = []
        for value in raw:
            try:
                contexts.append(AgentContextSnapshot.model_validate(value))
            except Exception:
                # A malformed historical metadata blob must not make the whole
                # conversation unreadable.  It is never treated as an active
                # authorization grant.
                continue
        return contexts or None

    return AgentSessionRecord(
        id=session.public_id,
        title=session.title,
        pinned=bool(getattr(session, "pinned", False)),
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
                    item.metadata_json if item.message_type == "clarification" else None
                ),
                contexts=message_contexts(item),
                created_at=item.created_at,
            )
            for item in (messages or [])
        ],
    )


def proposal_record(
    proposal: ResumeChangeProposal, run_public_id: str
) -> ProposalRecord:
    snapshot = parse_persisted_resume_snapshot(
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
        proposed_title=proposal.proposed_title,
        result_resume_id=(
            str(proposal.result_resume_id)
            if proposal.result_resume_id is not None
            else None
        ),
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


def update_session(
    db: Session,
    *,
    public_id: str,
    user_id: int,
    fields: set[str],
    title: str | None = None,
    pinned: bool | None = None,
) -> AgentSession:
    """Update only presentation state on an owner-scoped Agent session."""
    if not fields:
        raise ApiError(400, "INVALID_AGENT_SESSION")

    record = db.scalar(
        select(AgentSession)
        .where(
            AgentSession.public_id == public_id,
            AgentSession.user_id == user_id,
        )
        .with_for_update()
    )
    if record is None:
        raise ApiError(404, "AGENT_SESSION_NOT_FOUND")

    if "title" in fields:
        normalized_title = " ".join((title or "").split())
        if not normalized_title or len(normalized_title) > 128:
            raise ApiError(400, "INVALID_AGENT_SESSION")
        record.title = normalized_title
    if "pinned" in fields:
        if pinned is None:
            raise ApiError(400, "INVALID_AGENT_SESSION")
        record.pinned = pinned
    record.updated_at = utc_now()
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(record)
    return record


def delete_session(db: Session, *, public_id: str, user_id: int) -> None:
    """Delete one owned session and all of its Agent-owned dependent rows."""
    session = db.scalar(
        select(AgentSession)
        .where(
            AgentSession.public_id == public_id,
            AgentSession.user_id == user_id,
        )
        .with_for_update()
    )
    if session is None:
        raise ApiError(404, "AGENT_SESSION_NOT_FOUND")

    runs = list(
        db.scalars(
            select(AgentRun).where(AgentRun.session_id == session.id).with_for_update()
        ).all()
    )
    if any(run.status == "running" for run in runs):
        db.rollback()
        raise ApiError(409, "AGENT_RUN_IN_PROGRESS")

    run_ids = [run.id for run in runs]
    try:
        # These tables are intentionally not linked by database foreign keys;
        # keep the logical dependency order explicit for safe hard deletion.
        if run_ids:
            db.execute(
                delete(ResumeChangeProposal).where(
                    ResumeChangeProposal.run_id.in_(run_ids),
                    ResumeChangeProposal.user_id == user_id,
                )
            )
            db.execute(delete(AgentToolCall).where(AgentToolCall.run_id.in_(run_ids)))
        db.execute(delete(AgentMessage).where(AgentMessage.session_id == session.id))
        if run_ids:
            db.execute(delete(AgentRun).where(AgentRun.id.in_(run_ids)))
        db.execute(
            delete(AgentSession).where(
                AgentSession.id == session.id,
                AgentSession.user_id == user_id,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def create_session(db: Session, *, user_id: int, title: str | None) -> AgentSession:
    default_title = "新对话"
    normalized_title = " ".join((title or default_title).split())
    if not normalized_title or len(normalized_title) > 128:
        raise ApiError(400, "INVALID_AGENT_SESSION")
    record = AgentSession(
        public_id=str(uuid4()),
        user_id=user_id,
        title=normalized_title,
        status="active",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def clarification_context_state(
    db: Session,
    *,
    session: AgentSession,
    reply_to_sequence_no: int | None,
) -> tuple[list[AgentContextRef], AgentSelectionContext | None]:
    """Recover the originating message contexts and selection.

    Snapshots are display-only when read from history.  This function converts
    them back to references so ``resolve_contexts`` must re-check ownership,
    existence and version freshness before the next run starts.  Selection is
    parsed again so a reloaded client cannot replace the confirmed target with
    malformed historical metadata.
    """

    if reply_to_sequence_no is None:
        return [], None
    latest_message = db.scalar(
        select(AgentMessage)
        .where(AgentMessage.session_id == session.id)
        .order_by(AgentMessage.sequence_no.desc())
        .limit(1)
    )
    if (
        latest_message is None
        or latest_message.sequence_no != reply_to_sequence_no
        or latest_message.role != "assistant"
        or latest_message.message_type != "clarification"
    ):
        raise ApiError(409, "AGENT_CLARIFICATION_STALE")
    if latest_message.run_id is None:
        return [], None
    source_message = db.scalar(
        select(AgentMessage)
        .where(
            AgentMessage.session_id == session.id,
            AgentMessage.run_id == latest_message.run_id,
            AgentMessage.role == "user",
        )
        .order_by(AgentMessage.sequence_no.asc())
        .limit(1)
    )
    if source_message is None:
        return [], None
    if source_message.metadata_json is None:
        return [], None
    if not isinstance(source_message.metadata_json, dict):
        raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_INVALID")
    raw_contexts = source_message.metadata_json.get("contexts", [])
    raw_selection = source_message.metadata_json.get("selection_context")
    if not isinstance(raw_contexts, list):
        raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_INVALID")
    refs: list[AgentContextRef] = []
    try:
        for raw in raw_contexts:
            snapshot = AgentContextSnapshot.model_validate(raw)
            refs.append(
                AgentContextRef(
                    type=snapshot.type,
                    id=snapshot.id,
                    version_id=snapshot.version_id,
                    version=snapshot.version,
                )
            )
        selection = (
            AgentSelectionContext.model_validate(raw_selection)
            if raw_selection is not None
            else None
        )
    except Exception as error:
        raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_INVALID") from error
    return refs, selection


def create_run(
    db: Session,
    *,
    session: AgentSession,
    content: str,
    idempotency_key: str,
    timeout_seconds: float,
    public_id: str | None = None,
    reply_to_sequence_no: int | None = None,
    clarification_answers: list[ClarificationAnswerSelection] | None = None,
    context_snapshots: list[AgentContextSnapshot] | None = None,
    selection_context: AgentSelectionContext | None = None,
) -> tuple[AgentRun, bool]:
    normalized_content = content.strip()
    if not normalized_content:
        raise ApiError(400, "INVALID_AGENT_MESSAGE")
    context_snapshots = context_snapshots or []

    # Serialize run creation for the whole account so opening multiple sessions
    # cannot bypass the concurrency guard and multiply model cost. The
    # idempotency lookup intentionally happens after this lock to close the race
    # between two simultaneous retries with the same key.
    db.execute(select(User.id).where(User.id == session.user_id).with_for_update())
    locked_session = db.scalar(
        select(AgentSession)
        .where(
            AgentSession.id == session.id,
            AgentSession.user_id == session.user_id,
        )
        .with_for_update()
    )
    if locked_session is None:
        raise ApiError(404, "AGENT_SESSION_NOT_FOUND")
    session = locked_session
    existing = db.scalar(
        select(AgentRun).where(
            AgentRun.session_id == session.id,
            AgentRun.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return existing, False
    normalized_answers: list[dict[str, str]] = []
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
        try:
            clarification = AgentClarification.model_validate(latest_message.metadata_json)
        except Exception as error:
            raise ApiError(409, "AGENT_CLARIFICATION_STALE") from error
        if clarification_answers is not None:
            answer_by_question = {
                item.question_id: item for item in clarification_answers
            }
            if set(answer_by_question) != {item.id for item in clarification.questions}:
                raise ApiError(422, "AGENT_CLARIFICATION_INVALID")
            for question in clarification.questions:
                answer = answer_by_question[question.id]
                option = next(
                    (item for item in question.options if item.id == answer.option_id),
                    None,
                )
                if answer.option_id == "__other__":
                    value = (answer.value or "").strip()
                    if not value:
                        raise ApiError(422, "AGENT_CLARIFICATION_INVALID")
                elif option is not None:
                    value = option.label
                else:
                    raise ApiError(422, "AGENT_CLARIFICATION_INVALID")
                normalized_answers.append(
                    {
                        "question_id": question.id,
                        "option_id": answer.option_id,
                        "value": value,
                    }
                )
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
        public_id=public_id or str(uuid4()),
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
            content=normalized_content,
            metadata_json=(
                {
                    "version": 1,
                    **(
                        {
                            "contexts": [
                                item.model_dump(mode="json")
                                for item in context_snapshots
                            ]
                        }
                        if context_snapshots
                        else {}
                    ),
                    **(
                        {
                            "selection_context": selection_context.model_dump(
                                mode="json", by_alias=True
                            )
                        }
                        if selection_context is not None
                        else {}
                    ),
                    **(
                        {
                            "reply_to_sequence_no": reply_to_sequence_no,
                            "clarification_answers": normalized_answers,
                        }
                        if normalized_answers
                        else {}
                    ),
                }
                if context_snapshots or selection_context is not None or normalized_answers
                else None
            ),
        )
    )
    if sequence_no == 1 and session.title == "新对话":
        title_source = " ".join(normalized_content.split())
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


def resolve_resume_reference(
    db: Session,
    *,
    session: AgentSession,
    title: str | None,
    resume_id: str | None,
) -> dict[str, Any]:
    """Resolve an owned resume for this run without mutating the session."""

    resumes = list(
        db.scalars(
        select(Resume)
        .where(Resume.user_id == session.user_id)
        .order_by(Resume.updated_at.desc(), Resume.id.desc())
        ).all()
    )
    if resume_id is not None:
        if not resume_id.isascii() or not resume_id.isdecimal():
            return {"status": "not_found", "target": None, "candidates": []}
        matches = [resume for resume in resumes if resume.id == int(resume_id)]
        if title is not None and matches:
            try:
                title_key = resume_title_key(title)
            except InvalidResumeTitle as error:
                raise ApiError(400, "INVALID_RESUME_TITLE") from error
            matches = [
                resume
                for resume in matches
                if resume_title_key(resume.title) == title_key
            ]
    else:
        try:
            title_key = resume_title_key(title or "")
        except InvalidResumeTitle as error:
            raise ApiError(400, "INVALID_RESUME_TITLE") from error
        matches = [
            resume for resume in resumes if resume_title_key(resume.title) == title_key
        ]
    if not matches:
        return {"status": "not_found", "target": None, "candidates": []}
    if len(matches) > 1:
        return {
            "status": "ambiguous",
            "target": None,
            "candidates": [
                {
                    "resume_id": str(resume.id),
                    "title": resume.title,
                    "updated_at": resume.updated_at,
                }
                for resume in matches[:10]
            ],
        }

    resume = matches[0]
    snapshot = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
    resolved = resolve_target(
        resume,
        snapshot.data,
        selection_context=None,
        quoted_text=None,
        scope_hint="resume",
    )
    return resolved


def _owned_resume_for_target(
    db: Session, *, user_id: int, resume_id: str, lock: bool = False
) -> Resume:
    if not resume_id.isascii() or not resume_id.isdecimal():
        raise ApiError(404, "RESUME_NOT_FOUND")
    query = select(Resume).where(
        Resume.id == int(resume_id), Resume.user_id == user_id
    )
    if lock:
        query = query.with_for_update()
    resume = db.scalar(query)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume


def create_proposal(
    db: Session,
    *,
    run: AgentRun,
    session: AgentSession,
    resume_id: str,
    call_key: str,
    data: object,
    style: object,
    summary: str,
    ttl_days: int,
) -> ResumeChangeProposal:
    resume = _owned_resume_for_target(
        db,
        user_id=session.user_id,
        resume_id=resume_id,
        lock=True,
    )
    existing = db.scalar(
        select(ResumeChangeProposal).where(
            ResumeChangeProposal.run_id == run.id,
            ResumeChangeProposal.call_key == call_key,
        )
    )
    if existing is not None:
        return existing
    snapshot = parse_persisted_resume_snapshot(data, style)
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
    resume = _owned_resume_for_target(
        db,
        user_id=session.user_id,
        resume_id=payload.target.resume_id,
        lock=True,
    )
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
    snapshot = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
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
    updated_snapshot = parse_persisted_resume_snapshot(
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


def create_translation_proposal(
    db: Session,
    *,
    run: AgentRun,
    session: AgentSession,
    payload: TranslationProposalCreateRequest,
    ttl_days: int,
) -> ResumeChangeProposal:
    resume = _owned_resume_for_target(
        db,
        user_id=session.user_id,
        resume_id=payload.target.resume_id,
        lock=True,
    )
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
    if existing_mode is not None and existing_mode != "translate_resume":
        raise ApiError(409, "SKILL_MODE_CONFLICT")
    if (
        payload.target.resume_id != str(resume.id)
        or payload.target.base_lock_version != resume.lock_version
        or payload.target.surface != "semantic"
        or payload.target.section != "resume"
        or payload.target.field != "data"
    ):
        raise ApiError(409, "TARGET_STALE")
    source_snapshot = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
    target_content(resume, source_snapshot.data, payload.target, "resume")
    translated_snapshot = parse_persisted_resume_snapshot(payload.data, payload.style)
    if source_snapshot.style_json != translated_snapshot.style_json:
        raise ApiError(422, "RESUME_TRANSLATION_INVALID")
    validate_translation_snapshot(source_snapshot.data_json, translated_snapshot.data_json)
    try:
        proposed_title = normalize_resume_title(payload.proposed_title)
    except Exception as error:
        raise ApiError(400, "INVALID_RESUME_TITLE") from error
    proposal = ResumeChangeProposal(
        public_id=str(uuid4()),
        run_id=run.id,
        call_key=payload.call_key,
        resume_id=resume.id,
        user_id=session.user_id,
        base_lock_version=resume.lock_version,
        proposed_data_json=translated_snapshot.data_json,
        proposed_style_json=translated_snapshot.style_json,
        summary=payload.summary.strip(),
        proposal_mode="translate_resume",
        target_locator_json=payload.target.model_dump(mode="json"),
        target_content_hash=payload.target.expected_text_hash,
        diagnosis_json={"target_language": payload.target_language.lower()},
        proposed_title=proposed_title,
        status="pending",
        expires_at=utc_now() + timedelta(days=ttl_days),
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)
    return proposal


def confirm_proposal(
    db: Session,
    *,
    public_id: str,
    user_id: int,
    version_limit: int,
    validate_resume_data: Callable[[dict[str, Any], int], None] | None = None,
    prepare_translation_assets: Callable[
        [dict[str, Any], int, int], tuple[dict[str, Any], list[str]]
    ]
    | None = None,
    delete_asset: Callable[[str], None] | None = None,
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
        if proposal.proposal_mode == "translate_resume":
            result = db.scalar(
                select(Resume).where(
                    Resume.id == proposal.result_resume_id,
                    Resume.user_id == user_id,
                )
            )
            if result is None:
                raise ApiError(409, "AGENT_PROPOSAL_RESULT_NOT_FOUND")
            return proposal, result
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
    if proposal.proposal_mode == "translate_resume":
        copied_assets: list[str] = []
        try:
            locked_user_id = db.scalar(
                select(User.id).where(User.id == user_id).with_for_update()
            )
            if locked_user_id is None:
                raise ApiError(404, "USER_NOT_FOUND")
            if not has_resume_capacity(db, user_id):
                raise ApiError(409, "RESUME_LIMIT_REACHED")
            try:
                title = normalize_resume_title(proposal.proposed_title)
                ensure_unique_resume_title(db, user_id=user_id, title=title)
            except ResumeTitleConflict as error:
                raise ApiError(409, "RESUME_TITLE_CONFLICT") from error
            except Exception as error:
                raise ApiError(400, "INVALID_RESUME_TITLE") from error
            snapshot = parse_persisted_resume_snapshot(
                proposal.proposed_data_json, proposal.proposed_style_json
            )
            result = persist_resume_with_initial_version(
                CreateResumeCommand(
                    user_id=user_id,
                    title=title,
                    data=snapshot.data,
                    style=snapshot.style,
                    source_type=resume.source_type,
                    template_id=resume.template_id,
                ),
                db,
            )
            translated_data = deepcopy(snapshot.data_json)
            if prepare_translation_assets is not None:
                translated_data, copied_assets = prepare_translation_assets(
                    translated_data, resume.id, result.id
                )
            if validate_resume_data is not None:
                validate_resume_data(translated_data, result.id)
            result.data_json = translated_data
            initial_version = db.scalar(
                select(ResumeVersion).where(
                    ResumeVersion.resume_id == result.id,
                    ResumeVersion.version_no == 1,
                )
            )
            if initial_version is None:
                raise RuntimeError("translation initial version missing")
            initial_version.data_json = deepcopy(translated_data)
            proposal.status = "applied"
            proposal.result_resume_id = result.id
            proposal.applied_lock_version = proposal.base_lock_version
            proposal.applied_at = utc_now()
            db.commit()
            db.refresh(result)
            return proposal, result
        except Exception:
            db.rollback()
            if delete_asset is not None:
                for object_name in reversed(copied_assets):
                    try:
                        delete_asset(object_name)
                    except Exception:
                        pass
            raise
    if proposal.target_locator_json is not None:
        try:
            current = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
            target = ResumeTargetLocator.model_validate(proposal.target_locator_json)
            target_content(resume, current.data, target, "target")
        except (ApiError, ValueError):
            proposal.status = "conflicted"
            db.commit()
            raise ApiError(409, "TARGET_STALE")
    snapshot = parse_persisted_resume_snapshot(
        proposal.proposed_data_json, proposal.proposed_style_json
    )
    proposed_data = snapshot.data.model_dump(mode="json")
    if validate_resume_data is not None:
        validate_resume_data(proposed_data, resume.id)
    resume.data_json = proposed_data
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
    """Delete resume-scoped proposals without deleting independent conversations."""
    db.execute(
        delete(ResumeChangeProposal).where(
            ResumeChangeProposal.resume_id == resume_id,
            ResumeChangeProposal.user_id == user_id,
        )
    )


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
