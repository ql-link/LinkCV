from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
import json
from typing import Literal, Protocol
from urllib.parse import urlsplit

import litellm
import httpx

from linkresume.modules.llm.schemas import ChatMessage
from linkresume.modules.llm.providers import OPENAI_CHAT, OPENAI_RESPONSES, SYSTEM_ONE


@dataclass(frozen=True)
class GatewayUsage:
    input_tokens: int | None
    output_tokens: int | None
    details: dict | None = None


@dataclass(frozen=True)
class GatewayResult:
    content: str
    usage: GatewayUsage
    response_model_id: str | None = None
    upstream_request_id: str | None = None


@dataclass(frozen=True)
class GatewayStreamEvent:
    type: Literal["delta", "done"]
    content: str | None = None
    usage: GatewayUsage | None = None
    response_model_id: str | None = None
    upstream_request_id: str | None = None


class GatewayError(Exception):
    def __init__(
        self,
        *,
        code: Literal["LLM_UNAVAILABLE", "LLM_REQUEST_REJECTED", "LLM_TIMEOUT", "LLM_RESPONSE_INVALID"],
        may_have_reached_provider: bool,
        usage: GatewayUsage | None = None,
    ) -> None:
        super().__init__("LLM provider request failed")
        self.code = code
        self.may_have_reached_provider = may_have_reached_provider
        self.usage = usage


class LLMGateway(Protocol):
    async def complete(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
        protocol_code: str = OPENAI_CHAT,
    ) -> GatewayResult: ...

    async def start_stream(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
        protocol_code: str = OPENAI_CHAT,
    ) -> AsyncIterator[GatewayStreamEvent]: ...


def _usage(value: object) -> GatewayUsage:
    return _normalized_gateway_usage(_field(value, "usage"), responses=False)


def _responses_usage(value: object) -> GatewayUsage:
    return _normalized_gateway_usage(_field(value, "usage"), responses=True)


def _normalized_gateway_usage(usage: object, *, responses: bool) -> GatewayUsage:
    prompt = _field(usage, "input_tokens" if responses else "prompt_tokens")
    output = _field(usage, "output_tokens" if responses else "completion_tokens")
    inputs = _field(usage, "input_tokens_details" if responses else "prompt_tokens_details")
    outputs = _field(usage, "output_tokens_details" if responses else "completion_tokens_details")
    read = _field(inputs, "cached_tokens", _field(usage, "cache_read_input_tokens",
        _field(usage, "prompt_cache_hit_tokens", _field(usage, "cached_tokens"))))
    write = _field(usage, "cache_creation_input_tokens", _field(inputs, "cache_write_tokens", 0))
    return GatewayUsage(input_tokens=prompt, output_tokens=output, details={
        "usagePresent": usage is not None and prompt is not None and output is not None,
        "usageSource": "provider", "cacheRead": read, "cacheWrite": write,
        "cacheWrite1h": _field(_field(usage, "cache_creation"), "ephemeral_1h_input_tokens"),
        "reasoning": _field(outputs, "reasoning_tokens"),
    })


def _responses_input(messages: Sequence[ChatMessage]) -> list[dict]:
    result = []
    for message in messages:
        content = message.model_dump()["content"]
        if isinstance(content, list):
            content = [
                {"type": "input_text", "text": part["text"]} if part["type"] == "text" else
                {"type": "input_image", "image_url": part["image_url"]["url"], "detail": part["image_url"].get("detail", "auto")}
                for part in content
            ]
        result.append({"role": message.role, "content": content})
    return result


def _field(value, name, default=None):
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


def _gateway_error(
    error: Exception,
    *,
    usage: GatewayUsage | None = None,
) -> GatewayError:
    details = {
        "usage": usage,
    }
    if isinstance(error, (litellm.APIConnectionError, litellm.AuthenticationError)):
        return GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=True,
            **details,
        )
    if isinstance(error, litellm.RateLimitError):
        return GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=True,
            **details,
        )
    if isinstance(error, litellm.Timeout):
        return GatewayError(
            code="LLM_TIMEOUT",
            may_have_reached_provider=True,
            **details,
        )
    if isinstance(error, (litellm.ServiceUnavailableError, litellm.InternalServerError)):
        return GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=True,
            **details,
        )
    if isinstance(
        error,
        (
            litellm.BadRequestError,
            litellm.ContextWindowExceededError,
            litellm.ContentPolicyViolationError,
        ),
    ):
        # Some compatible gateways report an unavailable channel as HTTP 400.
        unavailable_channel = "no_available_channel" in str(error).lower()
        return GatewayError(
            code="LLM_UNAVAILABLE" if unavailable_channel else "LLM_REQUEST_REJECTED",
            may_have_reached_provider=True,
            **details,
        )
    return GatewayError(
        code="LLM_UNAVAILABLE",
        may_have_reached_provider=True,
        **details,
    )


class LiteLLMGateway:
    def __init__(self, timeout_seconds: float = 60.0) -> None:
        self.timeout_seconds = timeout_seconds

    async def _system_one(self, *, model, messages, api_base, api_key):
        # The service supplies a server-controlled provider address and typed questions.
        if api_base not in {"https://aihubmix.com/v1", "https://api.inferera.com/v1"}:
            raise GatewayError(code="LLM_REQUEST_REJECTED", may_have_reached_provider=False)
        payload = json.loads(messages[-1].content)
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=False) as client:
                response = await client.post(api_base + "/systemone", headers={"Authorization": f"Bearer {api_key}"},
                                             json={"model": model, "state": payload["state"], "questions": payload["questions"]})
            if response.is_error:
                code = "LLM_REQUEST_REJECTED" if response.status_code in {400, 422} else "LLM_UNAVAILABLE"
                raise GatewayError(code=code, may_have_reached_provider=True)
            value = response.json()
            if not isinstance(value, dict) or not isinstance(value.get("answers"), dict):
                raise ValueError("missing decisions")
            usage = value.get("usage") or {}
            tokens = [usage.get(key) for key in ("input_tokens", "output_tokens")]
            if any(token is not None and (type(token) is not int or token < 0) for token in tokens):
                raise ValueError("invalid usage")
            return GatewayResult(content=json.dumps(value), usage=GatewayUsage(*tokens),
                                 response_model_id=value.get("model"), upstream_request_id=value.get("id"))
        except httpx.TimeoutException as error:
            raise GatewayError(code="LLM_TIMEOUT", may_have_reached_provider=True) from error
        except httpx.RequestError as error:
            raise GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True) from error
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            raise GatewayError(code="LLM_RESPONSE_INVALID", may_have_reached_provider=True) from error

    def _request_args(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
    ) -> dict[str, object]:
        request: dict[str, object] = {
            "model": model,
            "custom_llm_provider": "openai",
            "messages": [message.model_dump() for message in messages],
            "base_url": api_base,
            "api_key": api_key,
            "timeout": self.timeout_seconds,
            "num_retries": 0,
        }
        if api_base and urlsplit(api_base).hostname in {"aihubmix.com", "api.inferera.com"}:
            if model == "deepseek-v4.1-flash":
                request["extra_body"] = {"thinking": {"type": "disabled"}}
            elif model == "qwen3.8-flash":
                request["extra_body"] = {"enable_thinking": False}
        return request

    def _responses_args(self, *, model, messages, api_base, api_key) -> dict:
        request = {
            "model": model, "input": _responses_input(messages), "custom_llm_provider": "openai",
            "api_base": api_base, "api_key": api_key, "timeout": self.timeout_seconds,
            "num_retries": 0, "store": False,
        }
        if api_base and urlsplit(api_base).hostname in {"aihubmix.com", "api.inferera.com"} and model == "gpt-6-luna":
            request["reasoning"] = {"effort": "none"}
        return request

    async def complete(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
        protocol_code: str = OPENAI_CHAT,
    ) -> GatewayResult:
        try:
            if protocol_code == SYSTEM_ONE:
                return await self._system_one(model=model, messages=messages, api_base=api_base, api_key=api_key)
            if protocol_code == OPENAI_RESPONSES:
                response = await litellm.aresponses(**self._responses_args(
                    model=model, messages=messages, api_base=api_base, api_key=api_key,
                ))
                if response.status != "completed":
                    raise GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True, usage=_responses_usage(response))
                content = "".join(
                    _field(part, "text", "") for item in response.output if _field(item, "type") == "message"
                    for part in _field(item, "content", []) if _field(part, "type") == "output_text"
                )
                return GatewayResult(content=content, usage=_responses_usage(response), response_model_id=response.model,
                                     upstream_request_id=response.id)
            response = await litellm.acompletion(
                **self._request_args(
                    model=model,
                    messages=messages,
                    api_base=api_base,
                    api_key=api_key,
                )
            )
            content = response.choices[0].message.content or ""
            return GatewayResult(
                content=content,
                usage=_usage(response),
                response_model_id=getattr(response, "model", None),
                upstream_request_id=getattr(response, "id", None),
            )
        except GatewayError:
            raise
        except Exception as error:
            raise _gateway_error(error) from None

    async def start_stream(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
        protocol_code: str = OPENAI_CHAT,
    ) -> AsyncIterator[GatewayStreamEvent]:
        if protocol_code == OPENAI_RESPONSES:
            return await self._start_responses_stream(model=model, messages=messages, api_base=api_base, api_key=api_key)
        try:
            response = await litellm.acompletion(
                **self._request_args(
                    model=model,
                    messages=messages,
                    api_base=api_base,
                    api_key=api_key,
                ),
                stream=True,
                stream_options={"include_usage": True},
            )
        except Exception as error:
            raise _gateway_error(error) from None

        async def events() -> AsyncIterator[GatewayStreamEvent]:
            usage = GatewayUsage(None, None)
            response_model_id: str | None = None
            upstream_request_id: str | None = None
            try:
                async for chunk in response:
                    response_model_id = getattr(chunk, "model", None) or response_model_id
                    upstream_request_id = getattr(chunk, "id", None) or upstream_request_id
                    chunk_usage = _usage(chunk)
                    if (
                        chunk_usage.input_tokens is not None
                        or chunk_usage.output_tokens is not None
                    ):
                        usage = chunk_usage
                    choices = getattr(chunk, "choices", [])
                    if choices:
                        content = getattr(choices[0].delta, "content", None)
                        if content:
                            yield GatewayStreamEvent(type="delta", content=content)
                yield GatewayStreamEvent(
                    type="done",
                    usage=usage,
                    response_model_id=response_model_id,
                    upstream_request_id=upstream_request_id,
                )
            except Exception as error:
                raise _gateway_error(
                    error,
                    usage=usage,
                ) from None

        return events()

    async def _start_responses_stream(self, *, model, messages, api_base, api_key):
        try:
            response = await litellm.aresponses(
                **self._responses_args(model=model, messages=messages, api_base=api_base, api_key=api_key), stream=True,
            )
        except Exception as error:
            raise _gateway_error(error) from None

        async def events():
            usage = GatewayUsage(None, None)
            try:
                async for event in response:
                    if event.type == "response.output_text.delta" and event.delta:
                        yield GatewayStreamEvent(type="delta", content=event.delta)
                    elif event.type == "response.completed":
                        value = event.response
                        usage = _responses_usage(value)
                        if value.status != "completed":
                            break
                        yield GatewayStreamEvent(type="done", usage=usage, response_model_id=value.model, upstream_request_id=value.id)
                        return
                    elif event.type in {"response.failed", "response.incomplete", "error"}:
                        value = getattr(event, "response", None)
                        usage = _responses_usage(value)
                        break
            except Exception as error:
                raise _gateway_error(error, usage=usage) from None
            finally:
                raw_response = getattr(response, "response", None)
                if raw_response is not None:
                    await raw_response.aclose()
            raise GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True, usage=usage)

        return events()
