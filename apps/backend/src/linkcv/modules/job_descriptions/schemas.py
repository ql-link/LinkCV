from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


EmploymentType = Literal[
    "full_time", "part_time", "internship", "contract", "temporary"
]
WorkMode = Literal["onsite", "hybrid", "remote"]
SalaryPeriod = Literal["hour", "day", "month", "year"]
SourceType = Literal["manual", "external_import"]
Skill = Annotated[str, Field(max_length=100)]


class DuplicateResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["update"]
    job_description_id: str
    base_lock_version: int = Field(ge=1)


class BrowserJobCapture(BaseModel):
    """Fields observed on a job detail page before server-side normalization."""

    model_config = ConfigDict(extra="forbid")

    job_title: str | None = Field(default=None, max_length=1_000)
    company_name: str | None = Field(default=None, max_length=1_000)
    description_text: str | None = Field(default=None, max_length=200_000)
    skills: list[Skill] = Field(default_factory=list, max_length=100)
    employment_type_text: str | None = Field(default=None, max_length=100)
    education_text: str | None = Field(default=None, max_length=100)
    experience_text: str | None = Field(default=None, max_length=100)
    work_schedule_text: str | None = Field(default=None, max_length=100)
    work_city: str | None = Field(default=None, max_length=100)
    work_address: str | None = Field(default=None, max_length=500)
    salary_text: str | None = Field(default=None, max_length=128)
    company_legal_name: str | None = Field(default=None, max_length=255)
    company_industry: str | None = Field(default=None, max_length=100)
    company_size: str | None = Field(default=None, max_length=50)
    company_financing_stage: str | None = Field(default=None, max_length=50)
    company_description: str | None = Field(default=None, max_length=200_000)
    company_tags: list[Skill] = Field(default_factory=list, max_length=30)
    recruiter_name: str | None = Field(default=None, max_length=100)
    recruiter_title: str | None = Field(default=None, max_length=100)


class JobDescriptionImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_url: str = Field(max_length=2048)
    capture: BrowserJobCapture
    duplicate_resolution: DuplicateResolution | None = None

    @field_validator("source_url")
    @classmethod
    def trim_source_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("source_url cannot be blank")
        return normalized


class JobDescriptionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_title: str = Field(max_length=200)
    company_name: str = Field(max_length=200)
    employment_type: EmploymentType | None = None
    description: str = Field(max_length=200_000)
    skills: list[Skill] = Field(default_factory=list, max_length=100)
    education_requirement: str | None = Field(default=None, max_length=100)
    experience_requirement: str | None = Field(default=None, max_length=100)
    work_schedule: str | None = Field(default=None, max_length=100)
    work_city: str | None = Field(default=None, max_length=100)
    work_address: str | None = Field(default=None, max_length=500)
    work_mode: WorkMode | None = None
    salary_text: str | None = Field(default=None, max_length=128)
    salary_min: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    salary_max: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    salary_currency: str | None = Field(default=None, max_length=3)
    salary_period: SalaryPeriod | None = None
    salary_months_per_year: int | None = Field(default=None, ge=1, le=65_535)
    company_legal_name: str | None = Field(default=None, max_length=255)
    company_industry: str | None = Field(default=None, max_length=100)
    company_size: str | None = Field(default=None, max_length=50)
    company_financing_stage: str | None = Field(default=None, max_length=50)
    company_description: str | None = Field(default=None, max_length=200_000)
    recruiter_name: str | None = Field(default=None, max_length=100)
    recruiter_title: str | None = Field(default=None, max_length=100)
    source_type: SourceType
    source_url: str | None = Field(default=None, max_length=2048)
    notes: str | None = Field(default=None, max_length=16_000)
    duplicate_resolution: DuplicateResolution | None = None

    @field_validator("job_title", "company_name", "description")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("required text cannot be blank")
        return normalized

    @field_validator(
        "education_requirement",
        "experience_requirement",
        "work_schedule",
        "work_city",
        "work_address",
        "salary_text",
        "company_legal_name",
        "company_industry",
        "company_size",
        "company_financing_stage",
        "company_description",
        "recruiter_name",
        "recruiter_title",
        "source_url",
        "notes",
    )
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("skills")
    @classmethod
    def normalize_skills(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = value.strip()
            if not normalized or normalized in seen:
                continue
            if len(normalized) > 100:
                raise ValueError("skill is too long")
            seen.add(normalized)
            result.append(normalized)
        return result

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
    def validate_salary(self) -> JobDescriptionCreateRequest:
        _validate_salary_values(
            self.salary_min,
            self.salary_max,
            self.salary_currency,
            self.salary_period,
        )
        return self


class JobDescriptionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_title: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)
    employment_type: EmploymentType | None = None
    description: str | None = Field(default=None, max_length=200_000)
    skills: list[Skill] | None = Field(default=None, max_length=100)
    education_requirement: str | None = Field(default=None, max_length=100)
    experience_requirement: str | None = Field(default=None, max_length=100)
    work_schedule: str | None = Field(default=None, max_length=100)
    work_city: str | None = Field(default=None, max_length=100)
    work_address: str | None = Field(default=None, max_length=500)
    work_mode: WorkMode | None = None
    salary_text: str | None = Field(default=None, max_length=128)
    salary_min: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    salary_max: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    salary_currency: str | None = Field(default=None, max_length=3)
    salary_period: SalaryPeriod | None = None
    salary_months_per_year: int | None = Field(default=None, ge=1, le=65_535)
    company_legal_name: str | None = Field(default=None, max_length=255)
    company_industry: str | None = Field(default=None, max_length=100)
    company_size: str | None = Field(default=None, max_length=50)
    company_financing_stage: str | None = Field(default=None, max_length=50)
    company_description: str | None = Field(default=None, max_length=200_000)
    recruiter_name: str | None = Field(default=None, max_length=100)
    recruiter_title: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=16_000)
    base_lock_version: int = Field(ge=1)

    @field_validator("job_title", "company_name", "description")
    @classmethod
    def trim_required_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("required text cannot be blank")
        return normalized

    @field_validator(
        "education_requirement",
        "experience_requirement",
        "work_schedule",
        "work_city",
        "work_address",
        "salary_text",
        "company_legal_name",
        "company_industry",
        "company_size",
        "company_financing_stage",
        "company_description",
        "recruiter_name",
        "recruiter_title",
        "notes",
    )
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("skills")
    @classmethod
    def normalize_skills(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        result: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = value.strip()
            if not normalized or normalized in seen:
                continue
            if len(normalized) > 100:
                raise ValueError("skill is too long")
            seen.add(normalized)
            result.append(normalized)
        return result

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
    def require_update_field(self) -> JobDescriptionUpdateRequest:
        changed = self.model_fields_set - {"base_lock_version"}
        if not changed:
            raise ValueError("at least one mutable field is required")
        for required in ("job_title", "company_name", "description"):
            if required in self.model_fields_set and getattr(self, required) is None:
                raise ValueError(f"{required} cannot be null")
        return self


class JobDescriptionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    job_title: str
    company_name: str
    work_city: str | None
    salary_text: str | None
    skills: list[str]
    source_type: SourceType
    source_site: str | None
    source_url: str | None
    lock_version: int
    updated_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)

    @field_validator("updated_at", mode="before")
    @classmethod
    def normalize_summary_timestamps(cls, value: object) -> object:
        return _as_utc(value)


class JobDescriptionRecord(JobDescriptionSummary):
    employment_type: EmploymentType | None
    description: str
    education_requirement: str | None
    experience_requirement: str | None
    work_schedule: str | None
    work_address: str | None
    work_mode: WorkMode | None
    salary_min: Decimal | None
    salary_max: Decimal | None
    salary_currency: str | None
    salary_period: SalaryPeriod | None
    salary_months_per_year: int | None
    company_legal_name: str | None
    company_industry: str | None
    company_size: str | None
    company_financing_stage: str | None
    company_description: str | None
    recruiter_name: str | None
    recruiter_title: str | None
    source_job_id: str | None
    source_url_hash: str | None
    imported_at: datetime | None
    notes: str | None
    created_at: datetime

    @field_validator("source_url_hash", mode="before")
    @classmethod
    def encode_source_hash(cls, value: object) -> str | None:
        if value is None:
            return None
        if isinstance(value, bytes):
            return value.hex()
        return str(value)

    @field_validator("imported_at", "created_at", mode="before")
    @classmethod
    def normalize_record_timestamps(cls, value: object) -> object:
        return _as_utc(value)


class JobDescriptionResponse(BaseModel):
    job_description: JobDescriptionRecord


class JobDescriptionListResponse(BaseModel):
    items: list[JobDescriptionSummary]
    next_cursor: str | None


class DeleteJobDescriptionResponse(BaseModel):
    deleted: bool


def _as_utc(value: object) -> object:
    if not isinstance(value, datetime):
        return value
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _validate_salary_values(
    salary_min: Decimal | None,
    salary_max: Decimal | None,
    currency: str | None,
    period: str | None,
) -> None:
    if salary_min is not None and salary_max is not None and salary_max < salary_min:
        raise ValueError("salary_max must not be less than salary_min")
    if (salary_min is not None or salary_max is not None) and (
        currency is None or period is None
    ):
        raise ValueError("numeric salary requires currency and period")
