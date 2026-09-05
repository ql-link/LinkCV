from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.application.interviews.state import (
    ApplicationStateValue,
    InvalidTransition,
    POST_APPLICATION_SCREENING_LABEL,
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
    JobApplicationStage,
)
from linkcv.modules.interviews.schemas import (
    AddApplicationStageRequest,
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
    TerminateApplicationRequest,
)
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.resumes.models import Resume, ResumeVersion


class InterviewNotFound(LookupError):
    pass


class InterviewResumeVersionRequired(RuntimeError):
    pass


class InterviewEditConflict(RuntimeError):
    pass


class InterviewInvalidTransition(RuntimeError):
    pass


class InvalidInterviewRequest(RuntimeError):
    pass


class InterviewApplicationNotEmpty(RuntimeError):
    pass


@dataclass(slots=True)
class InterviewApplicationAlreadyActive(RuntimeError):
    application_id: int


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


@dataclass(frozen=True, slots=True)
class StageChangeResult:
    application: JobApplication
    stage: JobApplicationStage | None


CALENDAR_COLORS = ("red", "orange", "yellow", "green", "blue", "purple", "gray")

DEFAULT_STAGE_LABELS = {
    "screening": "筛选中",
    "assessment": "测评",
    "written_test": "笔试",
    "ai_interview": "AI 面试",
    "offer": "Offer",
}

SCHEDULABLE_STAGE_TYPES = {
    "assessment",
    "written_test",
    "ai_interview",
    "interview",
}


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


def find_unfinished_application_for_job(
    db: Session, user_id: int, job_description_id: int
) -> JobApplication | None:
    return db.scalar(
        select(JobApplication)
        .where(
            JobApplication.user_id == user_id,
            JobApplication.job_description_id == job_description_id,
            JobApplication.lifecycle_status == "active",
        )
        .order_by(JobApplication.created_at.desc(), JobApplication.id.desc())
        .limit(1)
    )


def ensure_pending_application_for_job(
    db: Session,
    user_id: int,
    job: JobDescription,
    *,
    resume_version: ResumeVersion | None = None,
    notes: str | None = None,
) -> tuple[JobApplication, bool]:
    locked_job = db.scalar(
        select(JobDescription)
        .where(
            JobDescription.id == job.id,
            JobDescription.user_id == user_id,
        )
        .with_for_update()
    )
    if locked_job is None:
        raise InterviewNotFound
    existing = find_unfinished_application_for_job(db, user_id, job.id)
    if existing is not None:
        return existing, False
    now = utc_now()
    application = JobApplication(
        user_id=user_id,
        job_description_id=job.id,
        resume_version_id=resume_version.id if resume_version else None,
        company_name_snapshot=locked_job.company_name,
        job_title_snapshot=locked_job.job_title,
        job_snapshot=_job_snapshot(locked_job),
        resume_title_snapshot=resume_version.name if resume_version else None,
        calendar_color=secrets.choice(CALENDAR_COLORS),
        current_stage_type="screening",
        current_round_no=None,
        current_stage_label="待投递",
        stage_state="awaiting_schedule",
        status="active",
        lifecycle_status="active",
        offer_status="none",
        is_favorite=0,
        applied_at=None,
        notes=notes,
        lock_version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(application)
    db.flush()
    db.refresh(application)
    return application, True


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
    try:
        application, _created = ensure_pending_application_for_job(
            db,
            user_id,
            job,
            resume_version=resume_version,
            notes=payload.notes,
        )
        if application.applied_at is not None or current_application_stage(
            db, application.id
        ) is not None:
            raise InterviewApplicationAlreadyActive(application.id)
        if resume_version is not None:
            application.resume_version_id = resume_version.id
            application.resume_title_snapshot = resume_version.name
        if payload.notes is not None:
            application.notes = payload.notes
        db.commit()
        db.refresh(application)
    except Exception:
        db.rollback()
        raise
    if (
        payload.current_stage_type == "screening"
        and payload.current_stage_label == "待投递"
    ):
        return application

    legacy_stage_type = payload.current_stage_type
    if legacy_stage_type == "offer":
        stage_type = "offer"
    elif legacy_stage_type in {"interview", "hr"}:
        stage_type = "interview"
    elif payload.current_stage_label == "测评":
        stage_type = "assessment"
    elif payload.current_stage_label == "笔试":
        stage_type = "written_test"
    elif payload.current_stage_label == "AI 面试":
        stage_type = "ai_interview"
    else:
        stage_type = "screening"
    result = add_application_stage(
        db,
        user_id,
        application.id,
        AddApplicationStageRequest(
            client_request_id=uuid4(),
            stage_type=stage_type,
            stage_label=(
                payload.current_stage_label if stage_type == "interview" else None
            ),
            interview_round_no=(
                payload.current_round_no if stage_type == "interview" else None
            ),
            applied_at=payload.applied_at,
            resume_version_id=payload.resume_version_id,
            base_lock_version=application.lock_version,
        ),
    )
    return result.application


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
    phase: str | None = None,
    lifecycle_status: str | None = None,
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
            "phase": phase or "",
            "lifecycle_status": lifecycle_status or "",
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
                exists(
                    select(JobApplicationStage.id).where(
                        JobApplicationStage.application_id == JobApplication.id,
                        JobApplicationStage.stage_label.like(pattern),
                    )
                ),
            )
        )
    if status:
        query = query.where(JobApplication.status == status)
    if stage_type:
        query = query.where(
            exists(
                select(JobApplicationStage.id).where(
                    JobApplicationStage.application_id == JobApplication.id,
                    JobApplicationStage.current_marker == 1,
                    JobApplicationStage.stage_type == stage_type,
                )
            )
        )
    if phase == "pending":
        query = query.where(JobApplication.applied_at.is_(None))
    elif phase == "applied":
        query = query.where(JobApplication.applied_at.is_not(None))
    if lifecycle_status:
        query = query.where(JobApplication.lifecycle_status == lifecycle_status)
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


