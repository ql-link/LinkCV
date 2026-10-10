"""LLM use-case execution; provider SDKs do not choose routes or prices."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from decimal import Decimal
from importlib.resources import files
from time import perf_counter
from typing import TypeVar
from uuid import uuid4
import wave

from PIL import Image
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from linkresume.core.database import utc_now
from linkresume.modules.llm.pricing import calculate_cost, normalize_usage, route_pricing
from linkresume.modules.llm.accounting import record_runtime_cost, store_price
from linkresume.modules.llm.crypto import CredentialCipher, CredentialUnavailableError
from linkresume.modules.llm.gateway import (
    GatewayError, GatewayResult, GatewayStreamEvent, GatewayUsage, LLMGateway,
)
from linkresume.modules.llm.models import (
    LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute,
    get_use_case_route,
)
from linkresume.modules.llm.providers import (
    OPENAI_CHAT, OPENAI_RESPONSES, SYSTEM_ONE, OPENAI_ASR_FILE, OPENAI_TTS, SPEECH_PROTOCOLS, inference_base_url, speech_ws_url, validate_route, validate_model_protocol,
)
from linkresume.modules.llm.resolver import (
    ASSISTANT_CONVERSATION, ASSISTANT_INTENT, BROWSER_AUTOFILL, JOB_IMAGE_EXTRACTION, JOB_TEXT_EXTRACTION,
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


def _bounded_log_identifier(value: str, field: str) -> str | None:
    """Opaque upstream identifiers must fit the existing optional log column."""
    limit = LLMCallLog.__table__.c[field].type.length
    return value if isinstance(value, str) and len(value) <= limit else None


def _speech_probe_pcm(protocol_code: str) -> bytes:
    if protocol_code != OPENAI_ASR_FILE:
        return bytes(SAMPLE_RATE * 2)
    # Whisper can hallucinate ~30-second word times for one second of silence.
    # A fixed synthetic recording exercises the same strict timestamp checks.
    with files("linkresume.modules.speech").joinpath("asr_probe.wav").open("rb") as source:
        with wave.open(source, "rb") as recording:
            if (recording.getframerate(), recording.getnchannels(), recording.getsampwidth()) != (SAMPLE_RATE, 1, 2):
                raise ValueError("invalid speech probe fixture")
            return recording.readframes(recording.getnframes())


def create_call_id() -> str:
    return "llmcall_" + uuid4().hex


class LLMError(Exception):
    def __init__(self, code: str, call_id: str | None = None, decision_detail: dict | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.call_id = call_id or create_call_id()
        self.decision_detail = decision_detail


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
    normalized = normalize_usage(usage.input_tokens, usage.output_tokens, usage.details,
                                 exclusive=(usage.details or {}).get("usageSource") == "pi")
    result = calculate_cost(normalized, pricing)
    return ("complete" if result.amount is not None else "partial" if normalized.get("usagePresent") else "unknown",
            result.amount, result.currency)


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
            validate_model_protocol(plan.invoke_target, plan.protocol_code)
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
            if user_id is not None:
                from linkresume.modules.identity.dependencies import lock_active_user
                lock_active_user(db, user_id)
            route = db.get(LLMModelRoute, plan.route_id)
            price_revision = store_price(db, route, plan.pricing, update_route=False) if route else None
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
                price_revision_id=price_revision.id if price_revision else None,
                request_started_at=utc_now(), time_basis="explicit_utc",
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
        request_started_at: datetime | None = None,
    ) -> None:
        with self._session_factory() as db:
            row = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
            if row is None:
                return
            row.status = status
            if request_started_at is not None:
                row.request_started_at = request_started_at.astimezone(timezone.utc)
                row.time_basis = "explicit_utc"
            row.request_finished_at = utc_now()
            if usage is not None:
                metering_status, cost, currency = _metering(usage, row.price_snapshot_json)
                row.metering_status = metering_status
                row.input_tokens = usage.input_tokens
                row.output_tokens = usage.output_tokens
                row.usage_json = usage.details
                row.normalized_usage_json = normalize_usage(usage.input_tokens, usage.output_tokens, usage.details,
                    exclusive=(usage.details or {}).get("usageSource") == "pi")
                row.estimated_cost = cost
                row.cost_currency = currency
            if response_model_id is not None:
                row.response_model_id = _bounded_log_identifier(response_model_id, "response_model_id")
            if upstream_request_id is not None:
                row.upstream_request_id = _bounded_log_identifier(upstream_request_id, "upstream_request_id")
            row.error_code = error_code
            row.latency_ms = latency_ms
            record_runtime_cost(db, row)
            db.commit()

    async def _complete_plan(self, plan, runtime, messages):
        if plan.protocol_code != SYSTEM_ONE:
            return await self._gateway.complete(model=plan.invoke_target, messages=tuple(messages),
                api_base=runtime.base_url, api_key=runtime.api_key, protocol_code=plan.protocol_code)
        if plan.use_case == BROWSER_AUTOFILL:
            from linkresume.modules.browser_extension.decisions import native_request, native_decision
            result = None
            try:
                payload = native_request(messages)
                result = await self._gateway.complete(model=plan.invoke_target,
                    messages=(ChatMessage(role="user", content=json.dumps(payload, ensure_ascii=False)),),
                    api_base=runtime.base_url, api_key=runtime.api_key, protocol_code=SYSTEM_ONE)
                return replace(result, content=native_decision(json.loads(result.content)).model_dump_json())
            except (ValueError, KeyError, TypeError) as error:
                raise GatewayError(code="LLM_RESPONSE_INVALID", may_have_reached_provider=True,
                                   usage=result.usage if result else None) from error
        if plan.use_case != ASSISTANT_INTENT:
            raise GatewayError(code="LLM_REQUEST_REJECTED", may_have_reached_provider=False)
        from linkresume.modules.agent.systemone_intent import request_for_intent, decision_from_answers, IntentDecisionError
        result = None
        try:
            payload, refs = request_for_intent(messages)
            result = await self._gateway.complete(model=plan.invoke_target,
                messages=(ChatMessage(role="user", content=json.dumps(payload, ensure_ascii=False)),),
                api_base=runtime.base_url, api_key=runtime.api_key, protocol_code=SYSTEM_ONE)
            decision = decision_from_answers(json.loads(result.content), refs)
            return replace(result, content=decision.model_dump_json())
        except IntentDecisionError as error:
            raise GatewayError(code=error.code, may_have_reached_provider=True,
                               usage=result.usage if result is not None else None,
                               decision_detail=error.detail) from error
        except (ValueError, KeyError, TypeError, StopIteration) as error:
            raise GatewayError(code="LLM_RESPONSE_INVALID", may_have_reached_provider=True,
                               usage=result.usage if result is not None else None) from error

    async def chat(
        self,
        user_id: int,
        messages: Sequence[ChatMessage],
        *,
        source: str,
        use_case: str = JOB_TEXT_EXTRACTION,
        agent_run_id: int | None = None,
    ) -> ChatResult:
        if not messages or not SOURCE_PATTERN.fullmatch(source):
            raise ValueError("invalid LLM request")
        plans = await self._db(self._resolve_candidates_sync, use_case)
        if not plans:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED")
        last_error: LLMError | None = None
        for plan in plans:
            if plan.protocol_code not in {OPENAI_CHAT, OPENAI_RESPONSES, SYSTEM_ONE}:
                continue
            try:
                runtime = self.runtime_model_for_plan(plan)
            except LLMError:
                continue
            call_id = create_call_id()
            started = perf_counter()
            await self._db(self._start_log_sync, plan, call_id=call_id, source=source, user_id=user_id, agent_run_id=agent_run_id)
            try:
                result = await self._complete_plan(plan, runtime, messages)
            except GatewayError as error:
                await self._db(
                    self._finish_log_sync, call_id, status="failed", usage=error.usage,
                    error_code=error.code, latency_ms=round((perf_counter() - started) * 1000),
                )
                last_error = LLMError(error.code, call_id, error.decision_detail)
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
        agent_run_id: int | None = None,
    ) -> StructuredChatResult[StructuredValue]:
        result = await self.chat(
            user_id, _structured_messages(messages, response_model),
            source=source, use_case=use_case,
            agent_run_id=agent_run_id,
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
            binding = get_use_case_route(db, use_case, route_id)
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
                pricing=route_pricing(route),
                selection_source="probe",
            )
            fingerprint = validation_fingerprint(binding, route, connection)
        runtime = None if use_case in SPEECH_USE_CASES else self.runtime_model_for_plan(plan)
        call_id = create_call_id()
        await self._db(self._start_log_sync, plan, call_id=call_id, source="capability_probe", user_id=user_id)
        probe_started_at = None
        try:
            if use_case in SPEECH_USE_CASES:
                speech_details = await self._probe_speech(plan, call_id)
                result = GatewayResult(content="OK", usage=GatewayUsage(None, None, speech_details),
                                       upstream_request_id=speech_details.pop("upstreamRequestId", None))
            elif use_case == ASSISTANT_CONVERSATION:
                if pi_probe is None:
                    raise LLMError("LLM_PI_AGENT_UNAVAILABLE", call_id)
                usage = await pi_probe.run_probe(runtime, runtime.api_key)
                probe_calls = (usage.details or {}).get("calls")
                if isinstance(probe_calls, list) and 1 <= len(probe_calls) <= 20:
                    for index, entry in enumerate(probe_calls):
                        started_at = datetime.fromisoformat(entry["requestStartedAt"])
                        call_usage = GatewayUsage(entry.get("inputTokens"), entry.get("outputTokens"), {
                            "cacheRead": entry.get("cacheRead"), "cacheWrite": entry.get("cacheWrite"),
                            "usageSource": "pi", "usagePresent": entry.get("usagePresent", False)})
                        if index == 0:
                            usage, probe_started_at = call_usage, started_at
                        else:
                            extra_id = create_call_id()
                            await self._db(self._start_log_sync, plan, call_id=extra_id, source="capability_probe", user_id=user_id)
                            await self._db(self._finish_log_sync, extra_id, status="succeeded", usage=call_usage, request_started_at=started_at)
                result = GatewayResult(content="OK", usage=usage)
            else:
                if plan.protocol_code not in {OPENAI_CHAT, OPENAI_RESPONSES, SYSTEM_ONE}:
                    raise LLMError("LLM_MODEL_UNAVAILABLE", call_id)
                prompt = ('Reply only with this JSON: {"ok":true}'
                          if use_case == RESUME_STRUCTURING else "Reply with OK.")
                message = ChatMessage(role="user", content=prompt)
                if use_case == JOB_IMAGE_EXTRACTION:
                    message = ChatMessage(role="user", content=[
                        {"type": "text", "text": "Read this image and reply OK."},
                        {"type": "image_url", "image_url": {"url": VISION_PROBE_IMAGE_DATA_URL}},
                    ])
                messages = (message,)
                if use_case == ASSISTANT_INTENT:
                    from linkresume.modules.agent.intent_schemas import IntentDecision, intent_probe_messages
                    messages = _structured_messages(intent_probe_messages(), IntentDecision)
                if use_case == BROWSER_AUTOFILL:
                    from linkresume.modules.browser_extension.decisions import probe_messages
                    from linkresume.modules.browser_extension.schemas import FieldDecision
                    messages = _structured_messages(probe_messages(), FieldDecision)
                result = await self._complete_plan(plan, runtime, messages)
                if use_case == BROWSER_AUTOFILL:
                    from linkresume.modules.browser_extension.decisions import validate_probe
                    try:
                        validate_probe(_validate_structured_content(result.content, FieldDecision))
                    except ValueError as error:
                        raise LLMError("LLM_RESPONSE_INVALID", call_id) from error
                if use_case == ASSISTANT_INTENT:
                    from linkresume.modules.agent.intent_schemas import validate_intent_probe
                    try:
                        validate_intent_probe(_validate_structured_content(result.content, IntentDecision))
                    except ValueError as error:
                        raise LLMError("LLM_RESPONSE_INVALID", call_id) from error
                if use_case == RESUME_STRUCTURING:
                    try:
                        valid = json.loads(result.content).get("ok") is True
                    except (ValueError, AttributeError):
                        valid = False
                    if not valid:
                        raise LLMError("LLM_RESPONSE_INVALID", call_id)
            await self._db(self._finish_log_sync, call_id, status="succeeded", usage=result.usage, request_started_at=probe_started_at,
                           upstream_request_id=result.upstream_request_id, response_model_id=result.response_model_id)
        except BaseException as error:
            code = getattr(error, "code", "LLM_CONNECTION_FAILED")
            await asyncio.shield(self._db(self._finish_log_sync, call_id,
                                          status="cancelled" if isinstance(error, asyncio.CancelledError) else "failed",
                                          error_code=code, usage=getattr(error, "usage", None)))
            if isinstance(error, asyncio.CancelledError):
                raise
            raise LLMError(code, call_id, getattr(error, 'decision_detail', None)) from error
        with self._session_factory() as db:
            current = get_use_case_route(db, use_case, route_id)
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
        upstream_request_id: str | None = None,
    ) -> None:
        """Speech calls record audio seconds or characters, never content."""
        status = "cancelled" if cancelled else ("failed" if error_code else "succeeded")
        safe_details = dict(details or {})
        if "audio_seconds" in safe_details:
            safe_details["audioSeconds"] = safe_details.pop("audio_seconds")
        await asyncio.shield(self._db(
            self._finish_log_sync, call_id, status=status,
            usage=GatewayUsage(input_tokens=None, output_tokens=None, details=safe_details),
            upstream_request_id=upstream_request_id,
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
        await self.finish_speech_call(call_id, started=started, details=getattr(audio, "usage", None) or {"characters": len(text)},
                                      upstream_request_id=getattr(audio, "request_id", None))
        return audio

    async def _probe_speech(self, plan: RoutePlan, call_id: str) -> dict:
        target = self.speech_target_for_plan(plan)
        try:
            if plan.use_case == TEXT_TO_SPEECH:
                audio = await self._speech_gateway.synthesize(target, "你好。", voice=None)
                return {"characters": len("你好。"), "usageSource": "measured_characters", "upstreamRequestId": getattr(audio, "request_id", None)}

            async def probe_audio():
                yield _speech_probe_pcm(plan.protocol_code)

            recognized = False
            request_id = None
            async for event in self._speech_gateway.recognize(target, probe_audio(), hotwords=[], language="zh"):
                recognized = recognized or (event.final and bool(event.text.strip()))
                request_id = event.request_id or request_id
            if plan.protocol_code == OPENAI_ASR_FILE and not recognized:
                raise LLMError("LLM_RESPONSE_INVALID", call_id)
            return {"audioSeconds": len(_speech_probe_pcm(plan.protocol_code)) / (SAMPLE_RATE * 2), "usageSource": "measured_audio", "upstreamRequestId": request_id}
        except SpeechProviderError as error:
            raise LLMError("LLM_CONNECTION_FAILED", call_id) from error
