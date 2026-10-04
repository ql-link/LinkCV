from __future__ import annotations

import pytest
from types import SimpleNamespace

from linkresume.application.mock_interviews import voice_metrics
from linkresume.application.mock_interviews.speech_session import AudioBuffer
from linkresume.application.mock_interviews.service import voice_report
from linkresume.application.mock_interviews.transcripts import MAX_CHANGE_RATIO, change_ratio
from linkresume.modules.llm.providers import speech_ws_url, validate_use_case_protocol
from linkresume.modules.mock_interviews.routes import split_sentences


def words(text: str, *, gap_at: int | None = None, step: int = 250) -> list[dict]:
    result, cursor = [], 0
    for index, char in enumerate(text):
        cursor += 4_000 if index == gap_at else step
        result.append({"text": char, "start_ms": cursor, "end_ms": cursor + 200})
    return result


def test_voice_metrics_count_rate_pauses_and_fillers():
    answer = voice_metrics.answer_metrics(words("嗯我那个负责缓存", gap_at=3), None)
    assert answer["chars"] == 8 and answer["long_pauses"] == 1
    assert answer["fillers"] == 3  # 嗯 + 那个
    summary = voice_metrics.summarize([answer, voice_metrics.answer_metrics(words("没有停顿"), 60_000)])
    assert summary["long_pauses"] == 1
    assert summary["filler_ratio"] == pytest.approx(3 / 12, abs=1e-4)
    assert summary["chars_per_minute"] == round(12 / ((answer["duration_ms"] + 60_000) / 60_000))
    assert summary["reference"]["chars_per_minute"] == [180, 260]
    assert voice_metrics.summarize([]) is None


def test_voice_report_does_not_invent_delivery_metrics_when_asr_has_no_timestamps():
    untimed = SimpleNamespace(answer_source="voice", answer_status="answered", words_json=None, audio_duration_ms=60000)
    assert voice_report([untimed]) is None
    timed = SimpleNamespace(answer_source="voice", answer_status="answered", words_json=words("真实时间戳"), audio_duration_ms=60000)
    assert voice_report([untimed, timed]) == voice_report([timed])


def test_change_ratio_measures_edits_against_the_original():
    assert change_ratio("我用瑞迪斯做缓存", "我用瑞迪斯做缓存") == 0
    assert change_ratio("我用瑞迪斯做缓存", "我用Redis做缓存") == pytest.approx(5 / 8)
    long = "我在项目里用瑞迪斯做缓存，QPS 从两千提升到一万，主要靠本地缓存和批量写入"
    assert change_ratio(long, long.replace("瑞迪斯", "Redis")) <= MAX_CHANGE_RATIO
    assert change_ratio(long, "完全不同的内容") > MAX_CHANGE_RATIO
    assert change_ratio("", "x") == 1.0


def test_sentences_split_on_terminal_punctuation_and_length():
    sentences, rest = split_sentences("好的。请问你如何定位瓶颈？还有")
    assert sentences == ["好的。", "请问你如何定位瓶颈？"] and rest == "还有"
    sentences, rest = split_sentences("长" * 130)
    assert sentences == ["长" * 120] and rest == "长" * 10


def test_audio_buffer_stops_at_the_limit():
    buffer = AudioBuffer(max_bytes=10)
    assert buffer.add(b"12345678") and not buffer.add(b"123")
    assert buffer.data() == b"12345678" and buffer.duration_ms == 0


def test_speech_protocols_are_scoped_to_speech_use_cases_and_regions():
    validate_use_case_protocol("speech_to_text", "aliyun_asr_realtime")
    validate_use_case_protocol("assistant_conversation", "openai_responses")
    for use_case, protocol in (
        ("speech_to_text", "openai_chat"), ("text_to_speech", "aliyun_asr_realtime"),
        ("mock_interview", "aliyun_tts_realtime"),
    ):
        with pytest.raises(ValueError):
            validate_use_case_protocol(use_case, protocol)
    assert speech_ws_url("aliyun", {"region": "ap-southeast-1"}) == "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference/"
    with pytest.raises(ValueError):
        speech_ws_url("aliyun", {"region": "cn-hongkong"})
    with pytest.raises(ValueError):
        speech_ws_url("aihubmix", {})
