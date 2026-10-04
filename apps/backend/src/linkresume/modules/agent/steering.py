from copy import deepcopy

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.agent.context_service import resolve_contexts
from linkresume.modules.agent.message_scope import active_message, lock_run, request_hash, user_messages
from linkresume.modules.agent.models import AgentMessage, AgentRun
from linkresume.modules.agent.schemas import AgentContextRef, AgentSelectionContext, SubmissionReceipt
from linkresume.modules.agent.service import revision_source


def receipt(db: Session, run: AgentRun, key: str, *, fingerprint: str | None = None):
    for message in user_messages(db, run):
        submission = (message.metadata_json or {}).get("submission", {})
        if submission.get("key") != key:
            continue
        if fingerprint and submission.get("hash") != fingerprint:
            raise ApiError(409, "AGENT_SUBMISSION_CONFLICT")
        return SubmissionReceipt(run_id=run.public_id, submission_key=key,
                                 state=(message.metadata_json or {}).get("steering", {}).get("state", "applied"),
                                 user_sequence_no=message.sequence_no, run_status=run.status)
    return None


def resolve_input(db: Session, run: AgentRun, session, payload, *, storage, settings):
    current = active_message(db, run, validate_source=False)
    metadata = current.metadata_json or {}
    inherited = {item["type"]: AgentContextRef.model_validate(item)
                 for item in metadata.get("contexts", [])}
    changed_resume = False
    for ref in payload.contexts or []:
        previous = inherited.get(ref.type)
        if ref.type == "resume" and previous and previous.id != ref.id:
            if not payload.replace_inherited_resume:
                raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_CONFLICT")
            changed_resume = True
        inherited[ref.type] = ref
    revision = revision_source(db, session, payload.revision_proposal_id) if payload.revision_proposal_id else None
    if revision:
        previous_resume = inherited.get("resume")
        target = str(revision.resume_id)
        if any(ref.type == "resume" and ref.id != target for ref in payload.contexts or []):
            raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_CONFLICT")
        changed_resume = bool(previous_resume and previous_resume.id != target)
        if previous_resume is None or changed_resume:
            inherited["resume"] = AgentContextRef(type="resume", id=target)
    if payload.replace_inherited_resume and not any(item.type == "resume" for item in payload.contexts or []):
        raise ApiError(422, "AGENT_RESUME_REQUIRED")
    selection = payload.selection_context
    if selection is None and not changed_resume and metadata.get("selection_context"):
        selection = AgentSelectionContext.model_validate(metadata["selection_context"])
    if selection and "resume" not in inherited:
        raise ApiError(422, "AGENT_SELECTION_RESUME_REQUIRED")
    resolved = resolve_contexts(db, user_id=session.user_id, refs=list(inherited.values()),
                                storage=storage, settings=settings)
    return current, resolved, selection, revision


def activate(db: Session, run_id: str, payload, *, storage, settings):
    run, session = lock_run(db, run_id)
    fingerprint = request_hash(payload)
    previous = receipt(db, run, payload.idempotency_key, fingerprint=fingerprint)
    if previous:
        message = next(item for item in user_messages(db, run) if item.sequence_no == previous.user_sequence_no)
        # Replays use the activated snapshot, never inherit a later request.
        selection = (message.metadata_json or {}).get("selection_context")
        return {"receipt": previous.model_dump(), "contextMaterials": [
            {**{key: value for key, value in item.items() if key != "presentation"}, "content": {}}
            for item in (message.metadata_json or {}).get("contexts", [])],
            "selectionContext": selection, "revisionProposal": (message.metadata_json or {}).get("revision_proposal")}
    active_message(db, run, lock=True)
    current, resolved, selection, revision = resolve_input(db, run, session, payload, storage=storage, settings=settings)
    sequence = int(db.scalar(select(func.coalesce(func.max(AgentMessage.sequence_no), 0)).where(
        AgentMessage.session_id == session.id)) or 0) + 1
    metadata = deepcopy(current.metadata_json or {})
    tasks = metadata.get("agent_tasks", [])
    for task in tasks:
        if task.get("status") in {"planned", "running"}:
            task["superseded_by_sequence_no"] = sequence
    current.metadata_json = metadata
    message = AgentMessage(session_id=session.id, run_id=run.id, sequence_no=sequence,
                           role="user", content=payload.content.strip(), metadata_json={
                               "version": 1,
                               "submission": {"key": payload.idempotency_key, "hash": fingerprint, "mode": "steer"},
                               "steering": {"state": "accepted"},
                               "contexts": [item.model_dump(mode="json") for item in resolved.snapshots],
                               **({"revision_proposal_id": revision.public_id,
                                   "revision_proposal": {"summary": revision.summary, "operations": revision.operations_json or [],
                                                         "resume_id": str(revision.resume_id)}} if revision else {}),
                               **({"selection_context": selection.model_dump(mode="json", by_alias=True)} if selection else {}),
                           })
    db.add(message)
    session.last_message_at = utc_now()
    db.commit()
    return {"receipt": receipt(db, run, payload.idempotency_key).model_dump(),
            "contextMaterials": [{**item.model_dump(mode="json"), "content": {}} for item in resolved.materials],
            "selectionContext": selection.model_dump(mode="json", by_alias=True) if selection else None,
            "revisionProposal": (message.metadata_json or {}).get("revision_proposal")}


def acknowledge(db: Session, run_id: str, payload):
    run, _ = lock_run(db, run_id)
    stored = receipt(db, run, payload.submission_key)
    if stored is None or stored.user_sequence_no != payload.user_sequence_no:
        raise ApiError(409, "AGENT_REQUEST_SCOPE_STALE")
    message = active_message(db, run, lock=True)
    if message.sequence_no != payload.user_sequence_no:
        raise ApiError(409, "AGENT_REQUEST_SCOPE_STALE")
    metadata = deepcopy(message.metadata_json or {})
    metadata["steering"] = {"state": "applied"}
    message.metadata_json = metadata
    db.commit()
    return receipt(db, run, payload.submission_key)
