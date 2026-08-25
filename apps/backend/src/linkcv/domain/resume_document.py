import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ID_PATTERN = re.compile(r"^[a-z][a-z0-9_:-]{2,127}$")
DANGEROUS_MARKDOWN_PATTERN = re.compile(
    r"<(?:script|iframe|object|embed|style)\b|javascript:", re.IGNORECASE
)
Keyword = Annotated[str, Field(max_length=200)]


def _is_safe_http_url(value: str) -> bool:
    return value.lower().startswith(("https://", "http://"))


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RichText(DomainModel):
    format: Literal["markdown"] = "markdown"
    content: str = Field(max_length=20_000)

    @model_validator(mode="after")
    def reject_unsafe_markup(self) -> "RichText":
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
    label: str = Field(max_length=100)
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
    summary: RichText | None = None
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
    content: RichText


class DatedEntry(IdentifiedModel):
    start_date: str | None = Field(default=None, max_length=100)
    end_date: str | None = Field(default=None, max_length=100)
    current: bool = False
    source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)


class WorkExperience(DatedEntry):
    organization: str = Field(max_length=300)
    position: str = Field(max_length=300)
    location: str | None = Field(default=None, max_length=300)
    summary: RichText | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)


class Education(DatedEntry):
    institution: str = Field(max_length=300)
    area: str | None = Field(default=None, max_length=300)
    study_type: str | None = Field(default=None, max_length=200)
    score: str | None = Field(default=None, max_length=100)
    summary: RichText | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)


class Project(DatedEntry):
    name: str = Field(max_length=300)
    role: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)
    summary: RichText | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_url(self) -> "Project":
        if self.url and not _is_safe_http_url(self.url):
            raise ValueError("project URL must use HTTP or HTTPS")
        return self


class Skill(IdentifiedModel):
    name: str = Field(max_length=200)
    level: str | None = Field(default=None, max_length=100)
    keywords: list[Keyword] = Field(default_factory=list, max_length=100)


class Certificate(DatedEntry):
    name: str = Field(max_length=300)
    issuer: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)

    @model_validator(mode="after")
    def validate_url(self) -> "Certificate":
        if self.url and not _is_safe_http_url(self.url):
            raise ValueError("certificate URL must use HTTP or HTTPS")
        return self


class Award(DatedEntry):
    title: str = Field(max_length=300)
    awarder: str | None = Field(default=None, max_length=300)
    summary: RichText | None = None


class Language(IdentifiedModel):
    name: str = Field(max_length=300)
    fluency: str | None = Field(default=None, max_length=300)


class CustomItem(IdentifiedModel):
    title: str | None = Field(default=None, max_length=300)
    subtitle: str | None = Field(default=None, max_length=300)
    content: RichText
    source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)


class CustomSection(IdentifiedModel):
    title: str = Field(max_length=200)
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


SemanticKind = Literal[
    "basics",
    "work",
    "education",
    "project",
    "skills",
    "activity",
    "certificates",
    "awards",
    "languages",
    "custom",
]
SemanticSource = Literal["import", "model", "user", "system"]
ContentKey = Literal[
    "basics",
    "work_experiences",
    "educations",
    "projects",
    "skills",
    "certificates",
    "awards",
    "languages",
    "custom_sections",
]


class SemanticSection(IdentifiedModel):
    semantic_kind: SemanticKind
    display_title: str = Field(min_length=1, max_length=200)
    semantic_source: SemanticSource = "system"
    semantic_confidence: float | None = Field(default=None, ge=0, le=1)
    content_key: ContentKey
    custom_section_id: str | None = Field(default=None, min_length=3, max_length=128)

    @model_validator(mode="after")
    def validate_reference(self) -> "SemanticSection":
        if self.content_key == "custom_sections":
            if self.custom_section_id is None or not ID_PATTERN.fullmatch(self.custom_section_id):
                raise ValueError("custom semantic section requires a stable section id")
        elif self.custom_section_id is not None:
            raise ValueError("standard semantic section cannot reference custom content")
        return self


STANDARD_SEMANTIC_SECTIONS: tuple[tuple[ContentKey, SemanticKind, str], ...] = (
    ("basics", "basics", "基本信息"),
    ("work_experiences", "work", "工作经历"),
    ("educations", "education", "教育经历"),
    ("projects", "project", "项目经历"),
    ("skills", "skills", "专业技能"),
    ("certificates", "certificates", "证书"),
    ("awards", "awards", "荣誉奖项"),
    ("languages", "languages", "语言能力"),
)


class ResumeDocument(DomainModel):
    basics: ResumeBasics = Field(default_factory=ResumeBasics)
    sections: ResumeSections = Field(default_factory=ResumeSections)
    semantic_sections: list[SemanticSection] = Field(max_length=100)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ResumeDocument":
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

        custom_ids = {section.id for section in self.sections.custom_sections}
        semantic_ids = [section.id for section in self.semantic_sections]
        references = [
            (section.content_key, section.custom_section_id)
            for section in self.semantic_sections
        ]
        if len(semantic_ids) != len(set(semantic_ids)):
            raise ValueError("semantic section ids must be unique")
        if len(references) != len(set(references)):
            raise ValueError("semantic content references must be unique")
        if any(
            section.custom_section_id not in custom_ids
            for section in self.semantic_sections
            if section.content_key == "custom_sections"
        ):
            raise ValueError("semantic section references missing custom content")
        return self


def default_semantic_sections(document: ResumeDocument) -> list[SemanticSection]:
    sections = [
        SemanticSection(
            id=f"semantic_{content_key}",
            semantic_kind=semantic_kind,
            display_title=display_title,
            content_key=content_key,
        )
        for content_key, semantic_kind, display_title in STANDARD_SEMANTIC_SECTIONS
        if content_key == "basics" or bool(getattr(document.sections, content_key))
    ]
    sections.extend(
        SemanticSection(
            id=f"semantic_{section.id}",
            semantic_kind="custom",
            display_title=section.title,
            content_key="custom_sections",
            custom_section_id=section.id,
        )
        for section in document.sections.custom_sections
    )
    return sections


def with_default_semantics(document: ResumeDocument) -> ResumeDocument:
    if document.semantic_sections:
        return document
    return document.model_copy(update={"semantic_sections": default_semantic_sections(document)})


def default_resume_document() -> ResumeDocument:
    document = ResumeDocument(
        basics=ResumeBasics(name="张三", headline="后端开发工程师"),
        sections=ResumeSections(),
        semantic_sections=[],
    )
    return with_default_semantics(document)
