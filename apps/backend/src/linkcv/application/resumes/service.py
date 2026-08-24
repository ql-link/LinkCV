from copy import deepcopy
from datetime import timedelta, timezone

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.core.database import utc_now
from linkcv.domain.resume_document import ResumeDocumentV1
from linkcv.domain.resume_snapshot import ResumeSnapshot, parse_resume_snapshot
from linkcv.domain.resume_style import ResumeStyleV1, default_resume_style
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeVersion,
)

MAX_RESUMES_PER_USER = 10


class ResumeLimitExceeded(RuntimeError):
    pass


class InvalidResumeTitle(ValueError):
    pass


class InvalidResumeVersionName(ValueError):
    pass


class ResumeTitleConflict(RuntimeError):
    pass


class ResumeTemplateUnavailable(RuntimeError):
    pass


class ResumeVersionLimitExceeded(RuntimeError):
    pass


class LatestResumeVersionRequired(RuntimeError):
    pass


MAX_RESUME_VERSION_NAME_LENGTH = 80


def default_resume_version_name(reason: str, version_no: int) -> str:
    if reason == "initial":
        return "初始版本"
    if reason == "before_restore":
        return "恢复前备份"
    if reason == "restore":
        return "恢复结果（历史记录）"
    return f"版本 {version_no}"


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


def has_resume_capacity(db: Session, user_id: int) -> bool:
    return resume_slot_count(db, user_id) < MAX_RESUMES_PER_USER


def resume_slot_count(db: Session, user_id: int) -> int:
    resume_count = db.scalar(
        select(func.count(Resume.id)).where(Resume.user_id == user_id)
    )
    active_import_count = db.scalar(
        select(func.count(DocumentParseTask.id)).where(
            DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
            DocumentParseTask.user_id == user_id,
            or_(
                DocumentParseTask.upload_status == "uploading",
                DocumentParseTask.parse_status == "processing",
            ),
        )
    )
    return int(resume_count or 0) + int(active_import_count or 0)


def close_stale_resume_imports(
    db: Session,
    *,
    user_id: int,
    upload_stale_seconds: int,
    parse_stale_seconds: int,
) -> None:
    now = utc_now()
    upload_cutoff = now - timedelta(seconds=upload_stale_seconds)
    parse_cutoff = now - timedelta(seconds=parse_stale_seconds)
    records = db.scalars(
        select(DocumentParseTask)
        .where(
            DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
            DocumentParseTask.user_id == user_id,
            or_(
                and_(
                    DocumentParseTask.upload_status == "uploading",
                    DocumentParseTask.updated_at < upload_cutoff,
                ),
                and_(
                    DocumentParseTask.parse_status == "processing",
                    DocumentParseTask.updated_at < parse_cutoff,
                ),
            ),
        )
        .with_for_update()
    ).all()
    for record in records:
        created_at = record.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        elapsed_ms = round((now - created_at).total_seconds() * 1000)
        elapsed_ms = min(max(0, elapsed_ms), 2**32 - 1)
        if record.upload_status == "uploading":
            record.upload_status = "failed"
            record.upload_duration_ms = elapsed_ms
        else:
            record.parse_status = "failed"
            record.parse_duration_ms = elapsed_ms
            record.failure_reason = "timeout"
    if records:
        db.commit()


def normalize_resume_title(value: str | None) -> str:
    if value is None:
        raise InvalidResumeTitle
    normalized = " ".join(value.split())
    if not normalized or len(normalized) > 255:
        raise InvalidResumeTitle
    return normalized


def resume_title_key(value: str) -> str:
    return normalize_resume_title(value).casefold()


def _assert_unique_resume_title(
    db: Session,
    *,
    user_id: int,
    title: str,
    exclude_resume_id: int | None = None,
) -> None:
    expected_key = resume_title_key(title)
    rows = db.execute(
        select(Resume.id, Resume.title).where(Resume.user_id == user_id)
    ).all()
    if any(
        resume_id != exclude_resume_id
        and resume_title_key(existing_title) == expected_key
        for resume_id, existing_title in rows
    ):
        raise ResumeTitleConflict


def persist_resume_with_initial_version(
    command: CreateResumeCommand,
    db: Session,
) -> Resume:
    snapshot = ResumeSnapshot(
        data=command.data,
        style=command.style or default_resume_style(),
    )
    resume = Resume(
        user_id=command.user_id,
        template_id=command.template_id,
        title=command.title,
        data_json=snapshot.data.model_dump(mode="json"),
        style_json=snapshot.style.model_dump(mode="json"),
        source_type=command.source_type,
    )
    db.add(resume)
    db.flush()
    db.add(
        ResumeVersion(
            resume_id=resume.id,
            version_no=1,
            data_json=deepcopy(resume.data_json),
            style_json=deepcopy(resume.style_json),
            reason="initial",
            name=default_resume_version_name("initial", 1),
        )
    )
    db.flush()
    db.refresh(resume)
    return resume


