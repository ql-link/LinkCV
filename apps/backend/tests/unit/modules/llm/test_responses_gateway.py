import asyncio
import json
from types import SimpleNamespace

import httpx
import litellm
import pytest
from litellm.llms.custom_httpx import llm_http_handler
from litellm.llms.custom_httpx.http_handler import AsyncHTTPHandler

from drawoffer.modules.llm.gateway import GatewayError, LiteLLMGateway
from drawoffer.modules.llm.schemas import ChatMessage


def response_payload(status="completed"):
    return {
        "id": "resp_fixture", "created_at": 0, "object": "response", "model": "gpt-6-luna", "status": status,
        "output": [{"type": "message", "id": "msg_fixture", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": "OK", "annotations": []}]}],
        "parallel_tool_calls": False, "tool_choice": "auto", "tools": [], "top_p": 1,
        "usage": {"input_tokens": 3, "output_tokens": 1, "total_tokens": 4, "output_tokens_details": {"reasoning_tokens": 0}},
    }


def run_wire(monkeypatch, handler, *, stream=False):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            monkeypatch.setattr(AsyncHTTPHandler, "create_client", lambda *args, **kwargs: client)
            sdk_client = AsyncHTTPHandler(timeout=12.5)
            monkeypatch.setattr(llm_http_handler, "get_async_httpx_client", lambda *args, **kwargs: sdk_client)
            args = dict(model="gpt-6-luna", api_base="https://api.inferera.com/v1", api_key="fictional-key",
                        protocol_code="openai_responses", messages=[ChatMessage(role="user", content=[
                            {"type": "text", "text": "虚构截图"},
                            {"type": "image_url", "image_url": {"url": "data:image/png;base64,fictional", "detail": "auto"}},
                        ])])
            gateway = LiteLLMGateway(timeout_seconds=12.5)
            if stream:
                return [event async for event in await gateway.start_stream(**args)]
            return await gateway.complete(**args)
    return asyncio.run(run())


def test_responses_native_wire_uses_correct_image_parts_no_storage_and_no_reasoning(monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.path == "/v1/responses"
        body = json.loads(request.content)
        assert body["reasoning"] == {"effort": "none"} and body["store"] is False
        assert body["input"][0]["content"] == [
            {"type": "input_text", "text": "虚构截图"},
            {"type": "input_image", "image_url": "data:image/png;base64,fictional", "detail": "auto"},
        ]
        return httpx.Response(200, json=response_payload())
    result = run_wire(monkeypatch, handler)
    assert result.content == "OK" and result.usage.input_tokens == 3 and result.usage.output_tokens == 1
    assert len(calls) == 1


def test_responses_native_stream_emits_text_and_final_metering(monkeypatch):
    # This test targets native SSE; do not let a mutable LiteLLM model catalog
    # choose fake streaming for a model missing from the local metadata cache.
    monkeypatch.setattr(litellm.utils, "supports_native_streaming", lambda *args, **kwargs: True)
    def handler(request):
        assert json.loads(request.content)["stream"] is True
        events = [
            {"type": "response.output_text.delta", "delta": "OK", "sequence_number": 0, "item_id": "msg_fixture", "output_index": 0, "content_index": 0, "logprobs": []},
            {"type": "response.completed", "response": response_payload(), "sequence_number": 1},
        ]
        data = "".join("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n" for event in events)
        return httpx.Response(200, content=data, headers={"content-type": "text/event-stream"})
    events = run_wire(monkeypatch, handler, stream=True)
    assert [event.type for event in events] == ["delta", "done"]
    assert events[0].content == "OK" and events[1].usage.output_tokens == 1


def test_responses_rate_limit_is_not_retried_or_exposed(monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(429, json={"error": {"message": "fictional-key", "type": "rate_limit_error"}})
    with pytest.raises(GatewayError) as error:
        run_wire(monkeypatch, handler)
    assert error.value.code == "LLM_UNAVAILABLE" and len(calls) == 1
    assert "fictional-key" not in str(error.value)


def test_incomplete_nonstream_response_keeps_usage_and_fails(monkeypatch):
    with pytest.raises(GatewayError) as error:
        run_wire(monkeypatch, lambda request: httpx.Response(200, json=response_payload("incomplete")))
    assert error.value.usage.output_tokens == 1


@pytest.mark.parametrize("terminal", [None, "response.failed", "response.incomplete"])
def test_stream_eof_failure_or_incomplete_never_report_success(monkeypatch, terminal):
    async def fake(**kwargs):
        async def events():
            yield SimpleNamespace(type="response.output_text.delta", delta="部分文字")
            if terminal:
                yield SimpleNamespace(type=terminal, response=SimpleNamespace(usage=SimpleNamespace(input_tokens=3, output_tokens=1)))
        return events()
    monkeypatch.setattr(litellm, "aresponses", fake)
    async def run():
        seen = []
        stream = await LiteLLMGateway().start_stream(model="gpt-6-luna", messages=[ChatMessage(role="user", content="虚构输入")], api_base="https://aihubmix.com/v1", api_key="fictional-key", protocol_code="openai_responses")
        with pytest.raises(GatewayError):
            async for event in stream:
                seen.append(event.type)
        assert seen == ["delta"]
    asyncio.run(run())


def test_responses_cancel_closes_upstream_http_stream(monkeypatch):
    class Stream:
        closed = False
        @property
        def response(self):
            return self
        def __aiter__(self):
            return self
        async def __anext__(self):
            raise asyncio.CancelledError()
        async def aclose(self):
            self.closed = True
    upstream = Stream()
    async def fake(**kwargs):
        return upstream
    monkeypatch.setattr(litellm, "aresponses", fake)
    async def run():
        stream = await LiteLLMGateway().start_stream(model="gpt-6-luna", messages=[], api_base="https://aihubmix.com/v1", api_key="fictional-key", protocol_code="openai_responses")
        with pytest.raises(asyncio.CancelledError):
            await anext(stream)
        assert upstream.closed
    asyncio.run(run())
