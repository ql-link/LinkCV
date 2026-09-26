import asyncio
import json
import traceback

import httpx
import pytest

from linkresume.modules.llm.gateway import (
    GatewayError,
    OpenAIChatGateway,
    _gateway_error,
)
from linkresume.modules.llm.schemas import (
    ChatImageContentPart,
    ChatImageUrl,
    ChatMessage,
    ChatTextContentPart,
)

BASE_URL = "https://gateway.example.invalid/v1"
CHAT_URL = f"{BASE_URL}/chat/completions"


def _gateway(handler) -> OpenAIChatGateway:
    return OpenAIChatGateway(transport=httpx.MockTransport(handler))


def _json_response(payload: object, status_code: int = 200) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


def _completion(content: str = '{"answer":"ok"}', **usage) -> dict[str, object]:
    return {
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens", 3),
            "completion_tokens": usage.get("completion_tokens", 2),
        },
    }


def test_provider_errors_map_without_retry_or_switch_semantics() -> None:
    request = httpx.Request("POST", CHAT_URL)

    rate_limit = _gateway_error(
        httpx.HTTPStatusError(
            "limited", request=request, response=httpx.Response(429)
        )
    )
    bad_request = _gateway_error(
        httpx.HTTPStatusError(
            "invalid", request=request, response=httpx.Response(400)
        )
    )
    internal = _gateway_error(
        httpx.HTTPStatusError(
            "failed", request=request, response=httpx.Response(503)
        )
    )
    unreachable = _gateway_error(httpx.ConnectError("refused"))

    assert rate_limit.code == "LLM_UNAVAILABLE"
    assert rate_limit.may_have_reached_provider is False
    assert bad_request.code == "LLM_REQUEST_REJECTED"
    assert bad_request.may_have_reached_provider is False
    assert internal.code == "LLM_UNAVAILABLE"
    assert internal.may_have_reached_provider is True
    assert unreachable.code == "LLM_UNAVAILABLE"
    assert unreachable.may_have_reached_provider is False


def test_timeout_has_a_stable_error_code() -> None:
    read_timeout = _gateway_error(httpx.ReadTimeout("timed out"))
    connect_timeout = _gateway_error(httpx.ConnectTimeout("timed out"))

    assert read_timeout.code == "LLM_TIMEOUT"
    assert read_timeout.may_have_reached_provider is True
    # A connect timeout never left our side.
    assert connect_timeout.code == "LLM_UNAVAILABLE"
    assert connect_timeout.may_have_reached_provider is False


def test_complete_posts_openai_chat_completions_without_schema_extras() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        captured["body"] = json.loads(request.content)
        captured["headers"] = dict(request.headers)
        return _json_response(_completion())

    result = asyncio.run(
        _gateway(handler).complete(
            model="z-ai/glm-4.6",
            messages=[ChatMessage(role="user", content="结构化请求")],
            api_base=BASE_URL,
            api_key="fictional-key",
        )
    )

    request = captured["request"]
    assert isinstance(request, httpx.Request)
    assert request.method == "POST"
    assert str(request.url) == CHAT_URL
    headers = captured["headers"]
    assert headers["authorization"] == "Bearer fictional-key"
    body = captured["body"]
    assert body == {
        "model": "z-ai/glm-4.6",
        "messages": [{"role": "user", "content": "结构化请求"}],
    }
    assert "response_format" not in body
    assert "stream" not in body
    assert result.content == '{"answer":"ok"}'
    assert result.usage.input_tokens == 3
    assert result.usage.output_tokens == 2


def test_complete_tolerates_missing_usage() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _json_response({"choices": [{"message": {"content": "OK"}}]})

    result = asyncio.run(
        _gateway(handler).complete(
            model="z-ai/glm-4.6",
            messages=[ChatMessage(role="user", content="虚构请求")],
            api_base=BASE_URL,
            api_key="fictional-key",
        )
    )

    assert result.usage.input_tokens is None
    assert result.usage.output_tokens is None


