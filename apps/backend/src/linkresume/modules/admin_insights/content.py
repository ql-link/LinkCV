"""User, template and browser-plugin import statistics."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from linkresume.modules.admin_insights.window import aware, day_of, day_series
from linkresume.modules.identity.models import User
from linkresume.modules.job_descriptions.models import JobDescription
from linkresume.modules.resumes.models import Resume, ResumeTemplate

PENDING_REVIEW = "unsure"


def _daily(values, end: datetime, days: int) -> list[dict[str, object]]:
    counts = Counter(day_of(value) for value in values if value is not None)
    return [{"date": day.isoformat(), "count": counts.get(day, 0)} for day in day_series(end, days)]


def _start_of_day(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def user_stats(db: Session, now: datetime) -> dict[str, object]:
    week = now - timedelta(days=7)
    count = lambda *where: db.scalar(select(func.count(User.id)).where(*where)) or 0  # noqa: E731
    created = db.scalars(
        select(User.created_at).where(User.created_at >= _start_of_day(now) - timedelta(days=13))
    ).all()
    return {
        "total": count(),
        "newUsers7d": count(User.created_at >= week),
        "activeUsers7d": count(User.last_login_at >= week, User.status == 1),
        "disabled": count(User.status == 0),
        "admins": count(User.is_admin == 1),
        "registeredToday": count(User.created_at >= _start_of_day(now)),
        "daily": _daily(created, now, 14),
    }


def template_stats(db: Session, now: datetime, limit: int) -> dict[str, object]:
    templates = db.execute(
        select(
            ResumeTemplate.id,
            ResumeTemplate.key,
            ResumeTemplate.name,
            ResumeTemplate.is_active,
            ResumeTemplate.style_review_status,
        )
    ).all()
    usage = dict(
        db.execute(select(Resume.template_id, func.count(Resume.id)).group_by(Resume.template_id)).all()
    )
    used_today = db.scalar(
        select(func.count(Resume.id)).where(Resume.created_at >= _start_of_day(now))
    ) or 0
    items = sorted(
        (
            {"templateId": str(row.id), "key": row.key, "name": row.name,
             "resumeCount": usage.get(row.id, 0)}
            for row in templates
        ),
        key=lambda item: (-item["resumeCount"], item["key"]),
    )
    active = sum(1 for row in templates if row.is_active)
    return {
        "total": len(templates),
        "active": active,
        "inactive": len(templates) - active,
        "pendingReview": sum(
            1 for row in templates if row.is_active and row.style_review_status == PENDING_REVIEW
        ),
        "usedToday": used_today,
        "usage": items,
        "top": items[:limit],
    }


def job_import_stats(db: Session, now: datetime) -> dict[str, object]:
    month = now - timedelta(days=30)
    week = now - timedelta(days=7)
    rows = db.execute(
        select(JobDescription.imported_at, JobDescription.source_site, JobDescription.user_id).where(
            JobDescription.source_type == "external_import",
            JobDescription.imported_at >= _start_of_day(now) - timedelta(days=29),
        )
    ).all()
    recent_month = [row for row in rows if aware(row.imported_at) >= month]
    recent_week = [row for row in recent_month if aware(row.imported_at) >= week]
    sources = Counter(row.source_site for row in recent_month)
    return {
        "imported7d": len(recent_week),
        "imported30d": len(recent_month),
        "users7d": len({row.user_id for row in recent_week}),
        "sources": [
            {"site": site, "count": count}
            for site, count in sorted(sources.items(), key=lambda item: (-item[1], item[0]))
        ],
        "daily": _daily((row.imported_at for row in rows), now, 30),
    }


def pending_review_count(db: Session) -> int:
    return db.scalar(
        select(func.count(ResumeTemplate.id)).where(
            ResumeTemplate.is_active == 1,
            ResumeTemplate.style_review_status == PENDING_REVIEW,
        )
    ) or 0
