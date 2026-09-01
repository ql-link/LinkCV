from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.application.interviews.state import (
    ApplicationStateValue,
    InvalidTransition,
    POST_APPLICATION_SCREENING_LABEL,
    advance_application as transition_advance,
    cancel_current_session,
    close_application as transition_close,
    complete_session as transition_complete,
    record_offer as transition_offer,
    schedule_current_stage,
)
from linkcv.application.resumes.service import parse_decimal_id
from linkcv.core.database import utc_now
from linkcv.modules.interviews.models import (
    InterviewAsset,
    InterviewSession,
    JobApplication,
)
from linkcv.modules.interviews.schemas import (
    AdvanceApplicationRequest,
    CancelInterviewRequest,
    CloseApplicationRequest,
    CompleteInterviewRequest,
    InterviewSessionCreateRequest,
    InterviewSessionUpdateRequest,
    JobApplicationCreateRequest,
    JobApplicationUpdateRequest,
    OfferApplicationRequest,
    RescheduleInterviewRequest,
)
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.resumes.models import Resume, ResumeVersion


class InterviewNotFound(LookupError):
    pass


class InterviewResumeRequired(RuntimeError):
    pass


class InterviewResumeVersionRequired(RuntimeError):
    pass


class InterviewEditConflict(RuntimeError):
    pass


class InterviewInvalidTransition(RuntimeError):
    pass


class InterviewApplicationNotEmpty(RuntimeError):
    pass


class InterviewSessionNotEmpty(RuntimeError):
    pass


class InvalidInterviewTime(ValueError):
    pass