def list_application_stages(
    db: Session, application_id: int
) -> list[JobApplicationStage]:
    return list(
        db.scalars(
            select(JobApplicationStage)
            .where(JobApplicationStage.application_id == application_id)
            .order_by(JobApplicationStage.sequence_no, JobApplicationStage.id)
        )
    )


def current_application_stage(
    db: Session, application_id: int
) -> JobApplicationStage | None:
    return db.scalar(
        select(JobApplicationStage).where(
            JobApplicationStage.application_id == application_id,
            JobApplicationStage.current_marker == 1,
        )
    )


def _stage_label(stage_type: str, requested_label: str | None) -> str:
    if stage_type == "interview":
        if not requested_label:
            raise InterviewInvalidTransition
        return requested_label.strip()
    return requested_label or DEFAULT_STAGE_LABELS[stage_type]


def _legacy_stage_projection(
    stage_type: str, stage_label: str, round_no: int | None
) -> dict[str, object]:
    if stage_type in {"assessment", "written_test", "ai_interview"}:
        legacy_type = "screening"
        legacy_round = None
        stage_state = "awaiting_schedule"
    elif stage_type == "interview":
        legacy_type = "interview"
        legacy_round = round_no or 1
        stage_state = "awaiting_schedule"
    elif stage_type == "offer":
        legacy_type = "offer"
        legacy_round = None
        stage_state = "negotiating"
    else:
        legacy_type = "screening"
        legacy_round = None
        stage_state = "awaiting_result"
    return {
        "current_stage_type": legacy_type,
        "current_round_no": legacy_round,
        "current_stage_label": stage_label,
        "stage_state": stage_state,
    }


def _stage_matches_request(
    stage: JobApplicationStage, payload: AddApplicationStageRequest
) -> bool:
    return (
        stage.stage_type == payload.stage_type
        and stage.stage_label == _stage_label(payload.stage_type, payload.stage_label)
        and stage.interview_round_no == payload.interview_round_no
    )


def _resolve_stage_resume(
    db: Session,
    user_id: int,
    payload: AddApplicationStageRequest,
) -> ResumeVersion | None:
    if payload.resume_id is not None:
        resume_id = parse_decimal_id(payload.resume_id)
        if resume_id is None:
            raise InterviewNotFound
        resume = _owned_resume(db, user_id, resume_id)
        if resume is None:
            raise InterviewNotFound
        version = _latest_resume_version(db, resume.id)
        if version is None:
            raise InterviewResumeVersionRequired
        return version
    if payload.resume_version_id is not None:
        version_id = parse_decimal_id(payload.resume_version_id)
        if version_id is None:
            raise InterviewNotFound
        version = _owned_resume_version(db, user_id, version_id)
        if version is None:
            raise InterviewNotFound
        return version
    return None


