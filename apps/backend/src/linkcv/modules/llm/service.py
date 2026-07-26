from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from time import perf_counter
from uuid import uuid4

from anyio import to_thread
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from linkcv.core.database import utc_now
from linkcv.modules.llm.crypto import (
    CredentialCipher,
    CredentialUnavailableError,
)
from linkcv.modules.llm.gateway import (
    GatewayError,
    GatewayResult,
    GatewayStreamEvent,
    GatewayUsage,
    LLMGateway,
)
from linkcv.modules.llm.models import LLMCallLog, LLMModelConfig
from linkcv.modules.llm.schemas import (
    ChatMessage,
    ChatResult,
    ChatStream,
    ChatStreamEvent,
    ChatUsage,
)

logger = logging.getLogger(__name__)
ONE_MILLION = Decimal(1_000_000)
COST_QUANTUM = Decimal("0.0000000001")


def create_call_id() -> str:
    return f"llmcall_{uuid4().hex}"


class LLMError(Exception):
    def __init__(self, code: str, call_id: str) -> None:
        super().__init__(code)
        self.code = code
        self.call_id = call_id


@dataclass(frozen=True)
class RuntimeModelConfig:
    id: int
    model_name: str
    api_base: str | None
    encrypted_api_key: str | None
    input_price_per_million: Decimal | None
    output_price_per_million: Decimal | None


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
    index: int
    events: AsyncIterator[GatewayStreamEvent]
    ambiguous_usage: bool


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

    def __aiter__(self) -> "ManagedStreamEvents":
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
    gateway_input_price: Decimal | None,
    gateway_output_price: Decimal | None,
    config: RuntimeModelConfig,
    force_partial: bool = False,
) -> Metering:
    input_price = (
        gateway_input_price
        if gateway_input_price is not None
        else config.input_price_per_million
    )
    output_price = (
        gateway_output_price
        if gateway_output_price is not None
        else config.output_price_per_million
    )
    values = (
        usage.input_tokens,
        usage.output_tokens,
        input_price,
        output_price,
    )
    complete = all(value is not None for value in values) and not force_partial
    known = any(value is not None for value in values)
    status = "complete" if complete else "partial" if known else "unknown"

    estimated_cost = None
    if all(value is not None for value in values) and not force_partial:
        assert usage.input_tokens is not None
        assert usage.output_tokens is not None
        assert input_price is not None
        assert output_price is not None
        estimated_cost = (
            Decimal(usage.input_tokens) / ONE_MILLION * input_price
            + Decimal(usage.output_tokens) / ONE_MILLION * output_price
        ).quantize(COST_QUANTUM)

    return Metering(
        status=status,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        input_price_per_million=input_price,
        output_price_per_million=output_price,
        estimated_cost=estimated_cost,
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

    async def _db(self, function, *args, **kwargs):
        return await to_thread.run_sync(lambda: function(*args, **kwargs))

    def _create_log_sync(self, call_id: str, user_id: int) -> None:
        with self._session_factory() as db:
            db.add(
                LLMCallLog(
                    call_id=call_id,
                    user_id=user_id,
                    created_at=utc_now(),
                )
            )
            db.commit()

    def _enabled_configs_sync(self) -> list[RuntimeModelConfig]:
        with self._session_factory() as db:
            configs = db.scalars(
                select(LLMModelConfig)
                .where(LLMModelConfig.enabled.is_(True))
                .order_by(LLMModelConfig.priority.asc(), LLMModelConfig.id.asc())
            ).all()
            return [self._runtime_config(config) for config in configs]

    def _config_sync(self, config_id: int) -> RuntimeModelConfig | None:
        with self._session_factory() as db:
            config = db.get(LLMModelConfig, config_id)
            return self._runtime_config(config) if config is not None else None

    @staticmethod
    def _runtime_config(config: LLMModelConfig) -> RuntimeModelConfig:
        return RuntimeModelConfig(
            id=config.id,
            model_name=config.model_name,
            api_base=config.api_base,
            encrypted_api_key=config.encrypted_api_key,
            input_price_per_million=config.input_price_per_million,
            output_price_per_million=config.output_price_per_million,
        )

    def _select_model_sync(self, call_id: str, config: RuntimeModelConfig) -> None:
        with self._session_factory() as db:
            db.execute(
                update(LLMCallLog)
                .where(LLMCallLog.call_id == call_id)
                .values(model_config_id=config.id, model_name=config.model_name)
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
        metering_status = metering.status if metering else "unknown"
        rendered_error_code = error_code or "-"
        log(
            "LLM call finalized call_id=%s status=%s error_code=%s "
            "metering_status=%s",
            call_id,
            status,
            rendered_error_code,
            metering_status,
            extra={
                "call_id": call_id,
                "status": status,
                "error_code": error_code,
                "metering_status": metering_status,
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

    async def chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
    ) -> ChatResult:
        validated_messages = tuple(messages)
        if not validated_messages:
            raise ValueError("messages must not be empty")
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(self._create_log_sync, call_id, user_id)
            return await self._chat_started(
                validated_messages,
                call_id,
                started_at,
            )
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise

    async def _chat_started(
        self,
        messages: Sequence[ChatMessage],
        call_id: str,
        started_at: float,
    ) -> ChatResult:
        candidates = await self._db(self._enabled_configs_sync)
        if not candidates:
            await self._db(
                self._finalize_sync,
                call_id,
                status="failed",
                latency_ms=self._latency(started_at),
                error_code="NO_AVAILABLE_LLM_MODEL",
            )
            raise LLMError("NO_AVAILABLE_LLM_MODEL", call_id)

        ambiguous_usage = False
        for index, config in enumerate(candidates):
            await self._db(self._select_model_sync, call_id, config)
            api_key = await self._credential(config, call_id, started_at)
            try:
                result = await self._gateway.complete(
                    model=config.model_name,
                    messages=messages,
                    api_base=config.api_base,
                    api_key=api_key,
                )
            except GatewayError as error:
                ambiguous_usage = (
                    ambiguous_usage or error.may_have_reached_provider
                )
                logger.warning(
                    "LLM candidate failed call_id=%s model_config_id=%s "
                    "switchable=%s",
                    call_id,
                    config.id,
                    error.switchable,
                    extra={
                        "call_id": call_id,
                        "model_config_id": config.id,
                        "switchable": error.switchable,
                    },
                )
                if error.switchable and index + 1 < len(candidates):
                    continue
                code = "LLM_UNAVAILABLE" if error.switchable else "LLM_REQUEST_REJECTED"
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code=code,
                )
                raise LLMError(code, call_id) from error

            metering = calculate_metering(
                usage=result.usage,
                gateway_input_price=result.input_price_per_million,
                gateway_output_price=result.output_price_per_million,
                config=config,
                force_partial=ambiguous_usage,
            )
            await self._db(
                self._finalize_sync,
                call_id,
                status="succeeded",
                latency_ms=self._latency(started_at),
                error_code=None,
                metering=metering,
            )
            usage = None
            if (
                result.usage.input_tokens is not None
                or result.usage.output_tokens is not None
            ):
                usage = ChatUsage(
                    input_tokens=result.usage.input_tokens,
                    output_tokens=result.usage.output_tokens,
                )
            return ChatResult(content=result.content, call_id=call_id, usage=usage)

        raise AssertionError("candidate loop must return or raise")

    async def _open_stream(
        self,
        *,
        candidates: Sequence[RuntimeModelConfig],
        start_index: int,
        messages: Sequence[ChatMessage],
        call_id: str,
        started_at: float,
        ambiguous_usage: bool,
    ) -> OpenStream:
        for index in range(start_index, len(candidates)):
            config = candidates[index]
            await self._db(self._select_model_sync, call_id, config)
            api_key = await self._credential(config, call_id, started_at)
            try:
                events = await self._gateway.start_stream(
                    model=config.model_name,
                    messages=messages,
                    api_base=config.api_base,
                    api_key=api_key,
                )
            except GatewayError as error:
                ambiguous_usage = (
                    ambiguous_usage or error.may_have_reached_provider
                )
                if error.switchable and index + 1 < len(candidates):
                    continue
                code = "LLM_UNAVAILABLE" if error.switchable else "LLM_REQUEST_REJECTED"
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code=code,
                )
                raise LLMError(code, call_id) from error
            return OpenStream(config, index, events, ambiguous_usage)

        await self._db(
            self._finalize_sync,
            call_id,
            status="failed",
            latency_ms=self._latency(started_at),
            error_code="LLM_UNAVAILABLE",
        )
        raise LLMError("LLM_UNAVAILABLE", call_id)

    async def stream_chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
    ) -> ChatStream:
        validated_messages = tuple(messages)
        if not validated_messages:
            raise ValueError("messages must not be empty")
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(self._create_log_sync, call_id, user_id)
            candidates = await self._db(self._enabled_configs_sync)
            if not candidates:
                await self._db(
                    self._finalize_sync,
                    call_id,
                    status="failed",
                    latency_ms=self._latency(started_at),
                    error_code="NO_AVAILABLE_LLM_MODEL",
                )
                raise LLMError("NO_AVAILABLE_LLM_MODEL", call_id)
            opened = await self._open_stream(
                candidates=candidates,
                start_index=0,
                messages=validated_messages,
                call_id=call_id,
                started_at=started_at,
                ambiguous_usage=False,
            )
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise

        source = self._stream_events(
            candidates=candidates,
            messages=validated_messages,
            opened=opened,
            call_id=call_id,
            started_at=started_at,
        )
        return ChatStream(
            call_id=call_id,
            events=ManagedStreamEvents(
                source,
                lambda: self._close_unstarted_stream(
                    opened,
                    call_id,
                    started_at,
                ),
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
        *,
        candidates: Sequence[RuntimeModelConfig],
        messages: Sequence[ChatMessage],
        opened: OpenStream,
        call_id: str,
        started_at: float,
    ) -> AsyncIterator[ChatStreamEvent]:
        output_started = False
        finalized = False
        current = opened
        try:
            while True:
                final_event: GatewayStreamEvent | None = None
                try:
                    async for event in current.events:
                        if event.type == "delta":
                            output_started = True
                            yield ChatStreamEvent(
                                type="delta",
                                call_id=call_id,
                                content=event.content,
                            )
                        else:
                            final_event = event
                except GatewayError as error:
                    ambiguous = (
                        current.ambiguous_usage
                        or error.may_have_reached_provider
                        or error.usage is not None
                    )
                    if (
                        not output_started
                        and error.switchable
                        and current.index + 1 < len(candidates)
                    ):
                        try:
                            current = await self._open_stream(
                                candidates=candidates,
                                start_index=current.index + 1,
                                messages=messages,
                                call_id=call_id,
                                started_at=started_at,
                                ambiguous_usage=ambiguous,
                            )
                        except LLMError as final_error:
                            finalized = True
                            yield ChatStreamEvent(
                                type="error",
                                call_id=call_id,
                                error_code=final_error.code,
                            )
                            return
                        continue
                    code = (
                        "LLM_UNAVAILABLE"
                        if error.switchable and not output_started
                        else "LLM_REQUEST_REJECTED"
                    )
                    error_metering = None
                    if (
                        error.usage is not None
                        or error.input_price_per_million is not None
                        or error.output_price_per_million is not None
                    ):
                        error_metering = calculate_metering(
                            usage=error.usage or GatewayUsage(None, None),
                            gateway_input_price=error.input_price_per_million,
                            gateway_output_price=error.output_price_per_million,
                            config=current.config,
                            force_partial=True,
                        )
                    await self._db(
                        self._finalize_sync,
                        call_id,
                        status="failed",
                        latency_ms=self._latency(started_at),
                        error_code=code,
                        metering=error_metering,
                    )
                    finalized = True
                    yield ChatStreamEvent(
                        type="error", call_id=call_id, error_code=code
                    )
                    return

                if final_event is None:
                    if not output_started and current.index + 1 < len(candidates):
                        try:
                            current = await self._open_stream(
                                candidates=candidates,
                                start_index=current.index + 1,
                                messages=messages,
                                call_id=call_id,
                                started_at=started_at,
                                ambiguous_usage=current.ambiguous_usage,
                            )
                        except LLMError as final_error:
                            finalized = True
                            yield ChatStreamEvent(
                                type="error",
                                call_id=call_id,
                                error_code=final_error.code,
                            )
                            return
                        continue
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
                    gateway_input_price=final_event.input_price_per_million,
                    gateway_output_price=final_event.output_price_per_million,
                    config=current.config,
                    force_partial=current.ambiguous_usage,
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
                usage = None
                if (
                    final_usage.input_tokens is not None
                    or final_usage.output_tokens is not None
                ):
                    usage = ChatUsage(
                        input_tokens=final_usage.input_tokens,
                        output_tokens=final_usage.output_tokens,
                    )
                yield ChatStreamEvent(type="done", call_id=call_id, usage=usage)
                return
        except asyncio.CancelledError:
            if not finalized:
                await self._finalize_cancelled(call_id, started_at)
            raise
        except GeneratorExit:
            if not finalized:
                await self._finalize_cancelled(call_id, started_at)
            raise
        finally:
            close = getattr(current.events, "aclose", None)
            if close is not None:
                await close()

    async def test_config(self, user_id: int, config_id: int) -> str:
        call_id = create_call_id()
        started_at = perf_counter()
        try:
            await self._db(self._create_log_sync, call_id, user_id)
            return await self._test_config_started(
                config_id,
                call_id,
                started_at,
            )
        except asyncio.CancelledError:
            await self._finalize_cancelled(call_id, started_at)
            raise

    async def _test_config_started(
        self,
        config_id: int,
        call_id: str,
        started_at: float,
    ) -> str:
        config = await self._db(self._config_sync, config_id)
        if config is None:
            await self._db(
                self._finalize_sync,
                call_id,
                status="failed",
                latency_ms=self._latency(started_at),
                error_code="LLM_MODEL_NOT_FOUND",
            )
            raise LLMError("LLM_MODEL_NOT_FOUND", call_id)
        await self._db(self._select_model_sync, call_id, config)
        api_key = await self._credential(config, call_id, started_at)
        try:
            result: GatewayResult = await self._gateway.complete(
                model=config.model_name,
                messages=(ChatMessage(role="user", content="Reply with OK."),),
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
            )
            raise LLMError("LLM_CONNECTION_FAILED", call_id) from error
        metering = calculate_metering(
            usage=result.usage,
            gateway_input_price=result.input_price_per_million,
            gateway_output_price=result.output_price_per_million,
            config=config,
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
