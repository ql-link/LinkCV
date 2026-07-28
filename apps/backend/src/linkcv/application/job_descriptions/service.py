from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import String, and_, cast, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import parse_decimal_id
from linkcv.core.database import utc_now
from linkcv.domain.job_source import (
    InvalidJobSource,
    NormalizedJobSource,
    normalize_job_source,
)
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.job_descriptions.schemas import (
    JobDescriptionCreateRequest,
    JobDescriptionUpdateRequest,
    _validate_salary_values,
)


class JobEditConflict(RuntimeError):
    pass


class JobWriteFailed(RuntimeError):
    pass


@dataclass(slots=True)
class DuplicateJobDescription(RuntimeError):
    existing: JobDescription


@dataclass(frozen=True, slots=True)
class CreateJobResult:
    job: JobDescription
    created: bool


_MUTABLE_FIELDS = (
    "job_title",
    "company_name",
    "employment_type",
    "description",
    "skills",
    "education_requirement",
    "experience_requirement",
    "work_schedule",
    "work_city",
    "work_address",
    "work_mode",
    "salary_text",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
    "salary_months_per_year",
    "company_legal_name",
    "company_industry",
    "company_size",
    "company_financing_stage",
    "company_description",
    "recruiter_name",
    "recruiter_title",
    "notes",
)


def create_or_resolve_job(
    *, db: Session, user_id: int, payload: JobDescriptionCreateRequest
) -> CreateJobResult:
    source = _normalize_payload_source(payload)
    duplicate = _find_duplicate(db, user_id, source)
    if duplicate is not None:
        if payload.duplicate_resolution is None:
            raise DuplicateJobDescription(duplicate)
        return CreateJobResult(
            job=_resolve_duplicate(db, user_id, payload, source, duplicate),
            created=False,
        )
    if payload.duplicate_resolution is not None:
        raise JobEditConflict

    values = _create_values(payload)
    now = utc_now()
    job = JobDescription(
        user_id=user_id,
        **values,
        source_type=payload.source_type,
        source_site=source.site if source else None,
        source_job_id=source.job_id if source else None,
        source_url=source.url if source else None,
        source_url_hash=source.url_hash if source else None,
        imported_at=now if payload.source_type == "external_import" else None,
        created_at=now,
        updated_at=now,
    )
    try:
        db.add(job)
        db.flush()
        db.refresh(job)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        duplicate = _find_duplicate(db, user_id, source)
        if duplicate is not None:
            raise DuplicateJobDescription(duplicate) from error
        raise JobWriteFailed from error
    except Exception:
        db.rollback()
        raise
    return CreateJobResult(job=job, created=True)


def find_owned_job(db: Session, job_id: str, user_id: int) -> JobDescription | None:
    parsed = parse_decimal_id(job_id)
    if parsed is None:
        return None
    return db.scalar(
        select(JobDescription).where(
            JobDescription.id == parsed,
            JobDescription.user_id == user_id,
        )
    )