def create_resume_with_initial_version(
    command: CreateResumeCommand,
    db: Session,
) -> Resume:
    try:
        locked_user_id = db.scalar(
            select(User.id).where(User.id == command.user_id).with_for_update()
        )
        if locked_user_id is None:
            raise RuntimeError("resume owner no longer exists")
        if not has_resume_capacity(db, command.user_id):
            raise ResumeLimitExceeded

        normalized_command = CreateResumeCommand(
            **{**command.__dict__, "title": normalize_resume_title(command.title)}
        )
        resume = persist_resume_with_initial_version(normalized_command, db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return resume


def create_resume_from_template(
    *,
    db: Session,
    user_id: int,
    title: str | None,
    template_id: int,
) -> Resume:
    from linkcv.modules.resumes.models import ResumeTemplate

    normalized_title = normalize_resume_title(title)
    try:
        locked_user_id = db.scalar(
            select(User.id).where(User.id == user_id).with_for_update()
        )
        if locked_user_id is None:
            raise RuntimeError("resume owner no longer exists")
        if not has_resume_capacity(db, user_id):
            raise ResumeLimitExceeded
        _assert_unique_resume_title(db, user_id=user_id, title=normalized_title)
        template = db.scalar(
            select(ResumeTemplate)
            .where(
                ResumeTemplate.id == template_id,
                ResumeTemplate.is_active == 1,
            )
            .with_for_update()
        )
        if template is None:
            raise ResumeTemplateUnavailable
        try:
            snapshot = parse_resume_snapshot(template.data_json, template.style_json)
        except ValueError as error:
            raise ResumeTemplateUnavailable from error
        resume = persist_resume_with_initial_version(
            CreateResumeCommand(
                user_id=user_id,
                title=normalized_title,
                data=snapshot.data,
                style=snapshot.style,
                source_type="template",
                template_id=template.id,
            ),
            db,
        )
        db.commit()
        return resume
    except Exception:
        db.rollback()
        raise


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
    next_title = resume.title
    if title is not None:
        next_title = normalize_resume_title(title)
        db.scalar(select(User.id).where(User.id == user_id).with_for_update())
        if resume_title_key(next_title) != resume_title_key(resume.title):
            _assert_unique_resume_title(
                db,
                user_id=user_id,
                title=next_title,
                exclude_resume_id=resume.id,
            )
    values = {
        "title": next_title,
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


def normalize_resume_version_name(value: str | None, *, default: str) -> str:
    normalized = default if value is None else " ".join(value.split())
    if not normalized or len(normalized) > MAX_RESUME_VERSION_NAME_LENGTH:
        raise InvalidResumeVersionName
    return normalized


def _append_version(
    db: Session,
    resume: Resume,
    reason: str,
    name: str | None = None,
) -> ResumeVersion:
    snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
    version_no = _next_version_number(db, resume.id)
    version = ResumeVersion(
        resume_id=resume.id,
        version_no=version_no,
        data_json=deepcopy(snapshot.data.model_dump(mode="json")),
        style_json=deepcopy(snapshot.style.model_dump(mode="json")),
        reason=reason,
        name=normalize_resume_version_name(
            name,
            default=default_resume_version_name(reason, version_no),
        ),
    )
    db.add(version)
    db.flush()
    return version


def _version_count(db: Session, resume_id: int) -> int:
    count = db.scalar(
        select(func.count(ResumeVersion.id)).where(ResumeVersion.resume_id == resume_id)
    )
    return int(count or 0)


def append_resume_version(
    db: Session,
    resume: Resume,
    *,
    reason: str,
    version_limit: int,
    name: str | None = None,
) -> ResumeVersion:
    """Append a version while the caller holds the resume row lock."""
    if _version_count(db, resume.id) >= version_limit:
        raise ResumeVersionLimitExceeded
    return _append_version(db, resume, reason, name)


def create_manual_version(
    db: Session,
    resume_id: str,
    user_id: int,
    version_limit: int,
    name: str | None = None,
) -> ResumeVersion | None:
    resume = lock_owned_resume(db, resume_id, user_id)
    if resume is None:
        return None
    try:
        version = append_resume_version(
            db,
            resume,
            reason="manual",
            version_limit=version_limit,
            name=name,
        )
        db.refresh(version)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return version


def rename_resume_version(
    db: Session,
    resume_id: str,
    version_no: int,
    user_id: int,
    name: str,
) -> ResumeVersion | None:
    resume = lock_owned_resume(db, resume_id, user_id)
    if resume is None:
        return None
    version = db.scalar(
        select(ResumeVersion).where(
            ResumeVersion.resume_id == resume.id,
            ResumeVersion.version_no == version_no,
        )
    )
    if version is None:
        return None
    try:
        version.name = normalize_resume_version_name(name, default=version.name)
        db.flush()
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
    try:
        resume.data_json = target_snapshot.data.model_dump(mode="json")
        resume.style_json = target_snapshot.style.model_dump(mode="json")
        resume.lock_version += 1
        resume.updated_at = utc_now()
        db.flush()
        db.refresh(resume)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return resume


def delete_resume_version(
    db: Session,
    resume_id: str,
    version_no: int,
    user_id: int,
) -> bool | None:
    resume = lock_owned_resume(db, resume_id, user_id)
    if resume is None:
        return None
    try:
        version = db.scalar(
            select(ResumeVersion).where(
                ResumeVersion.resume_id == resume.id,
                ResumeVersion.version_no == version_no,
            )
        )
        if version is None:
            return None
        latest_version_no = db.scalar(
            select(func.max(ResumeVersion.version_no)).where(
                ResumeVersion.resume_id == resume.id
            )
        )
        if version.version_no == latest_version_no:
            raise LatestResumeVersionRequired
        db.execute(delete(ResumeVersion).where(ResumeVersion.id == version.id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return True
