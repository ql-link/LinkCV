import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DATE_PATTERN = re.compile(r"^\d{4}(?:-(?:0[1-9]|1[0-2]))?$")
ID_PATTERN = re.compile(r"^[a-z][a-z0-9_:-]{2,127}$")
DANGEROUS_MARKDOWN_PATTERN = re.compile(
    r"<(?:script|iframe|object|embed|style)\b|javascript:", re.IGNORECASE
)
Keyword = Annotated[str, Field(min_length=1, max_length=200)]


def _is_safe_http_url(value: str) -> bool:
    return value.lower().startswith(("https://", "http://"))


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RichTextV1(DomainModel):
    format: Literal["markdown"] = "markdown"
    content: str = Field(max_length=20_000)

    @model_validator(mode="after")
    def reject_unsafe_markup(self) -> "RichTextV1":
        if DANGEROUS_MARKDOWN_PATTERN.search(self.content):
            raise ValueError("unsafe markdown content")
        return self


class SourceRef(DomainModel):
    field: str = Field(min_length=1, max_length=64)
    source: Literal["extracted_markdown"] = "extracted_markdown"
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    quote: str = Field(min_length=1, max_length=1_000)

    @model_validator(mode="after")
    def validate_line_range(self) -> "SourceRef":
        if self.end_line < self.start_line:
            raise ValueError("source line range is reversed")
        return self


class IdentifiedModel(DomainModel):
    id: str = Field(min_length=3, max_length=128)

    @model_validator(mode="after")
    def validate_stable_id(self) -> "IdentifiedModel":
        if not ID_PATTERN.fullmatch(self.id):
            raise ValueError("invalid stable id")
        return self


class ResumeLink(IdentifiedModel):
    label: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=2_048)

    @model_validator(mode="after")
    def validate_url(self) -> "ResumeLink":
        if not _is_safe_http_url(self.url):
            raise ValueError("link URL must use HTTP or HTTPS")
        return self


class ResumeBasics(DomainModel):
    name: str = Field(default="", max_length=200)
    headline: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=300)
    photo: str | None = Field(default=None, max_length=512)
    summary: RichTextV1 | None = None
    links: list[ResumeLink] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_photo_reference(self) -> "ResumeBasics":
        if self.photo and not (
            _is_safe_http_url(self.photo)
            or self.photo.startswith(("/api/assets/", "/api/resumes/"))
        ):
            raise ValueError("photo must use a private API path or HTTP(S) URL")
        return self


class Highlight(IdentifiedModel):
    content: RichTextV1


class DatedEntry(IdentifiedModel):
    start_date: str | None = None
    end_date: str | None = None
    current: bool = False
    source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_date_format(self) -> "DatedEntry":
        for value in (self.start_date, self.end_date):
            if value is not None and not DATE_PATTERN.fullmatch(value):
                raise ValueError("date must use YYYY or YYYY-MM")
        return self


class WorkExperience(DatedEntry):
    organization: str = Field(min_length=1, max_length=300)
    position: str = Field(min_length=1, max_length=300)
    location: str | None = Field(default=None, max_length=300)
    summary: RichTextV1 | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)


class Education(DatedEntry):
    institution: str = Field(min_length=1, max_length=300)
    area: str | None = Field(default=None, max_length=300)
    study_type: str | None = Field(default=None, max_length=200)
    score: str | None = Field(default=None, max_length=100)
    summary: RichTextV1 | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)


class Project(DatedEntry):
    name: str = Field(min_length=1, max_length=300)
    role: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)
    summary: RichTextV1 | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_url(self) -> "Project":
        if self.url and not _is_safe_http_url(self.url):
            raise ValueError("project URL must use HTTP or HTTPS")
        return self


class Skill(IdentifiedModel):
    name: str = Field(min_length=1, max_length=200)
    level: str | None = Field(default=None, max_length=100)
    keywords: list[Keyword] = Field(default_factory=list, max_length=100)


class Certificate(DatedEntry):
    name: str = Field(min_length=1, max_length=300)
    issuer: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)

    @model_validator(mode="after")
    def validate_url(self) -> "Certificate":
        if self.url and not _is_safe_http_url(self.url):
            raise ValueError("certificate URL must use HTTP or HTTPS")
        return self


class Award(DatedEntry):
    title: str = Field(min_length=1, max_length=300)
    awarder: str | None = Field(default=None, max_length=300)
    summary: RichTextV1 | None = None


class Language(IdentifiedModel):
    name: str = Field(min_length=1, max_length=100)
    fluency: str | None = Field(default=None, max_length=100)


class CustomItem(IdentifiedModel):
    title: str | None = Field(default=None, max_length=300)
    subtitle: str | None = Field(default=None, max_length=300)
    content: RichTextV1
    source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)


class CustomSection(IdentifiedModel):
    title: str = Field(min_length=1, max_length=200)
    items: list[CustomItem] = Field(default_factory=list, max_length=100)


class ResumeSections(DomainModel):
    work_experiences: list[WorkExperience] = Field(default_factory=list, max_length=100)
    educations: list[Education] = Field(default_factory=list, max_length=100)
    projects: list[Project] = Field(default_factory=list, max_length=100)
    skills: list[Skill] = Field(default_factory=list, max_length=200)
    certificates: list[Certificate] = Field(default_factory=list, max_length=100)
    awards: list[Award] = Field(default_factory=list, max_length=100)
    languages: list[Language] = Field(default_factory=list, max_length=100)
    custom_sections: list[CustomSection] = Field(default_factory=list, max_length=50)


class ResumeDocumentV1(DomainModel):
    schema_version: Literal["1.0"] = "1.0"
    basics: ResumeBasics = Field(default_factory=ResumeBasics)
    sections: ResumeSections = Field(default_factory=ResumeSections)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ResumeDocumentV1":
        ids: list[str] = [item.id for item in self.basics.links]
        for collection in (
            self.sections.work_experiences,
            self.sections.educations,
            self.sections.projects,
            self.sections.skills,
            self.sections.certificates,
            self.sections.awards,
            self.sections.languages,
            self.sections.custom_sections,
        ):
            for item in collection:
                ids.append(item.id)
                highlights = getattr(item, "highlights", [])
                ids.extend(highlight.id for highlight in highlights)
                custom_items = getattr(item, "items", [])
                ids.extend(custom_item.id for custom_item in custom_items)
        if len(ids) != len(set(ids)):
            raise ValueError("resume element ids must be unique")
        return self


def default_resume_document() -> ResumeDocumentV1:
    return ResumeDocumentV1(
        basics=ResumeBasics(name="张三", headline="后端开发工程师"),
        sections=ResumeSections(),
    )
