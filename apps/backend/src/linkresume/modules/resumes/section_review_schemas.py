"""Request and response contracts for the editor's section focus review."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

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
MAX_REVIEW_ITEMS = 30

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
    """Legacy: the job as the whole reference, judged with the general standard."""

    kind: Literal["job"]
    job_id: str = Field(min_length=1, max_length=20)


WritingMethod = Literal["star", "xyz", "car"]


class MethodReference(_Request):
    """A named resume-writing method, e.g. STAR, used as the analysis style."""

    kind: Literal["method"]
    method: WritingMethod


SectionReviewReference = Annotated[
    GeneralReference | JobReference | MethodReference, Field(discriminator="kind")
]


def _check_context(context: list[SectionReviewContext]) -> None:
    ids = [item.id for item in context]
    if len(set(ids)) != len(ids):
        raise ValueError("context ids must be unique")
    if sum(len(item.text) for item in context) > CONTEXT_TOTAL_CHARS:
        raise ValueError("context text is too long")


def _check_job(reference: object, job_id: str | None) -> None:
    if job_id is not None and isinstance(reference, JobReference):
        raise ValueError("job_id cannot be combined with a job reference")


class SectionReviewAnalyzeRequest(_Request):
    section: SectionReviewSection
    context: list[SectionReviewContext] = Field(default_factory=list, max_length=MAX_CONTEXT)
    intent: str | None = Field(default=None, max_length=300)
    reference: SectionReviewReference = Field(default_factory=GeneralReference)
    # Optional job the resume is aimed at, applied on top of the style.
    job_id: str | None = Field(default=None, min_length=1, max_length=20)

    @model_validator(mode="after")
    def _bounded(self) -> "SectionReviewAnalyzeRequest":
        _check_context(self.context)
        _check_job(self.reference, self.job_id)
        return self


class SectionReviewAnswer(_Request):
    question: str = Field(min_length=1, max_length=300)
    answer: str = Field(min_length=1, max_length=300)


class SectionReviewRewriteRequest(_Request):
    section: SectionReviewSection
    context: list[SectionReviewContext] = Field(default_factory=list, max_length=MAX_CONTEXT)
    reference: SectionReviewReference = Field(default_factory=GeneralReference)
    job_id: str | None = Field(default=None, min_length=1, max_length=20)
    line_id: str | None = Field(default=None, max_length=64)
    instruction: str | None = Field(default=None, max_length=300)
    answers: list[SectionReviewAnswer] = Field(default_factory=list, max_length=MAX_QUESTIONS)
    # The saved analysis of this paragraph, and either the item the result belongs
    # to or the kind of item to create (a request of the user's, or a draft).
    # Without review_id the result is returned but not saved (older clients).
    review_id: str | None = Field(default=None, min_length=1, max_length=20)
    item_id: str | None = Field(default=None, min_length=1, max_length=20)
    item_kind: Literal["ask", "draft"] | None = None

    @model_validator(mode="after")
    def _bounded(self) -> "SectionReviewRewriteRequest":
        _check_context(self.context)
        _check_job(self.reference, self.job_id)
        if self.line_id is not None and self.section.line(self.line_id) is None:
            raise ValueError("line_id is not part of the section")
        if not (self.instruction or "").strip() and not self.answers:
            raise ValueError("instruction or answers is required")
        if self.review_id is None:
            if self.item_id is not None or self.item_kind is not None:
                raise ValueError("item_id and item_kind need a review_id")
        elif (self.item_id is None) == (self.item_kind is None):
            raise ValueError("exactly one of item_id and item_kind is required")
        if self.item_kind == "ask" and not (self.instruction or "").strip():
            raise ValueError("a request item needs an instruction")
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


class SectionReviewAnalyzeResult(BaseModel):
    reference_label: str
    inferred_focus: str | None
    too_thin: bool
    draft_questions: list[SectionReviewQuestion] = Field(default_factory=list)
    notes: list[SectionReviewNote] = Field(default_factory=list)


SectionReviewItemKind = Literal["missing", "wording", "structure", "ask", "draft"]
SectionReviewItemStatus = Literal["todo", "asking", "pending", "done", "skipped"]


class SectionReviewEdit(_Request):
    line_id: NodeId
    before: str = Field(max_length=LINE_CHARS)
    after: str = Field(max_length=LINE_CHARS)


class SectionReviewDraft(BaseModel):
    variants: list[SectionReviewVariant]
    missing: list[str] = Field(default_factory=list)
    base_text: str
    line_id: str


class SectionReviewItem(BaseModel):
    id: str
    review_id: str
    note_id: str | None
    # The note this item answers; kept with applied items across re-analysis.
    note: SectionReviewNote | None
    kind: SectionReviewItemKind
    line_id: str | None
    instruction: str
    status: SectionReviewItemStatus
    question_index: int
    answers: list[str]
    draft: SectionReviewDraft | None
    selected_index: int
    edit: SectionReviewEdit | None
    update_time: datetime


class SectionReviewRecord(BaseModel):
    id: str
    unit_id: str
    analysis_no: int
    reference: dict[str, Any]
    job_id: str | None
    intent: str
    context_ids: list[str]
    base_lines: dict[str, str]
    result: SectionReviewAnalyzeResult
    items: list[SectionReviewItem]
    update_time: datetime


class SectionReviewAnalyzeResponse(SectionReviewAnalyzeResult):
    review: SectionReviewRecord


class SectionReviewRewriteResponse(BaseModel):
    variants: list[SectionReviewVariant]
    missing: list[str] = Field(default_factory=list)
    # The saved item; null when the request carried no review_id.
    item: SectionReviewItem | None = None


class SectionReviewListResponse(BaseModel):
    reviews: list[SectionReviewRecord]


class SectionReviewItemUpdate(_Request):
    """A user's action on one item; only the fields sent are changed."""

    status: SectionReviewItemStatus | None = None
    question_index: int | None = Field(default=None, ge=0, lt=MAX_QUESTIONS)
    answers: list[Annotated[str, Field(max_length=300)]] | None = Field(
        default=None, max_length=MAX_QUESTIONS
    )
    selected_index: int | None = Field(default=None, ge=0, lt=MAX_VARIANTS)
    edit: SectionReviewEdit | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> "SectionReviewItemUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        for name in ("status", "question_index", "answers", "selected_index"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self
