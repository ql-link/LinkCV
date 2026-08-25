from dataclasses import dataclass
from typing import Literal

from linkcv.domain.resume_document import ResumeDocument
from linkcv.domain.resume_style import ResumePresentation


@dataclass(frozen=True)
class CreateResumeCommand:
    user_id: int
    title: str
    data: ResumeDocument
    source_type: Literal["blank", "template", "import"]
    style: ResumePresentation | None = None
    template_id: int | None = None
