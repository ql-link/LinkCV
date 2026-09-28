"""One realtime recognition: browser audio → provider → partial/final text.

The finished transcript is parked under a single-use session ID so the answer
endpoint trusts the server's recognition, never text supplied by the client.
Audio for voice interviews is held in this process until the answer is
submitted (WebSocket and submit hit the same user within minutes).
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
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
class _Held:
    audio: bytes
    expires_at: float


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
    """Redis holds the result; this process holds the recording bytes."""

    def __init__(self, redis) -> None:
        self._redis = redis
        self._audio: dict[str, _Held] = {}
        self._lock = threading.Lock()

    def save(self, result: SpeechResult, audio: bytes | None) -> None:
        payload = json.dumps(result.__dict__, ensure_ascii=False)
        self._redis.set(_KEY.format(result.session_id), payload, ex=SESSION_TTL_SECONDS)
        if audio is not None:
            with self._lock:
                self._evict()
                self._audio[result.session_id] = _Held(audio, time.monotonic() + SESSION_TTL_SECONDS)

    def consume(self, session_id: str) -> tuple[SpeechResult, bytes | None] | None:
        """Atomically take a result so a session can back exactly one answer."""
        key = _KEY.format(session_id)
        getdel = getattr(self._redis, "getdel", None)
        if getdel is not None:
            raw = getdel(key)
        else:  # pragma: no cover - test doubles without GETDEL
            raw = self._redis.get(key)
            if raw is not None and not self._redis.delete(key):
                raw = None
        if raw is None:
            return None
        result = SpeechResult(**json.loads(raw))
        with self._lock:
            held = self._audio.pop(session_id, None)
        return result, held.audio if held else None

    def restore(self, result: SpeechResult, audio: bytes | None) -> None:
        """Put a consumed session back when the answer could not be stored."""
        self.save(result, audio)

    def _evict(self) -> None:
        now = time.monotonic()
        for key in [key for key, held in self._audio.items() if held.expires_at < now]:
            self._audio.pop(key, None)


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
    try:
        async for event in llm.speech_gateway.recognize(target, audio(), hotwords=hotwords, language=language):
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
        details={"audio_seconds": round(buffer.duration_ms / 1000, 2)},
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
