from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.modules.mock_interviews.models import MockInterview
from tests.integration.api.test_mock_interviews import seed_dataset
from tests.integration.api.test_mock_interview_voice import (
    CorrectingGateway, FakeStorage, voice_app, recognize, run_voice_interview,
    voice_answer, start_interview, wait_for, register, sse_events,
    database_dir,  # noqa: F401
)


def test_device_and_current_question_playback_use_owned_server_text():
    app, speech = voice_app()
    with TestClient(app) as client:
        register(client, "playback@example.test")
        created = start_interview(client, app, answer_mode="voice", language="en")
        detail = wait_for(client, created["id"], {"in_progress"})
        base = f"/api/mock-interviews/{created['id']}/speech/playback"
        preview = client.post(base, json={})
        assert preview.status_code == 200 and preview.headers["content-type"] == "audio/mpeg"
        assert preview.headers["cache-control"] == "no-store"
        assert speech.synthesized[-1].startswith("Hello")
        qid = detail["current_question_id"]
        question = client.post(base, json={"question_id": qid})
        assert question.status_code == 200
        assert speech.synthesized[-1] == detail["questions"][0]["content"]
        assert client.post(base, json={"text": "任意输入"}).status_code == 422
        assert client.post(base, json={"question_id": "999999"}).status_code == 409
        client.post(f"/api/mock-interviews/{created['id']}/abandon")
        assert client.post(base, json={"question_id": qid}).status_code == 409
        client.post("/api/auth/logout")
        register(client, "other-playback@example.test")
        assert client.post(base, json={}).status_code == 404


def test_playback_provider_failure_is_not_successful_audio():
    app, speech = voice_app()
    with TestClient(app) as client:
        register(client, "playback-fail@example.test")
        created = start_interview(client, app, answer_mode="voice")
        speech.fail_synthesis = True
        response = client.post(f"/api/mock-interviews/{created['id']}/speech/playback", json={})
        assert response.status_code == 502


def test_repeat_can_switch_to_text_without_losing_pasted_job_snapshot():
    storage = FakeStorage()
    app, speech = voice_app(storage=storage)
    with TestClient(app) as client:
        register(client, "repeat-mode@example.test")
        material = seed_dataset(app, "repeat-mode@example.test", storage, "# 项目资料\n缓存开发实践")
        created = start_interview(client, app, answer_mode="voice", job_description_text="虚构岗位：缓存服务开发", target_role="后端开发", material_ids=[material], materials_in_questions=True)
        wait_for(client, created["id"], {"in_progress"})
        assert client.post(f"/api/mock-interviews/{created['id']}/abandon").status_code == 200
        response = client.post(f"/api/mock-interviews/{created['id']}/repeat", json={"answer_mode": "text"})
        assert response.status_code == 201
        repeated = response.json()["mock_interview"]
        assert repeated["answer_mode"] == "text" and repeated["repeat_of_id"] == created["id"]
        assert repeated["materials_in_questions"] is True
        with app.state.session_factory() as db:
            row = db.scalar(select(MockInterview).where(MockInterview.public_id == repeated["id"]))
            assert row.job_snapshot_json["description"] == "虚构岗位：缓存服务开发"
            assert row.resume_id == int(created["resume_id"])
            assert row.speech_snapshot_json is None


def test_voice_answer_replay_accepts_consumed_session_without_duplicate_recording():
    storage = FakeStorage()
    app, speech = voice_app(storage=storage)
    with TestClient(app) as client:
        register(client, "voice-idempotency@example.test")
        created = start_interview(client, app, answer_mode="voice")
        detail = wait_for(client, created["id"], {"in_progress"})
        qid = detail["current_question_id"]
        final = recognize(client, created["id"], qid)
        key = uuid4().hex
        first = voice_answer(client, created["id"], qid, final["session_id"], key)
        assert first.status_code == 200
        names = storage.list_names("mock-interviews/")
        replay = voice_answer(client, created["id"], qid, final["session_id"], key)
        assert replay.status_code == 200
        accepted = sse_events(replay.text)[0]
        assert accepted[0] == "answer.accepted" and accepted[1]["skipped"] is False
        assert storage.list_names("mock-interviews/") == names
        stored = client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]
        assert len([q for q in stored["questions"] if q["answer_status"] == "answered"]) == 1
        assert voice_answer(client, created["id"], qid, final["session_id"], uuid4().hex).status_code == 409


