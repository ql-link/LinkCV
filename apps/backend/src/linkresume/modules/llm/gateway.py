from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx

from linkresume.modules.llm.schemas import ChatMessage

logger = logging.getLogger(__name__)

STREAM_DATA_PREFIX = "data:"
STREAM_DONE = "[DONE]"
REJECTED_STATUSES = frozenset({400, 401, 403, 404, 405, 409, 413, 422})

GatewayErrorCode = Literal["LLM_UNAVAILABLE", "LLM_REQUEST_REJECTED", "LLM_TIMEOUT"]

_SKIP = object()
_DONE = object()


@dataclass(frozen=True)
class GatewayUsage:
    input_tokens: int | None
    output_tokens: int | None


@dataclass(frozen=True)
class GatewayResult:
    content: str
    usage: GatewayUsage


@dataclass(frozen=True)
class GatewayStreamEvent:
    type: Literal["delta", "done"]
    content: str | None = None
    usage: GatewayUsage | None = None


class GatewayError(Exception):
    """Stable, provider-detail-free failure of one model call."""

    def __init__(
        self,
        *,
        code: GatewayErrorCode,
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
        api_base: str,
        api_key: str,
    ) -> GatewayResult: ...

    async def start_stream(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str,
        api_key: str,
    ) -> AsyncIterator[GatewayStreamEvent]: ...


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _usage(payload: object) -> GatewayUsage:
    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        return GatewayUsage(None, None)
    return GatewayUsage(
        input_tokens=_int_or_none(usage.get("prompt_tokens")),
        output_tokens=_int_or_none(usage.get("completion_tokens")),
    )


def _content(payload: object) -> str:
    choices = payload.get("choices") if isinstance(payload, dict) else None
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    return content if isinstance(content, str) else ""


def _delta_content(payload: object) -> str | None:
    choices = payload.get("choices") if isinstance(payload, dict) else None
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    delta = first.get("delta")
    if not isinstance(delta, dict):
        return None
    content = delta.get("content")
    return content if isinstance(content, str) and content else None


def _stream_frame(line: str) -> object:
    """Return a decoded frame, or a sentinel for skip/done lines."""
    stripped = line.strip()
    if not stripped.startswith(STREAM_DATA_PREFIX):
        return _SKIP
    data = stripped[len(STREAM_DATA_PREFIX) :].strip()
    if data == STREAM_DONE:
        return _DONE
    try:
        return json.loads(data)
    except ValueError:
        # Malformed keep-alive or partial frame: ignore it, the next frame wins.
        return _SKIP


def _gateway_error(error: Exception, *, usage: GatewayUsage | None = None) -> GatewayError:
    if isinstance(error, (httpx.ConnectError, httpx.ConnectTimeout)):
        # The request never left our side, so no provider-side usage can exist.
        return GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=False,
            usage=usage,
        )
    if isinstance(error, httpx.TimeoutException):
        return GatewayError(
            code="LLM_TIMEOUT",
            may_have_reached_provider=True,
            usage=usage,
        )
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if status in REJECTED_STATUSES:
            return GatewayError(
                code="LLM_REQUEST_REJECTED",
                may_have_reached_provider=False,
                usage=usage,
            )
        if status == 408:
            return GatewayError(
                code="LLM_TIMEOUT",
                may_have_reached_provider=True,
                usage=usage,
            )
        if status == 429:
            return GatewayError(
                code="LLM_UNAVAILABLE",
                may_have_reached_provider=False,
                usage=usage,
            )
        if status >= 500:
            return GatewayError(
                code="LLM_UNAVAILABLE",
                may_have_reached_provider=True,
                usage=usage,
            )
        return GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=False,
            usage=usage,
        )
    # Any other transport or decoding failure happened after the request was sent.
    return GatewayError(
        code="LLM_UNAVAILABLE",
        may_have_reached_provider=True,
        usage=usage,
    )


def _chat_completions_url(api_base: str) -> str:
    return f"{api_base.rstrip('/')}/chat/completions"


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _body(
    model: str,
    messages: Sequence[ChatMessage],
    *,
    stream: bool,
) -> dict[str, object]:
    body: dict[str, object] = {
        "model": model,
        "messages": [message.model_dump() for message in messages],
    }
    if stream:
        body["stream"] = True
        body["stream_options"] = {"include_usage": True}
    return body


class OpenAIChatGateway:
    """Calls one OpenAI-compatible chat completions endpoint over HTTP.

    The gateway reaches exactly one protocol, so no per-vendor branching lives
    here. Every failure is reduced to a stable error code plus whether the
    request may already have consumed provider-side tokens.
    """

    def __init__(
        self,
        timeout_seconds: float = 60.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self._transport = transport
        self._client = client

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self.timeout_seconds,
                transport=self._transport,
            )
        return self._client

    async def aclose(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()

    async def complete(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str,
        api_key: str,
    ) -> GatewayResult:
        try:
            response = await self._http().post(
                _chat_completions_url(api_base),
                headers=_headers(api_key),
                json=_body(model, messages, stream=False),
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as error:
            raise _gateway_error(error) from None
        return GatewayResult(content=_content(payload), usage=_usage(payload))

    async def start_stream(
        self,
        *,
        model: str,
        messages: Sequence[ChatMessage],
        api_base: str,
        api_key: str,
    ) -> AsyncIterator[GatewayStreamEvent]:
        client = self._http()
        try:
            request = client.build_request(
                "POST",
                _chat_completions_url(api_base),
                headers=_headers(api_key),
                json=_body(model, messages, stream=True),
            )
            response = await client.send(request, stream=True)
            response.raise_for_status()
        except Exception as error:
            raise _gateway_error(error) from None

        async def events() -> AsyncIterator[GatewayStreamEvent]:
            usage = GatewayUsage(None, None)
            try:
                async for line in response.aiter_lines():
                    frame = _stream_frame(line)
                    if frame is _DONE:
                        break
                    if frame is _SKIP:
                        continue
                    chunk_usage = _usage(frame)
                    if (
                        chunk_usage.input_tokens is not None
                        or chunk_usage.output_tokens is not None
                    ):
                        usage = chunk_usage
                    content = _delta_content(frame)
                    if content:
                        yield GatewayStreamEvent(type="delta", content=content)
                yield GatewayStreamEvent(type="done", usage=usage)
            except Exception as error:
                raise _gateway_error(error, usage=usage) from None
            finally:
                try:
                    await response.aclose()
                except Exception:
                    # Closing must never replace an in-flight cancel or failure.
                    logger.warning(
                        "LLM stream close failed",
                        extra={
                            "dependency": "llm",
                            "error_code": "LLM_STREAM_CLOSE_FAILED",
                        },
                    )

        return events()
