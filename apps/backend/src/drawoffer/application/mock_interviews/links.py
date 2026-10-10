"""Clear mock interview source links when a source aggregate is deleted.

Kept free of the mock interview service imports so the resume, job and
application deletion paths can call it without an import cycle.
"""

from __future__ import annotations

from sqlalchemy import update
from sqlalchemy.orm import Session

from drawoffer.modules.mock_interviews.models import MockInterview


def detach_resume(db: Session, *, user_id: int, resume_id: int) -> None:
    db.execute(
        update(MockInterview)
        .where(MockInterview.user_id == user_id, MockInterview.resume_id == resume_id)
        .values(resume_id=None)
    )


def detach_applications(db: Session, application_ids: list[int]) -> None:
    if application_ids:
        db.execute(
            update(MockInterview)
            .where(MockInterview.job_application_id.in_(application_ids))
            .values(job_application_id=None)
        )


def detach_job(db: Session, job_id: int) -> None:
    db.execute(
        update(MockInterview)
        .where(MockInterview.job_description_id == job_id)
        .values(job_description_id=None)
    )
