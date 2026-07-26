from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ResumeWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str | None = None
    markdown: str | None = None
    settings: dict[str, Any] | None = None
    split_ratio: float | None = Field(default=None, alias="splitRatio")
    preview_scale: float | None = Field(default=None, alias="previewScale")
    lock_version: int | None = Field(default=None, alias="lockVersion", ge=1)


class ResumeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    title: str
    source_type: str = Field(alias="sourceType")
    lock_version: int = Field(alias="lockVersion")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class ResumeRecord(ResumeSummary):
    markdown: str
    settings: dict[str, Any]
    split_ratio: float = Field(alias="splitRatio")
    preview_scale: float = Field(alias="previewScale")


class ResumeResponse(BaseModel):
    resume: ResumeRecord


class ResumeListResponse(BaseModel):
    resumes: list[ResumeSummary]


class DeleteResumeResponse(BaseModel):
    deleted: bool
