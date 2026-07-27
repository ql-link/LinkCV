from copy import deepcopy

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.core.database import utc_now
from linkcv.domain.resume_document import ResumeDocumentV1
from linkcv.domain.resume_snapshot import ResumeSnapshot, parse_resume_snapshot
from linkcv.domain.resume_style import ResumeStyleV1, default_resume_style
from linkcv.modules.resumes.models import Resume, ResumeVersion


def parse_decimal_id(value: str) -> int | None:
    if not value or len(value) > 20 or not value.isascii() or not value.isdecimal():
        return None
    parsed = int(value)
    return parsed if 0 < parsed <= 2**64 - 1 and str(parsed) == value else None


def find_owned_resume(db: Session, resume_id: str, user_id: int) -> Resume | None:
    parsed_id = parse_decimal_id(resume_id)
    if parsed_id is None:
        return None
    return db.scalar(
        select(Resume).where(Resume.id == parsed_id, Resume.user_id == user_id)
    )


def lock_owned_resume(db: Session, resume_id: str, user_id: int) -> Resume | None:
    parsed_id = parse_decimal_id(resume_id)
    if parsed_id is None:
        return None
    return db.scalar(
        select(Resume)
        .where(Resume.id == parsed_id, Resume.user_id == user_id)
        .with_for_update()
    )


def create_resume_with_initial_version(
    command: CreateResumeCommand,
    db: Session,
) -> Resume:
    title = command.title.strip() or "未命名简历"
    snapshot = ResumeSnapshot(
        data=command.data,
        style=command.style or default_resume_style(),
    )
    resume = Resume(
        user_id=command.user_id,
        template_id=command.template_id,
        title=title,
        data_json=snapshot.data.model_dump(mode="json"),
        style_json=snapshot.style.model_dump(mode="json"),
        source_type=command.source_type,
        source_filename=command.source_filename,
        source_object_key=command.source_object_key,
        extracted_markdown=command.extracted_markdown,
    )
    try:
        db.add(resume)
        db.flush()
        db.add(
            ResumeVersion(
                resume_id=resume.id,
                version_no=1,
                data_json=deepcopy(resume.data_json),
                style_json=deepcopy(resume.style_json),
                reason="initial",
            )
        )
        db.flush()
        db.refresh(resume)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return resume


def update_resume_snapshot(
    *,
    db: Session,
    resume: Resume,
    user_id: int,
    base_lock_version: int,
    title: str | None,
    data: ResumeDocumentV1 | None,
    style: ResumeStyleV1 | None,
) -> Resume | None:
    current = parse_resume_snapshot(resume.data_json, resume.style_json)
    snapshot = ResumeSnapshot(
        data=data or current.data,
        style=style or current.style,
    )
    values = {
        "title": (title.strip() or "未命名简历") if title is not None else resume.title,
        "data_json": snapshot.data.model_dump(mode="json"),
        "style_json": snapshot.style.model_dump(mode="json"),
        "lock_version": Resume.lock_version + 1,
        "updated_at": utc_now(),
    }
    result = db.execute(
        update(Resume)
        .where(
            Resume.id == resume.id,
            Resume.user_id == user_id,
            Resume.lock_version == base_lock_version,
        )
        .values(**values)
    )
    if result.rowcount != 1:
        db.rollback()
        return None
    updated = db.scalar(select(Resume).where(Resume.id == resume.id))
    db.commit()
    return updated


def _next_version_number(db: Session, resume_id: int) -> int:
    current = db.scalar(
        select(func.max(ResumeVersion.version_no)).where(
            ResumeVersion.resume_id == resume_id
        )
    )
    return int(current or 0) + 1


def _append_version(db: Session, resume: Resume, reason: str) -> ResumeVersion:
    snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
    version = ResumeVersion(
        resume_id=resume.id,
        version_no=_next_version_number(db, resume.id),
        data_json=deepcopy(snapshot.data.model_dump(mode="json")),
        style_json=deepcopy(snapshot.style.model_dump(mode="json")),
        reason=reason,
    )
    db.add(version)
    db.flush()
    return version


def _enforce_version_limit(db: Session, resume_id: int, limit: int) -> None:
    ids = db.scalars(
        select(ResumeVersion.id)
        .where(ResumeVersion.resume_id == resume_id)
        .order_by(ResumeVersion.version_no.desc())
    ).all()
    expired = ids[limit:]
    if expired:
        db.execute(delete(ResumeVersion).where(ResumeVersion.id.in_(expired)))


def create_manual_version(
    db: Session,
    resume_id: str,
    user_id: int,
    version_limit: int,
) -> ResumeVersion | None:
    resume = lock_owned_resume(db, resume_id, user_id)
    if resume is None:
        return None
    try:
        version = _append_version(db, resume, "manual")
        _enforce_version_limit(db, resume.id, version_limit)
        db.refresh(version)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return version


def restore_resume_version(
    db: Session,
    resume_id: str,
    version_no: int,
    user_id: int,
    version_limit: int,
) -> Resume | None:
    resume = lock_owned_resume(db, resume_id, user_id)
    if resume is None:
        return None
    target = db.scalar(
        select(ResumeVersion).where(
            ResumeVersion.resume_id == resume.id,
            ResumeVersion.version_no == version_no,
        )
    )
    if target is None:
        return None

    target_snapshot = parse_resume_snapshot(target.data_json, target.style_json)
    latest = db.scalar(
        select(ResumeVersion)
        .where(ResumeVersion.resume_id == resume.id)
        .order_by(ResumeVersion.version_no.desc())
        .limit(1)
    )
    try:
        if latest is None or (
            latest.data_json != resume.data_json or latest.style_json != resume.style_json
        ):
            _append_version(db, resume, "before_restore")

        resume.data_json = target_snapshot.data.model_dump(mode="json")
        resume.style_json = target_snapshot.style.model_dump(mode="json")
        resume.lock_version += 1
        resume.updated_at = utc_now()
        db.flush()
        _append_version(db, resume, "restore")
        _enforce_version_limit(db, resume.id, version_limit)
        db.refresh(resume)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return resume
