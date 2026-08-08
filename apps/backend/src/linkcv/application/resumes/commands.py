from dataclasses import dataclass
from typing import Literal

from linkcv.domain.resume_document import ResumeDocumentV1
from linkcv.domain.resume_style import ResumeStyleV1


@dataclass(frozen=True)
class CreateResumeCommand:
    user_id: int
    title: str
    data: ResumeDocumentV1
    source_type: Literal["blank", "template", "import"]
    style: ResumeStyleV1 | None = None
    template_id: int | None = None
