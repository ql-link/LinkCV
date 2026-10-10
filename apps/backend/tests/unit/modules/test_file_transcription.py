import json
from datetime import timedelta
from urllib.parse import urlsplit

import httpx
import pytest

from drawoffer.core.config import Settings
from drawoffer.core.storage import AssetStorage
from drawoffer.modules.speech.file_transcription import (
    DashScopeFileTranscriber,
    Sentence,
    TranscriptionProviderError,
    file_model,
    parse_result,
    render_markdown,
)
from drawoffer.modules.speech.gateway import SpeechTarget

TARGET = SpeechTarget(
    ws_url="wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
    api_key="sk-test",
    model="paraformer-realtime-v2",
    workspace_id="ws-1",
)


def test_file_model_pairs_with_the_realtime_route():
    assert file_model("paraformer-realtime-v2") == "paraformer-v2"
    assert file_model("paraformer-realtime-8k-v2") == "paraformer-8k-v2"
    assert file_model("fun-asr-realtime") == "fun-asr"
    assert file_model("something-else") == "paraformer-v2"
    assert file_model("paraformer-realtime-v2", " fun-asr ") == "fun-asr"


def test_two_speakers_label_the_questioner_as_interviewer():
    sentences = [
        Sentence(0, 1, "你好。"),
        Sentence(1000, 0, "请介绍一下你的项目？"),
        Sentence(2000, 1, "我负责示例系统。"),
        Sentence(3000, 1, "主要做重构。"),
        Sentence(4000, 0, "为什么这样设计呢"),
    ]
    assert render_markdown(sentences) == (
        "我：你好。\n\n面试官：请介绍一下你的项目？\n\n我：我负责示例系统。主要做重构。\n\n面试官：为什么这样设计呢"
    )


def test_more_than_two_speakers_and_no_speaker_fall_back_to_neutral_labels():
    assert render_markdown([Sentence(0, 0, "甲"), Sentence(1, 1, "乙"), Sentence(2, 2, "丙")]) == (
        "说话人 1：甲\n\n说话人 2：乙\n\n说话人 3：丙"
    )
    assert render_markdown([Sentence(0, None, "无说话人")]) == "无说话人"


def test_parse_result_reads_sentences_and_duration():
    transcript = parse_result({
        "properties": {"original_duration_in_milliseconds": 61000},
        "transcripts": [{"sentences": [
            {"begin_time": 0, "text": "请自我介绍？", "speaker_id": 0},
            {"begin_time": 900, "text": "我是示例候选人。", "speaker_id": 1},
        ]}],
    })
    assert transcript.duration_ms == 61000
    assert transcript.markdown == "面试官：请自我介绍？\n\n我：我是示例候选人。"
    with pytest.raises(TranscriptionProviderError) as empty:
        parse_result({"transcripts": [{"sentences": []}]})
    assert empty.value.code == "INTERVIEW_TRANSCRIPTION_EMPTY"


def test_submit_query_and_fetch_follow_the_async_protocol():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path == "/api/v1/services/audio/asr/transcription":
            return httpx.Response(200, json={"output": {"task_id": "t-1", "task_status": "PENDING"}})
        if path == "/api/v1/tasks/t-1":
            return httpx.Response(200, json={"output": {"task_status": "SUCCEEDED", "results": [
                {"subtask_status": "SUCCEEDED", "transcription_url": "https://result.example.test/r.json"}
            ]}})
        if path == "/api/v1/tasks/t-2":
            return httpx.Response(200, json={"output": {"task_status": "FAILED", "results": [
                {"subtask_status": "FAILED", "code": "InvalidFile.DecodeFailed"}
            ]}})
        if path == "/r.json":
            return httpx.Response(200, json={"transcripts": [{"sentences": [
                {"begin_time": 0, "text": "好的", "speaker_id": 0}
            ]}]})
        return httpx.Response(404)

    transcriber = DashScopeFileTranscriber(transport=httpx.MockTransport(handler))
    assert transcriber.submit(TARGET, "https://minio.example.test/a.m4a?sig") == "t-1"
    submit = seen[0]
    assert submit.url.host == "dashscope.aliyuncs.com"
    assert submit.headers["X-DashScope-Async"] == "enable"
    assert submit.headers["Authorization"] == "Bearer sk-test"
    assert submit.headers["X-DashScope-WorkSpace"] == "ws-1"
    body = json.loads(submit.content)
    assert body["model"] == "paraformer-v2"
    assert body["input"]["file_urls"] == ["https://minio.example.test/a.m4a?sig"]
    assert body["parameters"]["diarization_enabled"] is True

    status = transcriber.query(TARGET, "t-1")
    assert status.state == "succeeded" and status.result_url
    assert transcriber.fetch(status.result_url).markdown == "好的"
    failed = transcriber.query(TARGET, "t-2")
    assert failed.state == "failed"
    assert failed.error_code == "INTERVIEW_TRANSCRIPTION_FORMAT_UNSUPPORTED"


@pytest.mark.parametrize(("status", "retryable", "code"), [
    (503, True, "INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE"),
    (429, True, "INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE"),
    (401, False, "INTERVIEW_TRANSCRIPTION_AUTH_FAILED"),
    (400, False, "INTERVIEW_TRANSCRIPTION_REJECTED"),
])
def test_provider_errors_are_classified(status, retryable, code):
    transcriber = DashScopeFileTranscriber(
        transport=httpx.MockTransport(lambda request: httpx.Response(status))
    )
    with pytest.raises(TranscriptionProviderError) as caught:
        transcriber.submit(TARGET, "https://minio.example.test/a.m4a")
    assert caught.value.retryable is retryable
    assert caught.value.code == code


def test_presigned_links_use_the_public_origin_without_network():
    storage = AssetStorage(Settings(
        jwt_secret="integration-test-secret-with-32-bytes",
        minio_endpoint="http://minio:9000",
        minio_public_endpoint="https://files.example.test",
    ))
    assert storage.public_downloads_enabled
    url = storage.presigned_public_get_url("users/1/a.m4a", timedelta(hours=6))
    parts = urlsplit(url)
    assert parts.scheme == "https" and parts.hostname == "files.example.test"
    assert "X-Amz-Expires=21600" in parts.query
    plain = AssetStorage(Settings(jwt_secret="integration-test-secret-with-32-bytes"))
    assert not plain.public_downloads_enabled
