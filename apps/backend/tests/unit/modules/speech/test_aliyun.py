from __future__ import annotations

import asyncio
import json

import pytest

from linkresume.modules.speech.aliyun import AliyunSpeechGateway
from linkresume.modules.speech.gateway import SpeechProviderError, SpeechTarget

TARGET = SpeechTarget(ws_url="wss://example.invalid/ws", api_key="fictional-key", model="fun-asr-realtime", workspace_id="ws-1")


def event(name: str, **payload) -> str:
    return json.dumps({"header": {"event": name, "task_id": "t"}, "payload": payload})


class FakeSocket:
    def __init__(self, replies):
        self.replies = list(replies)
        self.sent: list[object] = []
        self._finished = asyncio.Event()

    async def send(self, message):
        self.sent.append(message)
        if isinstance(message, str) and json.loads(message)["header"]["action"] == "finish-task":
            self._finished.set()

    async def recv(self):
        if not self.replies:
            await asyncio.sleep(3600)
        reply = self.replies.pop(0)
        if reply == "WAIT_FINISH":
            await self._finished.wait()
            return self.replies.pop(0)
        return reply


class Connect:
    def __init__(self, socket):
        self.socket = socket
        self.kwargs = None

    def __call__(self, url, **kwargs):
        self.url = url
        self.kwargs = kwargs
        socket = self.socket

        class Context:
            async def __aenter__(self):
                return socket

            async def __aexit__(self, *exc):
                return False

        return Context()


async def audio(*chunks):
    for chunk in chunks:
        yield chunk


def sentence(text, end, words=None):
    return {"output": {"sentence": {"text": text, "sentence_end": end, "words": words or []}}}


def test_recognition_sends_task_audio_and_parses_sentences_with_word_timing():
    socket = FakeSocket([
        event("task-started"),
        event("result-generated", **sentence("你好", False)),
        event("result-generated", **{"output": {"sentence": {"heartbeat": True}}}),
        event("result-generated", **sentence("你好。", True, [
            {"text": "你", "begin_time": 0, "end_time": 200},
            {"text": "好", "begin_time": 200, "end_time": 400, "punctuation": "。"},
        ])),
        "WAIT_FINISH",
        event("task-finished"),
    ])
    connect = Connect(socket)

    async def run():
        return [item async for item in AliyunSpeechGateway(connect).recognize(
            TARGET, audio(b"a" * 10, b"b" * 10), hotwords=["Redis"], language="zh"
        )]

    events = asyncio.run(run())
    assert [(item.text, item.final) for item in events] == [("你好", False), ("你好。", True)]
    assert [(w.text, w.start_ms, w.end_ms) for w in events[1].words] == [("你", 0, 200), ("好。", 200, 400)]
    assert connect.kwargs["additional_headers"] == {"Authorization": "bearer fictional-key", "X-DashScope-WorkSpace": "ws-1"}
    run_task = json.loads(socket.sent[0])
    assert run_task["header"]["action"] == "run-task"
    assert run_task["payload"]["task"] == "asr" and run_task["payload"]["model"] == "fun-asr-realtime"
    assert run_task["payload"]["parameters"]["sample_rate"] == 16000
    assert socket.sent[1:3] == [b"a" * 10, b"b" * 10]
    assert json.loads(socket.sent[3])["header"]["action"] == "finish-task"


def test_recognition_task_failure_raises_provider_error():
    socket = FakeSocket([event("task-started"), event("task-failed")])

    async def run():
        return [item async for item in AliyunSpeechGateway(Connect(socket)).recognize(
            TARGET, audio(b"a"), hotwords=[], language="zh"
        )]

    with pytest.raises(SpeechProviderError):
        asyncio.run(run())


def test_synthesis_collects_binary_audio_until_finished():
    socket = FakeSocket([event("task-started"), b"ID3", b"-audio", event("result-generated"), event("task-finished")])
    audio_bytes = asyncio.run(AliyunSpeechGateway(Connect(socket)).synthesize(
        TARGET, "你好。", voice=None
    ))
    assert audio_bytes == b"ID3-audio"
    actions = [json.loads(item)["header"]["action"] for item in socket.sent]
    assert actions == ["run-task", "continue-task", "finish-task"]
    assert json.loads(socket.sent[1])["payload"]["input"]["text"] == "你好。"
    assert json.loads(socket.sent[0])["payload"]["parameters"]["format"] == "mp3"


def test_synthesis_without_audio_or_with_bad_start_fails():
    with pytest.raises(SpeechProviderError):
        asyncio.run(AliyunSpeechGateway(Connect(FakeSocket([event("task-started"), event("task-finished")]))).synthesize(TARGET, "x", voice=None))
    with pytest.raises(SpeechProviderError):
        asyncio.run(AliyunSpeechGateway(Connect(FakeSocket([event("task-failed")]))).synthesize(TARGET, "x", voice=None))
