from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from linkcv.modules.observability.context import REQUEST_ID_PATTERN


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class ClientLogEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: Literal["unhandled_error", "unhandled_rejection", "render_error", "api_5xx"]
    error_name: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=16384)
    stack: str | None = Field(default=None, max_length=32768)
    request_id: str | None = Field(default=None, max_length=64)

    @field_validator("request_id")
    @classmethod
    def validate_request_id(cls, value: str | None) -> str | None:
        if value is not None and not REQUEST_ID_PATTERN.fullmatch(value):
            raise ValueError("request_id is invalid")
        return value


class AcceptedResponse(ApiModel):
    accepted: Literal[True] = True
    event_id: str | None = Field(default=None, alias="eventId")


class AuditEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["resume.pdf_export"]
    target_type: Literal["resume"]
    target_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    result: Literal["succeeded", "failed"]
    error_code: str | None = Field(
        default=None,
        pattern=r"^[A-Z][A-Z0-9_]{0,63}$",
    )


class LogItem(ApiModel):
    timestamp_ns: str = Field(alias="timestampNs")
    timestamp: str
    event_id: str = Field(alias="eventId")
    event_version: int = Field(alias="eventVersion")
    log_type: Literal["system", "audit"] = Field(alias="logType")
    level: str
    service: str
    environment: str
    source: str
    logger: str
    message: str
    request_id: str | None = Field(default=None, alias="requestId")
    task_id: str | None = Field(default=None, alias="taskId")
    operation_id: str | None = Field(default=None, alias="operationId")
    actor_user_id: str | None = Field(default=None, alias="actorUserId")
    dependency: str | None = None
    duration_ms: int | None = Field(default=None, alias="durationMs")
    http_method: str | None = Field(default=None, alias="httpMethod")
    http_route: str | None = Field(default=None, alias="httpRoute")
    http_status: int | None = Field(default=None, alias="httpStatus")
    error_code: str | None = Field(default=None, alias="errorCode")
    exception_type: str | None = Field(default=None, alias="exceptionType")
    exception_stack: str | None = Field(default=None, alias="exceptionStack")
    action: str | None = None
    actor_type: str | None = Field(default=None, alias="actorType")
    target_type: str | None = Field(default=None, alias="targetType")
    target_id: str | None = Field(default=None, alias="targetId")
    result: str | None = None
    summary: str | None = None


class LogListResponse(ApiModel):
    items: list[LogItem]
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    partial: bool = False
    dropped_malformed: int = Field(default=0, alias="droppedMalformed")


class SystemLogSummary(ApiModel):
    total: int
    warnings: int
    errors: int


class AuditLogSummary(ApiModel):
    total: int
    succeeded: int
    failed: int


class LogSummaryResponse(ApiModel):
    system: SystemLogSummary
    audit: AuditLogSummary
