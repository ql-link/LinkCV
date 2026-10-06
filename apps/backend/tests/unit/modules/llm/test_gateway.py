import asyncio
import json
import traceback
from types import SimpleNamespace

import litellm
import httpx
import pytest
from openai import AsyncOpenAI
from litellm.llms.openai.openai import OpenAIChatCompletion

from linkresume.modules.llm.gateway import GatewayError, LiteLLMGateway, _gateway_error
from linkresume.modules.llm.schemas import (
    ChatImageContentPart,
    ChatImageUrl,
    ChatMessage,
    ChatTextContentPart,
)


@pytest.mark.parametrize('status,expected', [(200, None), (404, 'LLM_UNAVAILABLE'), (422, 'LLM_REQUEST_REJECTED')])
def test_systemone_uses_native_endpoint_and_typed_payload(monkeypatch, status, expected):
    original_client = httpx.AsyncClient
    captured = []
    def handler(request):
        captured.append(request)
        return httpx.Response(status, json={'answers': {}, 'model': 'jev-1.13', 'id': 'fictional-call',
                                           'usage': {'input_tokens': 14, 'output_tokens': 2}})
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(handler)))
    payload = {'state': '虚构请求', 'questions': {'mode': {'type': 'choice', 'criteria': {'chat': '普通聊天'}}}}
    async def call():
        return await LiteLLMGateway().complete(model='jev-latest', messages=[ChatMessage(role='user', content=json.dumps(payload))],
            api_base='https://aihubmix.com/v1', api_key='fictional-key', protocol_code='system_one')
    if expected:
        with pytest.raises(GatewayError) as error: asyncio.run(call())
        assert error.value.code == expected
    else:
        result = asyncio.run(call())
        assert result.usage.input_tokens == 14 and result.upstream_request_id == 'fictional-call'
    assert str(captured[0].url) == 'https://aihubmix.com/v1/systemone'
    assert json.loads(captured[0].content) == {'model': 'jev-latest', **payload}
    assert 'messages' not in json.loads(captured[0].content)


def test_systemone_cancellation_propagates_without_conversion(monkeypatch):
    original_client = httpx.AsyncClient
    async def handler(request):
        raise asyncio.CancelledError
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: original_client(**kwargs, transport=httpx.MockTransport(handler)))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(LiteLLMGateway().complete(model='jev-latest',
            messages=[ChatMessage(role='user', content='{"state":"test","questions":{}}')],
            api_base='https://aihubmix.com/v1', api_key='fictional-key', protocol_code='system_one'))


@pytest.mark.parametrize('kind,code', [('timeout','LLM_TIMEOUT'), ('malformed','LLM_RESPONSE_INVALID'), ('negative_usage','LLM_RESPONSE_INVALID')])
def test_systemone_refuses_invalid_response_or_timeout(monkeypatch, kind, code):
    original_client = httpx.AsyncClient
    def handler(request):
        if kind == 'timeout': raise httpx.ReadTimeout('fictional timeout',request=request)
        return httpx.Response(200,json={} if kind == 'malformed' else {'answers':{},'usage':{'input_tokens':-1}})
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs: original_client(**kwargs,transport=httpx.MockTransport(handler)))
    with pytest.raises(GatewayError) as error:
        asyncio.run(LiteLLMGateway().complete(model='jev-latest',messages=[ChatMessage(role='user',content='{"state":"fictional","questions":{}}')],
            api_base='https://aihubmix.com/v1',api_key='fictional-key',protocol_code='system_one'))
    assert error.value.code == code


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
    unavailable_channel = _gateway_error(
        litellm.BadRequestError("no_available_channel", "fictional-model", "openai")
    )
    auth = _gateway_error(
        litellm.AuthenticationError("invalid route credential", "fictional-model", "openai")
    )

    assert rate_limit.code == "LLM_UNAVAILABLE"
    assert rate_limit.may_have_reached_provider is True
    assert bad_request.code == "LLM_REQUEST_REJECTED"
    assert bad_request.may_have_reached_provider is True
    assert internal.code == "LLM_UNAVAILABLE"
    assert internal.may_have_reached_provider is True
    assert unavailable_channel.code == "LLM_UNAVAILABLE"
    assert auth.code == "LLM_UNAVAILABLE"


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
            model="fictional-model-id",
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
    assert captured["model"] == "fictional-model-id"
    assert captured["custom_llm_provider"] == "openai"


@pytest.mark.parametrize(("model", "base", "expected"), [
    ("gpt-6-luna", "https://aihubmix.com/v1", {}),
    ("deepseek-v4.1-flash", "https://api.inferera.com/v1", {"thinking": {"type": "disabled"}}),
    ("qwen3.8-flash", "https://api.inferera.com/v1", {"enable_thinking": False}),
    ("deepseek-v4.1-flash", "https://models.example.invalid/v1", {}),
])
def test_non_thinking_option_reaches_real_litellm_openai_wire(monkeypatch, model, base, expected):
    bodies = []
    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "chatcmpl-fixture", "object": "chat.completion", "created": 0, "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4},
        })
    async def run():
        async with AsyncOpenAI(api_key="fictional-key", base_url=base, max_retries=0,
                               http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))) as client:
            monkeypatch.setattr(OpenAIChatCompletion, "_get_openai_client", lambda *args, **kwargs: client)
            return await LiteLLMGateway().complete(
                model=model, messages=[ChatMessage(role="user", content="虚构请求")],
                api_base=base, api_key="fictional-key",
            )
    assert asyncio.run(run()).content == "OK"
    assert len(bodies) == 1
    assert "reasoning_effort" not in bodies[0]
    for field, value in expected.items():
        assert bodies[0][field] == value
    if not expected:
        assert "thinking" not in bodies[0] and "enable_thinking" not in bodies[0]
    assert "extra_body" not in bodies[0]


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
            model="fictional-vision-model",
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


def test_stream_forwards_zero_retries_and_preserves_partial_metering(
    monkeypatch,
) -> None:
    model = "deepseek/stream-model"
    captured: dict[str, object] = {}
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
