from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Protocol

import litellm

from linkcv.modules.llm.schemas import ChatMessage


@dataclass(frozen=True)
class GatewayUsage:
    input_tokens: int | None
    output_tokens: int | None


@dataclass(frozen=True)
class GatewayResult:
    content: str
    usage: GatewayUsage
    input_price_per_million: Decimal | None
    output_price_per_million: Decimal | None


@dataclass(frozen=True)
class GatewayStreamEvent:
    type: Literal["delta", "done"]
    content: str | None = None
    usage: GatewayUsage | None = None
    input_price_per_million: Decimal | None = None
    output_price_per_million: Decimal | None = None


class GatewayError(Exception):
    def __init__(
        self,
        *,
        code: Literal["LLM_UNAVAILABLE", "LLM_REQUEST_REJECTED"],
        may_have_reached_provider: bool,
        usage: GatewayUsage | None = None,
        input_price_per_million: Decimal | None = None,
        output_price_per_million: Decimal | None = None,
    ) -> None:
        super().__init__("LLM provider request failed")
        self.code = code
        self.may_have_reached_provider = may_have_reached_provider
        self.usage = usage
        self.input_price_per_million = input_price_per_million
        self.output_price_per_million = output_price_per_million


class LLMGateway(Protocol):
    async def complete(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
        disable_thinking: bool = False,
    ) -> GatewayResult: ...

    async def start_stream(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
    ) -> AsyncIterator[GatewayStreamEvent]: ...


def _usage(value: object) -> GatewayUsage:
    usage = getattr(value, "usage", None)
    return GatewayUsage(
        input_tokens=getattr(usage, "prompt_tokens", None),
        output_tokens=getattr(usage, "completion_tokens", None),
    )


def _prices(model: str) -> tuple[Decimal | None, Decimal | None]:
    details = litellm.model_cost.get(model)
    if details is None and "/" in model:
        details = litellm.model_cost.get(model.split("/", 1)[1])
    if not details:
        return None, None

    def per_million(name: str) -> Decimal | None:
        value = details.get(name)
        if value is None:
            return None
        return Decimal(str(value)) * Decimal(1_000_000)

    return per_million("input_cost_per_token"), per_million(
        "output_cost_per_token"
    )


def _gateway_error(
    error: Exception,
    *,
    usage: GatewayUsage | None = None,
    input_price_per_million: Decimal | None = None,
    output_price_per_million: Decimal | None = None,
) -> GatewayError:
    details = {
        "usage": usage,
        "input_price_per_million": input_price_per_million,
        "output_price_per_million": output_price_per_million,
    }
    if isinstance(error, (litellm.APIConnectionError, litellm.AuthenticationError)):
        return GatewayError(
            code=(
                "LLM_REQUEST_REJECTED"
                if isinstance(error, litellm.AuthenticationError)
                else "LLM_UNAVAILABLE"
            ),
            may_have_reached_provider=False,
            **details,
        )
    if isinstance(error, litellm.RateLimitError):
        return GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=False,
            **details,
        )
    if isinstance(
        error,
        (
            litellm.Timeout,
            litellm.ServiceUnavailableError,
            litellm.InternalServerError,
        ),
    ):
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
        return GatewayError(
            code="LLM_REQUEST_REJECTED",
            may_have_reached_provider=False,
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
        disable_thinking: bool = False,
    ) -> dict[str, object]:
        request: dict[str, object] = {
            "model": model,
            "messages": [message.model_dump() for message in messages],
            "base_url": api_base,
            "api_key": api_key,
            "timeout": self.timeout_seconds,
            "num_retries": 0,
        }
        if disable_thinking and model.startswith("deepseek/"):
            request["extra_body"] = {"thinking": {"type": "disabled"}}
        return request

    async def complete(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
        disable_thinking: bool = False,
    ) -> GatewayResult:
        try:
            response = await litellm.acompletion(
                **self._request_args(
                    model=model,
                    messages=messages,
                    api_base=api_base,
                    api_key=api_key,
                    disable_thinking=disable_thinking,
                )
            )
            content = response.choices[0].message.content or ""
            input_price, output_price = _prices(model)
            return GatewayResult(
                content=content,
                usage=_usage(response),
                input_price_per_million=input_price,
                output_price_per_million=output_price,
            )
        except Exception as error:
            raise _gateway_error(error) from None

    async def start_stream(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str | None,
        api_key: str | None,
    ) -> AsyncIterator[GatewayStreamEvent]:
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
            input_price, output_price = _prices(model)
            try:
                async for chunk in response:
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
                    input_price_per_million=input_price,
                    output_price_per_million=output_price,
                )
            except Exception as error:
                raise _gateway_error(
                    error,
                    usage=usage,
                    input_price_per_million=input_price,
                    output_price_per_million=output_price,
                ) from None

        return events()
