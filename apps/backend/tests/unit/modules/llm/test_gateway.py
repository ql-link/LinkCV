import asyncio
import traceback
from types import SimpleNamespace

import litellm

from linkcv.modules.llm.gateway import GatewayError, LiteLLMGateway, _gateway_error
from linkcv.modules.llm.schemas import (
    ChatImageContentPart,
    ChatImageUrl,
    ChatMessage,
    ChatTextContentPart,
)


def test_provider_errors_map_without_retry_or_switch_semantics() -> None:
    rate_limit = _gateway_error(
        litellm.RateLimitError("limited", "openai", "fictional-model")
    )
    bad_request = _gateway_error(
        litellm.BadRequestError("invalid", "fictional-model", "openai")
    )
    internal = _gateway_error(
        litellm.InternalServerError("failed", "openai", "fictional-model")
    )

    assert rate_limit.code == "LLM_UNAVAILABLE"
    assert rate_limit.may_have_reached_provider is False
    assert bad_request.code == "LLM_REQUEST_REJECTED"
    assert bad_request.may_have_reached_provider is False
    assert internal.code == "LLM_UNAVAILABLE"
    assert internal.may_have_reached_provider is True


def test_timeout_has_a_stable_error_code() -> None:
    error = _gateway_error(litellm.Timeout("timed out", "fictional-model", "openai"))

    assert error.code == "LLM_TIMEOUT"
    assert error.may_have_reached_provider is True


def test_complete_forwards_zero_retries_and_timeout_without_provider_schema(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"answer":"ok"}'))],
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
        )

    monkeypatch.setattr(litellm, "acompletion", fake_completion)

    result = asyncio.run(
        LiteLLMGateway(timeout_seconds=12.5).complete(
            model="deepseek/fictional-model",
            messages=[ChatMessage(role="user", content="结构化请求")],
            api_base="https://models.example.invalid",
            api_key="fictional-key",
        )
    )

    assert result.content == '{"answer":"ok"}'
    assert "response_format" not in captured
    assert "extra_body" not in captured
    assert captured["timeout"] == 12.5
    assert captured["num_retries"] == 0


def test_complete_forwards_multimodal_message_parts(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"color":"red"}'))],
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
        )

    monkeypatch.setattr(litellm, "acompletion", fake_completion)
    message = ChatMessage(
        role="user",
        content=[
            ChatTextContentPart(text="识别图片"),
            ChatImageContentPart(
                image_url=ChatImageUrl(url="data:image/png;base64,fictional")
            ),
        ],
    )

    asyncio.run(
        LiteLLMGateway().complete(
            model="openai/fictional-vision-model",
            messages=[message],
            api_base=None,
            api_key="fictional-key",
        )
    )

    assert captured["messages"] == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "识别图片"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,fictional",
                        "detail": "auto",
                    },
                },
            ],
        }
    ]


def test_complete_disables_thinking_only_for_deepseek_when_requested(
    monkeypatch,
) -> None:
    captured: list[dict[str, object]] = []

    async def fake_completion(**kwargs):
        captured.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"answer":"ok"}'))],
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
        )

    monkeypatch.setattr(litellm, "acompletion", fake_completion)
    gateway = LiteLLMGateway()

    async def call() -> None:
        for model in ("deepseek/deepseek-v4-flash", "dashscope/qwen-plus"):
            await gateway.complete(
                model=model,
                messages=[ChatMessage(role="user", content="结构化请求")],
                api_base=None,
                api_key="fictional-key",
                disable_thinking=True,
            )

    asyncio.run(call())

    assert captured[0]["extra_body"] == {"thinking": {"type": "disabled"}}
    assert "extra_body" not in captured[1]


def test_stream_forwards_zero_retries_and_preserves_partial_metering(
    monkeypatch,
) -> None:
    model = "deepseek/stream-model"
    captured: dict[str, object] = {}
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
        raise litellm.InternalServerError("failed", "deepseek", model)

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return response()

    monkeypatch.setattr(litellm, "acompletion", fake_completion)

    async def consume() -> GatewayError:
        events = await LiteLLMGateway().start_stream(
            model=model,
            messages=[ChatMessage(role="user", content="虚构请求")],
            api_base=None,
            api_key="fictional-key",
        )
        try:
            async for _event in events:
                pass
        except GatewayError as error:
            return error
        raise AssertionError("stream must fail")

    error = asyncio.run(consume())

    assert captured["num_retries"] == 0
    assert error.code == "LLM_UNAVAILABLE"
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
                model="deepseek/fictional-model",
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
