from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from time import perf_counter
from typing import TypeVar
from uuid import uuid4

from anyio import to_thread
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from linkcv.core.database import utc_now
from linkcv.modules.llm.catalog import (
    CHAT_CAPABILITY,
    JOB_IMAGE_STRUCTURING_CAPABILITY,
    PI_AGENT_CAPABILITY,
    RESUME_STRUCTURING_CAPABILITY,
    adapter_requires_api_key,
    assemble_model_identifier,
)
from linkcv.modules.llm.crypto import CredentialCipher, CredentialUnavailableError
from linkcv.modules.llm.gateway import (
    GatewayError,
    GatewayResult,
    GatewayStreamEvent,
    GatewayUsage,
    LLMGateway,
)
from linkcv.modules.llm.models import (
    LLMCallLog,
    LLMCapabilityBinding,
    LLMModelConfig,
)
from linkcv.modules.llm.schemas import (
    ChatImageContentPart,
    ChatImageUrl,
    ChatMessage,
    ChatResult,
    ChatStream,
    ChatStreamEvent,
    ChatUsage,
    ChatTextContentPart,
    StructuredChatResult,
)

logger = logging.getLogger(__name__)
VISION_PROBE_IMAGE_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg=="
)
ONE_MILLION = Decimal(1_000_000)
COST_QUANTUM = Decimal("0.0000000001")
SOURCE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
StructuredValue = TypeVar("StructuredValue", bound=BaseModel)


def create_call_id() -> str:
    return f"llmcall_{uuid4().hex}"


def normalize_call_source(source: str) -> str:
    normalized = source.strip()
    if not SOURCE_PATTERN.fullmatch(normalized):
        raise ValueError("invalid LLM call source")
    return normalized