def add_application_stage(
    db: Session,
    user_id: int,
    application_id: int,
    payload: AddApplicationStageRequest,
) -> StageChangeResult:
    application = db.scalar(
        select(JobApplication)
        .where(
            JobApplication.id == application_id,
            JobApplication.user_id == user_id,
        )
        .with_for_update()
    )
    if application is None:
        raise InterviewNotFound
    existing = db.scalar(
        select(JobApplicationStage).where(
            JobApplicationStage.application_id == application.id,
            JobApplicationStage.client_request_id == str(payload.client_request_id),
        )
    )
    if existing is not None:
        if not _stage_matches_request(existing, payload):
            raise InterviewEditConflict
        return StageChangeResult(application=application, stage=existing)
    if (
        application.archived_at is not None
        or application.lifecycle_status != "active"
        or application.status != "active"
    ):
        raise InterviewInvalidTransition
    if application.lock_version != payload.base_lock_version:
        raise InterviewEditConflict

    stage_label = _stage_label(payload.stage_type, payload.stage_label)
    resume_version = _resolve_stage_resume(db, user_id, payload)
    now = utc_now()
    previous = current_application_stage(db, application.id)
    if previous is not None:
        previous.current_marker = None
        previous.stage_status = "completed"
        previous.stage_result = "passed"
        previous.completed_at = now
        previous.updated_at = now
        db.execute(
            update(InterviewSession)
            .where(
                InterviewSession.application_stage_id == previous.id,
                InterviewSession.status == "completed",
                InterviewSession.round_result == "pending",
            )
            .values(round_result="passed", updated_at=now)
        )
    last_sequence_no = db.scalar(
        select(func.max(JobApplicationStage.sequence_no)).where(
            JobApplicationStage.application_id == application.id
        )
    )
    next_sequence = (last_sequence_no or 0) + 1
    stage = JobApplicationStage(
        application_id=application.id,
        client_request_id=str(payload.client_request_id),
        stage_type=payload.stage_type,
        stage_label=stage_label,
        interview_round_no=payload.interview_round_no,
        sequence_no=next_sequence,
        stage_status="active",
        stage_result="pending",
        current_marker=1,
        entered_at=now,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )
    application.applied_at = (
        payload.applied_at.astimezone(UTC)
        if payload.applied_at is not None
        else application.applied_at or now
    )
    if resume_version is not None:
        application.resume_version_id = resume_version.id
        application.resume_title_snapshot = resume_version.name
    for key, value in _legacy_stage_projection(
        payload.stage_type, stage_label, payload.interview_round_no
    ).items():
        setattr(application, key, value)
    application.lifecycle_status = "active"
    application.terminated_at = None
    application.termination_reason = None
    application.lock_version += 1
    application.updated_at = now
    try:
        db.add(stage)
        db.commit()
        db.refresh(stage)
        db.refresh(application)
    except IntegrityError as error:
        db.rollback()
        existing = db.scalar(
            select(JobApplicationStage).where(
                JobApplicationStage.application_id == application_id,
                JobApplicationStage.client_request_id
                == str(payload.client_request_id),
            )
        )
        if existing is not None and _stage_matches_request(existing, payload):
            current = require_owned_application(db, user_id, application_id)
            return StageChangeResult(application=current, stage=existing)
        raise InterviewEditConflict from error
    return StageChangeResult(application=application, stage=stage)


def terminate_application(
    db: Session,
    user_id: int,
    application_id: int,
    payload: TerminateApplicationRequest,
) -> StageChangeResult:
    application = db.scalar(
        select(JobApplication)
        .where(
            JobApplication.id == application_id,
            JobApplication.user_id == user_id,
        )
        .with_for_update()
    )
    if application is None:
        raise InterviewNotFound
    if application.lifecycle_status == "terminated":
        if application.termination_reason == payload.reason:
            return StageChangeResult(application=application, stage=None)
        raise InterviewEditConflict
    if application.archived_at is not None or application.status != "active":
        raise InterviewInvalidTransition
    if application.lock_version != payload.base_lock_version:
        raise InterviewEditConflict
    now = utc_now()
    current = current_application_stage(db, application.id)
    if current is not None:
        current.current_marker = None
        current.stage_status = "completed"
        current.stage_result = (
            "rejected" if payload.reason == "company_rejected" else "skipped"
        )
        current.completed_at = now
        current.updated_at = now
    application.applied_at = (
        payload.applied_at.astimezone(UTC)
        if payload.applied_at is not None
        else application.applied_at or now
    )
    application.lifecycle_status = "terminated"
    application.terminated_at = now
    application.termination_reason = payload.reason
    application.status = {
        "company_rejected": "rejected",
        "user_withdrew": "withdrawn",
        "offer_declined": "closed",
        "completed": "closed",
        "other": "closed",
    }[payload.reason]
    if payload.reason == "offer_declined":
        application.offer_status = "declined"
    application.lock_version += 1
    application.updated_at = now
    db.commit()
    db.refresh(application)
    return StageChangeResult(application=application, stage=None)


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
    is_pending = application.applied_at is None
    if (
        is_pending
        and provided.get("applied_at") is not None
        and set(provided) <= {"applied_at", "resume_id", "resume_version_id"}
    ):
        stage_payload: dict[str, object] = {
            "client_request_id": uuid4(),
            "stage_type": "screening",
            "stage_label": POST_APPLICATION_SCREENING_LABEL,
            "applied_at": provided.get("applied_at"),
            "base_lock_version": payload.base_lock_version,
        }
        if "resume_id" in provided:
            stage_payload["resume_id"] = provided["resume_id"]
        if "resume_version_id" in provided:
            stage_payload["resume_version_id"] = provided["resume_version_id"]
        result = add_application_stage(
            db,
            user_id,
            application_id,
            AddApplicationStageRequest.model_validate(stage_payload),
        )
        return result.application
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
    screening_label = payload.target_stage_label.strip().casefold()
    stable_type = {
        "screening": (
            "ai_interview"
            if "ai" in screening_label and "面试" in screening_label
            else "written_test"
            if "笔试" in screening_label
            else "assessment"
            if "测评" in screening_label or "assessment" in screening_label
            else "screening"
        ),
        "interview": "interview",
        "hr": "interview",
        "offer": "offer",
    }[payload.target_stage_type]
    result = add_application_stage(
        db,
        user_id,
        application_id,
        AddApplicationStageRequest(
            client_request_id=uuid4(),
            stage_type=stable_type,
            stage_label=payload.target_stage_label,
            interview_round_no=(
                payload.target_round_no
                if payload.target_stage_type == "interview"
                else None
            ),
            base_lock_version=payload.base_lock_version,
        ),
    )
    return result.application


