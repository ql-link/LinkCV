"""Alibaba Cloud Model Studio (DashScope) realtime speech over WebSocket.

Recognition uses the duplex ``asr`` task (Paraformer / Fun-ASR realtime) and
synthesis the ``tts`` task (CosyVoice). Both share one task protocol:
``run-task`` → ``task-started`` → data → ``finish-task`` → ``task-finished``.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from uuid import uuid4

import websockets
from websockets.exceptions import WebSocketException

from linkresume.modules.speech.gateway import (
    SAMPLE_RATE,
    RecognitionEvent,
    SpeechProviderError,
    SpeechTarget,
    SpeechWord,
)

CONNECT_TIMEOUT_SECONDS = 10
RESULT_TIMEOUT_SECONDS = 15
DEFAULT_VOICE = "longxiaochun_v2"


def _headers(target: SpeechTarget) -> dict[str, str]:
    headers = {"Authorization": f"bearer {target.api_key}"}
    if target.workspace_id:
        headers["X-DashScope-WorkSpace"] = target.workspace_id
    return headers


def _command(action: str, task_id: str, payload: dict) -> str:
    return json.dumps(
        {"header": {"action": action, "task_id": task_id, "streaming": "duplex"}, "payload": payload},
        ensure_ascii=False,
    )


def _event(raw: str | bytes) -> tuple[str, dict]:
    try:
        message = json.loads(raw)
        return str(message["header"]["event"]), message
    except (ValueError, KeyError, TypeError) as error:
        raise SpeechProviderError() from error


async def _await_started(socket) -> None:
    raw = await asyncio.wait_for(socket.recv(), RESULT_TIMEOUT_SECONDS)
    event, _ = _event(raw)
    if event != "task-started":
        raise SpeechProviderError()


def _words(sentence: dict) -> tuple[SpeechWord, ...]:
    words = []
    for item in sentence.get("words") or []:
        try:
            text = str(item.get("text") or "") + str(item.get("punctuation") or "")
            words.append(SpeechWord(text=text, start_ms=int(item["begin_time"]), end_ms=int(item["end_time"])))
        except (KeyError, TypeError, ValueError):
            continue
    return tuple(words)


class AliyunSpeechGateway:
    def __init__(self, connect=None) -> None:
        # Injectable for tests; defaults to the websockets client.
        self._connect = connect or websockets.connect

    async def recognize(
        self,
        target: SpeechTarget,
        audio: AsyncIterator[bytes],
        *,
        hotwords: list[str],
        language: str,
    ) -> AsyncIterator[RecognitionEvent]:
        # DashScope binds hot words through a pre-created vocabulary ID rather
        # than inline terms; the per-interview list is kept for correction and
        # passed here once vocabulary management is added.
        del hotwords
        task_id = uuid4().hex
        parameters = {
            "format": "pcm",
            "sample_rate": SAMPLE_RATE,
            "language_hints": ["zh", "en"] if language == "zh" else ["en"],
        }
        try:
            async with self._connect(
                target.ws_url, additional_headers=_headers(target), open_timeout=CONNECT_TIMEOUT_SECONDS
            ) as socket:
                await socket.send(_command("run-task", task_id, {
                    "task_group": "audio", "task": "asr", "function": "recognition",
                    "model": target.model, "parameters": parameters, "input": {},
                }))
                await _await_started(socket)

                async def pump() -> None:
                    async for chunk in audio:
                        await socket.send(chunk)
                    await socket.send(_command("finish-task", task_id, {"input": {}}))

                sender = asyncio.create_task(pump())
                sentence_id = 0
                try:
                    while True:
                        raw = await asyncio.wait_for(socket.recv(), RESULT_TIMEOUT_SECONDS * 20)
                        event, message = _event(raw)
                        if event == "result-generated":
                            sentence = (message.get("payload") or {}).get("output", {}).get("sentence") or {}
                            if sentence.get("heartbeat"):
                                continue
                            final = bool(sentence.get("sentence_end"))
                            yield RecognitionEvent(
                                text=str(sentence.get("text") or ""),
                                sentence_id=sentence_id,
                                final=final,
                                words=_words(sentence) if final else (),
                            )
                            if final:
                                sentence_id += 1
                        elif event == "task-finished":
                            break
                        elif event == "task-failed":
                            raise SpeechProviderError()
                    if sender.done() and sender.exception():
                        raise SpeechProviderError() from sender.exception()
                finally:
                    if not sender.done():
                        sender.cancel()
                        await asyncio.gather(sender, return_exceptions=True)
        except SpeechProviderError:
            raise
        except (OSError, asyncio.TimeoutError, WebSocketException) as error:
            raise SpeechProviderError() from error

    async def synthesize(self, target: SpeechTarget, text: str, *, voice: str | None = None) -> bytes:
        task_id = uuid4().hex
        audio = bytearray()
        try:
            async with self._connect(
                target.ws_url, additional_headers=_headers(target), open_timeout=CONNECT_TIMEOUT_SECONDS
            ) as socket:
                await socket.send(_command("run-task", task_id, {
                    "task_group": "audio", "task": "tts", "function": "SpeechSynthesizer",
                    "model": target.model,
                    "parameters": {
                        "text_type": "PlainText", "voice": voice or DEFAULT_VOICE,
                        "format": "mp3", "sample_rate": 22050,
                    },
                    "input": {},
                }))
                await _await_started(socket)
                await socket.send(_command("continue-task", task_id, {"input": {"text": text}}))
                await socket.send(_command("finish-task", task_id, {"input": {}}))
                while True:
                    raw = await asyncio.wait_for(socket.recv(), RESULT_TIMEOUT_SECONDS)
                    if isinstance(raw, bytes):
                        audio.extend(raw)
                        continue
                    event, _ = _event(raw)
                    if event == "task-finished":
                        break
                    if event == "task-failed":
                        raise SpeechProviderError()
        except SpeechProviderError:
            raise
        except (OSError, asyncio.TimeoutError, WebSocketException) as error:
            raise SpeechProviderError() from error
        if not audio:
            raise SpeechProviderError()
        return bytes(audio)
