"""One realtime recognition: browser audio → provider → partial/final text.

The finished transcript is parked under a single-use session ID so the answer
endpoint trusts the server's recognition, never text supplied by the client.
Voice recordings share the result's Redis TTL so another worker can accept the answer.
"""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from time import perf_counter
from uuid import uuid4

from linkresume.modules.llm.resolver import SPEECH_TO_TEXT
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.speech.gateway import SAMPLE_RATE, SpeechProviderError

MAX_AUDIO_SECONDS = 300
MAX_AUDIO_BYTES = 10 * 1024 * 1024
SESSION_TTL_SECONDS = 600
SPEECH_SOURCE = "mock_interview"
_KEY = "mock_interview:speech:{}"


@dataclass
class SpeechResult:
    session_id: str
    user_id: int
    interview_id: int
    question_id: int
    purpose: str
    text: str
    words: list[dict[str, object]]
    duration_ms: int
    partial: bool


@dataclass
class AudioBuffer:
    """Accumulates PCM16 frames within the per-recording limits."""

    max_bytes: int = min(MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS * SAMPLE_RATE * 2)
    chunks: list[bytes] = field(default_factory=list)
    size: int = 0

    def add(self, chunk: bytes) -> bool:
        """False once the limit is reached; the overflowing chunk is dropped."""
        if self.size + len(chunk) > self.max_bytes:
            return False
        self.chunks.append(chunk)
        self.size += len(chunk)
        return True

    @property
    def duration_ms(self) -> int:
        return self.size * 1000 // (SAMPLE_RATE * 2)

    def data(self) -> bytes:
        return b"".join(self.chunks)


class SpeechSessionStore:
    """Redis holds both the single-use result and its expiring recording."""

    def __init__(self, redis) -> None:
        self._redis = redis

    def save(self, result: SpeechResult, audio: bytes | None) -> None:
        key = _KEY.format(result.session_id)
        if audio is not None:
            # The shared Redis client decodes UTF-8 responses, so encode PCM.
            self._redis.set(key + ":audio", base64.b64encode(audio).decode("ascii"), ex=SESSION_TTL_SECONDS)
        self._redis.set(key, json.dumps(result.__dict__, ensure_ascii=False), ex=SESSION_TTL_SECONDS)

    def _take(self, key: str):
        getdel = getattr(self._redis, "getdel", None)
        if getdel is not None:
            return getdel(key)
        raw = self._redis.get(key)
        return raw if raw is not None and self._redis.delete(key) else None

    def consume(self, session_id: str) -> tuple[SpeechResult, bytes | None] | None:
        key = _KEY.format(session_id)
        raw = self._take(key)
        if raw is None:
            return None
        audio = self._take(key + ":audio")
        return SpeechResult(**json.loads(raw)), base64.b64decode(audio) if audio is not None else None

    def restore(self, result: SpeechResult, audio: bytes | None) -> None:
        self.save(result, audio)


async def run_recognition(
    llm: LLMService,
    *,
    user_id: int,
    interview_id: int,
    question_id: int,
    purpose: str,
    hotwords: list[str],
    language: str,
    frames: AsyncIterator[bytes | None],
    emit,
) -> tuple[SpeechResult, bytes]:
    """Relay ``frames`` (``None`` means the user pressed stop) to the provider.

    ``emit`` receives ``partial`` events; the caller sends the final event.
    Raises ``LLMError``/``SpeechProviderError`` when recognition cannot start
    or fails before any sentence was recognised.
    """
    plan = await llm.speech_plan(SPEECH_TO_TEXT)
    target = llm.speech_target_for_plan(plan)
    buffer = AudioBuffer()
    disconnected = False

    async def audio() -> AsyncIterator[bytes]:
        nonlocal disconnected
        try:
            async for frame in frames:
                if frame is None:
                    return
                if not buffer.add(frame):
                    return
                yield frame
        except ConnectionError:
            disconnected = True

    call_id = await llm.start_speech_call(plan, source=SPEECH_SOURCE, user_id=user_id)
    started = perf_counter()
    finals: dict[int, tuple[str, list[dict[str, object]]]] = {}
    pending = ""
    error: Exception | None = None
    billing_usage = None
    upstream_request_id = None
    try:
        async for event in llm.speech_gateway.recognize(target, audio(), hotwords=hotwords, language=language):
            billing_usage = event.usage or billing_usage
            upstream_request_id = event.request_id or upstream_request_id
            if event.final:
                finals[event.sentence_id] = (
                    event.text,
                    [{"text": w.text, "start_ms": w.start_ms, "end_ms": w.end_ms} for w in event.words],
                )
                pending = ""
            else:
                pending = event.text
            text = "".join(finals[key][0] for key in sorted(finals)) + pending
            await emit({"type": "partial", "text": text})
    except asyncio.CancelledError:
        await llm.finish_speech_call(call_id, started=started, cancelled=True,
                                     details={"audio_seconds": round(buffer.duration_ms / 1000, 2)})
        raise
    except SpeechProviderError as caught:
        error = caught
    await llm.finish_speech_call(
        call_id, started=started, error_code=error.code if error else None,
        details=billing_usage or {"audio_seconds": round(buffer.duration_ms / 1000, 2)},
        upstream_request_id=upstream_request_id,
    )
    text = "".join(finals[key][0] for key in sorted(finals)) + pending
    if error is not None and not text.strip():
        raise error
    words = [word for key in sorted(finals) for word in finals[key][1]]
    result = SpeechResult(
        session_id=uuid4().hex,
        user_id=user_id,
        interview_id=interview_id,
        question_id=question_id,
        purpose=purpose,
        text=text.strip(),
        words=words,
        duration_ms=buffer.duration_ms,
        partial=error is not None or disconnected,
    )
    return result, buffer.data()


__all__ = [
    "AudioBuffer", "LLMError", "SpeechResult", "SpeechSessionStore", "run_recognition",
    "MAX_AUDIO_BYTES", "MAX_AUDIO_SECONDS",
]
