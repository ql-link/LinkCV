import asyncio
from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from drawoffer.application.interviews.transcription_service import TranscriptionRunner
from drawoffer.modules.interviews.models import InterviewRecordingTranscription
from drawoffer.modules.llm.service import LLMError
from drawoffer.modules.speech.file_transcription import (
    TaskStatus,
    Transcript,
    TranscriptionProviderError,
)
from drawoffer.modules.speech.gateway import SpeechTarget
from tests.integration.api.test_interviews import (
    FakeStorage,
    asset_headers,
    build_app,
    create_application,
    create_job,
    register,
    session_payload,
)


class PublicStorage(FakeStorage):
    public_downloads_enabled = True

    def presigned_public_get_url(self, object_name: str, expires: timedelta) -> str:
        assert expires == timedelta(hours=6)
        return f"https://minio.example.test/{object_name}?signed"


class FakeLLM:
    def __init__(self, configured: bool = True) -> None:
        self.configured = configured
        self.calls: list[dict] = []

    async def speech_plan(self, use_case: str):
        if not self.configured:
            raise LLMError("LLM_MODEL_NOT_CONFIGURED")
        return object()

    def speech_target_for_plan(self, plan) -> SpeechTarget:
        return SpeechTarget(ws_url="wss://dashscope.example.test/api-ws/v1/inference/", api_key="k", model="paraformer-realtime-v2")

    async def start_speech_call(self, plan, *, source: str, user_id: int | None) -> str:
        self.calls.append({"source": source, "user_id": user_id})
        return "call"

    async def finish_speech_call(self, call_id, *, started, error_code=None, cancelled=False, details=None) -> None:
        self.calls[-1].update(error_code=error_code, details=details)


class FakeTranscriber:
    def __init__(self) -> None:
        self.submitted: list[str] = []
        self.state = "running"
        self.submit_error: TranscriptionProviderError | None = None

    def submit(self, target, file_url: str) -> str:
        if self.submit_error:
            raise self.submit_error
        self.submitted.append(file_url)
        return f"task-{len(self.submitted)}"

    def query(self, target, task_id: str) -> TaskStatus:
        if self.state == "succeeded":
            return TaskStatus("succeeded", result_url="https://result.example.test/r.json")
        if self.state == "failed":
            return TaskStatus("failed", error_code="INTERVIEW_TRANSCRIPTION_FORMAT_UNSUPPORTED")
        return TaskStatus("running")

    def fetch(self, result_url: str) -> Transcript:
        return Transcript(markdown="面试官：请介绍一下项目。\n\n我：我负责示例系统的重构。", duration_ms=90_000)


def setup_session(client: TestClient, email: str) -> dict:
    register(client, email)
    application = create_application(client, create_job(client, "示例转写公司"))
    created = client.post(
        f"/api/job-applications/{application['id']}/interview-sessions",
        json=session_payload(str(uuid4())),
    )
    assert created.status_code == 201, created.text
    return created.json()["session"]


def upload_audio(client: TestClient, session_id: str) -> str:
    uploaded = client.post(
        f"/api/interview-sessions/{session_id}/assets",
        data={"source_type": "uploaded", "duration_ms": "90000"},
        files={"file": ("interview.m4a", b"fake-audio", "audio/mp4")},
        headers=asset_headers(),
    )
    assert uploaded.status_code == 201, uploaded.text
    return uploaded.json()["asset"]["id"]


def make_due(app) -> None:
    with app.state.session_factory() as db:
        for row in db.scalars(select(InterviewRecordingTranscription)):
            row.next_attempt_at = row.next_attempt_at - timedelta(hours=1)
            row.lease_until = None
        db.commit()


def run_round(app, runner) -> None:
    make_due(app)
    asyncio.run(runner.run_once())


def session_detail(client: TestClient, session_id: str) -> dict:
    response = client.get(f"/api/interview-sessions/{session_id}")
    assert response.status_code == 200, response.text
    return response.json()["session"]


def test_uploaded_recording_is_transcribed_into_an_empty_session():
    storage = PublicStorage()
    app = build_app(storage)
    llm, transcriber = FakeLLM(), FakeTranscriber()
    runner = TranscriptionRunner(app.state.session_factory, storage, llm, transcriber)
    with TestClient(app) as client:
        session = setup_session(client, "transcribe-empty@example.test")
        dataset_id = upload_audio(client, session["id"])
        queued = session_detail(client, session["id"])
        assert queued["transcriptions"][0]["status"] == "queued"
        assert queued["transcriptions"][0]["dataset_id"] == dataset_id

        run_round(app, runner)
        assert transcriber.submitted and "?signed" in transcriber.submitted[0]
        assert session_detail(client, session["id"])["transcriptions"][0]["status"] == "running"

        transcriber.state = "succeeded"
        run_round(app, runner)
        done = session_detail(client, session["id"])
        assert done["transcriptions"][0]["status"] == "succeeded"
        assert done["transcriptions"][0]["pending_replace"] is False
        assert done["questions_markdown"].startswith("面试官：请介绍一下项目。")
        assert done["transcript_source"] == "transcription"
        assert llm.calls[-1]["details"] == {"audio_seconds": 90.0}
        assert llm.calls[-1]["source"] == "interview_transcription"


