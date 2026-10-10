from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ChatTextContentPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ChatImageUrl(BaseModel):
    url: str
    detail: Literal["auto", "low", "high"] = "auto"

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        if not value.startswith((
            "data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,",
        )):
            raise ValueError("unsupported image URL")
        return value


class ChatImageContentPart(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: ChatImageUrl


ChatContentPart = Annotated[
    ChatTextContentPart | ChatImageContentPart, Field(discriminator="type")
]


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str | list[ChatContentPart]

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str | list[ChatContentPart]) -> str | list[ChatContentPart]:
        if isinstance(value, str) and not value.strip():
            raise ValueError("message content must not be empty")
        if isinstance(value, list) and not value:
            raise ValueError("message content must not be empty")
        return value


class ChatUsage(ApiModel):
    input_tokens: int | None = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: int | None = Field(default=None, alias="outputTokens", ge=0)


class ChatResult(ApiModel):
    content: str
    call_id: str = Field(alias="callId")
    usage: ChatUsage | None = None


StructuredValue = TypeVar("StructuredValue", bound=BaseModel)


@dataclass(frozen=True)
class StructuredChatResult(Generic[StructuredValue]):
    value: StructuredValue
    call_id: str
    usage: ChatUsage | None = None


class ChatStreamEvent(ApiModel):
    type: Literal["delta", "done", "error"]
    call_id: str = Field(alias="callId")
    content: str | None = None
    usage: ChatUsage | None = None
    error_code: str | None = Field(default=None, alias="errorCode")


@dataclass(frozen=True)
class ChatStream:
    call_id: str
    events: AsyncIterator[ChatStreamEvent]


class ConnectionCreate(ApiModel):
    provider_code: str = Field(alias="providerCode", min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=128)
    api_key: SecretStr = Field(alias="apiKey")
    settings: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = False


class ConnectionPatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    api_key: SecretStr | None = Field(default=None, alias="apiKey")
    settings: dict[str, Any] | None = None
    enabled: bool | None = None
    base_version: int = Field(alias="baseVersion", ge=1)


class LogicalModelCreate(ApiModel):
    display_name: str = Field(alias="displayName", min_length=1, max_length=128)
    developer_name: str | None = Field(default=None, alias="developerName", max_length=128)
    user_selectable: bool = Field(default=True, alias="userSelectable")


class LogicalModelPatch(ApiModel):
    display_name: str | None = Field(default=None, alias="displayName", min_length=1, max_length=128)
    developer_name: str | None = Field(default=None, alias="developerName", max_length=128)
    user_selectable: bool | None = Field(default=None, alias="userSelectable")


class RouteCreate(ApiModel):
    model_id: int = Field(alias="modelId", gt=0)
    connection_id: int = Field(alias="connectionId", gt=0)
    target_kind: Literal["model", "endpoint", "deployment"] = Field(alias="targetKind")
    invoke_target: str = Field(alias="invokeTarget", min_length=1, max_length=256)
    catalog_model_id: str | None = Field(default=None, alias="catalogModelId", max_length=256)
    identifier_kind: Literal["pinned", "alias", "unknown"] = Field(
        default="unknown", alias="identifierKind"
    )
    pricing: dict[str, Any] | None = None
    pricing_mode: Literal["provider", "manual_override"] = Field(default="provider", alias="pricingMode")
    enabled: bool = False

    @field_validator("pricing")
    @classmethod
    def validate_pricing(cls, value):
        from drawoffer.modules.llm.pricing import validate_manual_pricing
        validate_manual_pricing(value)
        return value


class RoutePatch(ApiModel):
    identifier_kind: Literal["pinned", "alias", "unknown"] | None = Field(
        default=None, alias="identifierKind"
    )
    pricing: dict[str, Any] | None = None
    pricing_mode: Literal["provider", "manual_override"] | None = Field(default=None, alias="pricingMode")
    enabled: bool | None = None

    @field_validator("pricing")
    @classmethod
    def validate_pricing(cls, value):
        from drawoffer.modules.llm.pricing import validate_manual_pricing
        validate_manual_pricing(value)
        return value


class UseCaseBindingWrite(ApiModel):
    use_case: str = Field(alias="useCase", min_length=1, max_length=48)
    route_id: int = Field(alias="routeId", gt=0)
    protocol_code: str = Field(alias="protocolCode", min_length=1, max_length=32)
    priority: int = Field(ge=0, le=4_294_967_295)
    enabled: bool = False


class UseCaseBindingPatch(ApiModel):
    priority: int | None = Field(default=None, ge=0, le=4_294_967_295)
    enabled: bool | None = None


class PiCallRecord(ApiModel):
    call_id: str = Field(alias="callId", min_length=1, max_length=40)
    route_id: str | None = Field(default=None, alias="routeId", pattern=r"^[1-9][0-9]{0,19}$")
    config_version: int | None = Field(default=None, alias="configVersion", ge=1)
    price_snapshot: dict[str, Any] | None = Field(default=None, alias="priceSnapshot")
    status: Literal["succeeded", "failed", "cancelled"]
    input_tokens: int | None = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: int | None = Field(default=None, alias="outputTokens", ge=0)
    usage: dict[str, Any] | None = None
    response_model_id: str | None = Field(default=None, alias="responseModelId", max_length=256)
    upstream_request_id: str | None = Field(default=None, alias="upstreamRequestId", max_length=128)
    error_code: str | None = Field(default=None, alias="errorCode", max_length=64)
    latency_ms: int | None = Field(default=None, alias="latencyMs", ge=0)
    request_started_at: datetime | None = Field(default=None, alias="requestStartedAt")
    request_finished_at: datetime | None = Field(default=None, alias="requestFinishedAt")


class CallLogListResponse(ApiModel):
    calls: list[dict[str, Any]]
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    summary: dict[str, Any]
