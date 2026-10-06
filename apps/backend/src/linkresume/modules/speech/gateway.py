"""Provider adapters for speech recognition and synthesis.

Routes, credentials and call logs come from the LLM module; adapters only
speak the upstream wire protocol.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol


class SpeechProviderError(Exception):
    def __init__(self, code: str = "MOCK_INTERVIEW_SPEECH_FAILED") -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class SpeechWord:
    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class RecognitionEvent:
    """A partial or sentence-final result; final sentences carry word timings."""

    text: str
    sentence_id: int
    final: bool
    words: tuple[SpeechWord, ...] = field(default_factory=tuple)
    usage: dict | None = None
    request_id: str | None = None


class SpeechAudio(bytes):
    """Bytes-compatible output carrying only safe billing evidence."""
    def __new__(cls, content: bytes, *, usage: dict | None = None, request_id: str | None = None):
        result = super().__new__(cls, content)
        result.usage = usage
        result.request_id = request_id
        return result


@dataclass(frozen=True)
class SpeechTarget:
    ws_url: str
    api_key: str
    model: str
    workspace_id: str | None = None
    provider_code: str = "aliyun"
    api_base: str | None = None


SAMPLE_RATE = 16_000


class SpeechGateway(Protocol):
    def recognize(
        self,
        target: SpeechTarget,
        audio: AsyncIterator[bytes],
        *,
        hotwords: list[str],
        language: str,
    ) -> AsyncIterator[RecognitionEvent]: ...

    async def synthesize(self, target: SpeechTarget, text: str, *, voice: str | None) -> bytes: ...
