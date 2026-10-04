import asyncio
import io
import json
import wave

import httpx
import pytest

from linkresume.modules.speech.aihubmix import AIHubMixSpeechGateway, MAX_PCM_BYTES, MAX_RESPONSE_BYTES
from linkresume.modules.speech.gateway import RecognitionEvent, SpeechProviderError, SpeechTarget
from linkresume.modules.speech.router import ProviderSpeechGateway

TARGET = SpeechTarget("", "fictional-key", "whisper-large-v3", provider_code="aihubmix", api_base="https://api.inferera.com/v1")
MP3 = b"ID3" + b"fictional audio"
STORAGE = "dashscope-result-bj.oss-cn-beijing.aliyuncs.com"


async def frames(*chunks):
    for chunk in chunks:
        yield chunk


def transcribe(handler, *chunks):
    async def run():
        gateway = AIHubMixSpeechGateway(transport=httpx.MockTransport(handler))
        return [event async for event in gateway.recognize(TARGET, frames(*chunks), hotwords=["Redis"], language="zh")]
    return asyncio.run(run())


def synthesize(handler, model="qwen-audio-3.0-tts-flash"):
    target = SpeechTarget("", "fictional-key", model, provider_code="aihubmix", api_base=TARGET.api_base)
    return asyncio.run(AIHubMixSpeechGateway(transport=httpx.MockTransport(handler)).synthesize(target, "虚构面试题。", voice=None))


@pytest.mark.parametrize("timings", [None, [], [{"word": "缓存", "start": 0.1, "end": 0.4}]])
def test_file_transcription_wraps_pcm_in_wav_and_handles_absent_word_timings(timings):
    def handler(request):
        assert request.url == "https://api.inferera.com/v1/audio/transcriptions"
        assert request.headers["authorization"] == "Bearer fictional-key"
        body = request.content
        assert b'filename="answer.wav"' in body and b"verbose_json" in body and b"Redis" in body
        wav_start = body.index(b"RIFF")
        wav_size = int.from_bytes(body[wav_start + 4:wav_start + 8], "little") + 8
        with wave.open(io.BytesIO(body[wav_start:wav_start + wav_size])) as wav:
            assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (16000, 1, 2)
            assert wav.readframes(wav.getnframes()) == b"\0\0" * 16000
        return httpx.Response(200, json={"text": "缓存", "words": timings})
    events = transcribe(handler, b"\0\0" * 16000)
    assert len(events) == 1 and events[0].final and events[0].text == "缓存"
    assert len(events[0].words) == (1 if timings else 0)
    if timings:
        assert events[0].words[0].start_ms == 100 and events[0].words[0].end_ms == 400


@pytest.mark.parametrize("response", [
    httpx.Response(429, json={"error": "fictional-key"}), httpx.Response(200, content=b"not JSON"),
    httpx.Response(200, json={"text": None}), httpx.Response(200, json={"text": "x", "words": "invalid"}),
    httpx.Response(200, json={"text": "x", "words": [{"word": "x", "start": -1, "end": 0}]}),
    httpx.Response(200, json={"text": "x", "words": [{"word": "x", "start": 0, "end": 200}]}),
])
def test_asr_errors_are_bounded_public_errors_without_upstream_content(response):
    with pytest.raises(SpeechProviderError) as error:
        transcribe(lambda request: response, b"\0\0" * 16000)
    assert str(error.value) == "MOCK_INTERVIEW_SPEECH_FAILED"
    assert error.value.__cause__ is None


@pytest.mark.parametrize("chunks", [(), (b"x",), (b"\0" * (MAX_PCM_BYTES + 2),)])
def test_invalid_or_oversized_recording_never_reaches_provider(chunks):
    def handler(request):
        pytest.fail("invalid audio was sent")
    with pytest.raises(SpeechProviderError):
        transcribe(handler, *chunks)


def test_qwen_audio_url_is_downloaded_with_tls_without_authorization():
    calls = []
    def handler(request):
        calls.append(request)
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["voice"] == "longanhuan_v3.6" and body["response_format"] == "mp3"
            return httpx.Response(200, json={"output": {"audio": {"url": f"http://{STORAGE}/audio.mp3?signature=fictional"}}})
        assert request.url.scheme == "https" and request.url.host == STORAGE
        assert "authorization" not in request.headers and "cookie" not in request.headers
        return httpx.Response(200, content=MP3)
    assert synthesize(handler) == MP3
    assert len(calls) == 2


def test_tts1_returns_binary_mp3_without_download():
    def handler(request):
        assert json.loads(request.content)["voice"] == "alloy"
        return httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})
    assert synthesize(handler, "tts-1") == MP3


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/audio.mp3", f"https://{STORAGE}.invalid/audio.mp3",
    f"https://user:password@{STORAGE}/audio.mp3", f"https://{STORAGE}:443/audio.mp3",
    f"https://{STORAGE}/audio.mp3#fragment", "file:///tmp/audio.mp3",
])
def test_untrusted_download_urls_are_rejected_without_network_request(url):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"output": {"audio": {"url": url}}})
    with pytest.raises(SpeechProviderError):
        synthesize(handler)
    assert len(calls) == 1


@pytest.mark.parametrize("response", [
    httpx.Response(302, headers={"location": "https://example.invalid/audio"}),
    httpx.Response(200, content=b"RIFFthis is not MP3"), httpx.Response(200, json={"error": "failed"}),
    httpx.Response(200, content=b"ID3" + b"x" * MAX_RESPONSE_BYTES),
])
def test_tts_rejects_redirects_wrong_format_error_json_and_oversized_body(response):
    with pytest.raises(SpeechProviderError):
        synthesize(lambda request: response)


def test_network_timeout_is_sanitized_and_cancellation_propagates():
    for exception in (httpx.ReadTimeout("fictional secret"), asyncio.CancelledError()):
        def handler(request):
            raise exception
        with pytest.raises(asyncio.CancelledError if isinstance(exception, asyncio.CancelledError) else SpeechProviderError):
            synthesize(handler)


def test_router_selects_provider_for_both_speech_operations():
    class FakeSpeech:
        def __init__(self):
            self.calls = []
        async def recognize(self, target, audio, **kwargs):
            self.calls.append(target)
            yield RecognitionEvent("虚构回答", 0, True)
        async def synthesize(self, target, text, **kwargs):
            self.calls.append(target)
            return MP3
    async def run():
        aliyun, aihubmix = FakeSpeech(), FakeSpeech()
        router = ProviderSpeechGateway(aliyun=aliyun, aihubmix=aihubmix)
        assert await router.synthesize(TARGET, "虚构题目", voice=None) == MP3
        assert [event.text async for event in router.recognize(TARGET, frames(), hotwords=[], language="zh")] == ["虚构回答"]
        assert not aliyun.calls and len(aihubmix.calls) == 2
        target = SpeechTarget("wss://example.invalid", "fictional", "fictional")
        assert await router.synthesize(target, "虚构题目", voice=None) == MP3
        assert len(aliyun.calls) == 1
        with pytest.raises(SpeechProviderError):
            await router.synthesize(SpeechTarget("", "", "", provider_code="unknown"), "x", voice=None)
    asyncio.run(run())