def test_existing_transcript_is_kept_until_the_user_replaces_it():
    storage = PublicStorage()
    app = build_app(storage)
    transcriber = FakeTranscriber()
    transcriber.state = "succeeded"
    runner = TranscriptionRunner(app.state.session_factory, storage, FakeLLM(), transcriber)
    with TestClient(app) as client:
        session = setup_session(client, "transcribe-keep@example.test")
        dataset_id = upload_audio(client, session["id"])
        current = session_detail(client, session["id"])
        edited = client.put(f"/api/interview-sessions/{session['id']}", json={
            "base_lock_version": current["lock_version"], "questions_markdown": "我手动整理的记录",
        })
        assert edited.status_code == 200, edited.text
        assert edited.json()["session"]["transcript_source"] == "manual"

        run_round(app, runner)
        run_round(app, runner)
        kept = session_detail(client, session["id"])
        assert kept["questions_markdown"] == "我手动整理的记录"
        assert kept["transcriptions"][0]["pending_replace"] is True

        stale = client.post(
            f"/api/interview-sessions/{session['id']}/transcriptions/{dataset_id}:apply",
            json={"base_lock_version": kept["lock_version"] - 1},
        )
        assert stale.status_code == 409
        applied = client.post(
            f"/api/interview-sessions/{session['id']}/transcriptions/{dataset_id}:apply",
            json={"base_lock_version": kept["lock_version"]},
        )
        assert applied.status_code == 200, applied.text
        body = applied.json()["session"]
        assert body["questions_markdown"].startswith("面试官：")
        assert body["transcript_source"] == "transcription"
        assert body["transcriptions"][0]["pending_replace"] is False
        again = client.post(
            f"/api/interview-sessions/{session['id']}/transcriptions/{dataset_id}:apply",
            json={"base_lock_version": body["lock_version"]},
        )
        assert again.status_code == 409


def test_failed_transcription_can_be_retried_and_unlinking_cancels_it():
    storage = PublicStorage()
    app = build_app(storage)
    transcriber = FakeTranscriber()
    runner = TranscriptionRunner(app.state.session_factory, storage, FakeLLM(), transcriber)
    with TestClient(app) as client:
        session = setup_session(client, "transcribe-retry@example.test")
        dataset_id = upload_audio(client, session["id"])
        busy = client.post(f"/api/interview-sessions/{session['id']}/transcriptions/{dataset_id}:retry")
        assert busy.status_code == 409

        run_round(app, runner)
        transcriber.state = "failed"
        run_round(app, runner)
        failed = session_detail(client, session["id"])["transcriptions"][0]
        assert failed["status"] == "failed"
        assert failed["error_code"] == "INTERVIEW_TRANSCRIPTION_FORMAT_UNSUPPORTED"

        retried = client.post(f"/api/interview-sessions/{session['id']}/transcriptions/{dataset_id}:retry")
        assert retried.status_code == 200, retried.text
        assert retried.json()["session"]["transcriptions"][0]["status"] == "queued"

        run_round(app, runner)
        transcriber.state = "succeeded"
        unlinked = client.delete(f"/api/interview-sessions/{session['id']}/assets/{dataset_id}")
        assert unlinked.status_code == 200, unlinked.text
        run_round(app, runner)
        after = session_detail(client, session["id"])
        assert after["questions_markdown"] is None
        assert after["transcriptions"][0]["status"] == "cancelled"


def test_submit_failures_retry_then_fail_and_missing_config_fails_the_job():
    storage = PublicStorage()
    app = build_app(storage)
    transcriber = FakeTranscriber()
    transcriber.submit_error = TranscriptionProviderError("INTERVIEW_TRANSCRIPTION_PROVIDER_UNAVAILABLE", retryable=True)
    runner = TranscriptionRunner(app.state.session_factory, storage, FakeLLM(), transcriber)
    with TestClient(app) as client:
        session = setup_session(client, "transcribe-submit@example.test")
        upload_audio(client, session["id"])
        for _ in range(2):
            run_round(app, runner)
            assert session_detail(client, session["id"])["transcriptions"][0]["status"] == "queued"
        run_round(app, runner)
        assert session_detail(client, session["id"])["transcriptions"][0]["status"] == "failed"

        dataset_id = session_detail(client, session["id"])["transcriptions"][0]["dataset_id"]
        assert client.post(f"/api/interview-sessions/{session['id']}/transcriptions/{dataset_id}:retry").status_code == 200
        unconfigured = TranscriptionRunner(app.state.session_factory, storage, FakeLLM(configured=False), transcriber)
        run_round(app, unconfigured)
        job = session_detail(client, session["id"])["transcriptions"][0]
        assert job["status"] == "failed"
        assert job["error_code"] == "INTERVIEW_TRANSCRIPTION_NOT_CONFIGURED"


def test_missing_public_storage_fails_and_other_users_cannot_touch_jobs():
    app = build_app(FakeStorage())
    runner = TranscriptionRunner(app.state.session_factory, FakeStorage(), FakeLLM(), FakeTranscriber())
    with TestClient(app) as client:
        session = setup_session(client, "transcribe-owner@example.test")
        dataset_id = upload_audio(client, session["id"])
        run_round(app, runner)
        job = session_detail(client, session["id"])["transcriptions"][0]
        assert job["error_code"] == "INTERVIEW_TRANSCRIPTION_STORAGE_UNAVAILABLE"
        client.post("/api/auth/logout")
        register(client, "transcribe-intruder@example.test")
        stolen = client.post(f"/api/interview-sessions/{session['id']}/transcriptions/{dataset_id}:retry")
        assert stolen.status_code == 404


def test_transcription_can_be_disabled():
    app = build_app(PublicStorage(), interview_transcription_enabled=False)
    with TestClient(app) as client:
        session = setup_session(client, "transcribe-off@example.test")
        upload_audio(client, session["id"])
        assert session_detail(client, session["id"])["transcriptions"] == []
    with app.state.session_factory() as db:
        assert db.scalar(select(InterviewRecordingTranscription.id)) is None
