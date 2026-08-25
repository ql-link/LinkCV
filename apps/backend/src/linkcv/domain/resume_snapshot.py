from pydantic import BaseModel, ConfigDict, model_validator

from linkcv.domain.resume_document import ResumeDocument
from linkcv.domain.resume_style import ResumePresentation

KNOWN_SECTION_KEYS = (
    "basics",
    "work_experiences",
    "projects",
    "educations",
    "skills",
    "certificates",
    "awards",
    "languages",
    "custom_sections",
)


class ResumeSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: ResumeDocument
    style: ResumePresentation

    @model_validator(mode="after")
    def normalize_section_order(self) -> "ResumeSnapshot":
        if not self.data.semantic_sections:
            raise ValueError("canonical resume requires semantic sections")
        custom_ids = {section.id for section in self.data.sections.custom_sections}
        custom_refs = {
            section.custom_section_id
            for section in self.data.semantic_sections
            if section.content_key == "custom_sections"
        }
        canonical_editor = all(
            section.content_key == "custom_sections"
            for section in self.data.semantic_sections
        )
        if canonical_editor:
            typed_content_present = any(
                bool(getattr(self.data.sections, key))
                for key in KNOWN_SECTION_KEYS
                if key not in {"basics", "custom_sections"}
            )
            duplicated_basics = any(
                value
                for value in (
                    self.data.basics.headline,
                    self.data.basics.email,
                    self.data.basics.phone,
                    self.data.basics.location,
                    self.data.basics.summary,
                    self.data.basics.links,
                )
            )
            if typed_content_present or duplicated_basics:
                raise ValueError("canonical editor content cannot keep a typed duplicate")
            if custom_refs != custom_ids or sum(
                section.semantic_kind == "basics"
                for section in self.data.semantic_sections
            ) != 1:
                raise ValueError("canonical editor sections must be referenced exactly once")
        else:
            required = {"basics"}
            required.update(
                key
                for key in KNOWN_SECTION_KEYS
                if key not in {"basics", "custom_sections"}
                and bool(getattr(self.data.sections, key))
            )
            standard_refs = {
                section.content_key
                for section in self.data.semantic_sections
                if section.content_key != "custom_sections"
            }
            if not required.issubset(standard_refs) or custom_refs != custom_ids:
                raise ValueError("canonical content must be referenced exactly once")
        order = [key for key in self.style.section_order if key in KNOWN_SECTION_KEYS]
        for key in KNOWN_SECTION_KEYS:
            value = self.data.basics if key == "basics" else getattr(self.data.sections, key)
            if (key == "basics" or value) and key not in order:
                order.append(key)
        self.style.section_order = order
        return self


def parse_resume_snapshot(
    data: object,
    style: object,
) -> ResumeSnapshot:
    return ResumeSnapshot.model_validate({"data": data, "style": style})
