from __future__ import annotations

import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from linkresume.core.database import utc_now
from linkresume.modules.llm.models import (
    LLMCallLog,
    LLMModel,
    LLMModelRoute,
    LLMProviderConnection,
    LLMUseCaseRoute,
)
from linkresume.modules.llm.resolver import (
    SPEECH_TO_TEXT,
    TEXT_TO_SPEECH,
    TRANSCRIPT_CORRECTION,
    validation_fingerprint,
)
from linkresume.modules.mock_interviews.models import MockInterview, MockInterviewQuestion
from linkresume.modules.speech.gateway import RecognitionEvent, SpeechProviderError, SpeechWord
from tests.integration.api.test_interviews import register
from tests.integration.api.test_mock_interviews import (
    FakeStorage,
    ScriptedGateway,
    build_app,
    database_dir,  # noqa: F401  (autouse file-backed SQLite)
    sse_events,
    start_interview,
    wait_for,
)

ORIGIN = {"origin": "http://testserver"}
PCM = b"\x01\x00" * 16_000  # one second of 16 kHz PCM16


class FakeSpeech:
    """Recognises every recording as ``transcripts[n]`` and synthesises bytes."""

    def __init__(self) -> None:
        self.transcripts: list[str] = []
        self.fail_recognition = False
        self.fail_after_partial = False
        self.fail_synthesis = False
        self.synthesized: list[str] = []

    async def recognize(self, target, audio, *, hotwords, language):
        del target, hotwords, language
        async for _chunk in audio:
            if self.fail_recognition:
                raise SpeechProviderError()
            yield RecognitionEvent(text="识别中", sentence_id=0, final=False)
        if self.fail_after_partial:
            raise SpeechProviderError()
        text = self.transcripts.pop(0) if self.transcripts else "我用火焰图定位热点，也对比过本地缓存。"
        words = []
        cursor = 0
        for index, char in enumerate(text):
            # A 4 s gap before the 5th character gives one long pause.
            cursor += 4_000 if index == 4 else 200
            words.append(SpeechWord(text=char, start_ms=cursor, end_ms=cursor + 150))
        yield RecognitionEvent(text=text, sentence_id=0, final=True, words=tuple(words))

    async def synthesize(self, target, text, *, voice):
        del target, voice
        if self.fail_synthesis:
            raise SpeechProviderError()
        self.synthesized.append(text)
        return b"ID3" + text.encode()


class CorrectingGateway(ScriptedGateway):
    """Adds the transcript-correction prompt family."""

    def __init__(self) -> None:
        super().__init__()
        self.corrections: list[dict] = []

    async def complete(self, *, model, messages, api_base, api_key, protocol_code="openai_chat"):
        system = self._system(messages)
        if "语音识别校对员" in system:
            from linkresume.modules.llm.gateway import GatewayResult, GatewayUsage

            payload = self.corrections.pop(0)
            return GatewayResult(content=json.dumps(payload, ensure_ascii=False),
                                 usage=GatewayUsage(input_tokens=5, output_tokens=5))
        return await super().complete(model=model, messages=messages, api_base=api_base, api_key=api_key, protocol_code=protocol_code)


def _bind(app, use_case: str, protocol: str, *, provider: str, settings: dict, target: str) -> None:
    with app.state.session_factory() as db:
        connection = db.scalar(
            select(LLMProviderConnection).where(LLMProviderConnection.provider_code == provider)
        )
        if connection is None:
            connection = LLMProviderConnection(
                provider_code=provider, name=f"{provider}-test",
                credential_ciphertext=app.state.llm_service.encrypt_credential(json.dumps({"api_key": "fictional-key"})),
                settings_json=settings, is_enabled=True, runtime_config_version=1,
            )
            db.add(connection)
            db.flush()
        model = LLMModel(display_name=target)
        db.add(model)
        db.flush()
        route = LLMModelRoute(
            model_id=model.id, connection_id=connection.id, target_kind="model", invoke_target=target,
            origin="manual", is_enabled=True, is_target_available=True,
        )
        db.add(route)
        db.flush()
        binding = LLMUseCaseRoute(
            use_case=use_case, route_id=route.id, protocol_code=protocol, priority=100,
            is_enabled=True, validated_at=utc_now(),
        )
        db.add(binding)
        db.flush()
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()


