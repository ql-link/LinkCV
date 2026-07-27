import re
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from linkcv.domain.resume_document import (
    Award,
    Certificate,
    CustomItem,
    CustomSection,
    Education,
    Highlight,
    Language,
    Project,
    ResumeBasics,
    ResumeDocumentV1,
    ResumeLink,
    ResumeSections,
    RichTextV1,
    Skill,
    SourceRef,
    WorkExperience,
)
from linkcv.domain.resume_extraction import ResumeExtractionDraft


class NormalizationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: ResumeDocumentV1
    warnings: list[str] = Field(default_factory=list)


def new_element_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:16]}"


def normalize_date(value: str | None) -> tuple[str | None, bool]:
    if value is None or not value.strip():
        return None, False
    normalized = value.strip().lower()
    if normalized in {"至今", "现在", "今", "present", "current", "now"}:
        return None, True
    match = re.search(r"(?P<year>\d{4})(?:\D+(?P<month>\d{1,2}))?", normalized)
    if not match:
        return None, False
    year = match.group("year")
    month = match.group("month")
    if month is None:
        return year, False
    number = int(month)
    if not 1 <= number <= 12:
        return None, False
    return f"{year}-{number:02d}", False


def _source_refs(
    field: str,
    quotes: list[str],
    markdown: str,
    warnings: list[str],
) -> list[SourceRef]:
    lines = markdown.splitlines()
    refs: list[SourceRef] = []
    for quote in quotes:
        candidate = quote.strip()
        if not candidate:
            continue
        matched = False
        for index, line in enumerate(lines):
            if candidate in line:
                refs.append(
                    SourceRef(
                        field=field,
                        start_line=index + 1,
                        end_line=index + 1,
                        quote=candidate,
                    )
                )
                matched = True
                break
        if not matched:
            warnings.append("source_quote_not_found")
    return refs


def _rich_text(value: str | None) -> RichTextV1 | None:
    return RichTextV1(content=value.strip()) if value and value.strip() else None


def finalize_resume_document(
    draft: ResumeExtractionDraft,
    extracted_markdown: str,
) -> NormalizationResult:
    warnings: list[str] = []
    basics = ResumeBasics(
        name=(draft.basics.name or "").strip(),
        headline=draft.basics.headline,
        email=draft.basics.email,
        phone=draft.basics.phone,
        location=draft.basics.location,
        summary=_rich_text(draft.basics.summary),
        links=[
            ResumeLink(id=new_element_id("link"), label=link.label, url=link.url)
            for link in draft.basics.links
        ],
    )

    work_experiences: list[WorkExperience] = []
    for item in draft.work_experiences:
        start_date, _ = normalize_date(item.raw_start_date)
        end_date, current = normalize_date(item.raw_end_date)
        if item.raw_start_date and start_date is None:
            warnings.append("unparsed_work_start_date")
        if item.raw_end_date and end_date is None and not current:
            warnings.append("unparsed_work_end_date")
        work_experiences.append(
            WorkExperience(
                id=new_element_id("work"),
                organization=item.organization,
                position=item.position,
                location=item.location,
                start_date=start_date,
                end_date=end_date,
                current=current,
                summary=_rich_text(item.summary),
                highlights=[
                    Highlight(
                        id=new_element_id("highlight"),
                        content=RichTextV1(content=highlight),
                    )
                    for highlight in item.highlights
                    if highlight.strip()
                ],
                source_refs=_source_refs(
                    "work_experience", item.source_quotes, extracted_markdown, warnings
                ),
            )
        )

    educations: list[Education] = []
    for item in draft.educations:
        start_date, _ = normalize_date(item.raw_start_date)
        end_date, current = normalize_date(item.raw_end_date)
        educations.append(
            Education(
                id=new_element_id("education"),
                institution=item.institution,
                area=item.area,
                study_type=item.study_type,
                start_date=start_date,
                end_date=end_date,
                current=current,
                summary=_rich_text(item.summary),
                source_refs=_source_refs(
                    "education", item.source_quotes, extracted_markdown, warnings
                ),
            )
        )

    projects: list[Project] = []
    for item in draft.projects:
        start_date, _ = normalize_date(item.raw_start_date)
        end_date, current = normalize_date(item.raw_end_date)
        projects.append(
            Project(
                id=new_element_id("project"),
                name=item.name,
                role=item.role,
                url=item.url,
                start_date=start_date,
                end_date=end_date,
                current=current,
                summary=_rich_text(item.summary),
                highlights=[
                    Highlight(
                        id=new_element_id("highlight"),
                        content=RichTextV1(content=highlight),
                    )
                    for highlight in item.highlights
                    if highlight.strip()
                ],
                source_refs=_source_refs(
                    "project", item.source_quotes, extracted_markdown, warnings
                ),
            )
        )

    custom_sections = [
        CustomSection(
            id=new_element_id("custom_section"),
            title=section.title,
            items=[
                CustomItem(
                    id=new_element_id("custom_item"),
                    content=RichTextV1(content=value),
                    source_refs=_source_refs(
                        "custom_section",
                        section.source_quotes,
                        extracted_markdown,
                        warnings,
                    ),
                )
                for value in section.items
                if value.strip()
            ],
        )
        for section in draft.custom_sections
    ]
    if draft.unmapped_fragments:
        custom_sections.append(
            CustomSection(
                id=new_element_id("custom_section"),
                title="未分类内容",
                items=[
                    CustomItem(
                        id=new_element_id("custom_item"),
                        content=RichTextV1(content=value),
                    )
                    for value in draft.unmapped_fragments
                    if value.strip()
                ],
            )
        )
        warnings.append("unmapped_fragments_preserved")

    document = ResumeDocumentV1(
        basics=basics,
        sections=ResumeSections(
            work_experiences=work_experiences,
            educations=educations,
            projects=projects,
            skills=[
                Skill(
                    id=new_element_id("skill"),
                    name=item.name,
                    level=item.level,
                    keywords=item.keywords,
                )
                for item in draft.skills
            ],
            certificates=[
                Certificate(
                    id=new_element_id("certificate"),
                    name=item.name,
                    issuer=item.detail,
                    start_date=normalize_date(item.raw_date)[0],
                    source_refs=_source_refs(
                        "certificate", item.source_quotes, extracted_markdown, warnings
                    ),
                )
                for item in draft.certificates
            ],
            awards=[
                Award(
                    id=new_element_id("award"),
                    title=item.name,
                    awarder=item.detail,
                    start_date=normalize_date(item.raw_date)[0],
                    source_refs=_source_refs(
                        "award", item.source_quotes, extracted_markdown, warnings
                    ),
                )
                for item in draft.awards
            ],
            languages=[
                Language(
                    id=new_element_id("language"),
                    name=item.name,
                    fluency=item.detail,
                )
                for item in draft.languages
            ],
            custom_sections=custom_sections,
        ),
    )
    return NormalizationResult(document=document, warnings=sorted(set(warnings)))