def test_recording_upload_failure_restores_speech_session_for_retry(monkeypatch):
    storage = FakeStorage()
    app, speech = voice_app(storage=storage)
    with TestClient(app) as client:
        register(client, "record-store-fail@example.test")
        created = start_interview(client, app, answer_mode="voice")
        detail = wait_for(client, created["id"], {"in_progress"})
        qid = detail["current_question_id"]
        final = recognize(client, created["id"], qid)
        upload = storage.upload_stream
        def fail(*args, **kwargs):
            raise RuntimeError("storage unavailable")
        monkeypatch.setattr(storage, "upload_stream", fail)
        key = uuid4().hex
        response = voice_answer(client, created["id"], qid, final["session_id"], key)
        assert response.status_code == 502 and response.json()["error"] == "MOCK_INTERVIEW_RECORDING_STORE_FAILED"
        latest = client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]
        assert latest["questions"][0]["answer_status"] == "pending"
        monkeypatch.setattr(storage, "upload_stream", upload)
        assert voice_answer(client, created["id"], qid, final["session_id"], key).status_code == 200
        assert storage.list_names("mock-interviews/")


@pytest.mark.parametrize("delete_interview", [False, True])
def test_failed_recording_deletion_retains_references_for_retry(monkeypatch, delete_interview):
    storage = FakeStorage()
    app, speech = voice_app(CorrectingGateway(), storage=storage)
    with TestClient(app) as client:
        register(client, "record-delete-fail@example.test")
        detail = run_voice_interview(client, app, speech, ["张三说明缓存一致性方案。"] * 3)
        base = f"/api/mock-interviews/{detail['id']}"
        url = base if delete_interview else base + "/recordings"
        names = storage.list_names("mock-interviews/")
        prefix = names[0].rsplit("/", 1)[0] + "/"
        storage.objects[prefix + "unaccepted-attempt.wav"] = b"fictional audio"
        other_name = "mock-interviews/other-user/other-interview/recording.wav"
        storage.objects[other_name] = b"another fictional recording"
        listing = storage.list_names
        def fail_listing(*args):
            raise RuntimeError("storage unavailable")
        monkeypatch.setattr(storage, "list_names", fail_listing)
        response = client.delete(url)
        assert response.status_code == 502 and response.json()["error"] == "MOCK_INTERVIEW_RECORDING_DELETE_FAILED"
        assert client.get(base).json()["mock_interview"]["recordings_deleted"] is False
        assert all(name in storage.objects for name in names)
        monkeypatch.setattr(storage, "list_names", listing)
        delete = storage.delete
        calls = 0
        def fail_second(name):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("storage unavailable")
            delete(name)
        monkeypatch.setattr(storage, "delete", fail_second)
        response = client.delete(url)
        assert response.status_code == 502 and response.json()["error"] == "MOCK_INTERVIEW_RECORDING_DELETE_FAILED"
        retained = client.get(base)
        assert retained.status_code == 200
        retained = retained.json()["mock_interview"]
        assert retained["recordings_deleted"] is False
        assert len([q for q in retained["questions"] if q["has_recording"]]) == len(names)
        assert storage.list_names(prefix)
        monkeypatch.setattr(storage, "delete", delete)
        assert client.delete(url).status_code == 200
        assert not storage.list_names(prefix)
        assert storage.objects[other_name] == b"another fictional recording"
        if delete_interview:
            assert client.get(base).status_code == 404
        else:
            assert client.get(base).json()["mock_interview"]["recordings_deleted"] is True