def configure_speech(app) -> None:
    settings = {"region": "cn-beijing", "workspace_id": "ws-test"}
    _bind(app, SPEECH_TO_TEXT, "aliyun_asr_realtime", provider="aliyun", settings=settings, target="fun-asr-realtime")
    _bind(app, TEXT_TO_SPEECH, "aliyun_tts_realtime", provider="aliyun", settings=settings, target="cosyvoice-v3-flash")
    _bind(app, TRANSCRIPT_CORRECTION, "openai_chat", provider="aliyun", settings=settings, target="qwen-flash")


def voice_app(gateway=None, *, speech: FakeSpeech | None = None, storage: FakeStorage | None = None, configure=True):
    speech = speech or FakeSpeech()
    import linkresume.main as main_module

    original = main_module.create_app

    def create_app(*args, **kwargs):
        kwargs.setdefault("speech_gateway", speech)
        return original(*args, **kwargs)

    main_module.create_app = create_app
    try:
        import tests.integration.api.test_mock_interviews as base

        base_create = base.create_app
        base.create_app = create_app
        try:
            app = build_app(gateway or CorrectingGateway(), storage=storage)
        finally:
            base.create_app = base_create
    finally:
        main_module.create_app = original
    if configure:
        configure_speech(app)
    return app, speech


def recognize(client: TestClient, interview_id: str, question_id: str, purpose: str = "voice_answer") -> dict:
    url = f"/api/mock-interviews/{interview_id}/speech?question_id={question_id}&purpose={purpose}"
    with client.websocket_connect(url, headers=ORIGIN) as socket:
        socket.send_bytes(PCM[:16_000])
        socket.send_bytes(PCM[16_000:])
        socket.send_text(json.dumps({"type": "stop"}))
        events = []
        while True:
            try:
                events.append(socket.receive_json())
            except WebSocketDisconnect:
                break
            if events[-1]["type"] in ("final", "error"):
                break
    assert events and events[0]["type"] in ("partial", "error")
    return events[-1]


def voice_answer(client, interview_id, question_id, session_id, key=None):
    return client.post(
        f"/api/mock-interviews/{interview_id}/answers",
        json={"question_id": question_id, "speech_session_id": session_id},
        headers={"Idempotency-Key": key or uuid4().hex},
    )


def run_voice_interview(client, app, speech: FakeSpeech, transcripts: list[str]) -> dict:
    speech.transcripts = list(transcripts)
    created = start_interview(client, app, answer_mode="voice")
    assert created["answer_mode"] == "voice"
    with app.state.session_factory() as db:
        stored = db.scalar(select(MockInterview).where(MockInterview.public_id == created["id"]))
        assert stored.speech_snapshot_json["text_to_speech"]["model"] == "cosyvoice-v3-flash"
    detail = wait_for(client, created["id"], {"in_progress"})
    for _ in range(len(transcripts)):
        question = detail["questions"][-1]
        final = recognize(client, created["id"], question["id"])
        assert final["type"] == "final" and final["words"]
        events = sse_events(voice_answer(client, created["id"], question["id"], final["session_id"]).text)
        names = [name for name, _ in events]
        assert names[0] == "answer.accepted"
        if names[-1] == "interviewer.turn" and next(d for n, d in events if n == "interviewer.turn")["action"] == "finish":
            break
        detail = wait_for(client, created["id"], {"in_progress", "evaluating", "completed"})
    return wait_for(client, created["id"], {"completed"})