class InvalidInterviewCursor(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class TimeConflict:
    id: int
    application_id: int
    company_name: str
    stage_label: str
    start_at: datetime
    end_at: datetime


@dataclass(slots=True)
class InterviewTimeConflict(RuntimeError):
    conflicts: list[TimeConflict]


@dataclass(frozen=True, slots=True)
class SessionWithApplication:
    session: InterviewSession
    application: JobApplication


CALENDAR_COLORS = ("red", "orange", "yellow", "green", "blue", "purple", "gray")


def _cursor_filter_digest(values: dict[str, object]) -> str:
    normalized = json.dumps(values, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _normalize_cursor_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _encode_cursor(
    *, kind: str, timestamp: datetime, row_id: int, filter_digest: str
) -> str:
    payload = {
        "kind": kind,
        "timestamp": _normalize_cursor_time(timestamp).isoformat(),
        "id": str(row_id),
        "filter_digest": filter_digest,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def _decode_cursor(
    cursor: str, *, kind: str, filter_digest: str
) -> tuple[datetime, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.b64decode(padded, altchars=b"-_", validate=True)
        payload = json.loads(raw.decode("utf-8"))
        if set(payload) != {"kind", "timestamp", "id", "filter_digest"}:
            raise ValueError
        timestamp = datetime.fromisoformat(payload["timestamp"])
        row_id = int(payload["id"])
        if (
            timestamp.tzinfo is None
            or timestamp.utcoffset() != timedelta(0)
            or row_id < 1
            or payload["kind"] != kind
            or payload["filter_digest"] != filter_digest
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise InvalidInterviewCursor from error
    return timestamp.astimezone(UTC), row_id


def _application_state(application: JobApplication) -> ApplicationStateValue:
    return ApplicationStateValue(
        stage_type=application.current_stage_type,  # type: ignore[arg-type]
        round_no=application.current_round_no,
        stage_label=application.current_stage_label,
        stage_state=application.stage_state,  # type: ignore[arg-type]
        status=application.status,  # type: ignore[arg-type]
        offer_status=application.offer_status,  # type: ignore[arg-type]
    )


def _apply_state(application: JobApplication, state: ApplicationStateValue) -> None:
    application.current_stage_type = state.stage_type
    application.current_round_no = state.round_no
    application.current_stage_label = state.stage_label
    application.stage_state = state.stage_state
    application.status = state.status
    application.offer_status = state.offer_status


def _job_snapshot(job: JobDescription) -> dict[str, object]:
    def json_value(value: object) -> object:
        if isinstance(value, Decimal):
            return str(value)
        if isinstance(value, datetime):
            return value.isoformat()
        return value

    fields = (
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
        "company_industry",
        "company_size",
        "company_financing_stage",
        "company_description",
        "recruiter_name",
        "recruiter_title",
        "source_type",
        "source_site",
        "source_url",
    )
    return {
        "schema_version": 1,
        **{field: json_value(getattr(job, field)) for field in fields},
    }


def _owned_resume_version(
    db: Session, user_id: int, version_id: int | None
) -> ResumeVersion | None:
    if version_id is None:
        return None
    return db.scalar(
        select(ResumeVersion)
        .join(Resume, Resume.id == ResumeVersion.resume_id)
        .where(ResumeVersion.id == version_id, Resume.user_id == user_id)
    )


def _owned_resume(db: Session, user_id: int, resume_id: int) -> Resume | None:
    return db.scalar(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user_id)
    )


def _latest_resume_version(db: Session, resume_id: int) -> ResumeVersion | None:
    return db.scalar(
        select(ResumeVersion)
        .where(ResumeVersion.resume_id == resume_id)
        .order_by(ResumeVersion.version_no.desc(), ResumeVersion.id.desc())
        .limit(1)
    )


def create_application(
    db: Session, user_id: int, payload: JobApplicationCreateRequest
) -> JobApplication:
    job_description_id = parse_decimal_id(payload.job_description_id)
    if job_description_id is None:
        raise InterviewNotFound
    job = db.scalar(
        select(JobDescription).where(
            JobDescription.id == job_description_id,
            JobDescription.user_id == user_id,
        )
    )
    if job is None:
        raise InterviewNotFound
    resume_version_id = (
        parse_decimal_id(payload.resume_version_id)
        if payload.resume_version_id is not None
        else None
    )
    if payload.resume_version_id is not None and resume_version_id is None:
        raise InterviewNotFound
    resume_version = _owned_resume_version(db, user_id, resume_version_id)
    if resume_version_id is not None and resume_version is None:
        raise InterviewNotFound
    now = utc_now()
    application = JobApplication(
        user_id=user_id,
        job_description_id=job.id,
        resume_version_id=resume_version.id if resume_version else None,
        company_name_snapshot=job.company_name,
        job_title_snapshot=job.job_title,
        job_snapshot=_job_snapshot(job),
        resume_title_snapshot=resume_version.name if resume_version else None,
        calendar_color=secrets.choice(CALENDAR_COLORS),
        current_stage_type=payload.current_stage_type,
        current_round_no=payload.current_round_no,
        current_stage_label=payload.current_stage_label,
        stage_state=payload.stage_state,
        status="active",
        offer_status="none",
        is_favorite=0,
        applied_at=payload.applied_at.astimezone(UTC) if payload.applied_at else None,
        notes=payload.notes,
        lock_version=1,
        created_at=now,
        updated_at=now,
    )
    try:
        db.add(application)
        db.commit()
        db.refresh(application)
    except Exception:
        db.rollback()
        raise
    return application


def find_owned_application(
    db: Session, user_id: int, application_id: int
) -> JobApplication | None:
    return db.scalar(
        select(JobApplication).where(
            JobApplication.id == application_id,
            JobApplication.user_id == user_id,
        )
    )


def require_owned_application(
    db: Session, user_id: int, application_id: int
) -> JobApplication:
    application = find_owned_application(db, user_id, application_id)
    if application is None:
        raise InterviewNotFound
    return application


def list_applications(
    db: Session,
    user_id: int,
    *,
    scope: Literal["active", "archived", "all"] = "active",
    keyword: str | None = None,
    status: str | None = None,
    stage_type: str | None = None,
    cursor: str | None = None,
    limit: int = 100,
) -> tuple[list[JobApplication], str | None]:
    normalized_keyword = keyword.strip() if keyword else ""
    filter_digest = _cursor_filter_digest(
        {
            "scope": scope,
            "keyword": normalized_keyword,
            "status": status or "",
            "stage_type": stage_type or "",
        }
    )
    query = select(JobApplication).where(JobApplication.user_id == user_id)
    if scope == "active":
        query = query.where(JobApplication.archived_at.is_(None))
    elif scope == "archived":
        query = query.where(JobApplication.archived_at.is_not(None))
    if normalized_keyword:
        pattern = f"%{normalized_keyword}%"
        query = query.where(
            or_(
                JobApplication.company_name_snapshot.like(pattern),
                JobApplication.job_title_snapshot.like(pattern),
                JobApplication.current_stage_label.like(pattern),
            )
        )
    if status:
        query = query.where(JobApplication.status == status)
    if stage_type:
        query = query.where(JobApplication.current_stage_type == stage_type)
    if cursor:
        cursor_time, cursor_id = _decode_cursor(
            cursor,
            kind="job_applications",
            filter_digest=filter_digest,
        )
        query = query.where(
            or_(
                JobApplication.updated_at < cursor_time,
                and_(
                    JobApplication.updated_at == cursor_time,
                    JobApplication.id < cursor_id,
                ),
            )
        )
    rows = list(
        db.scalars(
            query.order_by(
                JobApplication.updated_at.desc(), JobApplication.id.desc()
            ).limit(limit + 1)
        )
    )
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = (
        _encode_cursor(
            kind="job_applications",
            timestamp=items[-1].updated_at,
            row_id=items[-1].id,
            filter_digest=filter_digest,
        )
        if has_more and items
        else None
    )
    return items, next_cursor


def _commit_application_update(
    db: Session,
    application: JobApplication,
    base_lock_version: int,
    values: dict[str, object],
) -> JobApplication:
    values = {
        **values,
        "lock_version": JobApplication.lock_version + 1,
        "updated_at": utc_now(),
    }
    result = db.execute(
        update(JobApplication)
        .where(
            JobApplication.id == application.id,
            JobApplication.user_id == application.user_id,
            JobApplication.lock_version == base_lock_version,
        )
        .values(**values)
    )
    if result.rowcount != 1:
        db.rollback()
        raise InterviewEditConflict
    db.commit()
    return require_owned_application(db, application.user_id, application.id)


def update_application(
    db: Session,
    user_id: int,
    application_id: int,
    payload: JobApplicationUpdateRequest,
) -> JobApplication:
    application = require_owned_application(db, user_id, application_id)
    provided = payload.model_dump(exclude_unset=True)
    provided.pop("base_lock_version", None)
    if "is_favorite" in provided:
        provided["is_favorite"] = int(bool(provided["is_favorite"]))
    if "applied_at" in provided and provided["applied_at"] is not None:
        provided["applied_at"] = provided["applied_at"].astimezone(UTC)
        is_unsubmitted_application = (
            application.applied_at is None
            and application.current_stage_type == "screening"
            and (
                (
                    application.current_stage_label.strip() == "待投递"
                    and application.stage_state == "awaiting_schedule"
                )
                or (
                    application.current_stage_label.strip()
                    == POST_APPLICATION_SCREENING_LABEL
                    and application.stage_state == "awaiting_result"
                )
            )
        )
        if is_unsubmitted_application:
            provided.update(
                {
                    "current_stage_type": "screening",
                    "current_round_no": None,
                    "current_stage_label": POST_APPLICATION_SCREENING_LABEL,
                    "stage_state": "awaiting_result",
                }
            )
    if "resume_id" in provided:
        requested_resume_id = provided.pop("resume_id")
        if requested_resume_id is not None:
            parsed_resume_id = (
                parse_decimal_id(requested_resume_id)
                if isinstance(requested_resume_id, str)
                else None
            )
            if parsed_resume_id is None:
                raise InterviewNotFound
            resume = _owned_resume(db, user_id, parsed_resume_id)
            if resume is None:
                raise InterviewNotFound
            resume_version = _latest_resume_version(db, resume.id)
            if resume_version is None:
                raise InterviewResumeVersionRequired
            provided["resume_version_id"] = str(resume_version.id)
            provided["resume_title_snapshot"] = resume_version.name
    if "resume_version_id" in provided:
        requested_resume_version_id = provided["resume_version_id"]
        parsed_resume_version_id = (
            parse_decimal_id(requested_resume_version_id)
            if isinstance(requested_resume_version_id, str)
            else None
        )
        if requested_resume_version_id is not None and parsed_resume_version_id is None:
            raise InterviewNotFound
        resume_version = _owned_resume_version(
            db, user_id, parsed_resume_version_id
        )
        if parsed_resume_version_id is not None and resume_version is None:
            raise InterviewNotFound
        provided["resume_version_id"] = parsed_resume_version_id
        provided["resume_title_snapshot"] = (
            resume_version.name if resume_version else None
        )
    if (
        application.applied_at is None
        and provided.get("applied_at") is not None
        and provided.get("resume_version_id", application.resume_version_id) is None
    ):
        raise InterviewResumeRequired
    return _commit_application_update(
        db, application, payload.base_lock_version, provided
    )


def _state_values(state: ApplicationStateValue) -> dict[str, object]:
    return {
        "current_stage_type": state.stage_type,
        "current_round_no": state.round_no,
        "current_stage_label": state.stage_label,
        "stage_state": state.stage_state,
        "status": state.status,
        "offer_status": state.offer_status,
    }


def advance_application(
    db: Session,
    user_id: int,
    application_id: int,
    payload: AdvanceApplicationRequest,
) -> JobApplication:
    application = require_owned_application(db, user_id, application_id)
    if application.archived_at is not None:
        raise InterviewInvalidTransition
    try:
        next_state = transition_advance(
            _application_state(application),
            target_stage_type=payload.target_stage_type,
            target_round_no=payload.target_round_no,
            target_stage_label=payload.target_stage_label,
        )
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
    latest: InterviewSession | None = None
    if application.current_stage_type != "screening":
        current_session_type = application.current_stage_type
        session_query = select(InterviewSession).where(
            InterviewSession.application_id == application.id,
            InterviewSession.stage_type == current_session_type,
            InterviewSession.status == "completed",
            InterviewSession.round_result == "pending",
        )
        if current_session_type == "interview":
            session_query = session_query.where(
                InterviewSession.round_no == application.current_round_no
            )
        latest = db.scalar(
            session_query.order_by(
                InterviewSession.completed_at.desc(), InterviewSession.id.desc()
            )
        )
        if latest is None:
            raise InterviewInvalidTransition
        latest.round_result = "passed"
    updated = _commit_application_update(
        db, application, payload.base_lock_version, _state_values(next_state)
    )
    return updated


def record_offer(
    db: Session,
    user_id: int,
    application_id: int,
    payload: OfferApplicationRequest,
) -> JobApplication:
    application = require_owned_application(db, user_id, application_id)
    try:
        state = transition_offer(_application_state(application), payload.offer_status)
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
    return _commit_application_update(
        db, application, payload.base_lock_version, _state_values(state)
    )


def close_application(
    db: Session,
    user_id: int,
    application_id: int,
    payload: CloseApplicationRequest,
) -> JobApplication:
    application = require_owned_application(db, user_id, application_id)
    try:
        state = transition_close(
            _application_state(application),
            status=payload.status,
            offer_status=payload.offer_status,
        )
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
    if payload.status == "rejected":
        latest = db.scalar(
            select(InterviewSession)
            .where(
                InterviewSession.application_id == application.id,
                InterviewSession.status == "completed",
                InterviewSession.round_result == "pending",
            )
            .order_by(InterviewSession.completed_at.desc(), InterviewSession.id.desc())
        )
        if latest is not None:
            latest.round_result = "rejected"
    return _commit_application_update(
        db, application, payload.base_lock_version, _state_values(state)
    )


def set_application_archived(
    db: Session,
    user_id: int,
    application_id: int,
    base_lock_version: int,
    *,
    archived: bool,
) -> JobApplication:
    application = require_owned_application(db, user_id, application_id)
    return _commit_application_update(
        db,
        application,
        base_lock_version,
        {"archived_at": utc_now() if archived else None},
    )


def delete_application(db: Session, user_id: int, application_id: int) -> None:
    application = require_owned_application(db, user_id, application_id)
    if application.archived_at is None:
        raise InterviewApplicationNotEmpty
    result = db.execute(
        delete(JobApplication).where(
            JobApplication.id == application.id,
            JobApplication.user_id == user_id,
            JobApplication.archived_at.is_not(None),
            ~exists(
                select(InterviewSession.id).where(
                    InterviewSession.application_id == JobApplication.id
                )
            ),
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise InterviewApplicationNotEmpty
    db.commit()


def _validate_schedule(
    start_at: datetime, end_at: datetime, timezone_name: str
) -> tuple[datetime, datetime]:
    if start_at.tzinfo is None or end_at.tzinfo is None or end_at <= start_at:
        raise InvalidInterviewTime
    try:
        local_start = start_at.astimezone(ZoneInfo(timezone_name))
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise InvalidInterviewTime from error
    if local_start.second or local_start.microsecond:
        raise InvalidInterviewTime
    return start_at.astimezone(UTC), end_at.astimezone(UTC)


def find_time_conflicts(
    db: Session,
    user_id: int,
    start_at: datetime,
    end_at: datetime,
    *,
    exclude_session_id: int | None = None,
) -> list[TimeConflict]:
    query = (
        select(InterviewSession, JobApplication)
        .join(JobApplication, JobApplication.id == InterviewSession.application_id)
        .where(
            JobApplication.user_id == user_id,
            JobApplication.archived_at.is_(None),
            InterviewSession.status != "cancelled",
            InterviewSession.start_at < end_at,
            InterviewSession.end_at > start_at,
        )
    )
    if exclude_session_id is not None:
        query = query.where(InterviewSession.id != exclude_session_id)
    return [
        TimeConflict(
            id=session.id,
            application_id=application.id,
            company_name=application.company_name_snapshot,
            stage_label=session.stage_label,
            start_at=session.start_at,
            end_at=session.end_at,
        )
        for session, application in db.execute(query).all()
    ]


def _session_matches_current_stage(
    session: InterviewSession, application: JobApplication
) -> bool:
    if application.current_stage_type == "screening":
        return session.stage_type == "other"
    if session.stage_type != application.current_stage_type:
        return False
    if session.stage_type == "interview":
        return session.round_no == application.current_round_no
    return True


def _session_matches_create_request(
    session: InterviewSession,
    payload: InterviewSessionCreateRequest,
    start_at: datetime,
    end_at: datetime,
) -> bool:
    return (
        session.stage_type == payload.stage_type
        and session.round_no == payload.round_no
        and session.stage_label == payload.stage_label
        and _normalize_cursor_time(session.start_at) == start_at
        and _normalize_cursor_time(session.end_at) == end_at
        and session.timezone == payload.timezone
        and session.mode == payload.mode
        and session.meeting_url == payload.meeting_url
        and session.location == payload.location
        and session.interviewer_name == payload.interviewer_name
        and session.interviewer_title == payload.interviewer_title
        and session.reminder_minutes == payload.reminder_minutes
        and session.preparation_note == payload.preparation_note
    )


def create_session(
    db: Session,
    user_id: int,
    application_id: int,
    payload: InterviewSessionCreateRequest,
) -> InterviewSession:
    application = require_owned_application(db, user_id, application_id)
    if application.status != "active" or application.archived_at is not None:
        raise InterviewInvalidTransition
    existing = db.scalar(
        select(InterviewSession).where(
            InterviewSession.application_id == application.id,
            InterviewSession.client_request_id == str(payload.client_request_id),
        )
    )
    if existing is not None:
        requested_start, requested_end = _validate_schedule(
            payload.start_at, payload.end_at, payload.timezone
        )
        if not _session_matches_create_request(
            existing, payload, requested_start, requested_end
        ):
            raise InterviewEditConflict
        return existing
    start_at, end_at = _validate_schedule(
        payload.start_at, payload.end_at, payload.timezone
    )
    try:
        state = schedule_current_stage(_application_state(application))
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
    if payload.stage_type != application.current_stage_type:
        if not (
            payload.stage_type == "other"
            and application.current_stage_type == "screening"
        ):
            raise InterviewInvalidTransition
    if (
        payload.stage_type == "interview"
        and payload.round_no != application.current_round_no
    ):
        raise InterviewInvalidTransition
    conflicts = find_time_conflicts(db, user_id, start_at, end_at)
    if conflicts and not payload.allow_conflict:
        raise InterviewTimeConflict(conflicts)
    now = utc_now()
    session = InterviewSession(
        application_id=application.id,
        client_request_id=str(payload.client_request_id),
        stage_type=payload.stage_type,
        round_no=payload.round_no,
        stage_label=payload.stage_label,
        status="scheduled",
        round_result="pending",
        start_at=start_at,
        end_at=end_at,
        timezone=payload.timezone,
        mode=payload.mode,
        meeting_url=payload.meeting_url,
        location=payload.location,
        interviewer_name=payload.interviewer_name,
        interviewer_title=payload.interviewer_title,
        reminder_minutes=payload.reminder_minutes,
        preparation_note=payload.preparation_note,
        lock_version=1,
        created_at=now,
        updated_at=now,
    )
    try:
        db.add(session)
        transition = db.execute(
            update(JobApplication)
            .where(
                JobApplication.id == application.id,
                JobApplication.user_id == user_id,
                JobApplication.status == "active",
                JobApplication.archived_at.is_(None),
                JobApplication.stage_state == "awaiting_schedule",
                JobApplication.lock_version == application.lock_version,
            )
            .values(
                **_state_values(state),
                lock_version=JobApplication.lock_version + 1,
                updated_at=now,
            )
        )
        if transition.rowcount != 1:
            db.rollback()
            raise InterviewEditConflict
        db.commit()
        db.refresh(session)
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(InterviewSession).where(
                InterviewSession.application_id == application.id,
                InterviewSession.client_request_id == str(payload.client_request_id),
            )
        )
        if existing is not None:
            if _session_matches_create_request(
                existing, payload, start_at, end_at
            ):
                return existing
            raise InterviewEditConflict
        raise
    return session


def find_owned_session(
    db: Session, user_id: int, session_id: int, *, for_update: bool = False
) -> SessionWithApplication | None:
    query = (
        select(InterviewSession, JobApplication)
        .join(JobApplication, JobApplication.id == InterviewSession.application_id)
        .where(InterviewSession.id == session_id, JobApplication.user_id == user_id)
    )
    if for_update:
        query = query.with_for_update()
    row = db.execute(query).one_or_none()
    if row is None:
        return None
    return SessionWithApplication(session=row[0], application=row[1])


def require_owned_session(
    db: Session, user_id: int, session_id: int, *, for_update: bool = False
) -> SessionWithApplication:
    result = find_owned_session(db, user_id, session_id, for_update=for_update)
    if result is None:
        raise InterviewNotFound
    return result


def list_sessions(
    db: Session,
    user_id: int,
    *,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    status: str | None = None,
    application_id: int | None = None,
    include_archived: bool = False,
    cursor: str | None = None,
    limit: int = 200,
) -> tuple[list[SessionWithApplication], str | None]:
    normalized_start = start_at.astimezone(UTC) if start_at is not None else None
    normalized_end = end_at.astimezone(UTC) if end_at is not None else None
    filter_digest = _cursor_filter_digest(
        {
            "start_at": normalized_start.isoformat() if normalized_start else "",
            "end_at": normalized_end.isoformat() if normalized_end else "",
            "status": status or "",
            "application_id": application_id or 0,
            "include_archived": include_archived,
        }
    )
    query = (
        select(InterviewSession, JobApplication)
        .join(JobApplication, JobApplication.id == InterviewSession.application_id)
        .where(JobApplication.user_id == user_id)
    )
    if not include_archived:
        query = query.where(JobApplication.archived_at.is_(None))
    if start_at is not None:
        query = query.where(InterviewSession.end_at > normalized_start)
    if end_at is not None:
        query = query.where(InterviewSession.start_at < normalized_end)
    if status:
        query = query.where(InterviewSession.status == status)
    if application_id:
        query = query.where(InterviewSession.application_id == application_id)
    if cursor:
        cursor_time, cursor_id = _decode_cursor(
            cursor,
            kind="interview_sessions",
            filter_digest=filter_digest,
        )
        query = query.where(
            or_(
                InterviewSession.start_at > cursor_time,
                and_(
                    InterviewSession.start_at == cursor_time,
                    InterviewSession.id > cursor_id,
                ),
            )
        )
    rows = db.execute(
        query.order_by(
            InterviewSession.start_at.asc(), InterviewSession.id.asc()
        ).limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    items = [
        SessionWithApplication(session=row[0], application=row[1])
        for row in rows[:limit]
    ]
    next_cursor = (
        _encode_cursor(
            kind="interview_sessions",
            timestamp=items[-1].session.start_at,
            row_id=items[-1].session.id,
            filter_digest=filter_digest,
        )
        if has_more and items
        else None
    )
    return items, next_cursor


def _commit_session_update(
    db: Session,
    session: InterviewSession,
    base_lock_version: int,
    values: dict[str, object],
) -> InterviewSession:
    values = {
        **values,
        "lock_version": InterviewSession.lock_version + 1,
        "updated_at": utc_now(),
    }
    result = db.execute(
        update(InterviewSession)
        .where(
            InterviewSession.id == session.id,
            InterviewSession.lock_version == base_lock_version,
        )
        .values(**values)
    )
    if result.rowcount != 1:
        db.rollback()
        raise InterviewEditConflict
    db.commit()
    return db.get(InterviewSession, session.id)  # type: ignore[return-value]


def update_session(
    db: Session, user_id: int, session_id: int, payload: InterviewSessionUpdateRequest
) -> InterviewSession:
    result = require_owned_session(db, user_id, session_id)
    values = payload.model_dump(exclude_unset=True)
    values.pop("base_lock_version", None)
    return _commit_session_update(db, result.session, payload.base_lock_version, values)


def reschedule_session(
    db: Session, user_id: int, session_id: int, payload: RescheduleInterviewRequest
) -> InterviewSession:
    result = require_owned_session(db, user_id, session_id)
    if (
        result.session.status != "scheduled"
        or result.application.status != "active"
        or result.application.archived_at is not None
    ):
        raise InterviewInvalidTransition
    start_at, end_at = _validate_schedule(
        payload.start_at, payload.end_at, payload.timezone
    )
    conflicts = find_time_conflicts(
        db, user_id, start_at, end_at, exclude_session_id=result.session.id
    )
    if conflicts and not payload.allow_conflict:
        raise InterviewTimeConflict(conflicts)
    return _commit_session_update(
        db,
        result.session,
        payload.base_lock_version,
        {"start_at": start_at, "end_at": end_at, "timezone": payload.timezone},
    )


def complete_interview(
    db: Session, user_id: int, session_id: int, payload: CompleteInterviewRequest
) -> InterviewSession:
    result = require_owned_session(db, user_id, session_id, for_update=True)
    session = result.session
    if result.application.archived_at is not None:
        raise InterviewInvalidTransition
    if session.status == "completed":
        return session
    if session.status != "scheduled":
        raise InterviewInvalidTransition
    if not _session_matches_current_stage(session, result.application):
        raise InterviewInvalidTransition
    try:
        state = transition_complete(_application_state(result.application))
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
    if session.lock_version != payload.base_lock_version:
        raise InterviewEditConflict
    now = utc_now()
    provided = payload.model_dump(exclude_unset=True)
    provided.pop("base_lock_version", None)
    for key, value in provided.items():
        setattr(session, key, value)
    session.status = "completed"
    session.completed_at = now
    session.lock_version += 1
    session.updated_at = now
    _apply_state(result.application, state)
    result.application.lock_version += 1
    result.application.updated_at = now
    db.commit()
    db.refresh(session)
    return session


def cancel_interview(
    db: Session, user_id: int, session_id: int, payload: CancelInterviewRequest
) -> InterviewSession:
    result = require_owned_session(db, user_id, session_id, for_update=True)
    session = result.session
    if result.application.archived_at is not None:
        raise InterviewInvalidTransition
    if session.status == "cancelled":
        return session
    if session.status != "scheduled":
        raise InterviewInvalidTransition
    if not _session_matches_current_stage(session, result.application):
        raise InterviewInvalidTransition
    if session.lock_version != payload.base_lock_version:
        raise InterviewEditConflict
    try:
        state = cancel_current_session(_application_state(result.application))
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
    now = utc_now()
    session.status = "cancelled"
    session.cancelled_at = now
    session.cancellation_reason = payload.reason
    session.lock_version += 1
    session.updated_at = now
    _apply_state(result.application, state)
    result.application.lock_version += 1
    result.application.updated_at = now
    db.commit()
    db.refresh(session)
    return session


def delete_session(db: Session, user_id: int, session_id: int) -> JobApplication:
    result = require_owned_session(db, user_id, session_id, for_update=True)
    asset_count = db.scalar(
        select(func.count(InterviewAsset.id)).where(
            InterviewAsset.interview_session_id == session_id
        )
    )
    if asset_count:
        raise InterviewSessionNotEmpty
    db.delete(result.session)
    remaining_scheduled = db.scalar(
        select(func.count(InterviewSession.id)).where(
            InterviewSession.application_id == result.application.id,
            InterviewSession.id != session_id,
            InterviewSession.status == "scheduled",
        )
    )
    if (
        result.application.status == "active"
        and _session_matches_current_stage(result.session, result.application)
        and not remaining_scheduled
    ):
        result.application.stage_state = "awaiting_schedule"
        result.application.lock_version += 1
        result.application.updated_at = utc_now()
    db.commit()
    db.refresh(result.application)
    return result.application


def list_assets(db: Session, user_id: int, session_id: int) -> list[InterviewAsset]:
    require_owned_session(db, user_id, session_id)
    return list(
        db.scalars(
            select(InterviewAsset)
            .where(InterviewAsset.interview_session_id == session_id)
            .order_by(InterviewAsset.created_at.desc(), InterviewAsset.id.desc())
        )
    )


def find_owned_asset(
    db: Session, user_id: int, asset_id: int
) -> tuple[InterviewAsset, SessionWithApplication] | None:
    row = db.execute(
        select(InterviewAsset, InterviewSession, JobApplication)
        .join(
            InterviewSession, InterviewSession.id == InterviewAsset.interview_session_id
        )
        .join(JobApplication, JobApplication.id == InterviewSession.application_id)
        .where(InterviewAsset.id == asset_id, JobApplication.user_id == user_id)
    ).one_or_none()
    if row is None:
        return None
    return row[0], SessionWithApplication(session=row[1], application=row[2])


def create_asset_record(
    db: Session,
    *,
    session_id: int,
    source_type: str,
    asset_type: str,
    original_file_name: str,
    content_type: str,
    file_size: int,
    duration_ms: int | None,
    object_name: str,
    sha256: str,
) -> InterviewAsset:
    asset = InterviewAsset(
        interview_session_id=session_id,
        source_type=source_type,
        asset_type=asset_type,
        original_file_name=original_file_name,
        content_type=content_type,
        file_size=file_size,
        duration_ms=duration_ms,
        object_name=object_name,
        sha256=sha256,
        created_at=utc_now(),
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


def delete_asset_record(db: Session, asset: InterviewAsset) -> None:
    db.delete(asset)
    db.commit()


def overview(
    db: Session, user_id: int, week_start: date, timezone_name: str
) -> tuple[dict[str, int], list[JobApplication], list[SessionWithApplication]]:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as error:
        raise InvalidInterviewTime from error
    local_start = datetime.combine(week_start, datetime.min.time(), tzinfo=zone)
    local_end = local_start + timedelta(days=7)
    start_at = local_start.astimezone(UTC)
    end_at = local_end.astimezone(UTC)
    week_sessions, _ = list_sessions(
        db, user_id, start_at=start_at, end_at=end_at, limit=500
    )
    now = utc_now()
    metrics = {
        "weekly_interviews": sum(
            1 for item in week_sessions if item.session.status != "cancelled"
        ),
        "upcoming_interviews": int(
            db.scalar(
                select(func.count(InterviewSession.id))
                .join(
                    JobApplication, JobApplication.id == InterviewSession.application_id
                )
                .where(
                    JobApplication.user_id == user_id,
                    JobApplication.archived_at.is_(None),
                    InterviewSession.status == "scheduled",
                    InterviewSession.end_at > now,
                )
            )
            or 0
        ),
        "completed_interviews": int(
            db.scalar(
                select(func.count(InterviewSession.id))
                .join(
                    JobApplication, JobApplication.id == InterviewSession.application_id
                )
                .where(
                    JobApplication.user_id == user_id,
                    JobApplication.archived_at.is_(None),
                    InterviewSession.status == "completed",
                )
            )
            or 0
        ),
        "written_offers": int(
            db.scalar(
                select(func.count(JobApplication.id)).where(
                    JobApplication.user_id == user_id,
                    JobApplication.archived_at.is_(None),
                    JobApplication.offer_status.in_(
                        ("written_offer_received", "accepted", "declined")
                    ),
                )
            )
            or 0
        ),
    }
    pipeline = list(
        db.scalars(
            select(JobApplication)
            .where(
                JobApplication.user_id == user_id,
                JobApplication.archived_at.is_(None),
                JobApplication.status == "active",
            )
            .order_by(JobApplication.updated_at.desc(), JobApplication.id.desc())
        )
    )
    return metrics, pipeline, week_sessions
