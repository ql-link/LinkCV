"""Request scope within a Pi run. Durable state stays in existing messages."""

from contextvars import ContextVar
from copy import deepcopy
from hashlib import sha256
import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from drawoffer.core.database import utc_now
from drawoffer.core.errors import ApiError
from drawoffer.modules.agent.models import AgentMessage, AgentRun, AgentSession
from drawoffer.modules.identity.dependencies import lock_active_user

source_sequence_no: ContextVar[int | None] = ContextVar("agent_source_sequence_no", default=None)


def request_hash(payload) -> str:
    return sha256(json.dumps(payload.model_dump(mode="json", by_alias=True),
                             sort_keys=True, ensure_ascii=False,
                             separators=(",", ":")).encode()).hexdigest()


def user_messages(db: Session, run: AgentRun, *, lock: bool = False) -> list[AgentMessage]:
    query = select(AgentMessage).where(AgentMessage.run_id == run.id,
                                      AgentMessage.role == "user").order_by(AgentMessage.sequence_no)
    if lock:
        query = query.with_for_update()
    return list(db.scalars(query))


def active_message(db: Session, run: AgentRun, *, lock: bool = False,
                   validate_source: bool = True) -> AgentMessage:
    messages = user_messages(db, run, lock=lock)
    if not messages:
        raise ApiError(409, "AGENT_TASK_MESSAGE_NOT_FOUND")
    current = messages[-1]
    source = source_sequence_no.get()
    if validate_source and ((source is None and len(messages) > 1)
                            or (source is not None and source != current.sequence_no)):
        raise ApiError(409, "AGENT_REQUEST_SCOPE_STALE")
    return current


def proposal_message(db: Session, run_id: int, proposal_id: str) -> AgentMessage | None:
    messages = list(db.scalars(select(AgentMessage).where(
        AgentMessage.run_id == run_id, AgentMessage.role == "user")))
    return next((message for message in messages
                 if proposal_id in (message.metadata_json or {}).get("generated_proposal_ids", [])),
                messages[0] if len(messages) == 1 else None)


def register_proposal(db: Session, run: AgentRun, proposal_id: str) -> None:
    message = active_message(db, run, lock=True)
    metadata = deepcopy(message.metadata_json or {})
    ids = metadata.setdefault("generated_proposal_ids", [])
    if proposal_id not in ids:
        ids.append(proposal_id)
    message.metadata_json = metadata


def clarification_metadata(message: AgentMessage):
    metadata = message.metadata_json or {}
    return metadata.get("clarification", metadata)


def reply_source_message(db: Session, reply: AgentMessage) -> AgentMessage | None:
    source = (reply.metadata_json or {}).get("reply_to_sequence_no")
    messages = list(db.scalars(select(AgentMessage).where(
        AgentMessage.run_id == reply.run_id, AgentMessage.role == "user")))
    if source is not None:
        message = next((item for item in messages if item.sequence_no == source), None)
        if message is None:
            raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_INVALID")
        return message
    if len(messages) > 1:
        raise ApiError(409, "AGENT_CLARIFICATION_CONTEXT_INVALID")
    return messages[0] if messages else None


def lock_run(db: Session, public_id: str) -> tuple[AgentRun, AgentSession]:
    row = db.execute(select(AgentRun, AgentSession).join(AgentSession, AgentSession.id == AgentRun.session_id).where(
        AgentRun.public_id == public_id)).one_or_none()
    if row is None:
        raise ApiError(404, "AGENT_RUN_NOT_FOUND")
    run, session = row
    lock_active_user(db, session.user_id)
    db.execute(select(AgentSession.id).where(AgentSession.id == session.id).with_for_update())
    db.refresh(run, with_for_update=True)
    if run.status != "running" or session.status != "active":
        raise ApiError(409, "AGENT_RUN_NOT_ACTIVE")
    return run, session


def persist_reply(db: Session, public_id: str, *, source: int, content: str,
                  clarification: dict | None = None) -> AgentMessage:
    run, session = lock_run(db, public_id)
    current = active_message(db, run, lock=True, validate_source=False)
    if current.sequence_no != source:
        raise ApiError(409, "AGENT_REQUEST_SCOPE_STALE")
    # Pi retries a completion after an unknown HTTP outcome with the same source.
    existing = next((item for item in db.scalars(select(AgentMessage).where(
        AgentMessage.run_id == run.id, AgentMessage.role == "assistant"))
        if (item.metadata_json or {}).get("reply_to_sequence_no") == source), None)
    if existing is not None:
        if existing.content != content or (existing.metadata_json or {}).get("clarification") != clarification:
            raise ApiError(409, "AGENT_REPLY_CONFLICT")
        return existing
    sequence = int(db.scalar(select(func.coalesce(func.max(AgentMessage.sequence_no), 0)).where(
        AgentMessage.session_id == session.id)) or 0) + 1
    message = AgentMessage(session_id=session.id, run_id=run.id, sequence_no=sequence,
                           role="assistant", content=content,
                           message_type="clarification" if clarification else "text",
                           metadata_json={"reply_to_sequence_no": source,
                                          **({"clarification": clarification} if clarification else {})})
    db.add(message)
    session.last_message_at = utc_now()
    db.commit()
    db.refresh(message)
    return message
