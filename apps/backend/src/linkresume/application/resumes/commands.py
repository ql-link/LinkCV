from dataclasses import dataclass
from typing import Literal

from linkresume.domain.resume import (
    CanonicalResumeDocument,
    ResumePresentation as CanonicalResumePresentation,
)
@dataclass(frozen=True)
class CreateResumeCommand:
    user_id: int
    title: str
    data: CanonicalResumeDocument
    source_type: Literal["blank", "template", "import"]
    style: CanonicalResumePresentation
    template_id: int
