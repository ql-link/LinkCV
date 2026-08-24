from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Generic, Literal, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    SecretStr,
    field_validator,
    model_validator,
)

from linkcv.modules.llm.catalog import (
    CHAT_CAPABILITY,
    normalize_adapter,
    normalize_model_call_name,
)


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AdminWriteModel(CamelModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


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


LLMCallStatus = Literal["pending", "succeeded", "failed", "cancelled"]
LLMMeteringStatus = Literal["complete", "partial", "unknown"]
StructuredValue = TypeVar("StructuredValue", bound=BaseModel)


@dataclass(frozen=True)
class StructuredChatResult(Generic[StructuredValue]):
    value: StructuredValue
    call_id: str
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


class ModelConfigCreate(AdminWriteModel):
    adapter: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=128)
    api_base: HttpUrl | None = Field(default=None, alias="apiBase", max_length=512)
    api_key: SecretStr | None = Field(default=None, alias="apiKey")

    @field_validator("adapter")
    @classmethod
    def validate_adapter(cls, value: str) -> str:
        return normalize_adapter(value)

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: str, info) -> str:
        adapter = info.data.get("adapter")
        if not isinstance(adapter, str):
            normalized = value.strip()
            if not normalized:
                raise ValueError("model must not be empty")
            return normalized
        return normalize_model_call_name(adapter, value)

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().strip():
            raise ValueError("apiKey must not be empty")
        return value

    @model_validator(mode="after")
    def validate_identifier(self) -> "ModelConfigCreate":
        self.model = normalize_model_call_name(self.adapter, self.model)
        return self


class ModelConfigPatch(AdminWriteModel):
    base_config_version: int | None = Field(default=None, alias="baseConfigVersion", ge=1)
    adapter: str | None = Field(default=None, min_length=1, max_length=64)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    api_base: HttpUrl | None = Field(default=None, alias="apiBase", max_length=512)
    api_key: SecretStr | None = Field(default=None, alias="apiKey")

    @field_validator("adapter")
    @classmethod
    def validate_adapter(cls, value: str | None) -> str | None:
        return None if value is None else normalize_adapter(value)

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
        if value is not None and not value.get_secret_value().strip():
            raise ValueError("apiKey must not be empty")
        return value

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "ModelConfigPatch":
        for field in ("adapter", "model"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} must not be null")
        return self


class ModelLastTest(CamelModel):
    status: Literal["succeeded", "failed", "cancelled"]
    call_id: str = Field(alias="callId")
    tested_at: datetime = Field(alias="testedAt")


class ModelConfigRecord(CamelModel):
    id: str
    capability: Literal["chat"] = CHAT_CAPABILITY
    adapter: str
    model: str
    api_base: str | None = Field(alias="apiBase")
    key_configured: bool = Field(alias="keyConfigured")
    active: bool
    last_test: ModelLastTest | None = Field(alias="lastTest")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


ModelCapability = Literal["chat", "resume_structuring", "pi_agent"]


class CapabilityModelConfigRecord(CamelModel):
    id: str
    adapter: str
    model: str
    api_base: str | None = Field(alias="apiBase")
    key_configured: bool = Field(alias="keyConfigured")
    config_version: int = Field(alias="configVersion", ge=1)
    active_capabilities: list[ModelCapability] = Field(alias="activeCapabilities")
    last_test: ModelLastTest | None = Field(alias="lastTest")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class ModelCapabilityRecord(CamelModel):
    capability: ModelCapability
    active_model_id: str | None = Field(alias="activeModelId")
    binding_version: int = Field(alias="bindingVersion", ge=1)
    active_model: CapabilityModelConfigRecord | None = Field(alias="activeModel")
    models: list[CapabilityModelConfigRecord]

    @field_validator("active_model_id", mode="before")
    @classmethod
    def stringify_active_id(cls, value: object) -> str | None:
        return None if value is None else str(value)


class ModelCapabilityListResponse(CamelModel):
    capabilities: list[ModelCapabilityRecord]


class ModelBindingRequest(AdminWriteModel):
    model_config_id: str = Field(alias="modelConfigId", min_length=1)
    base_config_version: int | None = Field(default=None, alias="baseConfigVersion", ge=1)
    base_binding_version: int | None = Field(default=None, alias="baseBindingVersion", ge=1)


class ModelBindingResponse(CamelModel):
    capability: ModelCapability
    active_model_id: str | None = Field(alias="activeModelId")
    binding_version: int = Field(alias="bindingVersion", ge=1)
    validation_id: str = Field(alias="validationId")
    call_id: str = Field(alias="callId")
    active_model: CapabilityModelConfigRecord = Field(alias="activeModel")

    @field_validator("active_model_id", mode="before")
    @classmethod
    def stringify_active_id(cls, value: object) -> str | None:
        return None if value is None else str(value)


class ModelCapabilityTestRequest(AdminWriteModel):
    capability: ModelCapability
    base_config_version: int | None = Field(default=None, alias="baseConfigVersion", ge=1)


class ModelValidationResponse(CamelModel):
    ok: Literal[True] = True
    capability: ModelCapability
    validation_id: str = Field(alias="validationId")
    call_id: str = Field(alias="callId")
    config_version: int = Field(alias="configVersion", ge=1)


class ModelConfigResponse(CamelModel):
    model: ModelConfigRecord


class ModelConfigPatchResponse(ModelConfigResponse):
    validation_call_id: str | None = Field(default=None, alias="validationCallId")


class ChatCapabilityResponse(CamelModel):
    capability: Literal["chat"] = CHAT_CAPABILITY
    active_model_id: str | None = Field(alias="activeModelId")
    active_model: ModelConfigRecord | None = Field(alias="activeModel")
    models: list[ModelConfigRecord]

    @field_validator("active_model_id", mode="before")
    @classmethod
    def stringify_active_id(cls, value: object) -> str | None:
        return None if value is None else str(value)


class ModelConnectionTestResponse(CamelModel):
    ok: Literal[True] = True
    call_id: str = Field(alias="callId")


class ModelActivationResponse(CamelModel):
    active_model: ModelConfigRecord = Field(alias="activeModel")
    call_id: str = Field(alias="callId")


class ChatCatalogAdapter(CamelModel):
    code: str
    label: str
    requires_api_key: bool = Field(alias="requiresApiKey")
    models: list[str]


class ChatCatalogResponse(CamelModel):
    capability: Literal["chat"] = CHAT_CAPABILITY
    adapters: list[ChatCatalogAdapter]


class ModelCatalogResponse(CamelModel):
    capabilities: list[ModelCapability]
    adapters: list[ChatCatalogAdapter]


Price = Decimal | None


class CallLogRecord(CamelModel):
    call_id: str = Field(alias="callId")
    capability: ModelCapability
    source: str
    user_id: str = Field(alias="userId")
    model_config_id: str | None = Field(alias="modelConfigId")
    adapter: str | None
    model: str | None
    status: LLMCallStatus
    metering_status: LLMMeteringStatus = Field(alias="meteringStatus")
    input_tokens: int | None = Field(alias="inputTokens")
    output_tokens: int | None = Field(alias="outputTokens")
    input_price_per_million: Price = Field(alias="inputPricePerMillion")
    output_price_per_million: Price = Field(alias="outputPricePerMillion")
    estimated_cost_usd: Decimal | None = Field(alias="estimatedCostUsd")
    latency_ms: int | None = Field(alias="latencyMs")
    error_code: str | None = Field(alias="errorCode")
    model_config_version: int | None = Field(default=None, alias="modelConfigVersion")
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