def update_owned_job(
    *,
    db: Session,
    job: JobDescription,
    user_id: int,
    payload: JobDescriptionUpdateRequest,
) -> JobDescription | None:
    provided = payload.model_dump(exclude_unset=True)
    provided.pop("base_lock_version", None)
    _validate_merged_salary(job, provided)
    values = {field: provided[field] for field in _MUTABLE_FIELDS if field in provided}
    values.update(
        {
            "lock_version": JobDescription.lock_version + 1,
            "updated_at": utc_now(),
        }
    )
    try:
        result = db.execute(
            update(JobDescription)
            .where(
                JobDescription.id == job.id,
                JobDescription.user_id == user_id,
                JobDescription.lock_version == payload.base_lock_version,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            db.rollback()
            return None
        updated_job = db.scalar(
            select(JobDescription).where(JobDescription.id == job.id)
        )
        db.commit()
        return updated_job
    except Exception:
        db.rollback()
        raise


def set_job_archived(
    *,
    db: Session,
    job: JobDescription,
    user_id: int,
    base_lock_version: int,
    archived: bool,
) -> JobDescription | None:
    state_filter = (
        JobDescription.archived_at.is_(None)
        if archived
        else JobDescription.archived_at.is_not(None)
    )
    now = utc_now()
    try:
        result = db.execute(
            update(JobDescription)
            .where(
                JobDescription.id == job.id,
                JobDescription.user_id == user_id,
                JobDescription.lock_version == base_lock_version,
                state_filter,
            )
            .values(
                archived_at=now if archived else None,
                lock_version=JobDescription.lock_version + 1,
                updated_at=now,
            )
        )
        if result.rowcount != 1:
            db.rollback()
            return None
        updated_job = db.scalar(
            select(JobDescription).where(JobDescription.id == job.id)
        )
        db.commit()
        return updated_job
    except Exception:
        db.rollback()
        raise


def hard_delete_owned_job(db: Session, job: JobDescription, user_id: int) -> bool:
    try:
        result = db.execute(
            delete(JobDescription).where(
                JobDescription.id == job.id,
                JobDescription.user_id == user_id,
            )
        )
        db.commit()
        return result.rowcount == 1
    except Exception:
        db.rollback()
        raise


def list_owned_jobs(
    *,
    db: Session,
    user_id: int,
    scope: Literal["active", "archived", "all"],
    keyword: str | None,
    cursor: str | None,
    limit: int,
) -> tuple[list[JobDescription], str | None]:
    normalized_keyword = keyword.strip() if keyword else ""
    query = select(JobDescription).where(JobDescription.user_id == user_id)
    if scope == "active":
        query = query.where(JobDescription.archived_at.is_(None))
    elif scope == "archived":
        query = query.where(JobDescription.archived_at.is_not(None))

    if normalized_keyword:
        pattern = f"%{_escape_like(normalized_keyword.lower())}%"
        text_columns = (
            JobDescription.job_title,
            JobDescription.company_name,
            JobDescription.work_city,
            JobDescription.work_address,
            JobDescription.description,
            JobDescription.notes,
            cast(JobDescription.skills, String),
        )
        query = query.where(
            or_(
                *(
                    func.lower(column).like(pattern, escape="\\")
                    for column in text_columns
                )
            )
        )

    if cursor:
        cursor_time, cursor_id = _decode_cursor(
            cursor,
            scope=scope,
            normalized_keyword=normalized_keyword,
        )
        query = query.where(
            or_(
                JobDescription.updated_at < cursor_time,
                and_(
                    JobDescription.updated_at == cursor_time,
                    JobDescription.id < cursor_id,
                ),
            )
        )

    rows = list(
        db.scalars(
            query.order_by(JobDescription.updated_at.desc(), JobDescription.id.desc()).limit(
                limit + 1
            )
        ).all()
    )
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = (
        _encode_cursor(items[-1], scope, normalized_keyword)
        if has_more and items
        else None
    )
    return items, next_cursor


def _normalize_payload_source(
    payload: JobDescriptionCreateRequest,
) -> NormalizedJobSource | None:
    if payload.source_type == "external_import" and not payload.source_url:
        raise InvalidJobSource("external_import requires source_url")
    if not payload.source_url:
        return None
    return normalize_job_source(payload.source_url)


def _find_duplicate(
    db: Session,
    user_id: int,
    source: NormalizedJobSource | None,
) -> JobDescription | None:
    if source is None:
        return None
    if source.job_id is not None:
        duplicate = db.scalar(
            select(JobDescription).where(
                JobDescription.user_id == user_id,
                JobDescription.source_site == source.site,
                JobDescription.source_job_id == source.job_id,
            )
        )
        if duplicate is not None:
            return duplicate
    return db.scalar(
        select(JobDescription).where(
            JobDescription.user_id == user_id,
            JobDescription.source_url_hash == source.url_hash,
        )
    )


def _resolve_duplicate(
    db: Session,
    user_id: int,
    payload: JobDescriptionCreateRequest,
    source: NormalizedJobSource | None,
    duplicate: JobDescription,
) -> JobDescription:
    resolution = payload.duplicate_resolution
    if resolution is None or source is None:
        raise JobEditConflict
    parsed_id = parse_decimal_id(resolution.job_description_id)
    if parsed_id is None or parsed_id != duplicate.id:
        raise JobEditConflict
    target = db.scalar(
        select(JobDescription)
        .where(
            JobDescription.id == parsed_id,
            JobDescription.user_id == user_id,
        )
        .with_for_update()
    )
    if (
        target is None
        or target.lock_version != resolution.base_lock_version
        or not _source_matches(target, source)
    ):
        db.rollback()
        raise JobEditConflict

    now = utc_now()
    if resolution.action == "restore":
        if target.archived_at is None:
            db.rollback()
            raise JobEditConflict
        target.archived_at = None
    else:
        values = _create_values(payload)
        values.pop("notes", None)
        for field, value in values.items():
            setattr(target, field, value)
        target.archived_at = None
    target.lock_version += 1
    target.updated_at = now
    try:
        db.flush()
        db.refresh(target)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return target


def _source_matches(job: JobDescription, source: NormalizedJobSource) -> bool:
    native_match = (
        source.job_id is not None
        and job.source_site == source.site
        and job.source_job_id == source.job_id
    )
    return native_match or job.source_url_hash == source.url_hash


def _create_values(payload: JobDescriptionCreateRequest) -> dict[str, object]:
    dumped = payload.model_dump(exclude={"source_type", "source_url", "duplicate_resolution"})
    return {field: dumped[field] for field in _MUTABLE_FIELDS}


def _validate_merged_salary(
    job: JobDescription, provided: dict[str, object]
) -> None:
    _validate_salary_values(
        provided.get("salary_min", job.salary_min),
        provided.get("salary_max", job.salary_max),
        provided.get("salary_currency", job.salary_currency),
        provided.get("salary_period", job.salary_period),
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _keyword_digest(keyword: str) -> str:
    return hashlib.sha256(keyword.encode("utf-8")).hexdigest()


def _encode_cursor(job: JobDescription, scope: str, keyword: str) -> str:
    cursor_time = job.updated_at
    if cursor_time.tzinfo is None:
        # MySQL DATETIME intentionally has no timezone metadata; the application
        # and database contract store these values in UTC.
        cursor_time = cursor_time.replace(tzinfo=timezone.utc)
    else:
        cursor_time = cursor_time.astimezone(timezone.utc)
    payload = {
        "updated_at": cursor_time.isoformat(),
        "id": str(job.id),
        "scope": scope,
        "keyword_hash": _keyword_digest(keyword),
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def _decode_cursor(cursor: str, *, scope: str, normalized_keyword: str) -> tuple[datetime, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        decoded = base64.b64decode(padded, altchars=b"-_", validate=True)
        payload = json.loads(decoded.decode("utf-8"))
        cursor_id = parse_decimal_id(payload["id"])
        cursor_time = datetime.fromisoformat(payload["updated_at"])
        if (
            cursor_id is None
            or cursor_time.tzinfo is None
            or cursor_time.utcoffset() != timedelta(0)
            or payload["scope"] != scope
            or payload["keyword_hash"] != _keyword_digest(normalized_keyword)
        ):
            raise ValueError
        cursor_time = cursor_time.astimezone(timezone.utc)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("invalid job list cursor") from error
    return cursor_time, cursor_id
