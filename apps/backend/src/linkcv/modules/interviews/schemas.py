from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from linkcv.application.interviews.state import validate_stage_context
from linkcv.modules.job_descriptions.schemas import SalaryPeriod


CalendarColor = Literal["red", "orange", "yellow", "green", "blue", "purple", "gray"]
ApplicationStageType = Literal["screening", "interview", "hr", "offer"]
SessionStageType = Literal["interview", "hr", "offer", "other"]
ApplicationStageState = Literal[
    "awaiting_schedule", "scheduled", "awaiting_result", "negotiating"
]
ApplicationStatus = Literal["active", "rejected", "withdrawn", "closed"]
OfferStatus = Literal["none", "received", "accepted", "declined"]
SessionStatus = Literal["scheduled", "completed", "cancelled"]
RoundResult = Literal["pending", "passed", "rejected"]
InterviewMode = Literal["video", "onsite", "phone", "other"]
AssetSourceType = Literal["recorded", "uploaded"]
AssetType = Literal["audio", "video", "document"]
OptionalText = Annotated[str | None, Field(default=None)]
DatabaseId = Annotated[str, Field(pattern=r"^[1-9][0-9]{0,19}$")]


def _trim_optional(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class JobApplicationCreateRequest(StrictModel):
    job_description_id: DatabaseId
    resume_version_id: DatabaseId | None = None
    current_stage_type: ApplicationStageType = "screening"
    current_round_no: int | None = Field(default=None, ge=1, le=65_535)
    current_stage_label: str = Field(default="筛选中", max_length=100)
    stage_state: ApplicationStageState = "awaiting_result"
    applied_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=16_000)

    @field_validator("current_stage_label")
    @classmethod
    def trim_stage_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("stage label cannot be blank")
        return value

    @field_validator("notes")
    @classmethod
    def trim_notes(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @field_validator("applied_at")
    @classmethod
    def require_aware_applied_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("applied_at must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_stage(self) -> JobApplicationCreateRequest:
        validate_stage_context(
            self.current_stage_type, self.current_round_no, self.current_stage_label
        )
        if (
            self.current_stage_type == "screening"
            and self.current_stage_label == "待投递"
        ):
            if self.applied_at is not None:
                raise ValueError("待投递阶段不能包含 applied_at")
            if self.stage_state != "awaiting_schedule":
                raise ValueError("待投递阶段必须等待投递")
            return self
        expected_state: ApplicationStageState
        if self.current_stage_type == "screening":
            expected_state = "awaiting_result"
        elif self.current_stage_type in {"interview", "hr"}:
            expected_state = "awaiting_schedule"
        else:
            expected_state = "negotiating"
        if self.stage_state != expected_state:
            raise ValueError(
                f"{self.current_stage_type} stages must start as {expected_state}"
            )
        return self


class JobApplicationUpdateRequest(StrictModel):
    calendar_color: CalendarColor | None = None
    is_favorite: bool | None = None
    applied_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=16_000)
    resume_id: DatabaseId | None = None
    resume_version_id: DatabaseId | None = None
    base_lock_version: int = Field(ge=1)

    @field_validator("notes")
    @classmethod
    def trim_notes(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @field_validator("applied_at")
    @classmethod
    def require_aware_applied_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("applied_at must include a timezone")
        return value

    @model_validator(mode="after")
    def require_change(self) -> JobApplicationUpdateRequest:
        if self.model_fields_set == {"base_lock_version"}:
            raise ValueError("at least one application field is required")
        if {"resume_id", "resume_version_id"} <= self.model_fields_set:
            raise ValueError(
                "resume_id and resume_version_id cannot be provided together"
            )
        for field_name in ("calendar_color", "is_favorite"):
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class LifecycleRequest(StrictModel):
    base_lock_version: int = Field(ge=1)


class AdvanceApplicationRequest(LifecycleRequest):
    target_stage_type: ApplicationStageType
    target_round_no: int | None = Field(default=None, ge=1, le=65_535)
    target_stage_label: str = Field(max_length=100)

    @model_validator(mode="after")
    def validate_stage(self) -> AdvanceApplicationRequest:
        validate_stage_context(
            self.target_stage_type,
            self.target_round_no,
            self.target_stage_label,
        )
        self.target_stage_label = self.target_stage_label.strip()
        return self


class OfferApplicationRequest(LifecycleRequest):
    base_location: str | None = Field(default=None, max_length=100)
    salary: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )
    salary_currency: str | None = Field(default=None, max_length=3)
    salary_period: SalaryPeriod | None = None
    benefits_description: str | None = Field(default=None, max_length=500)

    @field_validator("base_location", "benefits_description")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @field_validator("salary_currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", normalized):
            raise ValueError("salary currency must be a three-letter ASCII code")
        return normalized

    @model_validator(mode="after")
    def validate_salary(self) -> OfferApplicationRequest:
        if self.salary is not None and (
            self.salary_currency is None or self.salary_period is None
        ):
            raise ValueError("numeric salary requires currency and period")
        return self


class CloseApplicationRequest(LifecycleRequest):
    status: Literal["rejected", "withdrawn", "closed"]
    offer_status: Literal["accepted", "declined"] | None = None


class InterviewSessionCreateRequest(StrictModel):
    client_request_id: UUID
    stage_type: SessionStageType
    round_no: int | None = Field(default=None, ge=1, le=65_535)
    stage_label: str = Field(max_length=100)
    start_at: datetime
    end_at: datetime
    timezone: str = Field(max_length=64)
    mode: InterviewMode
    meeting_url: str | None = Field(default=None, max_length=2048)
    location: str | None = Field(default=None, max_length=500)
    interviewer_name: str | None = Field(default=None, max_length=100)
    interviewer_title: str | None = Field(default=None, max_length=100)
    reminder_minutes: int | None = Field(default=None, ge=0, le=10_080)
    preparation_note: str | None = Field(default=None, max_length=100_000)
    allow_conflict: bool = False

    @field_validator("stage_label")
    @classmethod
    def trim_stage_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("stage label cannot be blank")
        return value

    @field_validator(
        "meeting_url",
        "location",
        "interviewer_name",
        "interviewer_title",
        "preparation_note",
    )
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @model_validator(mode="after")
    def validate_context(self) -> InterviewSessionCreateRequest:
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("interview times must include a timezone")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if self.stage_type == "interview" and self.round_no is None:
            raise ValueError("interview stage requires round_no")
        if self.stage_type != "interview" and self.round_no is not None:
            raise ValueError("only interview stages can carry round_no")
        return self


class InterviewSessionUpdateRequest(StrictModel):
    mode: InterviewMode | None = None
    meeting_url: str | None = Field(default=None, max_length=2048)
    location: str | None = Field(default=None, max_length=500)
    interviewer_name: str | None = Field(default=None, max_length=100)
    interviewer_title: str | None = Field(default=None, max_length=100)
    reminder_minutes: int | None = Field(default=None, ge=0, le=10_080)
    preparation_note: str | None = Field(default=None, max_length=100_000)
    questions_markdown: str | None = Field(default=None, max_length=500_000)
    review_summary: str | None = Field(default=None, max_length=500_000)
    improvement_markdown: str | None = Field(default=None, max_length=500_000)
    base_lock_version: int = Field(ge=1)

    @field_validator(
        "meeting_url",
        "location",
        "interviewer_name",
        "interviewer_title",
        "preparation_note",
        "questions_markdown",
        "review_summary",
        "improvement_markdown",
    )
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @model_validator(mode="after")
    def require_change(self) -> InterviewSessionUpdateRequest:
        if self.model_fields_set == {"base_lock_version"}:
            raise ValueError("at least one interview field is required")
        if "mode" in self.model_fields_set and self.mode is None:
            raise ValueError("mode cannot be null")
        return self


class RescheduleInterviewRequest(LifecycleRequest):
    start_at: datetime
    end_at: datetime
    timezone: str = Field(max_length=64)
    allow_conflict: bool = False

    @model_validator(mode="after")
    def validate_time_range(self) -> RescheduleInterviewRequest:
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("interview times must include a timezone")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class CompleteInterviewRequest(LifecycleRequest):
    questions_markdown: str | None = Field(default=None, max_length=500_000)
    review_summary: str | None = Field(default=None, max_length=500_000)
    improvement_markdown: str | None = Field(default=None, max_length=500_000)

    @field_validator("questions_markdown", "review_summary", "improvement_markdown")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return _trim_optional(value)


class CancelInterviewRequest(LifecycleRequest):
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str | None) -> str | None:
        return _trim_optional(value)


class JobApplicationRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: DatabaseId
    job_description_id: DatabaseId | None
    resume_version_id: DatabaseId | None
    company_name_snapshot: str
    job_title_snapshot: str
    job_snapshot: dict[str, object]
    resume_title_snapshot: str | None
    calendar_color: CalendarColor
    current_stage_type: ApplicationStageType
    current_round_no: int | None
    current_stage_label: str
    stage_state: ApplicationStageState
    status: ApplicationStatus
    offer_status: OfferStatus
    offer_base_location: str | None
    offer_salary: Decimal | None
    offer_salary_currency: str | None
    offer_salary_period: SalaryPeriod | None
    offer_benefits_description: str | None
    is_favorite: bool
    applied_at: datetime | None
    notes: str | None
    archived_at: datetime | None
    lock_version: int
    created_at: datetime
    updated_at: datetime

    @field_validator(
        "id",
        "job_description_id",
        "resume_version_id",
        mode="before",
    )
    @classmethod
    def stringify_ids(cls, value: object) -> str | None:
        return None if value is None else str(value)

    @field_validator(
        "applied_at", "archived_at", "created_at", "updated_at", mode="before"
    )
    @classmethod
    def serialize_utc_times(cls, value: datetime | None) -> datetime | None:
        return _as_utc(value)