def _structured_messages(
    messages: Sequence[ChatMessage],
    response_model: type[StructuredValue],
) -> tuple[ChatMessage, ...]:
    schema = json.dumps(
        response_model.model_json_schema(),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    instruction = ChatMessage(
        role="system",
        content=(
            "只返回一个符合下列 JSON Schema 的 JSON 对象。"
            "不要输出 Markdown、代码围栏、解释或其他文字。"
            "必须保留 Schema 要求的字段与类型；未知值按 Schema 使用 null、空数组或空字符串。"
            f"\nJSON Schema:\n{schema}"
        ),
    )
    return (instruction, *messages)


def _json_object_candidates(content: str) -> tuple[str, ...]:
    candidates: list[str] = []
    start: int | None = None
    depth = 0
    in_string = False
    escaped = False

    for index, character in enumerate(content):
        if start is None:
            if character == "{":
                start = index
                depth = 1
                in_string = False
                escaped = False
            continue

        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue

        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                candidates.append(content[start : index + 1])
                start = None

    return tuple(candidates)


def _validate_structured_content(
    content: str,
    response_model: type[StructuredValue],
) -> StructuredValue:
    validated: list[StructuredValue] = []
    for candidate in _json_object_candidates(content):
        try:
            payload = json.loads(candidate)
            validated.append(response_model.model_validate(payload))
        except (TypeError, ValueError, ValidationError):
            continue
    if len(validated) == 1:
        return validated[0]
    raise ValueError("model output must contain exactly one valid structured object")


class LLMError(Exception):
    def __init__(self, code: str, call_id: str) -> None:
        super().__init__(code)
        self.code = code
        self.call_id = call_id


@dataclass(frozen=True)
class RuntimeModelConfig:
    id: int
    capability: str
    adapter: str
    model_call_name: str
    model_name: str
    api_base: str | None
    encrypted_api_key: str | None
    config_version: int

    @classmethod
    def from_record(
        cls,
        config: LLMModelConfig,
        *,
        capability: str = CHAT_CAPABILITY,
    ) -> RuntimeModelConfig | None:
        if config.adapter is None or config.model_call_name is None:
            return None
        return cls(
            id=config.id,
            capability=capability,
            adapter=config.adapter,
            model_call_name=config.model_call_name,
            model_name=assemble_model_identifier(
                config.adapter,
                config.model_call_name,
            ),
            api_base=config.api_base,
            encrypted_api_key=config.encrypted_api_key,
            config_version=config.config_version,
        )


@dataclass(frozen=True)
class AgentRuntimeModel:
    id: int
    adapter: str
    model_call_name: str
    api_base: str | None
    api_key: str | None
    config_version: int


@dataclass(frozen=True)
class AgentModelSummary:
    """The non-sensitive model identity exposed to an authenticated user."""

    adapter: str
    name: str


@dataclass(frozen=True)
class Metering:
    status: str
    input_tokens: int | None
    output_tokens: int | None
    input_price_per_million: Decimal | None
    output_price_per_million: Decimal | None
    estimated_cost: Decimal | None


@dataclass(frozen=True)
class OpenStream:
    config: RuntimeModelConfig
    events: AsyncIterator[GatewayStreamEvent]


class ManagedStreamEvents(AsyncIterator[ChatStreamEvent]):
    def __init__(
        self,
        source: AsyncIterator[ChatStreamEvent],
        close_before_start: Callable[[], Awaitable[None]],
    ) -> None:
        self._source = source
        self._close_before_start = close_before_start
        self._started = False
        self._closed = False

    def __aiter__(self) -> ManagedStreamEvents:
        return self

    async def __anext__(self) -> ChatStreamEvent:
        if self._closed:
            raise StopAsyncIteration
        self._started = True
        try:
            return await anext(self._source)
        except StopAsyncIteration:
            self._closed = True
            raise
        except BaseException:
            self._closed = True
            raise

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        if not self._started:
            await self._close_before_start()
        close = getattr(self._source, "aclose", None)
        if close is not None:
            await close()


def calculate_metering(
    *,
    usage: GatewayUsage,
    input_price_per_million: Decimal | None,
    output_price_per_million: Decimal | None,
    force_partial: bool = False,
) -> Metering:
    values = (
        usage.input_tokens,
        usage.output_tokens,
        input_price_per_million,
        output_price_per_million,
    )
    complete = all(value is not None for value in values) and not force_partial
    known = any(value is not None for value in values)
    status = "complete" if complete else "partial" if known else "unknown"

    estimated_cost = None
    if complete:
        assert usage.input_tokens is not None
        assert usage.output_tokens is not None
        assert input_price_per_million is not None
        assert output_price_per_million is not None
        estimated_cost = (
            Decimal(usage.input_tokens) / ONE_MILLION * input_price_per_million
            + Decimal(usage.output_tokens) / ONE_MILLION * output_price_per_million
        ).quantize(COST_QUANTUM)

    return Metering(
        status=status,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        input_price_per_million=input_price_per_million,
        output_price_per_million=output_price_per_million,
        estimated_cost=estimated_cost,
    )


def usage_response(usage: GatewayUsage) -> ChatUsage | None:
    if usage.input_tokens is None and usage.output_tokens is None:
        return None
    return ChatUsage(
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )


class LLMService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        gateway: LLMGateway,
        cipher: CredentialCipher,
    ) -> None:
        self._session_factory = session_factory
        self._gateway = gateway
        self._cipher = cipher

    def encrypt_credential(self, plaintext: str) -> str:
        return self._cipher.encrypt(plaintext)

    async def agent_model_summary(self) -> AgentModelSummary:
        """Resolve the bound Pi Agent model without reading its credentials."""
        config = await self._db(self._current_config_sync, PI_AGENT_CAPABILITY)
        if config is None:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED", "agent-model-summary")
        return AgentModelSummary(adapter=config.adapter, name=config.model_call_name)

    async def agent_runtime_model(self) -> AgentRuntimeModel:
        """Resolve and decrypt the model bound to the Pi Agent capability."""
        config = await self._db(self._current_config_sync, PI_AGENT_CAPABILITY)
        if config is None:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED", "agent-runtime-config")
        if config.encrypted_api_key is None:
            if adapter_requires_api_key(config.adapter):
                raise LLMError(
                    "LLM_CREDENTIALS_UNAVAILABLE", "agent-runtime-config"
                )
            api_key = None
        else:
            try:
                credential = self._cipher.decrypt(config.encrypted_api_key)
            except CredentialUnavailableError as error:
                raise LLMError(
                    "LLM_CREDENTIALS_UNAVAILABLE", "agent-runtime-config"
                ) from error
            api_key = credential.plaintext
            if credential.needs_rewrap:
                await self._db(self._rewrap_sync, config, credential.plaintext)
        return AgentRuntimeModel(
            id=config.id,
            adapter=config.adapter,
            model_call_name=config.model_call_name,
            api_base=config.api_base,
            api_key=api_key,
            config_version=config.config_version,
        )

    async def _db(self, function, *args, **kwargs):
        return await to_thread.run_sync(lambda: function(*args, **kwargs))

    def _create_log_sync(
        self,
        call_id: str,
        user_id: int,
        source: str,
        capability: str = CHAT_CAPABILITY,
    ) -> None:
        with self._session_factory() as db:
            db.add(
                LLMCallLog(
                    call_id=call_id,
                    capability=capability,
                    source=normalize_call_source(source),
                    user_id=user_id,
                    created_at=utc_now(),
                )
            )
            db.commit()

    def _current_config_sync(
        self, capability: str = CHAT_CAPABILITY
    ) -> RuntimeModelConfig | None:
        with self._session_factory() as db:
            binding = db.get(LLMCapabilityBinding, capability)
            if binding is None or binding.model_config_id is None:
                return None
            config = db.get(LLMModelConfig, binding.model_config_id)
            return (
                RuntimeModelConfig.from_record(config, capability=capability)
                if config is not None
                else None
            )

    def _config_sync(
        self, config_id: int, capability: str = CHAT_CAPABILITY
    ) -> RuntimeModelConfig | None:
        with self._session_factory() as db:
            config = db.get(LLMModelConfig, config_id)
            return (
                RuntimeModelConfig.from_record(config, capability=capability)
                if config is not None
                else None
            )

    def _select_model_sync(self, call_id: str, config: RuntimeModelConfig) -> None:
        with self._session_factory() as db:
            db.execute(
                update(LLMCallLog)
                .where(LLMCallLog.call_id == call_id)
                .values(
                    model_config_id=config.id,
                    model_config_version=config.config_version,
                    model_name=config.model_name,
                    adapter=config.adapter,
                    model_call_name=config.model_call_name,
                )
            )
            db.commit()

    def _rewrap_sync(self, config: RuntimeModelConfig, plaintext: str) -> None:
        assert config.encrypted_api_key is not None
        replacement = self._cipher.encrypt(plaintext)
        with self._session_factory() as db:
            db.execute(
                update(LLMModelConfig)
                .where(
                    LLMModelConfig.id == config.id,
                    LLMModelConfig.encrypted_api_key == config.encrypted_api_key,
                )
                .values(encrypted_api_key=replacement, updated_at=utc_now())
            )
            db.commit()

    def _finalize_sync(
        self,
        call_id: str,
        *,
        status: str,
        latency_ms: int,
        error_code: str | None,
        metering: Metering | None = None,
    ) -> None:
        values: dict[str, object] = {
            "status": status,
            "latency_ms": latency_ms,
            "error_code": error_code,
        }
        if metering is not None:
            values.update(
                {
                    "metering_status": metering.status,
                    "input_tokens": metering.input_tokens,
                    "output_tokens": metering.output_tokens,
                    "input_price_per_million": metering.input_price_per_million,
                    "output_price_per_million": metering.output_price_per_million,
                    "estimated_cost": metering.estimated_cost,
                }
            )
        with self._session_factory() as db:
            db.execute(
                update(LLMCallLog)
                .where(LLMCallLog.call_id == call_id)
                .values(**values)
            )
            db.commit()
        log = logger.warning if status == "failed" else logger.info
        log(
            "LLM call finalized call_id=%s status=%s error_code=%s metering_status=%s",
            call_id,
            status,
            error_code or "-",
            metering.status if metering else "unknown",
            extra={
                "dependency": "llm",
                "duration_ms": latency_ms,
                "operation_id": call_id,
                "error_code": error_code,
                "summary": (
                    f"status={status};metering="
                    f"{metering.status if metering else 'unknown'}"
                ),
            },
        )

    async def _finalize_cancelled(self, call_id: str, started_at: float) -> None:
        await asyncio.shield(
            self._db(
                self._finalize_sync,
                call_id,
                status="cancelled",
                latency_ms=self._latency(started_at),
                error_code=None,
            )
        )

    async def _credential(
        self,
        config: RuntimeModelConfig,
        call_id: str,
        started_at: float,
    ) -> str | None:
        if config.encrypted_api_key is None:
            if adapter_requires_api_key(config.adapter):
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code="LLM_CREDENTIALS_UNAVAILABLE",
                )
                raise LLMError("LLM_CREDENTIALS_UNAVAILABLE", call_id)
            return None
        try:
            credential = self._cipher.decrypt(config.encrypted_api_key)
        except CredentialUnavailableError as error:
            await self._db(
                self._finalize_sync,
                call_id,
                status="failed",
                latency_ms=self._latency(started_at),
                error_code="LLM_CREDENTIALS_UNAVAILABLE",
            )
            raise LLMError("LLM_CREDENTIALS_UNAVAILABLE", call_id) from error
        if credential.needs_rewrap:
            await self._db(self._rewrap_sync, config, credential.plaintext)
        return credential.plaintext

    @staticmethod
    def _latency(started_at: float) -> int:
        return max(0, round((perf_counter() - started_at) * 1000))

    async def _resolve_current(
        self,
        call_id: str,
        started_at: float,
        capability: str = CHAT_CAPABILITY,
    ) -> RuntimeModelConfig:
        config = await self._db(self._current_config_sync, capability)
        if config is None:
            await self._db(
                self._finalize_sync,
                call_id,
                status="failed",
                latency_ms=self._latency(started_at),
                error_code=(
                    "LLM_CHAT_NOT_CONFIGURED"
                    if capability == CHAT_CAPABILITY
                    else "LLM_MODEL_NOT_CONFIGURED"
                ),
            )
            raise LLMError(
                "LLM_CHAT_NOT_CONFIGURED"
                if capability == CHAT_CAPABILITY
                else "LLM_MODEL_NOT_CONFIGURED",
                call_id,
            )
        await self._db(self._select_model_sync, call_id, config)
        return config

    async def chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
        *,
        source: str,
        capability: str = CHAT_CAPABILITY,
    ) -> ChatResult:
        validated_messages = tuple(messages)
        if not validated_messages:
            raise ValueError("messages must not be empty")
        normalized_source = normalize_call_source(source)
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(
                self._create_log_sync,
                call_id,
                user_id,
                normalized_source,
                capability,
            )
            config = await self._resolve_current(call_id, started_at, capability)
            api_key = await self._credential(config, call_id, started_at)
            try:
                result = await self._gateway.complete(
                    model=config.model_name,
                    messages=validated_messages,
                    api_base=config.api_base,
                    api_key=api_key,
                )
            except GatewayError as error:
                metering = self._error_metering(error)
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code=error.code,
                    metering=metering,
                )
                raise LLMError(error.code, call_id) from error

            metering = calculate_metering(
                usage=result.usage,
                input_price_per_million=result.input_price_per_million,
                output_price_per_million=result.output_price_per_million,
            )
            await self._db(
                self._finalize_sync,
                call_id,
                status="succeeded",
                latency_ms=self._latency(started_at),
                error_code=None,
                metering=metering,
            )
            return ChatResult(
                content=result.content,
                call_id=call_id,
                usage=usage_response(result.usage),
            )
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise

    async def structured_chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
        *,
        source: str,
        response_model: type[StructuredValue],
        capability: str = CHAT_CAPABILITY,
    ) -> StructuredChatResult[StructuredValue]:
        validated_messages = tuple(messages)
        if not validated_messages:
            raise ValueError("messages must not be empty")
        normalized_source = normalize_call_source(source)
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(
                self._create_log_sync,
                call_id,
                user_id,
                normalized_source,
                capability,
            )
            config = await self._resolve_current(call_id, started_at, capability)
            api_key = await self._credential(config, call_id, started_at)
            try:
                result = await self._gateway.complete(
                    model=config.model_name,
                    messages=_structured_messages(
                        validated_messages,
                        response_model,
                    ),
                    api_base=config.api_base,
                    api_key=api_key,
                    disable_thinking=True,
                )
            except GatewayError as error:
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code=error.code,
                    metering=self._error_metering(error),
                )
                raise LLMError(error.code, call_id) from error

            metering = calculate_metering(
                usage=result.usage,
                input_price_per_million=result.input_price_per_million,
                output_price_per_million=result.output_price_per_million,
            )
            try:
                value = _validate_structured_content(
                    result.content,
                    response_model,
                )
            except (TypeError, ValueError, ValidationError):
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code="LLM_RESPONSE_INVALID",
                    metering=metering,
                )
                raise LLMError("LLM_RESPONSE_INVALID", call_id) from None

            await self._db(
                self._finalize_sync,
                call_id,
                status="succeeded",
                latency_ms=self._latency(started_at),
                error_code=None,
                metering=metering,
            )
            return StructuredChatResult(
                value=value,
                call_id=call_id,
                usage=usage_response(result.usage),
            )
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise

    async def stream_chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
        *,
        source: str,
        capability: str = CHAT_CAPABILITY,
    ) -> ChatStream:
        validated_messages = tuple(messages)
        if not validated_messages:
            raise ValueError("messages must not be empty")
        normalized_source = normalize_call_source(source)
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(
                self._create_log_sync,
                call_id,
                user_id,
                normalized_source,
                capability,
            )
            config = await self._resolve_current(call_id, started_at, capability)
            api_key = await self._credential(config, call_id, started_at)
            try:
                events = await self._gateway.start_stream(
                    model=config.model_name,
                    messages=validated_messages,
                    api_base=config.api_base,
                    api_key=api_key,
                )
            except GatewayError as error:
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code=error.code,
                    metering=self._error_metering(error),
                )
                raise LLMError(error.code, call_id) from error
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise

        opened = OpenStream(config=config, events=events)
        source_events = self._stream_events(opened, call_id, started_at)
        return ChatStream(
            call_id=call_id,
            events=ManagedStreamEvents(
                source_events,
                lambda: self._close_unstarted_stream(opened, call_id, started_at),
            ),
        )

    async def _close_unstarted_stream(
        self,
        opened: OpenStream,
        call_id: str,
        started_at: float,
    ) -> None:
        await self._finalize_cancelled(call_id, started_at)
        close = getattr(opened.events, "aclose", None)
        if close is not None:
            await close()

    async def _stream_events(
        self,
        opened: OpenStream,
        call_id: str,
        started_at: float,
    ) -> AsyncIterator[ChatStreamEvent]:
        finalized = False
        try:
            final_event: GatewayStreamEvent | None = None
            try:
                async for event in opened.events:
                    if event.type == "delta":
                        yield ChatStreamEvent(
                            type="delta",
                            call_id=call_id,
                            content=event.content,
                        )
                    else:
                        final_event = event
            except GatewayError as error:
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code=error.code,
                    metering=self._error_metering(error),
                )
                finalized = True
                yield ChatStreamEvent(
                    type="error",
                    call_id=call_id,
                    error_code=error.code,
                )
                return

            if final_event is None:
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code="LLM_REQUEST_REJECTED",
                )
                finalized = True
                yield ChatStreamEvent(
                    type="error",
                    call_id=call_id,
                    error_code="LLM_REQUEST_REJECTED",
                )
                return

            final_usage = final_event.usage or GatewayUsage(None, None)
            metering = calculate_metering(
                usage=final_usage,
                input_price_per_million=final_event.input_price_per_million,
                output_price_per_million=final_event.output_price_per_million,
            )
            await self._db(
                self._finalize_sync,
                call_id,
                status="succeeded",
                latency_ms=self._latency(started_at),
                error_code=None,
                metering=metering,
            )
            finalized = True
            yield ChatStreamEvent(
                type="done",
                call_id=call_id,
                usage=usage_response(final_usage),
            )
        except (asyncio.CancelledError, GeneratorExit):
            if not finalized:
                await self._finalize_cancelled(call_id, started_at)
            raise
        finally:
            close = getattr(opened.events, "aclose", None)
            if close is not None:
                await close()

    @staticmethod
    def _error_metering(error: GatewayError) -> Metering | None:
        if (
            error.usage is None
            and error.input_price_per_million is None
            and error.output_price_per_million is None
        ):
            return None
        return calculate_metering(
            usage=error.usage or GatewayUsage(None, None),
            input_price_per_million=error.input_price_per_million,
            output_price_per_million=error.output_price_per_million,
            force_partial=True,
        )

    async def test_config(
        self,
        user_id: int,
        config_id: int,
        *,
        capability: str = CHAT_CAPABILITY,
    ) -> str:
        config = await self._db(self._config_sync, config_id, capability)
        if config is None:
            call_id = create_call_id()
            started_at = perf_counter()
            await self._db(
                self._create_log_sync,
                call_id,
                user_id,
                "connection_test",
                capability,
            )
            await self._db(
                self._finalize_sync,
                call_id,
                status="failed",
                latency_ms=self._latency(started_at),
                error_code="LLM_MODEL_NOT_FOUND",
            )
            raise LLMError("LLM_MODEL_NOT_FOUND", call_id)
        return await self.test_runtime_config(user_id, config)

    async def test_runtime_config(
        self,
        user_id: int,
        config: RuntimeModelConfig,
    ) -> str:
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(
                self._create_log_sync,
                call_id,
                user_id,
                "connection_test",
                config.capability,
            )
            await self._db(self._select_model_sync, call_id, config)
            api_key = await self._credential(config, call_id, started_at)
            try:
                is_image_probe = config.capability == JOB_IMAGE_STRUCTURING_CAPABILITY
                probe_message = ChatMessage(
                    role="user",
                    content=(
                        [
                            ChatTextContentPart(
                                text=(
                                    "识别图片的纯色，只返回一个 JSON 对象，"
                                    '格式为 {"color":"颜色英文小写"}。'
                                )
                            ),
                            ChatImageContentPart(
                                image_url=ChatImageUrl(
                                    url=VISION_PROBE_IMAGE_DATA_URL,
                                    detail="low",
                                )
                            ),
                        ]
                        if is_image_probe
                        else (
                            "Reply only with this valid JSON object: {\"ok\": true}"
                            if config.capability == RESUME_STRUCTURING_CAPABILITY
                            else "Reply with OK."
                        )
                    ),
                )
                result: GatewayResult = await self._gateway.complete(
                    model=config.model_name,
                    messages=(probe_message,),
                    api_base=config.api_base,
                    api_key=api_key,
                )
            except GatewayError as error:
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code="LLM_CONNECTION_FAILED",
                    metering=self._error_metering(error),
                )
                raise LLMError("LLM_CONNECTION_FAILED", call_id) from error
            metering = calculate_metering(
                usage=result.usage,
                input_price_per_million=result.input_price_per_million,
                output_price_per_million=result.output_price_per_million,
            )
            if config.capability in {
                RESUME_STRUCTURING_CAPABILITY,
                JOB_IMAGE_STRUCTURING_CAPABILITY,
            }:
                try:
                    probe_payload = json.loads(result.content)
                except (TypeError, ValueError):
                    probe_payload = None
                if (
                    not isinstance(probe_payload, dict)
                    or (
                        probe_payload.get("color") != "red"
                        if config.capability == JOB_IMAGE_STRUCTURING_CAPABILITY
                        else probe_payload.get("ok") is not True
                    )
                ):
                    await self._db(
                        self._finalize_sync,
                        call_id,
                        status="failed",
                        latency_ms=self._latency(started_at),
                        error_code="LLM_RESPONSE_INVALID",
                        metering=metering,
                    )
                    raise LLMError("LLM_RESPONSE_INVALID", call_id)
            await self._db(
                self._finalize_sync,
                call_id,
                status="succeeded",
                latency_ms=self._latency(started_at),
                error_code=None,
                metering=metering,
            )
            return call_id
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise

    async def test_external_runtime_config(
        self,
        user_id: int,
        config: RuntimeModelConfig,
        *,
        invoke: Callable[[str], Awaitable[GatewayUsage]],
    ) -> str:
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(
                self._create_log_sync,
                call_id,
                user_id,
                "connection_test",
                config.capability,
            )
            await self._db(self._select_model_sync, call_id, config)
            api_key = await self._credential(config, call_id, started_at)
            try:
                usage = await invoke(api_key)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                error_code = getattr(error, "code", "LLM_CONNECTION_FAILED")
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code=str(error_code),
                )
                if hasattr(error, "call_id"):
                    error.call_id = call_id
                raise
            metering = calculate_metering(
                usage=usage,
                input_price_per_million=None,
                output_price_per_million=None,
            )
            await self._db(
                self._finalize_sync,
                call_id,
                status="succeeded",
                latency_ms=self._latency(started_at),
                error_code=None,
                metering=metering,
            )
            return call_id
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise
