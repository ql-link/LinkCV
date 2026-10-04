from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib.parse import urlsplit

import litellm

from linkresume.modules.llm.schemas import ChatMessage
from linkresume.modules.llm.providers import OPENAI_CHAT, OPENAI_RESPONSES


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
        code: Literal["LLM_UNAVAILABLE", "LLM_REQUEST_REJECTED", "LLM_TIMEOUT"],
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
    usage = getattr(value, "usage", None)
    return GatewayUsage(
        input_tokens=getattr(usage, "prompt_tokens", None),
        output_tokens=getattr(usage, "completion_tokens", None),
        details=None,
    )


def _responses_usage(value: object) -> GatewayUsage:
    usage = getattr(value, "usage", None)
    return GatewayUsage(
        input_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        details=None,
    )


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
