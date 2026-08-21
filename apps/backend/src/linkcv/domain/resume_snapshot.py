from pydantic import BaseModel, ConfigDict, model_validator

from linkcv.domain.resume_document import ResumeDocumentV1
from linkcv.domain.resume_style import ResumeStyleV1

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

    data: ResumeDocumentV1
    style: ResumeStyleV1

    @model_validator(mode="after")
    def normalize_section_order(self) -> "ResumeSnapshot":
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
