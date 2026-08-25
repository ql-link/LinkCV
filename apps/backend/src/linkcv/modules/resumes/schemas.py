from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from linkcv.domain.resume_document import ResumeDocument
from linkcv.domain.resume_style import ResumePresentation


class ResumeCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, strict=True, max_length=20_000)
    template_id: str | None = Field(default=None, strict=True)


class ResumeUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, strict=True, max_length=20_000)
    data: ResumeDocument | None = None
    style: ResumePresentation | None = None
    base_lock_version: int = Field(ge=1)


class ResumeApplyTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: str = Field(strict=True)
    base_lock_version: int = Field(ge=1)
    title: str | None = Field(default=None, strict=True, max_length=20_000)
    data: ResumeDocument | None = None


SemanticClassificationKind = Literal[
    "profile",
    "work",
    "education",
    "project",
    "skills",
    "activity",
    "interests",
    "certificates",
    "awards",
    "languages",
    "custom",
]


class SemanticClassificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    section_ids: list[str] | None = Field(default=None, min_length=1, max_length=50)


class SemanticClassificationSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    section_id: str = Field(min_length=3, max_length=128)
    semantic_kind: SemanticClassificationKind
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=240)


class SemanticClassificationModelResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggestions: list[SemanticClassificationSuggestion] = Field(max_length=50)


class SemanticClassificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_hash: str
    suggestions: list[SemanticClassificationSuggestion]


class ResumePreview(BaseModel):
    data: ResumeDocument
    style: ResumePresentation


class ResumeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    title: str
    source_type: Literal["blank", "template", "import"]
    lock_version: int
    created_at: datetime
    updated_at: datetime
    preview: ResumePreview | None = None

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class ResumeRecord(ResumeSummary):
    template_id: str | None
    data: ResumeDocument
    style: ResumePresentation


class ResumeResponse(BaseModel):
    resume: ResumeRecord


class ResumeListResponse(BaseModel):
    resumes: list[ResumeSummary]


class DeleteResumeResponse(BaseModel):
    deleted: bool


class ResumeImportMetadata(BaseModel):
    source_file_name: str
    source_file_format: Literal["md", "docx", "pdf"]
    warnings: list[str]


class ResumeImportResponse(BaseModel):
    import_result: "ResumeImportSummary" = Field(alias="import")


class ResumeImportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    source_filename: str
    source_file_format: Literal["md", "docx", "pdf"]
    upload_status: Literal["uploading", "succeeded", "failed"]
    upload_duration_ms: int | None
    parse_status: Literal["processing", "succeeded", "failed"] | None
    parse_duration_ms: int | None
    result_resume_id: str | None
    created_at: datetime
    updated_at: datetime

    @field_validator("id", "result_resume_id", mode="before")
    @classmethod
    def stringify_optional_id(cls, value: object) -> str | None:
        return None if value is None else str(value)


class ResumeOverviewResponse(BaseModel):
    resumes: list[ResumeSummary]
    active_imports: list[ResumeImportSummary]
    failed_imports: list[ResumeImportSummary]
    next_failed_cursor: str | None


class DeleteResumeImportResponse(BaseModel):
    deleted: bool


class ResumeTemplateRecord(BaseModel):
    id: str
    key: str
    name: str
    description: str | None
    data: ResumeDocument
    style: ResumePresentation
    switchable: Literal[True] = True
    incompatibility_reason: None = None


class ResumeTemplateListResponse(BaseModel):
    templates: list[ResumeTemplateRecord]


class ResumeTemplateResponse(BaseModel):
    template: ResumeTemplateRecord


class ResumeVersionSummary(BaseModel):
    id: str
    version_no: int
    name: str
    reason: Literal["initial", "manual", "before_restore", "restore", "agent"]
    created_at: datetime


class ResumeVersionRecord(ResumeVersionSummary):
    data: ResumeDocument
    style: ResumePresentation


class ResumeVersionListResponse(BaseModel):
    versions: list[ResumeVersionSummary]


class ResumeVersionResponse(BaseModel):
    version: ResumeVersionRecord


class ResumeVersionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, strict=True)


class ResumeVersionRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(strict=True)


class DeleteResumeVersionResponse(BaseModel):
    deleted: bool


class ResumeShareState(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    share_token: str
    share_visibility: Literal["private", "public"]
    share_expires_at: datetime | None = None
    share_created_at: datetime


class ResumeShareResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    share: ResumeShareState | None


class ResumeShareCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visibility: Literal["private", "public"] | None = None
    expires_at: datetime | None = None


class ResumeShareUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visibility: Literal["private", "public"] | None = None
    expires_at: datetime | None = None


class DeleteResumeShareResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deleted: bool


class PublicShareSharer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nickname: str
    avatar_url: str | None = None


class PublicSharePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ResumeDocument
    style: ResumePresentation
    sharer: PublicShareSharer
