from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ResumeWrite(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str | None = None
    markdown: str | None = None
    settings: dict[str, Any] | None = None
    split_ratio: float | None = Field(default=None, alias="splitRatio")
    preview_scale: float | None = Field(default=None, alias="previewScale")


class ResumeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    title: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


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
