from __future__ import annotations

import re
import hashlib
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from linkresume.application.interviews.state import validate_stage_context
from linkresume.core.database import utc_now
from linkresume.modules.job_descriptions.schemas import EmploymentType, SalaryPeriod


CalendarColor = Literal["red", "orange", "yellow", "green", "blue", "purple", "gray"]
ApplicationStageType = Literal[
    "screening",
    "assessment",
    "written_test",
    "ai_interview",
    "interview",
    "hr",
    "oc",
    "offer",
]
LegacyApplicationStageType = Literal["screening", "interview", "hr", "offer"]
ApplicationPhase = Literal["pending", "applied"]
ApplicationLifecycleStatus = Literal["active", "terminated"]
ApplicationStageStatus = Literal["active", "completed", "cancelled"]
ApplicationStageResult = Literal["pending", "passed", "rejected", "skipped"]
TerminationReason = Literal[
    "company_rejected",
    "user_withdrew",
    "offer_declined",
    "completed",
    "other",
]
SessionStageType = Literal["interview", "hr", "offer", "other"]
ApplicationStageState = Literal[
    "awaiting_schedule", "scheduled", "awaiting_result", "negotiating"
]
ApplicationStatus = Literal["active", "rejected", "withdrawn", "closed"]
OfferStatus = Literal["none", "received", "accepted", "declined"]
SessionStatus = Literal["scheduled", "completed", "cancelled"]
ScheduleKind = Literal["fixed_slot", "open_window"]
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


PrepCategory = Literal[
    "intro", "project", "technical", "system_design", "behavior", "company", "other"
]
MAX_PREP_ITEMS = 12


class PrepItem(StrictModel):
    id: str | None = Field(default=None, max_length=36)
    title: str = Field(max_length=80)
    category: PrepCategory = "other"
    reason: str | None = Field(default=None, max_length=200)
    done: bool = False

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("prep item title cannot be blank")
        return value

    @field_validator("id", "reason")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return _trim_optional(value)


