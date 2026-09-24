"""Owner-scoped links to current resumes, without content or image copies."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import parse_decimal_id
from linkresume.core.errors import ApiError
from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.resumes.models import Resume


def get_linked_resume(db: Session, application: JobApplication) -> Resume | None:
    if application.resume_id is None:
        return None
    return db.scalar(select(Resume).where(
        Resume.id == application.resume_id, Resume.user_id == application.user_id,
    ))


def current_resume_title(db: Session, application: JobApplication) -> str | None:
    resume = get_linked_resume(db, application)
    return resume.title if resume else None


def bind_resume(db: Session, application: JobApplication, payload) -> None:
    if getattr(payload, "resume_version_id", None) is not None:
        raise ApiError(410, "RESUME_VERSION_RETIRED")
    if "resume_id" not in payload.model_fields_set:
        return
    source = None
    if payload.resume_id is not None:
        source = db.scalar(select(Resume).where(
            Resume.id == parse_decimal_id(payload.resume_id),
            Resume.user_id == application.user_id,
        ).with_for_update())
        if source is None:
            raise ApiError(404, "RESUME_NOT_FOUND")
    application.resume_id = source.id if source else None
    application.resume_version_id = None
    application.resume_title_snapshot = None
