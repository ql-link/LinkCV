import hashlib
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from linkcv.domain.resume_document import ResumeDocument
from linkcv.domain.resume_style import ResumePresentation


class SessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=128)


class AgentSelectionContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    block_ids: list[str] = Field(min_length=1, max_length=32)
    from_: int = Field(alias="from", ge=0)
    to: int = Field(ge=0)
    selected_text: str = Field(min_length=1, max_length=20_000)
    selected_text_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")

    @model_validator(mode="after")
    def validate_selection(self) -> "AgentSelectionContext":
        if self.to <= self.from_:
            raise ValueError("selection range is empty")
        if len(self.block_ids) != len(set(self.block_ids)) or any(
            re.fullmatch(r"blk_[a-z0-9]{16,64}", block_id) is None
            for block_id in self.block_ids
        ):
            raise ValueError("invalid selection block ids")
        expected = "sha256:" + hashlib.sha256(self.selected_text.encode()).hexdigest()
        if self.selected_text_hash != expected:
            raise ValueError("selection text hash mismatch")
        return self


AgentContextType = Literal[
    "resume",
    "resume_version",
    "job",
    "application",
    "interview",
]


class AgentContextRef(BaseModel):
    """A client supplied reference to one explicitly selected private object.

    The client may send the stable marker as ``version`` (the canonical wire
    name), or one of the aliases used by older handoff examples.  Display
    fields are accepted for Web-client round trips but are always rebuilt from
    the owner-scoped record by FastAPI.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )

    type: AgentContextType
    id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    version_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("version_id", "versionId"),
        pattern=r"^[1-9][0-9]{0,19}$",
    )
    version: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "version", "stable_version", "lock_version", "updated_at"
        ),
        max_length=128,
    )
    # These display fields are accepted for the Web client convenience, but
    # context_service deliberately ignores them and rebuilds authoritative
    # values from the owner-scoped row.
    label: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=500)
    updated_at: str | datetime | None = Field(default=None, max_length=128)
    lock_version: int | None = Field(default=None, ge=1)
    resume_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,19}$")

    @field_validator("version", mode="before")
    @classmethod
    def normalize_version(cls, value: object) -> str | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    @field_validator("updated_at", mode="before")
    @classmethod
    def normalize_updated_at(cls, value: object) -> str | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)


class AgentContextListItem(BaseModel):
    """The light-weight selector entry returned by ``GET /api/agent/contexts``."""

    model_config = ConfigDict(extra="forbid")

    type: AgentContextType
    id: str
    version: str
    lock_version: int | None = None
    version_id: str | None = None
    resume_id: str | None = None
    label: str
    description: str | None = None
    updated_at: datetime


class AgentContextSnapshot(AgentContextListItem):
    """The immutable, display-only reference persisted on a user message."""


class AgentContextMaterial(BaseModel):
    """Bounded, already owner-checked material sent from FastAPI to Pi.

    ``content`` is intentionally a small field allow-list assembled by
    ``context_service``.  It is never persisted in ``agent_messages``.
    """

    model_config = ConfigDict(extra="forbid")

    type: AgentContextType
    id: str
    version: str
    lock_version: int | None = None
    version_id: str | None = None
    resume_id: str | None = None
    label: str
    description: str | None = None
    updated_at: datetime
    content: dict[str, object] = Field(default_factory=dict)


class AgentContextListResponse(BaseModel):
    contexts: list[AgentContextListItem]


class MessageCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=32_768)
    idempotency_key: str = Field(
        min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    selection_context: AgentSelectionContext | None = None
    contexts: list[AgentContextRef] | None = Field(default=None, max_length=10)
    reply_to_sequence_no: int | None = Field(default=None, ge=1)

    @field_validator("content")
    @classmethod
    def reject_blank_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message content cannot be blank")
        return value

    @model_validator(mode="after")
    def validate_context_types(self) -> "MessageCreateRequest":
        if self.contexts is None:
            return self
        context_types = [item.type for item in self.contexts]
        if len(context_types) != len(set(context_types)):
            raise ValueError("agent context types must be unique")
        return self


class ClarificationOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=48, pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=240)


class ClarificationQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=48, pattern=r"^[A-Za-z0-9_-]+$")
    header: str = Field(min_length=1, max_length=24)
    question: str = Field(min_length=1, max_length=500)
    options: list[ClarificationOption] = Field(min_length=2, max_length=3)

    @model_validator(mode="after")
    def validate_option_ids(self) -> "ClarificationQuestion":
        option_ids = [item.id for item in self.options]
        if len(option_ids) != len(set(option_ids)):
            raise ValueError("clarification option ids must be unique")
        return self


class AgentClarification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    questions: list[ClarificationQuestion] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_question_ids(self) -> "AgentClarification":
        question_ids = [item.id for item in self.questions]
        if len(question_ids) != len(set(question_ids)):
            raise ValueError("clarification question ids must be unique")
        return self


class AgentMessageRecord(BaseModel):
    sequence_no: int
    role: Literal["user", "assistant"]
    message_type: Literal["text", "clarification"] = "text"
    content: str
    clarification: AgentClarification | None = None
    contexts: list[AgentContextSnapshot] | None = None
    created_at: datetime


class AgentSessionRecord(BaseModel):
    id: str
    resume_id: str | None
    title: str
    status: Literal["active", "archived"]
    last_message_at: datetime | None
    created_at: datetime
    updated_at: datetime
    messages: list[AgentMessageRecord] = []


class SessionResponse(BaseModel):
    session: AgentSessionRecord


class SessionListResponse(BaseModel):
    sessions: list[AgentSessionRecord]


class RunResponse(BaseModel):
    run_id: str
    status: Literal["running", "succeeded", "failed", "cancelled"]


class AgentReadinessResponse(BaseModel):
    ready: bool


class ProposalCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    call_key: str = Field(min_length=1, max_length=128)
    data: ResumeDocument
    style: ResumePresentation
    summary: str = Field(min_length=1, max_length=4_000)


class ProposalRecord(BaseModel):
    id: str
    run_id: str
    resume_id: str
    base_lock_version: int
    data: ResumeDocument
    style: ResumePresentation
    summary: str
    proposal_mode: Literal[
        "legacy_snapshot",
        "polish_local",
        "rewrite_entry_star",
        "generate_from_materials",
    ] = "legacy_snapshot"
    target: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    operations: list[dict[str, Any]] = Field(default_factory=list)
    rationale: list[dict[str, str]] = Field(default_factory=list)
    source_refs: list[dict[str, Any]] = Field(default_factory=list)
    status: Literal["pending", "applied", "rejected", "expired", "conflicted"]
    applied_lock_version: int | None
    expires_at: datetime
    created_at: datetime


class ProposalResponse(BaseModel):
    proposal: ProposalRecord


class ProposalListResponse(BaseModel):
    proposals: list[ProposalRecord]


class ToolEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    call_key: str = Field(min_length=1, max_length=128)
    tool_name: Literal[
        "get_resume_context",
        "create_resume_proposal",
        "resolve_resume_target",
        "search_resume_materials",
        "analyze_resume_content",
        "create_resume_change_proposal",
        "request_user_input",
    ]
    status: Literal["running", "succeeded", "failed", "cancelled"]
    target_type: str | None = Field(default=None, max_length=32)
    target_id: str | None = Field(default=None, max_length=64)
    error_code: str | None = Field(default=None, max_length=64)
    duration_ms: int | None = Field(default=None, ge=0)


class PiRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    content: str = Field(min_length=1, max_length=32_768)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=41)
    selection_context: AgentSelectionContext | None = None
    context_materials: list[AgentContextMaterial] = Field(
        default_factory=list, max_length=10
    )


class ResumeTargetLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_id: str
    base_lock_version: int = Field(ge=1)
    surface: Literal["semantic", "editor"]
    section: str | None = Field(default=None, max_length=64)
    entry_id: str | None = Field(default=None, max_length=128)
    field: str | None = Field(default=None, max_length=64)
    item_id: str | None = Field(default=None, max_length=128)
    block_id: str | None = Field(default=None, pattern=r"^blk_[a-z0-9]{16,64}$")
    selected_text: str | None = Field(default=None, max_length=20_000)
    expected_text_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class TargetCandidate(BaseModel):
    target: ResumeTargetLocator
    label: str
    excerpt: str


class TargetResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection_context: AgentSelectionContext | None = None
    quoted_text: str | None = Field(default=None, min_length=1, max_length=20_000)
    scope_hint: Literal["target", "resume"] = "target"


class TargetResolveResponse(BaseModel):
    status: Literal["resolved", "ambiguous", "not_found"]
    target: ResumeTargetLocator | None = None
    candidates: list[TargetCandidate] = Field(default_factory=list)


class ContextReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: ResumeTargetLocator
    scope: Literal["target", "entry", "section", "resume"] = "target"


class ScopedResumeContextResponse(BaseModel):
    run_id: str
    resume_id: str
    title: str
    lock_version: int
    target: ResumeTargetLocator
    scope: Literal["target", "entry", "section", "resume"]
    content: str
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    data: ResumeDocument | None = None
    style: ResumePresentation


class MaterialSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=500)
    types: list[Literal["resume", "dataset", "job"]] = Field(
        default_factory=lambda: ["resume", "dataset", "job"],
        min_length=1,
        max_length=3,
    )
    limit: int = Field(default=5, ge=1, le=10)


class MaterialSource(BaseModel):
    source_id: str
    source_type: Literal["resume", "dataset", "job"]
    title: str
    excerpt: str
    version: str


class MaterialSearchResponse(BaseModel):
    sources: list[MaterialSource]


class DiagnosisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: ResumeTargetLocator
    scope: Literal["target", "entry", "section", "resume"] = "target"
    job_id: str | None = None
    source_ids: list[str] = Field(default_factory=list, max_length=20)


class DiagnosisResponse(BaseModel):
    diagnosis: dict[str, Any]
    diagnosis_fingerprint: str = Field(pattern=r"^diag:[a-f0-9]{64}$")


class ProposalOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op: Literal["replace_target_text", "insert_after_target"]
    target: ResumeTargetLocator
    new_text: str = Field(min_length=1, max_length=20_000)
    expected_text_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class ProposalV2CreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    call_key: str = Field(min_length=1, max_length=128)
    mode: Literal["polish_local", "rewrite_entry_star", "generate_from_materials"]
    target: ResumeTargetLocator
    diagnosis: dict[str, Any]
    diagnosis_fingerprint: str = Field(pattern=r"^diag:[a-f0-9]{64}$")
    operations: list[ProposalOperation] = Field(min_length=1, max_length=20)
    rationale: list[dict[str, str]] = Field(default_factory=list, max_length=20)
    source_ids: list[str] = Field(default_factory=list, max_length=20)
    summary: str = Field(min_length=1, max_length=4_000)


class ResumeContextResponse(BaseModel):
    run_id: str
    resume_id: str
    title: str
    lock_version: int
    data: ResumeDocument
    style: ResumePresentation


class RuntimeConfigResponse(BaseModel):
    provider: str
    model: str
    api_base: str | None
    api_key: str | None
    config_id: str
    config_version: int
