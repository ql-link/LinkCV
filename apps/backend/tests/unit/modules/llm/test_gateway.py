import asyncio
import traceback
from types import SimpleNamespace

import litellm

from linkcv.modules.llm.gateway import (
    GatewayError,
    LiteLLMGateway,
    _gateway_error,
)
from linkcv.modules.llm.schemas import ChatMessage


def test_rate_limit_is_switchable_without_ambiguous_usage() -> None:
    mapped = _gateway_error(
        litellm.RateLimitError("limited", "openai", "fictional-model")
    )

    assert mapped.switchable is True
    assert mapped.may_have_reached_provider is False


def test_bad_request_is_not_switchable() -> None:
    mapped = _gateway_error(
        litellm.BadRequestError("invalid", "fictional-model", "openai")
    )

    assert mapped.switchable is False
    assert mapped.may_have_reached_provider is False


def test_internal_server_error_is_switchable_with_ambiguous_usage() -> None:
    mapped = _gateway_error(
        litellm.InternalServerError("failed", "openai", "fictional-model")
    )

    assert mapped.switchable is True
    assert mapped.may_have_reached_provider is True


def test_stream_failure_preserves_received_usage_and_prices(monkeypatch) -> None:
    model = "fictional-provider/stream-model"
    monkeypatch.setitem(
        litellm.model_cost,
        model,
        {
            "input_cost_per_token": 0.0000015,
            "output_cost_per_token": 0.000002,
        },
    )

    async def response():
        yield SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=7, completion_tokens=3),
            choices=[],
        )
        raise litellm.InternalServerError("failed", "openai", model)

    async def fake_completion(**_kwargs):
        return response()

    monkeypatch.setattr(litellm, "acompletion", fake_completion)

    async def consume() -> GatewayError:
        events = await LiteLLMGateway().start_stream(
            model=model,
            messages=[ChatMessage(role="user", content="虚构请求")],
            api_base=None,
            api_key=None,
        )
        try:
            async for _event in events:
                pass
        except GatewayError as error:
            return error
        raise AssertionError("stream must fail")

    error = asyncio.run(consume())

    assert error.switchable is True
    assert error.may_have_reached_provider is True
    assert error.usage is not None
    assert error.usage.input_tokens == 7
    assert error.usage.output_tokens == 3
    assert str(error.input_price_per_million) == "1.5000000"
    assert str(error.output_price_per_million) == "2.000000"


def test_provider_exception_details_are_removed_from_traceback(monkeypatch) -> None:
    sensitive_detail = "provider-secret-query-and-key"

    async def fake_completion(**_kwargs):
        raise RuntimeError(sensitive_detail)

    monkeypatch.setattr(litellm, "acompletion", fake_completion)

    async def call() -> str:
        try:
            await LiteLLMGateway().complete(
                model="fictional-provider/model",
                messages=[ChatMessage(role="user", content="虚构请求")],
                api_base="https://models.example.invalid",
                api_key="fictional-key",
            )
        except GatewayError as error:
            return "".join(traceback.format_exception(error))
        raise AssertionError("gateway call must fail")

    rendered = asyncio.run(call())

    assert "LLM provider request failed" in rendered
    assert sensitive_detail not in rendered
