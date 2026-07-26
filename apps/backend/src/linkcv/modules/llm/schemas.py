from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    SecretStr,
    field_validator,
    model_validator,
)


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message content must not be empty")
        return value


class ChatUsage(CamelModel):
    input_tokens: int | None = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: int | None = Field(default=None, alias="outputTokens", ge=0)


class ChatResult(CamelModel):
    content: str
    call_id: str = Field(alias="callId")
    usage: ChatUsage | None = None


class ChatStreamEvent(CamelModel):
    type: Literal["delta", "done", "error"]
    call_id: str = Field(alias="callId")
    content: str | None = None
    usage: ChatUsage | None = None
    error_code: str | None = Field(default=None, alias="errorCode")


@dataclass(frozen=True)
class ChatStream:
    call_id: str
    events: AsyncIterator[ChatStreamEvent]


Price = Decimal | None


class ModelConfigCreate(CamelModel):
    model: str = Field(min_length=1, max_length=128)
    api_base: HttpUrl | None = Field(
        default=None,
        alias="apiBase",
        max_length=512,
    )
    api_key: SecretStr | None = Field(default=None, alias="apiKey")
    enabled: bool = False
    priority: int = Field(default=100, ge=0, le=65535)
    input_price_per_million: Price = Field(
        default=None,
        alias="inputPricePerMillion",
        ge=0,
        max_digits=18,
        decimal_places=8,
    )
    output_price_per_million: Price = Field(
        default=None,
        alias="outputPricePerMillion",
        ge=0,
        max_digits=18,
        decimal_places=8,
    )

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("model must not be empty")
        return normalized

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value():
            raise ValueError("apiKey must not be empty")
        return value


class ModelConfigPatch(CamelModel):
    model: str | None = Field(default=None, min_length=1, max_length=128)
    api_base: HttpUrl | None = Field(
        default=None,
        alias="apiBase",
        max_length=512,
    )
    api_key: SecretStr | None = Field(default=None, alias="apiKey")
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=65535)
    input_price_per_million: Price = Field(
        default=None,
        alias="inputPricePerMillion",
        ge=0,
        max_digits=18,
        decimal_places=8,
    )
    output_price_per_million: Price = Field(
        default=None,
        alias="outputPricePerMillion",
        ge=0,
        max_digits=18,
        decimal_places=8,
    )

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("model must not be empty")
        return normalized

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value():
            raise ValueError("apiKey must not be empty")
        return value

    @model_validator(mode="after")
    def reject_null_for_required_values(self) -> "ModelConfigPatch":
        for field in ("model", "enabled", "priority"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} must not be null")
        return self


class ModelConfigRecord(CamelModel):
    id: str
    model: str
    api_base: str | None = Field(alias="apiBase")
    enabled: bool
    priority: int
    input_price_per_million: Price = Field(alias="inputPricePerMillion")
    output_price_per_million: Price = Field(alias="outputPricePerMillion")
    key_configured: bool = Field(alias="keyConfigured")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class ModelConfigResponse(CamelModel):
    model: ModelConfigRecord


class ModelConfigListResponse(CamelModel):
    models: list[ModelConfigRecord]


class ModelConnectionTestResponse(CamelModel):
    ok: bool
    call_id: str = Field(alias="callId")


class CallLogRecord(CamelModel):
    call_id: str = Field(alias="callId")
    user_id: str = Field(alias="userId")
    model_config_id: str | None = Field(alias="modelConfigId")
    model: str | None
    status: str
    metering_status: str = Field(alias="meteringStatus")
    input_tokens: int | None = Field(alias="inputTokens")
    output_tokens: int | None = Field(alias="outputTokens")
    input_price_per_million: Price = Field(alias="inputPricePerMillion")
    output_price_per_million: Price = Field(alias="outputPricePerMillion")
    estimated_cost_usd: Decimal | None = Field(alias="estimatedCostUsd")
    latency_ms: int | None = Field(alias="latencyMs")
    error_code: str | None = Field(alias="errorCode")
    created_at: datetime = Field(alias="createdAt")

    @field_validator("user_id", mode="before")
    @classmethod
    def stringify_user_id(cls, value: object) -> str:
        return str(value)

    @field_validator("model_config_id", mode="before")
    @classmethod
    def stringify_model_config_id(cls, value: object) -> str | None:
        return None if value is None else str(value)


class CallLogSummary(CamelModel):
    call_count: int = Field(alias="callCount")
    incomplete_metering_count: int = Field(alias="incompleteMeteringCount")
    input_tokens: int | None = Field(alias="inputTokens")
    output_tokens: int | None = Field(alias="outputTokens")
    estimated_cost_usd: Decimal | None = Field(alias="estimatedCostUsd")


class CallLogListResponse(CamelModel):
    calls: list[CallLogRecord]
    summary: CallLogSummary
    next_cursor: str | None = Field(alias="nextCursor")
