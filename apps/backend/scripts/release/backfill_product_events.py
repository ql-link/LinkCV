"""Backfill product funnel events from existing business records (LOCAL-20260929-GTM-PLAN R7).

Run once after 0098 is migrated and the writing code is live; safe to repeat. Every event carries
``backfilled: true`` and uses the same dedupe key as live writes, so existing events are skipped.
PDF exports and the entry of past AI customizations cannot be recovered and are not backfilled.
"""

from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import drawoffer.models  # noqa: F401  (register every table for foreign keys)
from drawoffer.core.config import load_settings
from drawoffer.core.database import build_engine
from drawoffer.modules.agent.models import ResumeChangeProposal
from drawoffer.modules.identity.models import User
from drawoffer.modules.mock_interviews.models import MockInterview
from drawoffer.modules.product_events.models import ProductEvent
from drawoffer.modules.product_events.service import build_event
from drawoffer.modules.resumes.models import Resume


@dataclass(frozen=True)
class Candidate:
    user_id: int
    name: str
    dedupe_key: str
    properties: dict
    occurred_at: datetime


def candidates(db: Session) -> Iterator[Candidate]:
    for user_id, email, created_at in db.execute(select(User.id, User.email, User.create_time).order_by(User.id)):
        # Email accounts are certain; WeChat QR and mini program accounts cannot be told apart.
        props: dict = {"method": "email"} if email else {}
        yield Candidate(user_id, "user_registered", f"reg:{user_id}", {**props, "backfilled": True}, created_at)
    for resume_id, user_id, source_type, created_at in db.execute(
        select(Resume.id, Resume.user_id, Resume.source_type, Resume.create_time)
        .where(Resume.source_type.in_(("template", "import")))
        .order_by(Resume.id)
    ):
        # Past copies and translations kept their source's type and cannot be told apart.
        yield Candidate(
            user_id, "resume_created", f"resume:{resume_id}",
            {"source": source_type, "resume_id": resume_id, "backfilled": True}, created_at,
        )
    for proposal_id, user_id, resume_id, mode, applied_at in db.execute(
        select(
            ResumeChangeProposal.id, ResumeChangeProposal.user_id, ResumeChangeProposal.resume_id,
            ResumeChangeProposal.proposal_mode, ResumeChangeProposal.applied_at,
        )
        .where(
            ResumeChangeProposal.status == "applied",
            ResumeChangeProposal.proposal_mode != "translate_resume",
            ResumeChangeProposal.applied_at.is_not(None),
        )
        .order_by(ResumeChangeProposal.id)
    ):
        yield Candidate(
            user_id, "ai_customization_applied", f"ai:{proposal_id}",
            {"mode": mode, "entry": "unknown", "resume_id": resume_id, "proposal_id": proposal_id, "backfilled": True},
            applied_at,
        )
    for interview_id, user_id, answer_mode, finished_at, updated_at in db.execute(
        select(
            MockInterview.id, MockInterview.user_id, MockInterview.answer_mode,
            MockInterview.finished_at, MockInterview.update_time,
        )
        .where(MockInterview.status == "completed")
        .order_by(MockInterview.id)
    ):
        yield Candidate(
            user_id, "mock_interview_completed", f"interview:{interview_id}",
            {"answer_mode": answer_mode, "interview_id": interview_id, "backfilled": True},
            finished_at or updated_at,
        )


def backfill(db: Session, *, execute: bool) -> dict[str, Counter]:
    existing = set(db.scalars(select(ProductEvent.dedupe_key).where(ProductEvent.dedupe_key.is_not(None))))
    users = set(db.scalars(select(User.id)))
    stats = {"added": Counter(), "skipped": Counter(), "invalid": Counter()}
    for item in candidates(db):
        if item.dedupe_key in existing:
            stats["skipped"][item.name] += 1
            continue
        if item.user_id not in users or item.occurred_at is None:
            stats["invalid"][item.name] += 1
            continue
        existing.add(item.dedupe_key)
        if not execute:
            stats["added"][item.name] += 1
            continue
        try:
            with db.begin_nested():
                db.add(build_event(
                    user_id=item.user_id, name=item.name, dedupe_key=item.dedupe_key,
                    properties=item.properties, occurred_at=item.occurred_at,
                ))
        except IntegrityError:
            # A live write won the race for the same dedupe key.
            stats["skipped"][item.name] += 1
            continue
        stats["added"][item.name] += 1
    if execute:
        db.commit()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill product funnel events from existing records.")
    parser.add_argument("--dry-run", action="store_true", help="count what would be added without writing")
    args = parser.parse_args()
    engine = build_engine(load_settings().sqlalchemy_url)
    with Session(engine) as db:
        stats = backfill(db, execute=not args.dry_run)
    print(f"product events backfill: mode={'dry-run' if args.dry_run else 'execute'}")
    for kind, counts in stats.items():
        for name in sorted(counts):
            print(f"  {kind} {name}={counts[name]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
