"""LLM use-case execution; provider SDKs do not choose routes or prices."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from time import perf_counter
from typing import TypeVar
from uuid import uuid4

from PIL import Image
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from linkresume.core.database import utc_now
from linkresume.modules.llm.crypto import CredentialCipher, CredentialUnavailableError
from linkresume.modules.llm.gateway import (
    GatewayError, GatewayResult, GatewayStreamEvent, GatewayUsage, LLMGateway,
)
from linkresume.modules.llm.models import (
    LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute,
)
from linkresume.modules.llm.providers import (
    OPENAI_CHAT, OPENAI_RESPONSES, OPENAI_ASR_FILE, OPENAI_TTS, SPEECH_PROTOCOLS, inference_base_url, speech_ws_url, validate_route,
)
from linkresume.modules.llm.resolver import (
    ASSISTANT_CONVERSATION, JOB_IMAGE_EXTRACTION, JOB_TEXT_EXTRACTION,
    RESUME_STRUCTURING, SPEECH_TO_TEXT, SPEECH_USE_CASES, TEXT_TO_SPEECH,
    RoutePlan, resolve, validation_fingerprint, resolve_candidates,
)
from linkresume.modules.speech.gateway import (
    SAMPLE_RATE, SpeechGateway, SpeechProviderError, SpeechTarget,
)
from linkresume.modules.llm.schemas import (
    ChatMessage, ChatResult, ChatStream, ChatStreamEvent, ChatUsage,
    StructuredChatResult,
)

SOURCE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


def _vision_probe_image() -> str:
    # Qwen rejects dimensions <=10; use a valid RGB PNG without user data.
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), "red").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


VISION_PROBE_IMAGE_DATA_URL = _vision_probe_image()
StructuredValue = TypeVar("StructuredValue", bound=BaseModel)


def create_call_id() -> str:
    return "llmcall_" + uuid4().hex


class LLMError(Exception):
    def __init__(self, code: str, call_id: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.call_id = call_id or create_call_id()


@dataclass(frozen=True)
class AgentModelSummary:
    id: int
    name: str


@dataclass(frozen=True)
class AgentRuntimeModel:
    plan: RoutePlan
    api_key: str
    base_url: str


def _structured_messages(
    messages: Sequence[ChatMessage], response_model: type[StructuredValue]
) -> tuple[ChatMessage, ...]:
    schema = json.dumps(response_model.model_json_schema(), ensure_ascii=False, separators=(",", ":"))
    return (
        ChatMessage(
            role="system",
            content="只返回一个符合下列 JSON Schema 的 JSON 对象，不要输出 Markdown 或解释。\nJSON Schema:\n" + schema,
        ),
        *messages,
    )


def _json_object_candidates(content: str) -> tuple[str, ...]:
    candidates: list[str] = []
    start: int | None = None
    depth = 0
    quoted = False
    escaped = False
    for index, char in enumerate(content):
        if start is None:
            if char == "{":
                start, depth = index, 1
            continue
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                candidates.append(content[start:index + 1])
                start = None
    return tuple(candidates)


def _validate_structured_content(
    content: str, response_model: type[StructuredValue]
) -> StructuredValue:
    matches: list[StructuredValue] = []
    for candidate in _json_object_candidates(content):
        try:
            matches.append(response_model.model_validate(json.loads(candidate)))
        except (TypeError, ValueError, ValidationError):
            pass
    if len(matches) != 1:
        raise ValueError("model output must contain exactly one valid structured object")
    return matches[0]


def _credential_key(cipher: CredentialCipher, plan: RoutePlan) -> str:
    if not plan.credential_ciphertext:
        raise LLMError("LLM_CREDENTIALS_UNAVAILABLE")
    try:
        bundle = json.loads(cipher.decrypt(plan.credential_ciphertext).plaintext)
    except (CredentialUnavailableError, ValueError, TypeError) as error:
        raise LLMError("LLM_CREDENTIALS_UNAVAILABLE") from error
    key = bundle.get("api_key") if isinstance(bundle, dict) else None
    if not isinstance(key, str) or not key.strip():
        raise LLMError("LLM_CREDENTIALS_UNAVAILABLE")
    return key


def _metering(usage: GatewayUsage | None, pricing: dict | None) -> tuple[str, Decimal | None, str | None]:
    if usage is None:
        return "unknown", None, None
    if usage.input_tokens is None or usage.output_tokens is None:
        return "partial" if usage.input_tokens is not None or usage.output_tokens is not None else "unknown", None, None
    if not pricing:
        return "partial", None, None
    details = usage.details or {}
    if details.get("cacheRead") not in (None, 0) or details.get("cacheWrite") not in (None, 0):
        return "partial", None, None
    try:
        currency = pricing["currency"]
        input_price = Decimal(str(pricing["input_per_million"]))
        output_price = Decimal(str(pricing["output_per_million"]))
        if (
            not isinstance(currency, str) or len(currency) != 3
            or not input_price.is_finite() or input_price < 0
            or not output_price.is_finite() or output_price < 0
        ):
            raise ValueError
        cost = (
            Decimal(usage.input_tokens) * input_price
            + Decimal(usage.output_tokens) * output_price
        ) / Decimal(1_000_000)
        return "complete", cost, currency.upper()
    except (KeyError, ValueError, TypeError, InvalidOperation):
        return "partial", None, None


class LLMService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        gateway: LLMGateway,
        cipher: CredentialCipher,
        speech_gateway: SpeechGateway | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._gateway = gateway
        self._cipher = cipher
        if speech_gateway is None:
            from linkresume.modules.speech.router import ProviderSpeechGateway

            speech_gateway = ProviderSpeechGateway()
        self._speech_gateway = speech_gateway

    def encrypt_credential(self, plaintext: str) -> str:
        return self._cipher.encrypt(plaintext)

    async def _db(self, function, *args, **kwargs):
        return await asyncio.to_thread(function, *args, **kwargs)

    def _resolve_sync(self, use_case: str, model_id: int | None = None) -> RoutePlan | None:
        with self._session_factory() as db:
            return resolve(db, use_case, model_id=model_id)

    def _resolve_candidates_sync(self, use_case: str, model_id: int | None = None) -> list[RoutePlan]:
        with self._session_factory() as db:
            return resolve_candidates(db, use_case, model_id=model_id)

    async def ensure_configured(self, use_case: str) -> None:
        """Fail fast before creating work that depends on a routable use case."""
        if not await self._db(self._resolve_candidates_sync, use_case):
            raise LLMError("LLM_MODEL_NOT_CONFIGURED")

    async def agent_model_summary(self, model_id: int | None = None) -> AgentModelSummary:
        plan = await self._db(self._resolve_sync, ASSISTANT_CONVERSATION, model_id)
        if plan is None:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED" if model_id is None else "LLM_MODEL_UNAVAILABLE")
        return AgentModelSummary(id=plan.model_id, name=plan.display_name)

    async def agent_runtime_model(self, model_id: int | None = None) -> AgentRuntimeModel:
        plan = await self._db(self._resolve_sync, ASSISTANT_CONVERSATION, model_id)
        if plan is None:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED" if model_id is None else "LLM_MODEL_UNAVAILABLE")
        return self.runtime_model_for_plan(plan)

    def runtime_model_for_plan(self, plan: RoutePlan) -> AgentRuntimeModel:
        try:
            validate_route(plan.provider_code, plan.target_kind, plan.protocol_code)
            base_url = inference_base_url(plan.provider_code, plan.settings)
        except ValueError as error:
            raise LLMError("LLM_MODEL_UNAVAILABLE") from error
        return AgentRuntimeModel(
            plan=plan,
            api_key=_credential_key(self._cipher, plan),
            base_url=base_url,
        )

    def _start_log_sync(
        self,
        plan: RoutePlan,
        *,
        call_id: str,
        source: str,
        user_id: int | None,
        agent_run_id: int | None = None,
    ) -> None:
        with self._session_factory() as db:
            db.add(LLMCallLog(
                call_id=call_id,
                use_case=plan.use_case,
                source=source,
                user_id=user_id,
                agent_run_id=agent_run_id,
                route_id=plan.route_id,
                runtime_config_version=plan.runtime_config_version,
                protocol_code=plan.protocol_code,
                selection_source=plan.selection_source,
                price_snapshot_json=plan.pricing,
                status="pending",
                metering_status="unknown",
            ))
            db.commit()

    def _finish_log_sync(
        self,
        call_id: str,
        *,
        status: str,
        usage: GatewayUsage | None = None,
        response_model_id: str | None = None,
        upstream_request_id: str | None = None,
        error_code: str | None = None,
        latency_ms: int | None = None,
    ) -> None:
        with self._session_factory() as db:
            row = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
            if row is None:
                return
            row.status = status
            if usage is not None:
                metering_status, cost, currency = _metering(usage, row.price_snapshot_json)
                row.metering_status = metering_status
                row.input_tokens = usage.input_tokens
                row.output_tokens = usage.output_tokens
                row.usage_json = usage.details
                row.estimated_cost = cost
                row.cost_currency = currency
            if response_model_id is not None:
                row.response_model_id = response_model_id
            if upstream_request_id is not None:
                row.upstream_request_id = upstream_request_id
            row.error_code = error_code
            row.latency_ms = latency_ms
            db.commit()

    async def chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
        *,
        source: str,
        use_case: str = JOB_TEXT_EXTRACTION,
    ) -> ChatResult:
        if not messages or not SOURCE_PATTERN.fullmatch(source):
            raise ValueError("invalid LLM request")
        plans = await self._db(self._resolve_candidates_sync, use_case)
        if not plans:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED")
        last_error: LLMError | None = None
        for plan in plans:
            if plan.protocol_code not in {OPENAI_CHAT, OPENAI_RESPONSES}:
                continue
            try:
                runtime = self.runtime_model_for_plan(plan)
            except LLMError:
                continue
            call_id = create_call_id()
            started = perf_counter()
            await self._db(self._start_log_sync, plan, call_id=call_id, source=source, user_id=user_id)
            try:
                result = await self._gateway.complete(
                    model=plan.invoke_target, messages=tuple(messages),
                    api_base=runtime.base_url, api_key=runtime.api_key,
                    protocol_code=plan.protocol_code,
                )
            except GatewayError as error:
                await self._db(
                    self._finish_log_sync, call_id, status="failed", usage=error.usage,
                    error_code=error.code, latency_ms=round((perf_counter() - started) * 1000),
                )
                last_error = LLMError(error.code, call_id)
                if error.code == "LLM_REQUEST_REJECTED":
                    raise last_error from error
                continue
            except asyncio.CancelledError:
                await asyncio.shield(self._db(
                    self._finish_log_sync, call_id, status="cancelled",
                    latency_ms=round((perf_counter() - started) * 1000),
                ))
                raise
            except Exception as error:
                await self._db(
                    self._finish_log_sync, call_id, status="failed",
                    error_code="LLM_CONNECTION_FAILED",
                    latency_ms=round((perf_counter() - started) * 1000),
                )
                raise LLMError("LLM_CONNECTION_FAILED", call_id) from error
            await self._db(
                self._finish_log_sync, call_id, status="succeeded", usage=result.usage,
                response_model_id=result.response_model_id,
                upstream_request_id=result.upstream_request_id,
                latency_ms=round((perf_counter() - started) * 1000),
            )
            return ChatResult(
                content=result.content, callId=call_id,
                usage=ChatUsage(inputTokens=result.usage.input_tokens, outputTokens=result.usage.output_tokens),
            )
        raise last_error or LLMError("LLM_MODEL_UNAVAILABLE")

    async def structured_chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
        *,
        source: str,
        response_model: type[StructuredValue],
        use_case: str = JOB_TEXT_EXTRACTION,
    ) -> StructuredChatResult[StructuredValue]:
        result = await self.chat(
            user_id, _structured_messages(messages, response_model),
            source=source, use_case=use_case,
        )
        try:
            value = _validate_structured_content(result.content, response_model)
        except ValueError as error:
            await self._db(
                self._finish_log_sync, result.call_id, status="failed",
                error_code="LLM_RESPONSE_INVALID",
            )
            raise LLMError("LLM_RESPONSE_INVALID", result.call_id) from error
        return StructuredChatResult(value=value, call_id=result.call_id, usage=result.usage)

    async def stream_chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
        *,
        source: str,
        use_case: str = JOB_TEXT_EXTRACTION,
    ) -> ChatStream:
        if not messages or not SOURCE_PATTERN.fullmatch(source):
            raise ValueError("invalid LLM request")
        plans = await self._db(self._resolve_candidates_sync, use_case)
        if not plans:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED")
        request_call_id = create_call_id()
        async def events() -> AsyncIterator[ChatStreamEvent]:
            last_error = "LLM_MODEL_UNAVAILABLE"
            for index, plan in enumerate(plans):
                if plan.protocol_code not in {OPENAI_CHAT, OPENAI_RESPONSES}:
                    continue
                try:
                    runtime = self.runtime_model_for_plan(plan)
                except LLMError:
                    continue
                call_id = request_call_id if index == 0 else create_call_id()
                started = perf_counter()
                await self._db(self._start_log_sync, plan, call_id=call_id, source=source, user_id=user_id)
                upstream = None
                finished = False
                emitted_delta = False
                try:
                    upstream = await self._gateway.start_stream(
                        model=plan.invoke_target, messages=tuple(messages),
                        api_base=runtime.base_url, api_key=runtime.api_key,
                        protocol_code=plan.protocol_code,
                    )
                    async for event in upstream:
                        if event.type == "delta":
                            emitted_delta = True
                            yield ChatStreamEvent(type="delta", callId=call_id, content=event.content)
                        else:
                            await self._db(
                                self._finish_log_sync, call_id, status="succeeded", usage=event.usage,
                                response_model_id=event.response_model_id,
                                upstream_request_id=event.upstream_request_id,
                                latency_ms=round((perf_counter() - started) * 1000),
                            )
                            finished = True
                            yield ChatStreamEvent(
                                type="done", callId=call_id,
                                usage=ChatUsage(
                                    inputTokens=event.usage.input_tokens if event.usage else None,
                                    outputTokens=event.usage.output_tokens if event.usage else None,
                                ),
                            )
                            return
                    # An upstream stream without a terminal event is a failed request.
                    raise GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True)
                except GatewayError as error:
                    last_error = error.code
                    await self._db(self._finish_log_sync, call_id, status="failed", usage=error.usage,
                                   error_code=error.code, latency_ms=round((perf_counter() - started) * 1000))
                    finished = True
                    if emitted_delta or error.code == "LLM_REQUEST_REJECTED":
                        yield ChatStreamEvent(type="error", callId=call_id, errorCode=error.code)
                        return
                except asyncio.CancelledError:
                    raise
                except Exception:
                    last_error = "LLM_CONNECTION_FAILED"
                    await self._db(self._finish_log_sync, call_id, status="failed",
                                   error_code=last_error, latency_ms=round((perf_counter() - started) * 1000))
                    finished = True
                    yield ChatStreamEvent(type="error", callId=call_id, errorCode=last_error)
                    return
                finally:
                    if not finished:
                        await asyncio.shield(self._db(self._finish_log_sync, call_id, status="cancelled"))
                    close = getattr(upstream, "aclose", None)
                    if close:
                        await close()
            yield ChatStreamEvent(type="error", callId=request_call_id, errorCode=last_error)
        return ChatStream(call_id=request_call_id, events=events())

    async def probe_route(
        self,
        user_id: int,
        use_case: str,
        route_id: int,
        *,
        pi_probe=None,
    ) -> str:
        with self._session_factory() as db:
            binding = db.get(LLMUseCaseRoute, (use_case, route_id))
            route = db.get(LLMModelRoute, route_id)
            connection = db.get(LLMProviderConnection, route.connection_id) if route else None
            model = db.get(LLMModel, route.model_id) if route else None
            if binding is None or route is None or connection is None or model is None:
                raise LLMError("LLM_MODEL_NOT_FOUND")
            plan = RoutePlan(
                use_case=use_case, route_id=route.id, model_id=model.id,
                display_name=model.display_name, provider_code=connection.provider_code,
                connection_id=connection.id, runtime_config_version=connection.runtime_config_version,
                target_kind=route.target_kind, invoke_target=route.invoke_target,
                protocol_code=binding.protocol_code, settings=dict(connection.settings_json or {}),
                credential_ciphertext=connection.credential_ciphertext,
                pricing=dict(route.pricing_json) if route.pricing_json else None,
                selection_source="probe",
            )
            fingerprint = validation_fingerprint(binding, route, connection)
        runtime = None if use_case in SPEECH_USE_CASES else self.runtime_model_for_plan(plan)
        call_id = create_call_id()
        await self._db(self._start_log_sync, plan, call_id=call_id, source="capability_probe", user_id=user_id)
        try:
            if use_case in SPEECH_USE_CASES:
                await self._probe_speech(plan, call_id)
                result = GatewayResult(content="OK", usage=None)
            elif use_case == ASSISTANT_CONVERSATION:
                if pi_probe is None:
                    raise LLMError("LLM_PI_AGENT_UNAVAILABLE", call_id)
                usage = await pi_probe.run_probe(runtime, runtime.api_key)
                result = GatewayResult(content="OK", usage=usage)
            else:
                if plan.protocol_code not in {OPENAI_CHAT, OPENAI_RESPONSES}:
                    raise LLMError("LLM_MODEL_UNAVAILABLE", call_id)
                prompt = ('Reply only with this JSON: {"ok":true}'
                          if use_case == RESUME_STRUCTURING else "Reply with OK.")
                message = ChatMessage(role="user", content=prompt)
                if use_case == JOB_IMAGE_EXTRACTION:
                    message = ChatMessage(role="user", content=[
                        {"type": "text", "text": "Read this image and reply OK."},
                        {"type": "image_url", "image_url": {"url": VISION_PROBE_IMAGE_DATA_URL}},
                    ])
                result = await self._gateway.complete(
                    model=plan.invoke_target,
                    messages=(message,),
                    api_base=runtime.base_url, api_key=runtime.api_key,
                    protocol_code=plan.protocol_code,
                )
                if use_case == RESUME_STRUCTURING:
                    try:
                        valid = json.loads(result.content).get("ok") is True
                    except (ValueError, AttributeError):
                        valid = False
                    if not valid:
                        raise LLMError("LLM_RESPONSE_INVALID", call_id)
            await self._db(self._finish_log_sync, call_id, status="succeeded", usage=result.usage)
        except BaseException as error:
            code = getattr(error, "code", "LLM_CONNECTION_FAILED")
            await asyncio.shield(self._db(self._finish_log_sync, call_id,
                                          status="cancelled" if isinstance(error, asyncio.CancelledError) else "failed",
                                          error_code=code))
            if isinstance(error, asyncio.CancelledError):
                raise
            raise LLMError(code, call_id) from error
        with self._session_factory() as db:
            current = db.get(LLMUseCaseRoute, (use_case, route_id))
            current_route = db.get(LLMModelRoute, route_id)
            current_connection = db.get(LLMProviderConnection, current_route.connection_id) if current_route else None
            if (
                current is None or current_route is None or current_connection is None
                or validation_fingerprint(current, current_route, current_connection) != fingerprint
            ):
                raise LLMError("LLM_CONFIG_CHANGED", call_id)
            current.validated_fingerprint = fingerprint
            current.validated_at = utc_now()
            db.commit()
        return call_id


    # -- speech -------------------------------------------------------------

    def speech_target_for_plan(self, plan: RoutePlan) -> SpeechTarget:
        if plan.protocol_code not in SPEECH_PROTOCOLS.get(plan.use_case, ()):
            raise LLMError("LLM_MODEL_UNAVAILABLE")
        try:
            validate_route(plan.provider_code, plan.target_kind, plan.protocol_code)
            http_speech = plan.protocol_code in {OPENAI_ASR_FILE, OPENAI_TTS}
            url = "" if http_speech else speech_ws_url(plan.provider_code, plan.settings)
        except ValueError as error:
            raise LLMError("LLM_MODEL_UNAVAILABLE") from error
        return SpeechTarget(
            ws_url=url,
            api_key=_credential_key(self._cipher, plan),
            model=plan.invoke_target,
            workspace_id=plan.settings.get("workspace_id"),
            provider_code=plan.provider_code,
            api_base=inference_base_url(plan.provider_code, plan.settings) if http_speech else None,
        )

    async def speech_plan(self, use_case: str) -> RoutePlan:
        if use_case not in SPEECH_USE_CASES:
            raise ValueError("not a speech use case")
        for plan in await self._db(self._resolve_candidates_sync, use_case):
            if plan.protocol_code in SPEECH_PROTOCOLS[use_case]:
                return plan
        raise LLMError("LLM_MODEL_NOT_CONFIGURED")

    async def speech_available(self) -> dict[str, bool]:
        result = {}
        for use_case in SPEECH_USE_CASES:
            try:
                await self.speech_plan(use_case)
                result[use_case] = True
            except LLMError:
                result[use_case] = False
        return result

    async def start_speech_call(self, plan: RoutePlan, *, source: str, user_id: int | None) -> str:
        if not SOURCE_PATTERN.fullmatch(source):
            raise ValueError("invalid speech source")
        call_id = create_call_id()
        await self._db(self._start_log_sync, plan, call_id=call_id, source=source, user_id=user_id)
        return call_id

    async def finish_speech_call(
        self,
        call_id: str,
        *,
        started: float,
        error_code: str | None = None,
        cancelled: bool = False,
        details: dict | None = None,
    ) -> None:
        """Speech calls record audio seconds or characters, never content."""
        status = "cancelled" if cancelled else ("failed" if error_code else "succeeded")
        await asyncio.shield(self._db(
            self._finish_log_sync, call_id, status=status,
            usage=GatewayUsage(input_tokens=None, output_tokens=None, details=details),
            error_code=error_code, latency_ms=int((perf_counter() - started) * 1000),
        ))

    @property
    def speech_gateway(self) -> SpeechGateway:
        return self._speech_gateway

    async def synthesize(self, user_id: int, text: str, *, source: str, voice: str | None = None) -> bytes:
        plan = await self.speech_plan(TEXT_TO_SPEECH)
        target = self.speech_target_for_plan(plan)
        call_id = await self.start_speech_call(plan, source=source, user_id=user_id)
        started = perf_counter()
        try:
            audio = await self._speech_gateway.synthesize(target, text, voice=voice)
        except asyncio.CancelledError:
            await self.finish_speech_call(call_id, started=started, cancelled=True)
            raise
        except SpeechProviderError as error:
            await self.finish_speech_call(
                call_id, started=started, error_code=error.code, details={"characters": len(text)}
            )
            raise
        await self.finish_speech_call(call_id, started=started, details={"characters": len(text)})
        return audio

    async def _probe_speech(self, plan: RoutePlan, call_id: str) -> None:
        target = self.speech_target_for_plan(plan)
        try:
            if plan.use_case == TEXT_TO_SPEECH:
                await self._speech_gateway.synthesize(target, "你好。", voice=None)
                return

            async def silence():
                # One second of 16 kHz PCM16 silence proves the full task cycle.
                yield bytes(SAMPLE_RATE * 2)

            async for _ in self._speech_gateway.recognize(target, silence(), hotwords=[], language="zh"):
                pass
        except SpeechProviderError as error:
            raise LLMError("LLM_CONNECTION_FAILED", call_id) from error
