from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from linkcv.domain.resume_document import ResumeDocumentV1
from linkcv.domain.resume_style import ResumeStyleV1


class SessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=128)


class MessageCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=32_768)
    idempotency_key: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class AgentMessageRecord(BaseModel):
    sequence_no: int
    role: Literal["user", "assistant"]
    content: str
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
    data: ResumeDocumentV1
    style: ResumeStyleV1
    summary: str = Field(min_length=1, max_length=4_000)


class ProposalRecord(BaseModel):
    id: str
    run_id: str
    resume_id: str
    base_lock_version: int
    data: ResumeDocumentV1
    style: ResumeStyleV1
    summary: str
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
    tool_name: Literal["get_resume_context", "create_resume_proposal"]
    status: Literal["running", "succeeded", "failed", "cancelled"]
    target_type: str | None = Field(default=None, max_length=32)
    target_id: str | None = Field(default=None, max_length=64)
    error_code: str | None = Field(default=None, max_length=64)
    duration_ms: int | None = Field(default=None, ge=0)


class PiRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    content: str = Field(min_length=1, max_length=32_768)


class ResumeContextResponse(BaseModel):
    run_id: str
    resume_id: str
    title: str
    lock_version: int
    data: ResumeDocumentV1
    style: ResumeStyleV1


class RuntimeConfigResponse(BaseModel):
    provider: str
    model: str
    api_base: str | None
    api_key: str | None
    config_id: str
    config_version: int