def test_complete_forwards_multimodal_message_parts() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return _json_response(_completion('{"color":"red"}'))

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
        _gateway(handler).complete(
            model="openai/fictional-vision-model",
            messages=[message],
            api_base=BASE_URL,
            api_key="fictional-key",
        )
    )

    body = captured["body"]
    assert body["messages"] == [
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


def test_stream_requests_usage_and_yields_deltas_then_done() -> None:
    captured: dict[str, object] = {}
    frames = [
        'data: {"choices":[{"delta":{"content":"你"}}]}',
        'data: {"choices":[{"delta":{"content":"好"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}',
        "data: [DONE]",
    ]
    body = "\n\n".join(frames).encode("utf-8") + b"\n\n"

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, content=body)

    async def collect():
        events = await _gateway(handler).start_stream(
            model="z-ai/glm-4.6",
            messages=[ChatMessage(role="user", content="虚构请求")],
            api_base=BASE_URL,
            api_key="fictional-key",
        )
        return [event async for event in events]

    events = asyncio.run(collect())

    assert captured["body"]["stream"] is True
    assert captured["body"]["stream_options"] == {"include_usage": True}
    assert [event.content for event in events if event.type == "delta"] == ["你", "好"]
    assert events[-1].type == "done"
    assert events[-1].usage.input_tokens == 7
    assert events[-1].usage.output_tokens == 3


def test_stream_preserves_partial_metering_when_the_connection_drops() -> None:
    async def body():
        yield b'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n'
        raise httpx.ReadError("connection dropped")

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body())

    async def consume() -> GatewayError:
        events = await _gateway(handler).start_stream(
            model="z-ai/glm-4.6",
            messages=[ChatMessage(role="user", content="虚构请求")],
            api_base=BASE_URL,
            api_key="fictional-key",
        )
        try:
            async for _event in events:
                pass
        except GatewayError as error:
            return error
        raise AssertionError("stream must fail")

    error = asyncio.run(consume())

    assert error.code == "LLM_UNAVAILABLE"
    assert error.may_have_reached_provider is True
    assert error.usage is not None
    assert error.usage.input_tokens == 7
    assert error.usage.output_tokens == 3


def test_provider_exception_details_are_removed_from_traceback() -> None:
    sensitive_detail = "provider-secret-query-and-key"

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(sensitive_detail)

    async def call() -> str:
        try:
            await _gateway(handler).complete(
                model="z-ai/glm-4.6",
                messages=[ChatMessage(role="user", content="虚构请求")],
                api_base=BASE_URL,
                api_key="fictional-key",
            )
        except GatewayError as error:
            return "".join(traceback.format_exception(error))
        raise AssertionError("gateway call must fail")

    rendered = asyncio.run(call())

    assert "LLM provider request failed" in rendered
    assert sensitive_detail not in rendered


def test_status_error_details_are_removed_from_traceback() -> None:
    sensitive_detail = "provider-secret-in-response-body"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, content=sensitive_detail.encode("utf-8"))

    async def call() -> str:
        try:
            await _gateway(handler).complete(
                model="z-ai/glm-4.6",
                messages=[ChatMessage(role="user", content="虚构请求")],
                api_base=BASE_URL,
                api_key="fictional-key",
            )
        except GatewayError as error:
            return "".join(traceback.format_exception(error))
        raise AssertionError("gateway call must fail")

    rendered = asyncio.run(call())

    assert "LLM provider request failed" in rendered
    assert sensitive_detail not in rendered


@pytest.mark.parametrize(
    ("status", "code", "reached"),
    [
        (401, "LLM_REQUEST_REJECTED", False),
        (403, "LLM_REQUEST_REJECTED", False),
        (404, "LLM_REQUEST_REJECTED", False),
        (422, "LLM_REQUEST_REJECTED", False),
        (408, "LLM_TIMEOUT", True),
        (429, "LLM_UNAVAILABLE", False),
        (500, "LLM_UNAVAILABLE", True),
        (502, "LLM_UNAVAILABLE", True),
    ],
)
def test_complete_maps_every_status_class(status: int, code: str, reached: bool) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status)

    with pytest.raises(GatewayError) as caught:
        asyncio.run(
            _gateway(handler).complete(
                model="z-ai/glm-4.6",
                messages=[ChatMessage(role="user", content="虚构请求")],
                api_base=BASE_URL,
                api_key="fictional-key",
            )
        )

    assert caught.value.code == code
    assert caught.value.may_have_reached_provider is reached
