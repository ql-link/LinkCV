"""Conversion funnel for users registered in a window (LOCAL-20260929-GTM-PLAN R6).

The cohort is users created in the window; each later step counts how many of them have reached
it by now, so a user who registered early and acted later still counts toward their cohort.
"""

from __future__ import annotations

from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.modules.admin_insights.window import Window, day_of, day_series
from linkresume.modules.identity.models import User
from linkresume.modules.product_events.models import ProductEvent

# Only template and import count as "has a resume"; copies and translations derive from one.
RESUME_STEP_SOURCES = ("template", "import")


def _first_by_user(db: Session, cohort, name: str) -> dict[int, dict]:
    """Properties of each cohort user's earliest event of ``name``."""
    rows = db.execute(
        select(ProductEvent.user_id, ProductEvent.properties_json)
        .where(ProductEvent.event_name == name, ProductEvent.user_id.in_(cohort))
        .order_by(ProductEvent.user_id, ProductEvent.occurred_at, ProductEvent.id)
    ).all()
    first: dict[int, dict] = {}
    for user_id, props in rows:
        first.setdefault(user_id, props or {})
    return first


def funnel(db: Session, window: Window) -> dict:
    cohort = select(User.id).where(User.create_time >= window.start, User.create_time < window.end)
    created = db.execute(
        select(User.id, User.create_time).where(User.create_time >= window.start, User.create_time < window.end)
    ).all()
    registrations = _first_by_user(db, cohort, "user_registered")
    resumes = _first_by_user(db, cohort, "resume_created")
    ai = _first_by_user(db, cohort, "ai_customization_applied")
    interviews = _first_by_user(db, cohort, "mock_interview_completed")
    exports = _first_by_user(db, cohort, "resume_pdf_exported")

    resume_users = len({
        user_id
        for user_id, props in db.execute(
            select(ProductEvent.user_id, ProductEvent.properties_json).where(
                ProductEvent.event_name == "resume_created", ProductEvent.user_id.in_(cohort)
            )
        ).all()
        if (props or {}).get("source") in RESUME_STEP_SOURCES
    })

    days = (window.end - window.start).days or 1
    per_day = Counter(day_of(created_at) for _, created_at in created)
    return {
        "window": {"from": window.start, "to": window.end},
        "steps": [
            {"key": "registered", "users": len(created)},
            {"key": "resume", "users": resume_users},
            {"key": "ai_customization", "users": len(ai)},
            {"key": "mock_interview", "users": len(interviews)},
            {"key": "pdf_export", "users": len(exports)},
        ],
        "registrationsByMethod": dict(Counter(p.get("method", "unknown") for p in registrations.values())),
        "aiCustomizationByEntry": dict(Counter(p.get("entry", "unknown") for p in ai.values())),
        "resumeBySource": dict(Counter(p.get("source", "unknown") for p in resumes.values())),
        "daily": [
            {"date": day.isoformat(), "registered": per_day.get(day, 0)}
            for day in day_series(window.end, days)
        ],
    }
