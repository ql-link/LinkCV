"""Write product funnel events.

``add_event`` joins the caller's transaction so an event exists exactly when the business
result does. ``record_event_best_effort`` is for read-only requests (PDF export): it commits on
its own and never lets a failure reach the response.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.orm import Session

from linkresume.modules.product_events.models import ProductEvent
from linkresume.modules.identity.dependencies import lock_active_user

logger = logging.getLogger(__name__)

EventName = Literal[
    "user_registered",
    "resume_created",
    "ai_customization_applied",
    "mock_interview_completed",
    "resume_pdf_exported",
]
RegistrationMethod = Literal["wechat_qr", "wechat_miniprogram", "email"]
ResumeSource = Literal["template", "import", "copy", "translate"]
ProposalEntry = Literal["assistant", "editor", "unknown"]
AnswerMode = Literal["text", "voice"]
ExportChannel = Literal["web", "miniprogram", "desktop"]

# Property whitelist per event; values are enums or business ids, never user content.
ALLOWED_PROPERTIES: dict[str, frozenset[str]] = {
    "user_registered": frozenset({"method", "backfilled"}),
    "resume_created": frozenset({"source", "resume_id", "backfilled"}),
    "ai_customization_applied": frozenset({"mode", "entry", "resume_id", "proposal_id", "backfilled"}),
    "mock_interview_completed": frozenset({"answer_mode", "interview_id", "backfilled"}),
    "resume_pdf_exported": frozenset({"channel", "resume_id"}),
}


def _now() -> datetime:
    return datetime.now(UTC)


def build_event(
    *,
    user_id: int,
    name: EventName,
    dedupe_key: str | None,
    properties: dict[str, str | int | bool] | None = None,
    occurred_at: datetime | None = None,
) -> ProductEvent:
    props = dict(properties or {})
    unknown = set(props) - ALLOWED_PROPERTIES[name]
    if unknown:
        raise ValueError(f"unexpected product event properties for {name}: {sorted(unknown)}")
    return ProductEvent(
        user_id=user_id,
        event_name=name,
        dedupe_key=dedupe_key,
        properties_json=props or None,
        occurred_at=occurred_at or _now(),
    )


def add_event(db: Session, **kwargs) -> ProductEvent:
    """Stage an event in the current transaction; the caller commits."""
    event = build_event(**kwargs)
    db.add(event)
    return event


def record_event_best_effort(db: Session, **kwargs) -> None:
    """Commit an event on its own; failures are logged and swallowed."""
    try:
        lock_active_user(db, kwargs["user_id"])
        db.add(build_event(**kwargs))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("product event write failed", extra={"event_name": kwargs.get("name")})


def registered(db: Session, user_id: int, method: RegistrationMethod) -> None:
    add_event(db, user_id=user_id, name="user_registered", dedupe_key=f"reg:{user_id}", properties={"method": method})


def ai_customization_applied(
    db: Session, user_id: int, *, proposal_id: int, resume_id: int, mode: str, entry: ProposalEntry
) -> None:
    add_event(
        db,
        user_id=user_id,
        name="ai_customization_applied",
        dedupe_key=f"ai:{proposal_id}",
        properties={"mode": mode, "entry": entry, "resume_id": resume_id, "proposal_id": proposal_id},
    )


def mock_interview_completed(db: Session, user_id: int, interview_id: int, answer_mode: str) -> None:
    add_event(
        db,
        user_id=user_id,
        name="mock_interview_completed",
        dedupe_key=f"interview:{interview_id}",
        properties={"answer_mode": answer_mode, "interview_id": interview_id},
    )


def resume_created(db: Session, user_id: int, resume_id: int, source: ResumeSource) -> None:
    add_event(
        db,
        user_id=user_id,
        name="resume_created",
        dedupe_key=f"resume:{resume_id}",
        properties={"source": source, "resume_id": resume_id},
    )


def pdf_exported(db: Session, user_id: int, resume_id: int, channel: ExportChannel) -> None:
    """Best effort: the user already has the PDF, a lost event must not turn it into an error."""
    record_event_best_effort(
        db,
        user_id=user_id,
        name="resume_pdf_exported",
        dedupe_key=None,
        properties={"channel": channel, "resume_id": resume_id},
    )
