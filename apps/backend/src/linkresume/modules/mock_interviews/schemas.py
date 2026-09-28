from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

InterviewType = Literal["technical", "project_deep_dive", "hr", "comprehensive"]
Difficulty = Literal["junior", "intermediate", "senior"]
Language = Literal["zh", "en"]
MockInterviewStatus = Literal[
    "preparing",
    "preparation_failed",
    "in_progress",
    "evaluating",
    "evaluation_failed",
    "completed",
    "abandoned",
]

_DECIMAL_ID = r"^[1-9][0-9]{0,19}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MockInterviewCreateRequest(StrictModel):
    job_application_id: str | None = Field(default=None, pattern=_DECIMAL_ID)
    resume_id: str | None = Field(default=None, pattern=_DECIMAL_ID)
    job_description_id: str | None = Field(default=None, pattern=_DECIMAL_ID)
    job_description_text: str | None = Field(default=None, max_length=20_000)
    target_role: str | None = Field(default=None, max_length=200)
    interview_type: InterviewType | None = None
    difficulty: Difficulty = "intermediate"
    question_count: int = Field(default=5, ge=3, le=10)
    follow_up_enabled: bool = True
    language: Language = "zh"
    material_ids: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("material_ids")
    @classmethod
    def validate_material_ids(cls, value: list[str]) -> list[str]:
        import re

        if any(not re.fullmatch(_DECIMAL_ID, item) for item in value):
            raise ValueError("invalid material id")
        return value

    @model_validator(mode="after")
    def validate_source(self) -> "MockInterviewCreateRequest":
        if self.job_application_id is None and self.resume_id is None:
            raise ValueError("job_application_id or resume_id is required")
        if self.job_application_id is not None and (
            self.job_description_id is not None or self.job_description_text
        ):
            raise ValueError("job application source already carries the job")
        if self.job_description_id is not None and self.job_description_text:
            raise ValueError("choose either job_description_id or job_description_text")
        return self


class MockInterviewAnswerRequest(StrictModel):
    question_id: str = Field(pattern=_DECIMAL_ID)
    answer: str = Field(min_length=1, max_length=8000)

    @field_validator("answer")
    @classmethod
    def validate_answer(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("answer must not be blank")
        return value.strip()


class MockInterviewSkipRequest(StrictModel):
    question_id: str = Field(pattern=_DECIMAL_ID)


class MockInterviewQuestionRecord(BaseModel):
    id: str
    parent_id: str | None
    sequence_no: int
    kind: Literal["main", "follow_up"]
    plan_index: int
    depth_level: int
    content: str
    answer_status: Literal["pending", "answered", "skipped"]
    answer_text: str | None
    answered_at: datetime | None
    evaluation: dict[str, Any] | None = None


class MockInterviewSummary(BaseModel):
    id: str
    status: MockInterviewStatus
    source_type: Literal["job_application", "resume"]
    job_application_id: str | None
    resume_id: str | None
    job_description_id: str | None
    repeat_of_id: str | None
    resume_title: str
    company_name: str | None
    job_title: str | None
    target_role: str | None
    stage_label: str | None
    interview_type: InterviewType
    difficulty: Difficulty
    question_count: int
    follow_up_enabled: bool
    language: Language
    total_score: float | None
    low_confidence: bool
    error_code: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    lock_version: int


class MockInterviewMaterialRef(BaseModel):
    dataset_id: str
    file_name: str
    version: str


class MockInterviewDetail(MockInterviewSummary):
    materials: list[MockInterviewMaterialRef]
    current_question_id: str | None
    answered_main_questions: int
    needs_reply: bool
    questions: list[MockInterviewQuestionRecord]
    report: dict[str, Any] | None


class MockInterviewResponse(BaseModel):
    mock_interview: MockInterviewDetail


class MockInterviewListResponse(BaseModel):
    items: list[MockInterviewSummary]
    next_cursor: str | None


class DeleteResponse(BaseModel):
    deleted: bool
