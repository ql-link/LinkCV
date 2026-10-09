"""Request and response contracts for the editor's section focus review."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_LINES = 20
LINE_CHARS = 500
SECTION_CHARS = 4_000
MAX_CONTEXT = 6
CONTEXT_CHARS = 1_500
CONTEXT_TOTAL_CHARS = 6_000
MAX_NOTES = 6
MAX_QUESTIONS = 3
MAX_VARIANTS = 2

NodeId = Annotated[str, Field(min_length=1, max_length=64)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SectionReviewLine(_Request):
    id: NodeId
    text: str = Field(max_length=LINE_CHARS)


class SectionReviewSection(_Request):
    entry_id: NodeId
    heading: str = Field(default="", max_length=200)
    lines: list[SectionReviewLine] = Field(default_factory=list, max_length=MAX_LINES)

    @model_validator(mode="after")
    def _bounded(self) -> "SectionReviewSection":
        ids = [line.id for line in self.lines]
        if len(set(ids)) != len(ids):
            raise ValueError("line ids must be unique")
        if sum(len(line.text) for line in self.lines) > SECTION_CHARS:
            raise ValueError("section text is too long")
        return self

    def line(self, line_id: str) -> SectionReviewLine | None:
        return next((line for line in self.lines if line.id == line_id), None)


class SectionReviewContext(_Request):
    id: NodeId
    label: str = Field(default="", max_length=120)
    text: str = Field(max_length=CONTEXT_CHARS)


class GeneralReference(_Request):
    kind: Literal["general"] = "general"


class JobReference(_Request):
    kind: Literal["job"]
    job_id: str = Field(min_length=1, max_length=20)


SectionReviewReference = Annotated[
    GeneralReference | JobReference, Field(discriminator="kind")
]


def _check_context(context: list[SectionReviewContext]) -> None:
    ids = [item.id for item in context]
    if len(set(ids)) != len(ids):
        raise ValueError("context ids must be unique")
    if sum(len(item.text) for item in context) > CONTEXT_TOTAL_CHARS:
        raise ValueError("context text is too long")


class SectionReviewAnalyzeRequest(_Request):
    section: SectionReviewSection
    context: list[SectionReviewContext] = Field(default_factory=list, max_length=MAX_CONTEXT)
    intent: str | None = Field(default=None, max_length=300)
    reference: SectionReviewReference = Field(default_factory=GeneralReference)

    @model_validator(mode="after")
    def _bounded(self) -> "SectionReviewAnalyzeRequest":
        _check_context(self.context)
        return self


class SectionReviewAnswer(_Request):
    question: str = Field(min_length=1, max_length=300)
    answer: str = Field(min_length=1, max_length=300)


class SectionReviewRewriteRequest(_Request):
    section: SectionReviewSection
    context: list[SectionReviewContext] = Field(default_factory=list, max_length=MAX_CONTEXT)
    reference: SectionReviewReference = Field(default_factory=GeneralReference)
    line_id: str | None = Field(default=None, max_length=64)
    instruction: str | None = Field(default=None, max_length=300)
    answers: list[SectionReviewAnswer] = Field(default_factory=list, max_length=MAX_QUESTIONS)

    @model_validator(mode="after")
    def _bounded(self) -> "SectionReviewRewriteRequest":
        _check_context(self.context)
        if self.line_id is not None and self.section.line(self.line_id) is None:
            raise ValueError("line_id is not part of the section")
        if not (self.instruction or "").strip() and not self.answers:
            raise ValueError("instruction or answers is required")
        return self


class SectionReviewQuestion(BaseModel):
    id: str
    prompt: str
    options: list[str] = Field(default_factory=list)


class SectionReviewVariant(BaseModel):
    id: str
    label: str
    text: str
    risky_terms: list[str] = Field(default_factory=list)


class SectionReviewProposal(BaseModel):
    context_id: str
    summary: str
    line_id: str
    text: str


class SectionReviewNote(BaseModel):
    id: str
    kind: Literal["missing", "wording", "structure"]
    line_id: str | None
    quote: str
    title: str
    detail: str
    questions: list[SectionReviewQuestion] = Field(default_factory=list)
    variants: list[SectionReviewVariant] = Field(default_factory=list)
    proposal: SectionReviewProposal | None = None


class SectionReviewAnalyzeResponse(BaseModel):
    reference_label: str
    inferred_focus: str | None
    too_thin: bool
    draft_questions: list[SectionReviewQuestion] = Field(default_factory=list)
    notes: list[SectionReviewNote] = Field(default_factory=list)


class SectionReviewRewriteResponse(BaseModel):
    variants: list[SectionReviewVariant]
    missing: list[str] = Field(default_factory=list)