def test_voice_interview_saves_recordings_speaks_and_reports_voice_metrics() -> None:
    storage = FakeStorage()
    gateway = CorrectingGateway()
    app, speech = voice_app(gateway, storage=storage)
    with TestClient(app) as client:
        register(client, "voice-full@example.test")
        assert client.get("/api/mock-interviews/speech-capability").json() == {"stt": True, "tts": True}
        report_detail = run_voice_interview(client, app, speech, ["我用瑞迪斯做缓存，嗯，那个 QPS 一千"] * 4)
        answered = [q for q in report_detail["questions"] if q["answer_status"] == "answered"]
        assert answered and all(q["answer_source"] == "voice" and q["has_recording"] for q in answered)
        assert answered[0]["raw_transcript"] == "我用瑞迪斯做缓存，嗯，那个 QPS 一千"
        assert answered[0]["transcript_state"] == "original"
        report = report_detail["report"]
        assert report["answer_mode"] == "voice" and report["rubric_version"] == "v4"
        metrics = report["voice_metrics"]
        assert metrics["long_pauses"] == len(answered)
        assert metrics["filler_ratio"] > 0 and metrics["chars_per_minute"] > 0
        # The interviewer's replies were synthesised sentence by sentence.
        assert speech.synthesized
        recordings = [name for name in storage.objects if name.startswith("mock-interviews/")]
        assert len(recordings) == len(answered)
        assert storage.objects[recordings[0]][:4] == b"RIFF"
        audio = client.get(f"/api/mock-interviews/{report_detail['id']}/questions/{answered[0]['id']}/recording")
        assert audio.status_code == 200 and audio.headers["content-type"] == "audio/wav"
        # Evaluation prompts said the answers are transcripts.
        assert any("语音识别转写" in system for system in gateway.systems)

        assert client.delete(f"/api/mock-interviews/{report_detail['id']}").status_code == 200
        assert not [name for name in storage.objects if name.startswith("mock-interviews/")]
    with app.state.session_factory() as db:
        snapshot = db.scalars(select(MockInterview.speech_snapshot_json)).all()
        assert snapshot == [] or all(item is None or item["speech_to_text"]["model"] == "fun-asr-realtime" for item in snapshot)
        speech_logs = db.scalars(select(LLMCallLog).where(LLMCallLog.use_case.in_([SPEECH_TO_TEXT, TEXT_TO_SPEECH]))).all()
        assert {log.use_case for log in speech_logs} == {SPEECH_TO_TEXT, TEXT_TO_SPEECH}
        assert all(log.status == "succeeded" for log in speech_logs)
        assert any((log.usage_json or {}).get("audio_seconds") == 1.0 for log in speech_logs)


def test_turn_audio_is_sent_as_sse_and_tts_failure_only_drops_audio() -> None:
    app, speech = voice_app()
    with TestClient(app) as client:
        register(client, "voice-tts@example.test")
        created = start_interview(client, app, answer_mode="voice")
        detail = wait_for(client, created["id"], {"in_progress"})
        question = detail["questions"][-1]
        final = recognize(client, created["id"], question["id"])
        events = sse_events(voice_answer(client, created["id"], question["id"], final["session_id"]).text)
        audio = [data for name, data in events if name == "interviewer.audio"]
        assert audio and [item["seq"] for item in audio] == list(range(len(audio)))
        assert "".join(item["text"] for item in audio).startswith("好的")
        names = [name for name, _ in events]
        assert names.index("interviewer.audio") < names.index("interviewer.turn")

        speech.fail_synthesis = True
        question = wait_for(client, created["id"], {"in_progress"})["questions"][-1]
        final = recognize(client, created["id"], question["id"])
        events = sse_events(voice_answer(client, created["id"], question["id"], final["session_id"]).text)
        names = [name for name, _ in events]
        assert "interviewer.audio_failed" in names and "interviewer.turn" in names
        assert "interviewer.audio" not in names


def test_voice_interview_rejects_typed_answers_and_reused_or_foreign_sessions() -> None:
    app, _ = voice_app()
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "voice-owner@example.test")
        created = start_interview(owner, app, answer_mode="voice")
        question = wait_for(owner, created["id"], {"in_progress"})["questions"][-1]
        typed = owner.post(
            f"/api/mock-interviews/{created['id']}/answers",
            json={"question_id": question["id"], "answer": "打字作答"},
            headers={"Idempotency-Key": uuid4().hex},
        )
        assert typed.status_code == 422 and typed.json()["error"] == "MOCK_INTERVIEW_SPEECH_SESSION_INVALID"

        final = recognize(owner, created["id"], question["id"])
        register(other, "voice-other@example.test")
        foreign = voice_answer(other, created["id"], question["id"], final["session_id"])
        assert foreign.status_code in (404, 409)
        # A failed attempt returns the session, so the owner can still use it once.
        assert voice_answer(owner, created["id"], question["id"], final["session_id"]).status_code == 200
        reused = voice_answer(owner, created["id"], question["id"], final["session_id"])
        assert reused.status_code == 409 and reused.json()["error"] == "MOCK_INTERVIEW_SPEECH_SESSION_INVALID"