def record_offer(
    db: Session,
    user_id: int,
    application_id: int,
    payload: OfferApplicationRequest,
) -> JobApplication:
    application = require_owned_application(db, user_id, application_id)
    try:
        state = transition_offer(_application_state(application))
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
    values = {
        **_state_values(state),
        "offer_base_location": payload.base_location,
        "offer_salary": payload.salary,
        "offer_salary_currency": payload.salary_currency,
        "offer_salary_period": payload.salary_period,
        "offer_benefits_description": payload.benefits_description,
    }
    return _commit_application_update(
        db, application, payload.base_lock_version, values
    )


def close_application(
    db: Session,
    user_id: int,
    application_id: int,
    payload: CloseApplicationRequest,
) -> JobApplication:
    application = require_owned_application(db, user_id, application_id)
    if payload.offer_status != "accepted":
        reason = (
            "offer_declined"
            if payload.offer_status == "declined"
            else "company_rejected"
            if payload.status == "rejected"
            else "user_withdrew"
            if payload.status == "withdrawn"
            else "completed"
        )
        return terminate_application(
            db,
            user_id,
            application_id,
            TerminateApplicationRequest(
                client_request_id=uuid4(),
                reason=reason,
                base_lock_version=payload.base_lock_version,
            ),
        ).application
    try:
        state = transition_close(
            _application_state(application),
            status=payload.status,
            offer_status=payload.offer_status,
        )
    except InvalidTransition as error:
        raise InterviewInvalidTransition from error
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
        (
            payload.application_stage_id is None
            or session.application_stage_id
            == parse_decimal_id(payload.application_stage_id)
        )
        and session.stage_type == payload.stage_type
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
    if (
        application.status != "active"
        or application.lifecycle_status != "active"
        or application.archived_at is not None
    ):
        raise InterviewInvalidTransition
    current_stage = current_application_stage(db, application.id)
    if current_stage is None or current_stage.stage_type not in SCHEDULABLE_STAGE_TYPES:
        raise InvalidInterviewRequest
    requested_stage_id = (
        parse_decimal_id(payload.application_stage_id)
        if payload.application_stage_id is not None
        else current_stage.id
    )
    if requested_stage_id != current_stage.id:
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
    expected_legacy_types = (
        {"interview", "hr"}
        if current_stage.stage_type == "interview"
        else {"other"}
    )
    if payload.stage_type not in expected_legacy_types:
        raise InterviewInvalidTransition
    if payload.stage_label.strip() != current_stage.stage_label:
        raise InterviewInvalidTransition
    if current_stage.stage_type == "interview" and (
        payload.round_no != (current_stage.interview_round_no or 1)
    ):
        raise InterviewInvalidTransition
    conflicts = find_time_conflicts(db, user_id, start_at, end_at)
    if conflicts and not payload.allow_conflict:
        raise InterviewTimeConflict(conflicts)
    now = utc_now()
    session = InterviewSession(
        application_id=application.id,
        application_stage_id=current_stage.id,
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
        "offers_received": int(
            db.scalar(
                select(func.count(JobApplication.id)).where(
                    JobApplication.user_id == user_id,
                    JobApplication.archived_at.is_(None),
                    JobApplication.offer_status.in_(
                        ("received", "accepted", "declined")
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
