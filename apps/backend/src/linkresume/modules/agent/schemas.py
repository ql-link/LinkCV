import hashlib
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

from linkresume.domain.resume import CanonicalResumeDocument as ResumeDocument
from linkresume.domain.resume import ResumePresentation


class SessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Compatibility-only input for browser tabs that loaded the pre-0064 Web
    # bundle.  The service deliberately ignores it: resume context belongs to
    # messages, never to a session.
    resume_id: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,19}$")
    title: str | None = Field(default=None, min_length=1, max_length=128)


class SessionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=128)
    pinned: StrictBool | None = None

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("session title must be a string")
        normalized = " ".join(value.split())
        if not normalized or len(normalized) > 128:
            raise ValueError("session title must be 1..128 characters after trim")
        return normalized

    @model_validator(mode="after")
    def require_update_field(self) -> "SessionUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one session field is required")
        if "title" in self.model_fields_set and self.title is None:
            raise ValueError("session title cannot be null")
        if "pinned" in self.model_fields_set and self.pinned is None:
            raise ValueError("session pinned cannot be null")
        return self


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
            re.fullmatch(r"node_[a-z0-9]{16,64}", block_id) is None
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
    "dataset",
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
    presentation: Literal["mention", "implicit"] = "mention"
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

    presentation: Literal["mention", "implicit"] = "mention"


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


AgentResourceType = Literal["resume", "dataset", "interview"]


class AgentResourceListRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    types: list[AgentResourceType] = Field(
        default_factory=lambda: ["resume", "dataset", "interview"],
        min_length=1,
        max_length=3,
    )
    query: str | None = Field(default=None, max_length=200)
    limit: int = Field(default=20, ge=1, le=50)

    @field_validator("types")
    @classmethod
    def require_unique_resource_types(
        cls, value: list[AgentResourceType]
    ) -> list[AgentResourceType]:
        if len(value) != len(set(value)):
            raise ValueError("resource types must be unique")
        return value


class AgentResourceListResponse(BaseModel):
    resources: list[AgentContextListItem]


class ClarificationAnswerSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: str = Field(min_length=1, max_length=48, pattern=r"^[A-Za-z0-9_-]+$")
    option_id: str = Field(min_length=1, max_length=48, pattern=r"^(?:[A-Za-z0-9_-]+|__other__)$")
    value: str | None = Field(default=None, max_length=500)


class MessageCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=32_768)
    revision_proposal_id: str | None = Field(default=None, min_length=1, max_length=36)
    idempotency_key: str = Field(
        min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )
    selection_context: AgentSelectionContext | None = None
    contexts: list[AgentContextRef] | None = Field(default=None, max_length=10)
    reply_to_sequence_no: int | None = Field(default=None, ge=1)
    replace_inherited_resume: bool = False
    clarification_answers: list[ClarificationAnswerSelection] | None = Field(
        default=None, min_length=1, max_length=3
    )

    @field_validator("content")
    @classmethod
    def reject_blank_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message content cannot be blank")
        return value

    @model_validator(mode="after")
    def validate_context_types(self) -> "MessageCreateRequest":
        if self.contexts is not None:
            context_types = [item.type for item in self.contexts]
            if len(context_types) != len(set(context_types)):
                raise ValueError("agent context types must be unique")
        if self.clarification_answers is not None:
            question_ids = [item.question_id for item in self.clarification_answers]
            if len(question_ids) != len(set(question_ids)):
                raise ValueError("clarification answer question ids must be unique")
        if self.clarification_answers is not None and self.reply_to_sequence_no is None:
            raise ValueError("clarification answers require a reply target")
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
    run_id: str | None = None
    role: Literal["user", "assistant"]
    message_type: Literal["text", "clarification"] = "text"
    content: str
    clarification: AgentClarification | None = None
    contexts: list[AgentContextSnapshot] | None = None
    tasks: list[dict[str, Any]] | None = None
    created_at: datetime


class AgentSessionRecord(BaseModel):
    id: str
    title: str
    pinned: bool
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


class ActiveRunRecord(RunResponse):
    started_at: datetime


class ActiveRunResponse(BaseModel):
    run: ActiveRunRecord | None


class AgentReadinessResponse(BaseModel):
    ready: bool


class AgentModelSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    name: str


class AgentModelResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: AgentModelSummary


class ProposalCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    call_key: str = Field(min_length=1, max_length=128)
    resume_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    data: ResumeDocument
    style: ResumePresentation
    summary: str = Field(min_length=1, max_length=4_000)


class ProposalRecord(BaseModel):
    superseded_by: str | None = None
    id: str
    run_id: str
    resume_id: str
    base_lock_version: int
    data: ResumeDocument | None
    style: ResumePresentation | None
    preview: dict[str, Any] | None = None
    summary: str
    proposal_mode: Literal[
        "legacy_snapshot",
        "polish_local",
        "rewrite_entry_star",
        "generate_from_materials",
        "translate_resume",
    ] = "legacy_snapshot"
    target: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    operations: list[dict[str, Any]] = Field(default_factory=list)
    rationale: list[dict[str, str]] = Field(default_factory=list)
    source_refs: list[dict[str, Any]] = Field(default_factory=list)
    proposed_title: str | None = None
    result_resume_id: str | None = None
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
        "list_user_resources",
        "get_resume_context",
        "create_resume_proposal",
        "resolve_resume_reference",
        "resolve_resume_target",
        "search_resume_materials",
        "analyze_resume_content",
        "create_resume_change_proposal",
        "execute_local_resume_edit_plan",
        "create_resume_translation_proposal",
        "request_user_input",
        "plan_agent_request",
        "start_agent_task",
        "finish_agent_task",
    ]
    status: Literal["running", "succeeded", "failed", "cancelled"]
    target_type: str | None = Field(default=None, max_length=32)
    target_id: str | None = Field(default=None, max_length=64)
    error_code: str | None = Field(default=None, max_length=64)
    duration_ms: int | None = Field(default=None, ge=0)
    stage: str | None = Field(default=None, max_length=64)
    result: str | None = Field(default=None, max_length=64)
    scope: str | None = Field(default=None, max_length=32)
    selection_present: bool | None = None
    candidate_count: int | None = Field(default=None, ge=0, le=100)
    question_count: int | None = Field(default=None, ge=0, le=3)
    target_field: str | None = Field(default=None, max_length=64)
    base_lock_version: int | None = Field(default=None, ge=0)


class AgentTaskContextRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: AgentContextType
    id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")


class AgentTaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    workflow: Literal[
        "resource_catalog", "resume_edit", "resume_translation",
        "interview_guide", "career_planning", "resume_title",
    ]
    output: Literal["proposal", "advice", "catalog"]
    label: str = Field(min_length=1, max_length=120)
    depends_on: list[str] = Field(default_factory=list, max_length=8)
    context_refs: list[AgentTaskContextRef] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_output(self) -> "AgentTaskSpec":
        expected = {
            "resource_catalog": "catalog",
            "resume_translation": "proposal",
            "interview_guide": "advice",
            "career_planning": "advice",
            "resume_title": "advice",
        }
        if self.workflow in expected and self.output != expected[self.workflow]:
            raise ValueError("task output does not match workflow")
        if self.workflow == "resume_edit" and self.output not in {"proposal", "advice"}:
            raise ValueError("resume edit output must be proposal or advice")
        return self


class AgentTaskPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tasks: list[AgentTaskSpec] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def validate_dependencies(self) -> "AgentTaskPlanRequest":
        seen: set[str] = set()
        for task in self.tasks:
            if task.id in seen or len(task.depends_on) != len(set(task.depends_on)):
                raise ValueError("duplicate task or dependency")
            if any(dependency not in seen for dependency in task.depends_on):
                raise ValueError("dependencies must precede task")
            seen.add(task.id)
        return self


class AgentTaskStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["running", "completed", "partial", "blocked", "failed"]
    proposal_ids: list[str] = Field(default_factory=list, max_length=20)
    error_code: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{0,63}$")
    result: str | None = Field(default=None, max_length=2000)


class PiRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    content: str = Field(min_length=1, max_length=32_768)
    history: list[dict[str, Any]] = Field(default_factory=list, max_length=41)
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
    block_id: str | None = Field(default=None, pattern=r"^node_[a-z0-9]{16,64}$")
    selected_text: str | None = Field(default=None, max_length=20_000)
    expected_text_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class TargetCandidate(BaseModel):
    target: ResumeTargetLocator
    label: str
    excerpt: str


class TargetResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_id: str | None = Field(default=None, pattern=r"^[0-9]+$")
    selection_context: AgentSelectionContext | None = None
    quoted_text: str | None = Field(default=None, min_length=1, max_length=20_000)
    scope_hint: Literal["target", "resume"] = "target"


class TargetResolveResponse(BaseModel):
    status: Literal["resolved", "ambiguous", "not_found"]
    target: ResumeTargetLocator | None = None
    candidates: list[TargetCandidate] = Field(default_factory=list)


class ResumeReferenceResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    resume_id: str | None = Field(default=None, pattern=r"^[0-9]+$")

    @model_validator(mode="after")
    def require_reference(self) -> "ResumeReferenceResolveRequest":
        if self.title is None and self.resume_id is None:
            raise ValueError("title or resume_id is required")
        return self


class ResumeReferenceCandidate(BaseModel):
    resume_id: str
    title: str
    updated_at: datetime


class ResumeReferenceResolveResponse(BaseModel):
    status: Literal["resolved", "ambiguous", "not_found"]
    target: ResumeTargetLocator | None = None
    candidates: list[ResumeReferenceCandidate] = Field(default_factory=list)


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

    op: Literal["replace_target_text", "insert_after_target", "delete_target"]
    target: ResumeTargetLocator
    new_text: str = Field(max_length=20_000)
    expected_text_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")

    @model_validator(mode="after")
    def validate_operation_content(self) -> "ProposalOperation":
        if self.op == "insert_after_target" and not self.new_text.strip():
            raise ValueError("insert operation requires content")
        if self.op == "delete_target" and self.new_text:
            raise ValueError("delete operation cannot carry content")
        return self


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


class TranslationProposalCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    call_key: str = Field(min_length=1, max_length=128)
    target: ResumeTargetLocator
    target_language: str = Field(
        min_length=2, max_length=32, pattern=r"^[A-Za-z][A-Za-z0-9-]{1,31}$"
    )
    proposed_title: str = Field(min_length=1, max_length=255)
    data: ResumeDocument
    style: ResumePresentation
    summary: str = Field(min_length=1, max_length=4_000)


class ResumeContextResponse(BaseModel):
    run_id: str
    resume_id: str
    title: str
    lock_version: int
    data: ResumeDocument
    style: ResumePresentation


class AgentModelDefinition(BaseModel):
    """Model capabilities Pi Service needs to build one model instance."""

    model_id: str
    display_name: str
    reasoning: bool
    input_modalities: list[str]
    context_window: int
    max_output: int
    input_price_per_million: float | None
    output_price_per_million: float | None
    cache_read_price_per_million: float | None
    cache_write_price_per_million: float | None


class RuntimeConfigResponse(BaseModel):
    provider_id: str
    provider_name: str
    api: str
    model: str
    api_base: str
    api_key: str
    config_id: str
    config_version: int
    definition: AgentModelDefinition