def test_speech_socket_requires_same_origin_owner_and_current_question() -> None:
    app, speech = voice_app()
    with TestClient(app) as client, TestClient(app) as other:
        register(client, "voice-ws@example.test")
        created = start_interview(client, app, answer_mode="voice")
        question = wait_for(client, created["id"], {"in_progress"})["questions"][-1]
        url = f"/api/mock-interviews/{created['id']}/speech?question_id={question['id']}&purpose=voice_answer"
        with pytest.raises(WebSocketDisconnect) as blocked:
            with client.websocket_connect(url, headers={"origin": "https://evil.example"}) as socket:
                socket.receive_json()
        assert blocked.value.code == 4403
        register(other, "voice-ws-other@example.test")
        with pytest.raises(WebSocketDisconnect) as foreign:
            with other.websocket_connect(url, headers=ORIGIN) as socket:
                socket.receive_json()
        assert foreign.value.code == 4409
        wrong = url.replace(f"question_id={question['id']}", "question_id=999999")
        with pytest.raises(WebSocketDisconnect) as stale:
            with client.websocket_connect(wrong, headers=ORIGIN) as socket:
                socket.receive_json()
        assert stale.value.code == 4409
        # Voice input is for text interviews only.
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(url.replace("voice_answer", "voice_input"), headers=ORIGIN) as socket:
                socket.receive_json()

        speech.fail_after_partial = True
        kept = recognize(client, created["id"], question["id"])
        # Text recognised before the failure is kept and marked partial.
        assert kept["type"] == "final" and kept["partial"] is True and kept["text"] == "识别中"
        speech.fail_after_partial = False
        speech.fail_recognition = True
        error = recognize(client, created["id"], question["id"])
        assert error == {"type": "error", "code": "MOCK_INTERVIEW_SPEECH_FAILED"}


def test_voice_input_in_text_interview_keeps_no_recording() -> None:
    storage = FakeStorage()
    app, speech = voice_app(storage=storage)
    with TestClient(app) as client:
        register(client, "voice-input@example.test")
        created = start_interview(client, app)
        question = wait_for(client, created["id"], {"in_progress"})["questions"][-1]
        speech.transcripts = ["我用火焰图定位热点"]
        final = recognize(client, created["id"], question["id"], purpose="voice_input")
        assert final["text"] == "我用火焰图定位热点"
        response = client.post(
            f"/api/mock-interviews/{created['id']}/answers",
            json={"question_id": question["id"], "answer": "我用火焰图定位热点（已修改）",
                  "speech_session_id": final["session_id"]},
            headers={"Idempotency-Key": uuid4().hex},
        )
        assert response.status_code == 200
        stored = next(q for q in wait_for(client, created["id"], {"in_progress"})["questions"] if q["id"] == question["id"])
        assert stored["answer_text"] == "我用火焰图定位热点（已修改）"
        assert stored["answer_source"] == "voice_input" and stored["audio_duration_ms"] == 1000
        assert stored["has_recording"] is False and stored["raw_transcript"] is None
        assert not [name for name in storage.objects if name.startswith("mock-interviews/")]


def test_voice_mode_requires_configured_speech() -> None:
    app, _ = voice_app(configure=False)
    with TestClient(app) as client:
        register(client, "voice-unconfigured@example.test")
        assert client.get("/api/mock-interviews/speech-capability").json() == {"stt": False, "tts": False}
        from tests.integration.api.test_mock_interviews import create_resume

        resume = create_resume(client, app)
        response = client.post("/api/mock-interviews", json={"resume_id": resume["id"], "answer_mode": "voice"})
        assert response.status_code == 503 and response.json()["error"] == "MOCK_INTERVIEW_SPEECH_UNAVAILABLE"
        with app.state.session_factory() as db:
            assert db.scalar(select(MockInterview.id)) is None


