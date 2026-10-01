from __future__ import annotations

import pytest

from linkresume.application.mock_interviews import voice_metrics
from linkresume.application.mock_interviews.speech_session import AudioBuffer
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


def test_speech_session_audio_is_shared_between_workers_with_matching_ttl():
    from linkresume.application.mock_interviews.speech_session import SpeechResult, SpeechSessionStore, SESSION_TTL_SECONDS
    from tests.fakes import FakeRedis

    redis = FakeRedis()
    first, second = SpeechSessionStore(redis), SpeechSessionStore(redis)
    result = SpeechResult("a" * 32, 1, 2, 3, "voice_answer", "张三的回答", [], 1000, False)
    audio = b"\x00\xff\x01\x80" * 16
    first.save(result, audio)
    assert set(redis.ttls.values()) == {SESSION_TTL_SECONDS}
    consumed = second.consume(result.session_id)
    assert consumed == (result, audio)
    assert first.consume(result.session_id) is None
    second.restore(*consumed)
    assert first.consume(result.session_id) == (result, audio)
    assert not redis.strings


def test_speaker_sequences_remain_monotonic_after_draining():
    import asyncio
    import json
    from linkresume.modules.mock_interviews.routes import _Speaker

    class Speech:
        async def synthesize(self, user_id, text, *, source):
            return text.encode()

    async def run():
        speaker = _Speaker(Speech(), 1)
        speaker.say("第一句。")
        first = [chunk async for chunk in speaker.ready(wait=True)]
        speaker.say("第二句。")
        second = [chunk async for chunk in speaker.ready(wait=True)]
        return [json.loads(chunk.decode().split("data: ")[1])["seq"] for chunk in first + second]

    assert asyncio.run(run()) == [0, 1]