class OcDetails(StrictModel):
    """Verbal-offer details recorded together with an OC stage."""

    oc_communicated_at: datetime | None = None
    oc_contact: str | None = Field(default=None, max_length=100)
    oc_salary_text: str | None = Field(default=None, max_length=100)
    oc_start_text: str | None = Field(default=None, max_length=100)
    oc_note: str | None = Field(default=None, max_length=500)

    @field_validator("oc_contact", "oc_salary_text", "oc_start_text", "oc_note")
    @classmethod
    def trim_oc_text(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @field_validator("oc_communicated_at")
    @classmethod
    def require_aware_oc_time(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("oc_communicated_at must include a timezone")
        return value


OC_DETAIL_FIELDS = (
    "oc_communicated_at",
    "oc_contact",
    "oc_salary_text",
    "oc_start_text",
    "oc_note",
)


class ResumeBindingRequest(StrictModel):
    resume_id: DatabaseId | None = None
    resume_version_id: DatabaseId | None = None


class ResumeAssociationUpdateRequest(StrictModel):
    resume_id: DatabaseId | None
    base_lock_version: int = Field(ge=1)


class JobApplicationCreateRequest(ResumeBindingRequest):
    job_description_id: DatabaseId
    resume_version_id: DatabaseId | None = None
    current_stage_type: LegacyApplicationStageType = "screening"
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


class JobApplicationUpdateRequest(ResumeBindingRequest):
    employment_type: EmploymentType | None = None
    calendar_color: CalendarColor | None = None
    is_favorite: bool | None = None
    applied_at: datetime | None = None
    applied_channel: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=16_000)
    resume_id: DatabaseId | None = None
    resume_version_id: DatabaseId | None = None
    base_lock_version: int = Field(ge=1)

    @field_validator("notes", "applied_channel")
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
    target_stage_type: LegacyApplicationStageType
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
    received_on: date | None = None
    reply_due_on: date | None = None
    start_on: date | None = None
    notes: str | None = Field(default=None, max_length=16_000)
    base_location: str | None = Field(default=None, max_length=100)
    salary: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )
    salary_currency: str | None = Field(default=None, max_length=3)
    salary_period: SalaryPeriod | None = None
    benefits_description: str | None = Field(default=None, max_length=500)
    probation: str | None = Field(default=None, max_length=100)
    material_dataset_ids: list[DatabaseId] | None = Field(default=None, max_length=10)

    @field_validator("received_on", "reply_due_on", "start_on", mode="before")
    @classmethod
    def validate_calendar_date(cls, value: object) -> object:
        if value is None:
            return value
        if isinstance(value, date) and not isinstance(value, datetime):
            parsed = value
        elif isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            parsed = date.fromisoformat(value)
        else:
            raise ValueError("offer dates must use YYYY-MM-DD")
        if parsed.year < 1000:
            raise ValueError("offer dates must be supported by MySQL DATE")
        return parsed

    @field_validator("base_location", "benefits_description", "probation")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @field_validator("material_dataset_ids")
    @classmethod
    def unique_materials(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("offer materials must not repeat")
        return value

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


class AddApplicationStageRequest(LifecycleRequest, ResumeBindingRequest, OcDetails):
    notes: str | None = Field(default=None, max_length=16_000)
    applied_channel: str | None = Field(default=None, max_length=100)
    client_request_id: UUID
    stage_type: ApplicationStageType
    stage_label: str | None = Field(default=None, max_length=100)
    interview_round_no: int | None = Field(default=None, ge=1, le=65_535)
    applied_at: datetime | None = None
    resume_id: DatabaseId | None = None
    resume_version_id: DatabaseId | None = None

    @field_validator("stage_label", "applied_channel")
    @classmethod
    def trim_stage_label(cls, value: str | None) -> str | None:
        return _trim_optional(value)

    @field_validator("applied_at")
    @classmethod
    def require_aware_applied_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("applied_at must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_stage(self) -> AddApplicationStageRequest:
        if self.stage_type == "interview":
            if not self.stage_label:
                raise ValueError("interview stage requires a label")
        elif self.interview_round_no is not None:
            raise ValueError("only interview stages can carry a round number")
        if self.stage_type != "oc" and self.model_fields_set & set(OC_DETAIL_FIELDS):
            raise ValueError("verbal offer details require an OC stage")
        if {"resume_id", "resume_version_id"} <= self.model_fields_set:
            raise ValueError(
                "resume_id and resume_version_id cannot be provided together"
            )
        return self


class TerminateApplicationRequest(LifecycleRequest):
    client_request_id: UUID
    reason: TerminationReason
    applied_at: datetime | None = None

    @field_validator("applied_at")
    @classmethod
    def require_aware_applied_at(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("applied_at must include a timezone")
        return value


class InterviewSessionCreateRequest(StrictModel):
    client_request_id: UUID
    application_stage_id: DatabaseId | None = None
    stage_type: SessionStageType
    round_no: int | None = Field(default=None, ge=1, le=65_535)
    stage_label: str = Field(max_length=100)
    start_at: datetime
    end_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    schedule_kind: ScheduleKind = "fixed_slot"
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
        if (self.end_at is None) == (self.duration_minutes is None):
            raise ValueError("provide exactly one of end_at or duration_minutes")
        if self.start_at.tzinfo is None or (
            self.end_at is not None and self.end_at.tzinfo is None
        ):
            raise ValueError("interview times must include a timezone")
        if self.end_at is not None and self.end_at <= self.start_at:
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
    prep_items: list[PrepItem] | None = Field(default=None, max_length=MAX_PREP_ITEMS)
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
    end_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    timezone: str = Field(max_length=64)
    allow_conflict: bool = False

    @model_validator(mode="after")
    def validate_time_range(self) -> RescheduleInterviewRequest:
        if (self.end_at is None) == (self.duration_minutes is None):
            raise ValueError("provide exactly one of end_at or duration_minutes")
        if self.start_at.tzinfo is None or (
            self.end_at is not None and self.end_at.tzinfo is None
        ):
            raise ValueError("interview times must include a timezone")
        if self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class UpdateAnswerPlanRequest(LifecycleRequest):
    answer_plan_start_at: datetime | None = None
    answer_plan_end_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_time_range(self) -> UpdateAnswerPlanRequest:
        if self.answer_plan_start_at is None:
            if self.answer_plan_end_at is not None or self.duration_minutes is not None:
                raise ValueError("answer plan start is required")
            return self
        if (self.answer_plan_end_at is None) == (self.duration_minutes is None):
            raise ValueError(
                "provide exactly one of answer_plan_end_at or duration_minutes"
            )
        if (
            self.answer_plan_start_at.tzinfo is None
            or (
                self.answer_plan_end_at is not None
                and self.answer_plan_end_at.tzinfo is None
            )
        ):
            raise ValueError("answer plan times must include a timezone")
        if (
            self.answer_plan_end_at is not None
            and self.answer_plan_end_at <= self.answer_plan_start_at
        ):
            raise ValueError("answer_plan_end_at must be after answer_plan_start_at")
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


class ApplicationStageRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: DatabaseId
    application_id: DatabaseId
    client_request_id: str
    stage_type: ApplicationStageType
    stage_label: str
    interview_round_no: int | None
    sequence_no: int
    stage_status: ApplicationStageStatus
    stage_result: ApplicationStageResult
    current_marker: int | None
    entered_at: datetime
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @field_validator("id", "application_id", mode="before")
    @classmethod
    def stringify_ids(cls, value: object) -> str:
        return str(value)

    @field_validator(
        "entered_at", "completed_at", "created_at", "updated_at", mode="before"
    )
    @classmethod
    def serialize_utc_times(cls, value: datetime | None) -> datetime | None:
        return _as_utc(value)


class OfferMaterialRecord(BaseModel):
    dataset_id: DatabaseId
    file_name: str

    @field_validator("dataset_id", mode="before")
    @classmethod
    def stringify_dataset_id(cls, value: object) -> str:
        return str(value)


class JobApplicationRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: DatabaseId
    job_description_id: DatabaseId | None
    resume_id: DatabaseId | None = None
    company_name_snapshot: str
    job_title_snapshot: str
    company_logo_url: str | None = None
    job_snapshot: dict[str, object]
    resume_title_snapshot: str | None
    calendar_color: CalendarColor
    current_stage_type: LegacyApplicationStageType
    current_round_no: int | None
    current_stage_label: str
    stage_state: ApplicationStageState
    status: ApplicationStatus
    phase: ApplicationPhase
    lifecycle_status: ApplicationLifecycleStatus
    terminated_at: datetime | None
    termination_reason: TerminationReason | None
    offer_status: OfferStatus
    offer_received_on: date | None = None
    offer_reply_due_on: date | None = None
    offer_start_on: date | None = None
    offer_probation: str | None = None
    offer_materials: list[OfferMaterialRecord] = Field(default_factory=list)
    offer_base_location: str | None
    offer_salary: Decimal | None
    offer_salary_currency: str | None
    offer_salary_period: SalaryPeriod | None
    offer_benefits_description: str | None
    is_favorite: bool
    applied_at: datetime | None
    applied_channel: str | None = None
    oc_communicated_at: datetime | None = None
    oc_contact: str | None = None
    oc_salary_text: str | None = None
    oc_start_text: str | None = None
    oc_note: str | None = None
    notes: str | None
    archived_at: datetime | None
    lock_version: int
    created_at: datetime
    updated_at: datetime
    current_stage: ApplicationStageRecord | None = None
    stages: list[ApplicationStageRecord] = Field(default_factory=list)

    @field_validator(
        "id",
        "job_description_id",
        "resume_id",
        mode="before",
    )
    @classmethod
    def stringify_ids(cls, value: object) -> str | None:
        return None if value is None else str(value)

    @field_validator(
        "applied_at",
        "oc_communicated_at",
        "terminated_at",
        "archived_at",
        "created_at",
        "updated_at",
        mode="before",
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


class ReviewScore(BaseModel):
    score: float | None = Field(default=None, ge=0, le=10)
    reason: str = Field(min_length=1, max_length=2000)
    evidence: str | None = Field(default=None, max_length=1000)


class ReviewQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str | None = Field(default=None, max_length=6000)
    evidence: str = Field(min_length=1, max_length=1000)
    strength: str | None = Field(default=None, max_length=2000)
    improvement: str | None = Field(default=None, max_length=2000)
    suggested_answer: str | None = Field(default=None, max_length=4000)


class ReviewAnalysis(BaseModel):
    summary: str = Field(min_length=1, max_length=4000)
    project_expression: ReviewScore
    system_design: ReviewScore
    communication: ReviewScore
    questions: list[ReviewQuestion] = Field(max_length=30)


class InterviewReviewReport(ReviewAnalysis):
    schema_version: Literal[1] = 1
    source_hash: str
    overall_score: float | None = Field(default=None, ge=0, le=10)
    generated_at: datetime


class ReviewSignalJudgementV2(BaseModel):
    signal: str
    verdict: Literal["hit", "partial", "miss"]
    quote: str | None = None


class ReviewEvidenceSnippetV2(BaseModel):
    dataset_id: str
    title: str
    text: str


class ReviewQuestionV2(BaseModel):
    index: int
    key: str
    question: str
    answer: str | None = None
    category: Literal["technical", "project", "behavioral", "hr"]
    answer_status: Literal["answered", "declined", "missing"]
    follow_ups: int = 0
    expected_depth: int
    achieved_depth: int | None = None
    score: float | None = None
    signals: list[ReviewSignalJudgementV2] = Field(default_factory=list)
    factual_errors: list[str] = Field(default_factory=list)
    resume_conflict: str | None = None
    strength: str | None = None
    improvement: str | None = None
    suggested_answer: str | None = None
    evidence_snippets: list[ReviewEvidenceSnippetV2] = Field(default_factory=list)


class ReviewDimensionV2(BaseModel):
    key: Literal[
        "professional_depth", "motivation_fit", "structure", "job_fit", "resume_consistency", "communication"
    ]
    assessed: bool
    score: int | None = None
    weight: float = 0
    evidence: str | None = None
    comment: str | None = None


class ReviewInterviewerSignalV2(BaseModel):
    polarity: Literal["positive", "negative"]
    quote: str
    meaning: str


class ReviewVerdictV2(BaseModel):
    level: Literal["likely_pass", "promising", "at_risk", "likely_fail"]
    confidence: Literal["high", "medium", "low"]
    confidence_reason: str | None = None
    signals: list[ReviewInterviewerSignalV2] = Field(default_factory=list)
    adjusted_by_signals: int = 0
    fatal_questions: int = 0


class ReviewImprovementV2(BaseModel):
    title: str
    detail: str
    priority: Literal["key", "tip"]
    dimension: str | None = None
    question_indexes: list[int] = Field(default_factory=list)


class ReviewBasisV2(BaseModel):
    transcript_source: Literal["manual", "transcription"] | None = None
    transcript_chars: int
    resume_title: str | None = None
    has_job: bool
    material_snippets: int = 0
    material_mode: Literal["rag", "local", "none"] = "none"
    downgraded_quotes: int = 0
    dropped_questions: int = 0


class InterviewReviewReportV2(BaseModel):
    schema_version: Literal[2] = 2
    rubric_version: str
    source_hash: str
    generated_at: datetime
    headline: str
    summary: str
    verdict: ReviewVerdictV2
    total_score: float | None = None
    grade: Literal["excellent", "good", "pass", "improve"] | None = None
    question_average: float | None = None
    dimension_score: float | None = None
    first_axis: Literal["professional_depth", "motivation_fit"]
    category_counts: dict[str, int] = Field(default_factory=dict)
    dimensions: list[ReviewDimensionV2]
    questions: list[ReviewQuestionV2]
    improvements: list[ReviewImprovementV2] = Field(default_factory=list)
    basis: ReviewBasisV2


class GenerateReviewRequest(LifecycleRequest):
    request_id: UUID


class WrittenQuestion(BaseModel):
    no: int
    text: str


class WrittenQuestionsResponse(BaseModel):
    questions: list[WrittenQuestion]
    markdown: str


class ReviewQuestionNoteRequest(StrictModel):
    question_text: str = Field(min_length=1, max_length=1000)
    verdict: Literal["good", "improve"] | None = None
    note: str | None = Field(default=None, max_length=2000)
    lock_version: int | None = Field(default=None, ge=1)

    @field_validator("question_text")
    @classmethod
    def require_question(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("question_text must not be blank")
        return value


class TranscriptionApplyRequest(StrictModel):
    base_lock_version: int = Field(ge=1)


class TranscriptionRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    dataset_id: DatabaseId
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    error_code: str | None = None
    # ORM column is is_pending_replace; the response keeps the public field name.
    pending_replace: bool = Field(
        default=False, validation_alias=AliasChoices("is_pending_replace", "pending_replace")
    )
    result_duration_ms: int | None = None
    updated_at: datetime

    @field_validator("dataset_id", mode="before")
    @classmethod
    def stringify_dataset_id(cls, value: object) -> str:
        return str(value)

    @field_validator("pending_replace", mode="before")
    @classmethod
    def coerce_flag(cls, value: object) -> bool:
        return bool(value)


class ReviewQuestionNoteRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: DatabaseId
    question_key: str
    question_text: str
    verdict: Literal["good", "improve"] | None = None
    note: str | None = None
    lock_version: int
    updated_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class ReviewQuestionNoteResponse(BaseModel):
    note: ReviewQuestionNoteRecord


class InterviewSessionRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: DatabaseId
    application_id: DatabaseId
    application_stage_id: DatabaseId | None
    client_request_id: str
    stage_type: SessionStageType
    round_no: int | None
    stage_label: str
    status: SessionStatus
    round_result: RoundResult
    start_at: datetime
    end_at: datetime
    schedule_kind: ScheduleKind
    answer_plan_start_at: datetime | None
    answer_plan_end_at: datetime | None
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
    review_report: InterviewReviewReport | InterviewReviewReportV2 | None = None
    review_status: Literal["generating", "ready", "failed"] | None = None
    review_request_id: str | None = None
    review_error: str | None = None
    review_started_at: datetime | None = None
    transcript_source: Literal["manual", "transcription"] | None = None
    transcriptions: list[TranscriptionRecord] = Field(default_factory=list)
    review_question_notes: list[ReviewQuestionNoteRecord] = Field(default_factory=list)

    @field_validator("review_report", mode="before")
    @classmethod
    def read_compatible_review(cls, value: object) -> InterviewReviewReport | None:
        if not value:
            return None
        model = (
            InterviewReviewReportV2
            if isinstance(value, dict) and value.get("schema_version") == 2
            else InterviewReviewReport
        )
        try:
            return model.model_validate(value)
        except ValueError:
            return None

    @computed_field
    @property
    def review_stale(self) -> bool:
        if self.review_report is None:
            return False
        source = (self.questions_markdown or "").strip()
        return self.review_report.source_hash != hashlib.sha256(source.encode()).hexdigest()
    improvement_markdown: str | None
    prep_items: list[PrepItem] = Field(default_factory=list)
    prep_generated_at: datetime | None = None
    completed_at: datetime | None
    cancelled_at: datetime | None
    cancellation_reason: str | None
    lock_version: int
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def project_elapsed_schedule(self) -> InterviewSessionRecord:
        # A scheduled session whose end time has passed is completed by time;
        # the stored row is settled lazily by the next stage-changing command.
        if self.status == "scheduled" and _as_utc(self.end_at) <= utc_now():
            self.status = "completed"
            self.completed_at = self.end_at
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def prep_total(self) -> int:
        return len(self.prep_items)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def prep_done(self) -> int:
        return sum(1 for item in self.prep_items if item.done)

    @field_validator("prep_items", mode="before")
    @classmethod
    def default_prep_items(cls, value: object) -> object:
        return [] if value is None else value

    @field_validator(
        "id", "application_id", "application_stage_id", mode="before"
    )
    @classmethod
    def stringify_ids(cls, value: object) -> str | None:
        return None if value is None else str(value)

    @field_validator(
        "start_at",
        "end_at",
        "answer_plan_start_at",
        "answer_plan_end_at",
        "completed_at",
        "cancelled_at",
        "prep_generated_at",
        "review_started_at",
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
    company_logo_url: str | None = None
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