def test_correction_once_edit_limits_and_re_evaluation() -> None:
    gateway = CorrectingGateway()
    app, speech = voice_app(gateway)
    original = "我用瑞迪斯做缓存，嗯，那个 QPS 从两千提升到一万，主要靠本地缓存和批量写入"
    gateway.corrections = [
        {"corrected": original.replace("瑞迪斯", "Redis"),
         "changes": [{"original": "瑞迪斯", "corrected": "Redis", "reason": "术语"}]},
        {"corrected": "完全改写成了另一段内容，增加了很多没有说过的观点和细节", "changes": []},
        {"corrected": original, "changes": []},
    ]
    with TestClient(app) as client:
        register(client, "voice-correct@example.test")
        detail = run_voice_interview(client, app, speech, [original] * 4)
        interview_id = detail["id"]
        roots = [q for q in detail["questions"] if q["kind"] == "main" and q["answer_status"] == "answered"]

        # Re-evaluation needs an updated transcript first.
        early = client.post(f"/api/mock-interviews/{interview_id}/questions/{roots[0]['id']}/re-evaluate")
        assert early.status_code == 409

        corrected = client.post(f"/api/mock-interviews/{interview_id}/transcripts:correct")
        assert corrected.status_code == 200, corrected.text
        states = [item["state"] for item in corrected.json()["items"]]
        assert states == ["corrected", "correction_rejected", "original", "correction_rejected"]
        body = corrected.json()["mock_interview"]
        assert body["transcript_corrected_at"] is not None
        first = next(q for q in body["questions"] if q["id"] == roots[0]["id"])
        assert first["answer_text"].startswith("我用Redis") and first["raw_transcript"] == original
        assert first["correction"]["changes"][0]["corrected"] == "Redis"
        again = client.post(f"/api/mock-interviews/{interview_id}/transcripts:correct")
        assert again.status_code == 409 and again.json()["error"] == "MOCK_INTERVIEW_TRANSCRIPT_ALREADY_CORRECTED"

        edit_url = f"/api/mock-interviews/{interview_id}/questions/{roots[1]['id']}/transcript"
        too_much = client.put(edit_url, json={"text": "完全不同的一段话"})
        assert too_much.status_code == 422
        assert too_much.json()["error"] == "MOCK_INTERVIEW_TRANSCRIPT_CORRECTION_REJECTED"
        edited = client.put(edit_url, json={"text": original.replace("两千", "2000")})
        assert edited.status_code == 200
        second = next(q for q in edited.json()["mock_interview"]["questions"] if q["id"] == roots[1]["id"])
        assert second["transcript_state"] == "edited"

        url = f"/api/mock-interviews/{interview_id}/questions/{roots[0]['id']}/re-evaluate"

        def set_rubric(version: str) -> None:
            with app.state.session_factory() as db:
                row = db.scalar(select(MockInterview).where(MockInterview.public_id == interview_id))
                row.report_json = {**row.report_json, "rubric_version": version}
                db.commit()

        # Reports scored under an older rubric are read-only and do not spend an attempt.
        set_rubric("v3")
        outdated = client.post(url)
        assert outdated.status_code == 409 and outdated.json()["error"] == "MOCK_INTERVIEW_REPORT_OUTDATED"
        set_rubric("v4")
        for count in (1, 2, 3):
            result = client.post(url)
            assert result.status_code == 200, result.text
            data = result.json()
            assert data["re_evaluate_count"] == count and data["remaining"] == 3 - count
        report = data["mock_interview"]["report"]
        assert [item["count"] for item in report["re_evaluations"]] == [1, 2, 3]
        scores = [item["score"] for item in report["questions"] if not item["is_intro"]]
        assert report["total_score"] == pytest.approx(sum(scores) / len(scores), abs=0.01)
        assert report["re_evaluations"][-1]["verdict"] == report["verdict"]["level"]
        assert data["mock_interview"]["total_score"] == pytest.approx(report["total_score"])
        root = next(q for q in data["mock_interview"]["questions"] if q["id"] == roots[0]["id"])
        assert len(root["evaluation_history"]) == 3
        limit = client.post(url)
        assert limit.status_code == 409 and limit.json()["error"] == "MOCK_INTERVIEW_RE_EVALUATE_LIMIT"

        deleted = client.delete(f"/api/mock-interviews/{interview_id}/recordings")
        assert deleted.status_code == 200 and deleted.json()["mock_interview"]["recordings_deleted"] is True
        assert client.put(edit_url, json={"text": original}).status_code == 404
        assert client.get(
            f"/api/mock-interviews/{interview_id}/questions/{roots[0]['id']}/recording"
        ).status_code == 404
    with app.state.session_factory() as db:
        rows = db.scalars(select(MockInterviewQuestion).where(MockInterviewQuestion.recording_object_name.is_not(None))).all()
        assert rows == []
        correction_logs = db.scalars(select(LLMCallLog).where(LLMCallLog.use_case == TRANSCRIPT_CORRECTION)).all()
        assert len(correction_logs) == 4  # intro + 3 requested questions


def test_text_interview_rejects_correction() -> None:
    app, _ = voice_app()
    with TestClient(app) as client:
        register(client, "voice-text-correct@example.test")
        created = start_interview(client, app)
        response = client.post(f"/api/mock-interviews/{created['id']}/transcripts:correct")
        assert response.status_code == 409 and response.json()["error"] == "MOCK_INTERVIEW_STATE_INVALID"
