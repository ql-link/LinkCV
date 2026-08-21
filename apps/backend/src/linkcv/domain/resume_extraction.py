from pydantic import BaseModel, ConfigDict, Field


class DraftModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftLink(DraftModel):
    label: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=2_048)


class DraftBasics(DraftModel):
    name: str | None = Field(default=None, max_length=200)
    headline: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=20_000)
    links: list[DraftLink] = Field(default_factory=list, max_length=30)


class DraftWorkExperience(DraftModel):
    organization: str = Field(min_length=1, max_length=300)
    position: str = Field(min_length=1, max_length=300)
    location: str | None = Field(default=None, max_length=300)
    raw_start_date: str | None = Field(default=None, max_length=100)
    raw_end_date: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=20_000)
    highlights: list[str] = Field(default_factory=list, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftEducation(DraftModel):
    institution: str = Field(min_length=1, max_length=300)
    area: str | None = Field(default=None, max_length=300)
    study_type: str | None = Field(default=None, max_length=200)
    raw_start_date: str | None = Field(default=None, max_length=100)
    raw_end_date: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=20_000)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftProject(DraftModel):
    name: str = Field(min_length=1, max_length=300)
    role: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)
    raw_start_date: str | None = Field(default=None, max_length=100)
    raw_end_date: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=20_000)
    highlights: list[str] = Field(default_factory=list, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftSkill(DraftModel):
    name: str = Field(min_length=1, max_length=200)
    level: str | None = Field(default=None, max_length=100)
    keywords: list[str] = Field(default_factory=list, max_length=100)


class DraftNamedItem(DraftModel):
    name: str = Field(min_length=1, max_length=300)
    detail: str | None = Field(default=None, max_length=300)
    raw_date: str | None = Field(default=None, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftCustomSection(DraftModel):
    title: str = Field(min_length=1, max_length=200)
    items: list[str] = Field(default_factory=list, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class ResumeExtractionDraft(DraftModel):
    basics: DraftBasics = Field(default_factory=DraftBasics)
    work_experiences: list[DraftWorkExperience] = Field(default_factory=list, max_length=100)
    educations: list[DraftEducation] = Field(default_factory=list, max_length=100)
    projects: list[DraftProject] = Field(default_factory=list, max_length=100)
    skills: list[DraftSkill] = Field(default_factory=list, max_length=200)
    certificates: list[DraftNamedItem] = Field(default_factory=list, max_length=100)
    awards: list[DraftNamedItem] = Field(default_factory=list, max_length=100)
    languages: list[DraftNamedItem] = Field(default_factory=list, max_length=100)
    custom_sections: list[DraftCustomSection] = Field(default_factory=list, max_length=50)
    unmapped_fragments: list[str] = Field(default_factory=list, max_length=100)