class JobApplicationSummary(JobApplicationRecord):
    next_session_id: DatabaseId | None = None
    next_session_start_at: datetime | None = None
    next_session_end_at: datetime | None = None
    next_session_mode: InterviewMode | None = None

    @field_validator("next_session_start_at", "next_session_end_at", mode="before")
    @classmethod
    def serialize_next_session_utc(cls, value: datetime | None) -> datetime | None:
        return _as_utc(value)

    @field_validator("next_session_id", mode="before")
    @classmethod
    def stringify_next_session_id(cls, value: object) -> str | None:
        return None if value is None else str(value)


class InterviewSessionRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: DatabaseId
    application_id: DatabaseId
    client_request_id: str
    stage_type: SessionStageType
    round_no: int | None
    stage_label: str
    status: SessionStatus
    round_result: RoundResult
    start_at: datetime
    end_at: datetime
    timezone: str
    mode: InterviewMode
    meeting_url: str | None
    location: str | None
    interviewer_name: str | None
    interviewer_title: str | None
    reminder_minutes: int | None
    preparation_note: str | None
    questions_markdown: str | None
    review_summary: str | None
    improvement_markdown: str | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    cancellation_reason: str | None
    lock_version: int
    created_at: datetime
    updated_at: datetime

    @field_validator(
        "id", "application_id", mode="before"
    )
    @classmethod
    def stringify_ids(cls, value: object) -> str:
        return str(value)

    @field_validator(
        "start_at",
        "end_at",
        "completed_at",
        "cancelled_at",
        "created_at",
        "updated_at",
        mode="before",
    )
    @classmethod
    def serialize_utc_times(cls, value: datetime | None) -> datetime | None:
        return _as_utc(value)


class InterviewSessionSummary(InterviewSessionRecord):
    company_name: str
    job_title: str
    calendar_color: CalendarColor
    application_stage_state: ApplicationStageState


class InterviewAssetRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: DatabaseId
    interview_session_id: DatabaseId
    source_type: AssetSourceType
    asset_type: AssetType
    original_file_name: str
    content_type: str
    file_size: int
    duration_ms: int | None
    sha256: str | None
    created_at: datetime

    @field_validator("created_at", mode="before")
    @classmethod
    def serialize_created_at_utc(cls, value: datetime) -> datetime:
        return _as_utc(value)  # type: ignore[return-value]

    @field_validator("id", "interview_session_id", mode="before")
    @classmethod
    def stringify_ids(cls, value: object) -> str:
        return str(value)


class JobApplicationResponse(StrictModel):
    application: JobApplicationRecord


class JobApplicationListResponse(StrictModel):
    items: list[JobApplicationSummary]
    next_cursor: str | None = None


class InterviewSessionResponse(StrictModel):
    session: InterviewSessionRecord
    application: JobApplicationRecord
    assets: list[InterviewAssetRecord] = Field(default_factory=list)


class InterviewSessionListResponse(StrictModel):
    items: list[InterviewSessionSummary]
    next_cursor: str | None = None


class InterviewAssetListResponse(StrictModel):
    items: list[InterviewAssetRecord]


class InterviewAssetResponse(StrictModel):
    asset: InterviewAssetRecord


class OverviewMetrics(StrictModel):
    weekly_interviews: int
    upcoming_interviews: int
    completed_interviews: int
    offers_received: int


class InterviewOverviewResponse(StrictModel):
    metrics: OverviewMetrics
    pipeline: list[JobApplicationSummary]
    week_sessions: list[InterviewSessionSummary]


class DeleteResponse(StrictModel):
    deleted: bool


class DeleteSessionResponse(DeleteResponse):
    application: JobApplicationRecord
