"""AIHubMix file transcription and MP3 synthesis behind the speech interface."""

from __future__ import annotations

import asyncio
import io
import json
import math
import wave
from collections.abc import AsyncIterator
from urllib.parse import urlsplit, urlunsplit

import httpx

from drawoffer.modules.speech.gateway import (
    SAMPLE_RATE, RecognitionEvent, SpeechProviderError, SpeechTarget, SpeechWord, SpeechAudio,
)

MAX_PCM_BYTES = SAMPLE_RATE * 2 * 300
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 75
AUDIO_DOWNLOAD_HOSTS = frozenset({"dashscope-result-bj.oss-cn-beijing.aliyuncs.com"})


def _download_url(value: object) -> str:
    if not isinstance(value, str):
        raise SpeechProviderError()
    try:
        url = urlsplit(value)
        if (url.scheme not in {"http", "https"} or url.hostname not in AUDIO_DOWNLOAD_HOSTS
                or url.username or url.password or url.port is not None or url.fragment):
            raise SpeechProviderError()
        # Model Studio currently returns an HTTP URL; use verified TLS instead.
        return urlunsplit(("https", url.netloc, url.path, url.query, ""))
    except ValueError:
        raise SpeechProviderError() from None


async def _read_response(response: httpx.Response) -> bytes:
    if response.status_code != 200:
        raise SpeechProviderError()
    data = bytearray()
    async for chunk in response.aiter_bytes():
        data.extend(chunk)
        if len(data) > MAX_RESPONSE_BYTES:
            raise SpeechProviderError()
    return bytes(data)


def _json(data: bytes) -> dict:
    try:
        value = json.loads(data)
        if isinstance(value, dict):
            return value
    except (ValueError, UnicodeError):
        pass
    raise SpeechProviderError()


def _mp3(data: bytes) -> bytes:
    if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return data
    raise SpeechProviderError()


def _words(value: object, duration_seconds: float) -> tuple[SpeechWord, ...]:
    # Whisper routes may return null/missing timings. Never fabricate them.
    if value is None:
        return ()
    if not isinstance(value, list):
        raise SpeechProviderError()
    words = []
    for item in value:
        try:
            text = item["word"]
            start, end = float(item["start"]), float(item["end"])
            if (not isinstance(text, str) or not math.isfinite(start) or not math.isfinite(end)
                    or not 0 <= start <= end <= duration_seconds + 1):
                raise SpeechProviderError()
            words.append(SpeechWord(text, round(start * 1000), round(end * 1000)))
        except (KeyError, TypeError, ValueError, OverflowError):
            raise SpeechProviderError() from None
    return tuple(words)


class AIHubMixSpeechGateway:
    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=self._transport,
            timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=10),
            follow_redirects=False,
        )

    @staticmethod
    def _endpoint(target: SpeechTarget, path: str) -> str:
        base = (target.api_base or "").rstrip("/")
        if base not in {"https://aihubmix.com/v1", "https://api.inferera.com/v1"}:
            raise SpeechProviderError()
        return base + path

    async def recognize(
        self, target: SpeechTarget, audio: AsyncIterator[bytes], *, hotwords: list[str], language: str,
    ) -> AsyncIterator[RecognitionEvent]:
        pcm = bytearray()
        async for frame in audio:
            if len(frame) % 2 or len(pcm) + len(frame) > MAX_PCM_BYTES:
                raise SpeechProviderError()
            pcm.extend(frame)
        if not pcm:
            raise SpeechProviderError()
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(pcm)
        fields = {
            "model": target.model, "language": language, "response_format": "verbose_json",
            "timestamp_granularities[]": "word", "temperature": "0",
        }
        if hotwords:
            fields["prompt"] = ", ".join(word.replace("\n", " ") for word in hotwords)[:1000]
        try:
            # The timeout covers the whole request, including a slow response body.
            async with asyncio.timeout(REQUEST_TIMEOUT_SECONDS), self._client() as client:
                async with client.stream(
                    "POST", self._endpoint(target, "/audio/transcriptions"),
                    headers={"Authorization": f"Bearer {target.api_key}"}, data=fields,
                    files={"file": ("answer.wav", output.getvalue(), "audio/wav")},
                ) as response:
                    result = _json(await _read_response(response))
                    request_id = response.headers.get("x-request-id")
            text = result.get("text")
            if not isinstance(text, str) or len(text) > 8000:
                raise SpeechProviderError()
            yield RecognitionEvent(
                text=text, sentence_id=0, final=True,
                words=_words(result.get("words"), len(pcm) / (SAMPLE_RATE * 2)),
                usage={"audioSeconds": len(pcm) / (SAMPLE_RATE * 2), "usageSource": "measured_audio", "usagePresent": True},
                request_id=request_id if request_id and len(request_id) <= 128 else None,
            )
        except (httpx.HTTPError, TimeoutError, OSError):
            raise SpeechProviderError() from None

    async def synthesize(self, target: SpeechTarget, text: str, *, voice: str | None = None) -> bytes:
        if not text or len(text) > 4096:
            raise SpeechProviderError()
        default_voice = "longanhuan_v3.6" if target.model == "qwen-audio-3.0-tts-flash" else "alloy"
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT_SECONDS), self._client() as client:
                async with client.stream(
                    "POST", self._endpoint(target, "/audio/speech"),
                    headers={"Authorization": f"Bearer {target.api_key}"},
                    json={"model": target.model, "input": text, "voice": voice or default_voice,
                          "response_format": "mp3"},
                ) as response:
                    data = await _read_response(response)
                    request_id = response.headers.get("x-request-id")
                    is_json = "json" in response.headers.get("content-type", "").lower() or data.lstrip().startswith(b"{")
                if is_json:
                    result = _json(data)
                    try:
                        url = _download_url(result["output"]["audio"]["url"])
                    except (KeyError, TypeError):
                        raise SpeechProviderError() from None
                    # No Authorization or cookies cross to the audio storage host.
                    async with self._client() as downloader:
                        async with downloader.stream("GET", url) as response:
                            data = await _read_response(response)
                return SpeechAudio(_mp3(data), usage={"characters": len(text), "usageSource": "measured_characters", "usagePresent": True},
                                   request_id=request_id if request_id and len(request_id) <= 128 else None)
        except (httpx.HTTPError, TimeoutError, OSError):
            raise SpeechProviderError() from None
