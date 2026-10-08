from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import re
import wave
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from typing import TypeVar
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, Depends, Header, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from linkresume.application.mock_interviews import service, transcripts
from linkresume.application.mock_interviews.service import (
    MockInterviewError,
    MockInterviewRunner,
    StartRequest,
    VoiceAnswer,
)
from linkresume.application.mock_interviews.speech_session import (
    SpeechResult,
    SpeechSessionStore,
    run_recognition,
)
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.modules.identity.dependencies import _load_user, get_current_mock_interview_user as get_current_user
from linkresume.modules.identity.session_service import WEB_CHANNEL
from linkresume.modules.identity.models import User
from linkresume.modules.llm.resolver import MOCK_INTERVIEW, SPEECH_TO_TEXT, TEXT_TO_SPEECH, TRANSCRIPT_CORRECTION
from linkresume.modules.llm.service import LLMError
from linkresume.modules.speech.gateway import SAMPLE_RATE, SpeechProviderError
from linkresume.modules.mock_interviews.models import MockInterview, MockInterviewQuestion
from linkresume.modules.mock_interviews.schemas import (
    DeleteResponse,
    MockInterviewAnswerRequest,
    MockInterviewCreateRequest,
    MockInterviewDetail,
    MockInterviewListResponse,
    MockInterviewResponse,
    MockInterviewRepeatRequest,
    MockInterviewSkipRequest,
    MockInterviewStatus,
    MockInterviewSummary,
    ReEvaluationResponse,
    SpeechCapabilityResponse,
    SpeechPlaybackRequest,
    TranscriptCorrectionResponse,
    TranscriptEditRequest,
)
from linkresume.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/mock-interviews", tags=["mock-interviews"])
logger = logging.getLogger(__name__)

_IDEMPOTENCY_PATTERN = r"^[A-Za-z0-9_.:-]{8,64}$"
T = TypeVar("T")


def get_mock_interview_runner(request: Request) -> MockInterviewRunner:
    runner = getattr(request.app.state, "mock_interview_runner", None)
    if runner is None:
        runner = MockInterviewRunner(
            request.app.state.session_factory,
            request.app.state.llm_service,
            request.app.state.storage,
            rag=getattr(request.app.state, "linkrag_recall", None),
        )
        request.app.state.mock_interview_runner = runner
    return runner


def get_speech_sessions(request: Request) -> SpeechSessionStore:
    store = getattr(request.app.state, "mock_interview_speech_sessions", None)
    if store is None:
        store = SpeechSessionStore(request.app.state.redis)
        request.app.state.mock_interview_speech_sessions = store
    return store


def _raise(error: Exception) -> None:
    if isinstance(error, MockInterviewError):
        raise ApiError(error.status_code, error.code) from error
    if isinstance(error, SpeechProviderError):
        raise ApiError(502, error.code) from error
    if isinstance(error, LLMError):
        status = 503 if error.code == "LLM_MODEL_NOT_CONFIGURED" else 502
        raise ApiError(status, error.code) from error
    raise error


async def _in_session(request: Request, function: Callable[[Session], T]) -> T:
    def run() -> T:
        with request.app.state.session_factory() as db:
            try:
                return function(db)
            except BaseException:
                db.rollback()
                raise

    try:
        return await asyncio.to_thread(run)
    except (MockInterviewError, LLMError) as error:
        _raise(error)
        raise AssertionError("unreachable")


def _sse(event: str, data: dict[str, object]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n".encode()


def _summary(interview: MockInterview) -> MockInterviewSummary:
    job = interview.job_snapshot_json or {}
    stage = interview.stage_snapshot_json or {}
    report = (interview.report_json or {}) if interview.status == "completed" else {}
    return MockInterviewSummary(
        id=interview.public_id,
        status=interview.status,  # type: ignore[arg-type]
        source_type=interview.source_type,  # type: ignore[arg-type]
        job_application_id=str(interview.job_application_id) if interview.job_application_id else None,
        resume_id=str(interview.resume_id) if interview.resume_id else None,
        job_description_id=str(interview.job_description_id) if interview.job_description_id else None,
        repeat_of_id=None,
        resume_title=interview.resume_title_snapshot,
        company_name=job.get("company_name"),
        job_title=job.get("job_title"),
        target_role=interview.target_role,
        stage_label=stage.get("stage_label"),
        interview_type=interview.interview_type,  # type: ignore[arg-type]
        difficulty=interview.difficulty,  # type: ignore[arg-type]
        question_count=interview.question_count,
        follow_up_enabled=interview.is_follow_up_enabled,
        language=interview.language,  # type: ignore[arg-type]
        answer_mode=interview.answer_mode,  # type: ignore[arg-type]
        materials_in_questions=interview.is_materials_in_questions,
        total_score=float(interview.total_score) if interview.total_score is not None else None,
        low_confidence=interview.is_low_confidence,
        rubric_version=report.get("rubric_version"),
        verdict=(report.get("verdict") or {}).get("level"),
        error_code=interview.error_code,
        started_at=interview.started_at,
        finished_at=interview.finished_at,
        created_at=interview.create_time,
        lock_version=interview.lock_version,
    )


def _repeat_public_ids(db: Session, interviews: list[MockInterview]) -> dict[int, str]:
    ids = {item.repeat_of_id for item in interviews if item.repeat_of_id}
    if not ids:
        return {}
    return dict(
        db.execute(select(MockInterview.id, MockInterview.public_id).where(MockInterview.id.in_(ids))).all()
    )


def _detail(db: Session, interview: MockInterview) -> MockInterviewDetail:
    questions = service.list_questions(db, interview.id)
    summary = _summary(interview)
    repeat = _repeat_public_ids(db, [interview]).get(interview.repeat_of_id or 0)
    report = interview.report_json if interview.status == "completed" else None
    plan = (interview.plan_json or {}).get("selected") or []
    has_intro = bool(plan and plan[0].get("is_intro"))
    return MockInterviewDetail(
        **summary.model_dump(exclude={"repeat_of_id"}),
        repeat_of_id=repeat,
        materials=list(interview.material_refs_json or []),
        current_question_id=str(interview.current_question_id) if interview.current_question_id else None,
        has_intro=has_intro,
        answered_main_questions=sum(
            1
            for item in questions
            if item.parent_id is None and item.answer_status != "pending" and not (has_intro and item.plan_index == 0)
        ),
        needs_reply=bool(questions) and interview.status == "in_progress" and questions[-1].answer_status != "pending",
        questions=[service.serialize_question(item) for item in questions],
        report=report,
        transcript_corrected_at=interview.transcript_corrected_at,
        recordings_deleted=interview.recordings_deleted_at is not None,
    )


def _start_request(payload: MockInterviewCreateRequest) -> StartRequest:
    return StartRequest(
        job_application_id=int(payload.job_application_id) if payload.job_application_id else None,
        resume_id=int(payload.resume_id) if payload.resume_id else None,
        job_description_id=int(payload.job_description_id) if payload.job_description_id else None,
        job_description_text=payload.job_description_text,
        target_role=payload.target_role,
        interview_type=payload.interview_type,
        difficulty=payload.difficulty,
        question_count=payload.question_count,
        follow_up_enabled=payload.follow_up_enabled,
        language=payload.language,
        material_ids=[int(item) for item in payload.material_ids],
        materials_in_questions=payload.materials_in_questions,
        answer_mode=payload.answer_mode,
    )


async def _ensure_voice_available(request: Request) -> dict[str, object]:
    """Fail fast when speech is unroutable; returns the route snapshot to persist."""
    llm = request.app.state.llm_service
    snapshot: dict[str, object] = {}
    for use_case in (SPEECH_TO_TEXT, TEXT_TO_SPEECH):
        try:
            plan = await llm.speech_plan(use_case)
        except LLMError as error:
            raise ApiError(503, "MOCK_INTERVIEW_SPEECH_UNAVAILABLE") from error
        snapshot[use_case] = {
            "route_id": plan.route_id, "provider_code": plan.provider_code,
            "model": plan.invoke_target, "protocol_code": plan.protocol_code,
        }
    return snapshot


def _encode_cursor(interview: MockInterview) -> str:
    created = interview.create_time
    created = created if created.tzinfo else created.replace(tzinfo=UTC)
    raw = json.dumps({"c": created.isoformat(), "i": interview.id}).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, int]:
    try:
        padded = value + "=" * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        return datetime.fromisoformat(payload["c"]), int(payload["i"])
    except Exception as error:
        raise ApiError(400, "MOCK_INTERVIEW_CURSOR_INVALID") from error


@router.get("", response_model=MockInterviewListResponse)
def list_mock_interviews(
    job_application_id: str | None = Query(default=None, pattern=r"^[1-9][0-9]{0,19}$"),
    resume_id: str | None = Query(default=None, pattern=r"^[1-9][0-9]{0,19}$"),
    status: MockInterviewStatus | None = None,
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MockInterviewListResponse:
    service.release_expired(db, user.id)
    statement = select(MockInterview).where(MockInterview.user_id == user.id)
    if job_application_id:
        statement = statement.where(MockInterview.job_application_id == int(job_application_id))
    if resume_id:
        statement = statement.where(MockInterview.resume_id == int(resume_id))
    if status:
        statement = statement.where(MockInterview.status == status)
    if cursor:
        created, identifier = _decode_cursor(cursor)
        created = created.astimezone(UTC)
        statement = statement.where(
            or_(
                MockInterview.create_time < created,
                and_(MockInterview.create_time == created, MockInterview.id < identifier),
            )
        )
    rows = list(
        db.scalars(
            statement.order_by(MockInterview.create_time.desc(), MockInterview.id.desc()).limit(limit + 1)
        )
    )
    page = rows[:limit]
    repeats = _repeat_public_ids(db, page)
    items = [
        _summary(item).model_copy(update={"repeat_of_id": repeats.get(item.repeat_of_id or 0)})
        for item in page
    ]
    return MockInterviewListResponse(
        items=items,
        next_cursor=_encode_cursor(page[-1]) if len(rows) > limit and page else None,
    )


@router.post("", response_model=MockInterviewResponse, status_code=201)
async def create_mock_interview(
    request: Request,
    payload: MockInterviewCreateRequest,
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> MockInterviewResponse:
    try:
        await request.app.state.llm_service.ensure_configured(MOCK_INTERVIEW)
    except LLMError as error:
        _raise(error)
    start_request = _start_request(payload)
    snapshot = await _ensure_voice_available(request) if start_request.answer_mode == "voice" else None

    def create(db: Session) -> tuple[int, str, MockInterviewDetail]:
        interview = service.start(db, user.id, start_request, speech_snapshot=snapshot)
        return interview.id, str(interview.task_token), _detail(db, interview)

    interview_id, token, detail = await _in_session(request, create)
    runner.spawn(runner.prepare(interview_id, token))
    bind_audit_target(request, detail.id)
    return MockInterviewResponse(mock_interview=detail)


@router.get("/speech-capability", response_model=SpeechCapabilityResponse)
async def speech_capability(
    request: Request, user: User = Depends(get_current_user)
) -> SpeechCapabilityResponse:
    del user
    available = await request.app.state.llm_service.speech_available()
    return SpeechCapabilityResponse(stt=available[SPEECH_TO_TEXT], tts=available[TEXT_TO_SPEECH])


@router.get("/{interview_id}", response_model=MockInterviewResponse)
def get_mock_interview(
    interview_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MockInterviewResponse:
    try:
        interview = service.require_owned(db, user.id, interview_id)
        interview = service.refresh_state(db, interview)
    except MockInterviewError as error:
        _raise(error)
        raise AssertionError("unreachable")
    return MockInterviewResponse(mock_interview=_detail(db, interview))


_SENTENCE_END = re.compile(r"[。！？!?；;\n]")
MAX_SENTENCE_CHARS = 120


@router.post("/{interview_id}/speech/playback")
async def speech_playback(
    interview_id: str,
    request: Request,
    payload: SpeechPlaybackRequest,
    user: User = Depends(get_current_user),
) -> Response:
    def playback_text(db: Session) -> str:
        interview = service.require_owned(db, user.id, interview_id)
        if interview.answer_mode != "voice":
            raise MockInterviewError(409, "MOCK_INTERVIEW_STATE_INVALID")
        if payload.question_id is None:
            return (
                "Hello, I am your interviewer today. Let's start with a brief introduction."
                if interview.language == "en" else "你好，我是今天的面试官，我们先从自我介绍开始。"
            )
        if interview.status != "in_progress" or str(interview.current_question_id) != payload.question_id:
            raise MockInterviewError(409, "MOCK_INTERVIEW_QUESTION_MISMATCH")
        question = db.scalar(select(MockInterviewQuestion).where(
            MockInterviewQuestion.id == int(payload.question_id),
            MockInterviewQuestion.interview_id == interview.id,
        ))
        if question is None or question.answer_status != "pending":
            raise MockInterviewError(409, "MOCK_INTERVIEW_QUESTION_MISMATCH")
        return question.content

    text = await _in_session(request, playback_text)
    try:
        audio = await request.app.state.llm_service.synthesize(user.id, text, source="mock_interview")
    except (LLMError, SpeechProviderError) as error:
        _raise(error)
        raise AssertionError("unreachable")
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


def split_sentences(buffer: str) -> tuple[list[str], str]:
    """Cut complete sentences off the front of ``buffer`` for synthesis."""
    sentences: list[str] = []
    while True:
        match = _SENTENCE_END.search(buffer)
        if match is None:
            if len(buffer) >= MAX_SENTENCE_CHARS:
                sentences.append(buffer[:MAX_SENTENCE_CHARS])
                buffer = buffer[MAX_SENTENCE_CHARS:]
                continue
            return [item for item in sentences if item.strip()], buffer
        sentences.append(buffer[: match.end()])
        buffer = buffer[match.end():]


class _Speaker:
    """Synthesises sentences concurrently and yields them in order."""

    def __init__(self, llm, user_id: int) -> None:
        self._llm = llm
        self._user_id = user_id
        self._tasks: list[tuple[int, str, asyncio.Task[bytes]]] = []
        self._next_seq = 0

    def say(self, text: str) -> None:
        seq = self._next_seq
        self._next_seq += 1
        task = asyncio.create_task(self._llm.synthesize(self._user_id, text.strip(), source="mock_interview"))
        self._tasks.append((seq, text.strip(), task))

    async def ready(self, *, wait: bool) -> AsyncIterator[bytes]:
        while self._tasks and (wait or self._tasks[0][2].done()):
            seq, text, task = self._tasks.pop(0)
            try:
                audio = await task
            except (LLMError, SpeechProviderError):
                # Speech is best effort: the subtitle still carries the turn.
                yield _sse("interviewer.audio_failed", {"seq": seq, "text": text})
                continue
            yield _sse("interviewer.audio", {
                "seq": seq, "text": text, "format": "mp3",
                "data": base64.b64encode(audio).decode("ascii"),
            })

    def cancel(self) -> None:
        for _, _, task in self._tasks:
            task.cancel()


async def _turn_stream(
    runner: MockInterviewRunner,
    interview_id: int,
    prefix: list[bytes],
    *,
    speaker: _Speaker | None = None,
) -> AsyncIterator[bytes]:
    for item in prefix:
        yield item
    pending = ""
    try:
        async for event in runner.stream_turn(interview_id):
            kind = event.pop("event")
            if kind == "delta":
                yield _sse("interviewer.delta", event)
                if speaker is not None:
                    sentences, pending = split_sentences(pending + str(event.get("content") or ""))
                    for sentence in sentences:
                        speaker.say(sentence)
                    async for audio in speaker.ready(wait=False):
                        yield audio
            elif kind == "turn":
                if speaker is not None:
                    if pending.strip():
                        speaker.say(pending)
                    pending = ""
                    async for audio in speaker.ready(wait=True):
                        yield audio
                yield _sse("interviewer.turn", event)
            else:
                yield _sse("interviewer.failed", event)
    finally:
        if speaker is not None:
            speaker.cancel()


async def _speaker_for(request: Request, interview_id: int, user_id: int) -> _Speaker | None:
    mode = await _in_session(request, lambda db: db.get(MockInterview, interview_id).answer_mode)
    return _Speaker(request.app.state.llm_service, user_id) if mode == "voice" else None


def _streaming(body: AsyncIterator[bytes]) -> StreamingResponse:
    return StreamingResponse(
        body,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _record_answer(
    request: Request,
    user: User,
    runner: MockInterviewRunner,
    interview_id: str,
    question_id: str,
    answer: str | None,
    idempotency_key: str,
    speech_session_id: str | None = None,
) -> StreamingResponse:
    sessions = get_speech_sessions(request)
    consumed: tuple[SpeechResult, bytes | None] | None = None
    voice: VoiceAnswer | None = None
    def replayed(db: Session) -> bool:
        owned = service.require_owned(db, user.id, interview_id)
        question = db.scalar(select(MockInterviewQuestion).where(
            MockInterviewQuestion.interview_id == owned.id,
            MockInterviewQuestion.id == int(question_id),
        ))
        return question is not None and question.answer_idempotency_key == idempotency_key

    is_replay = await _in_session(request, replayed)
    if speech_session_id is not None and not is_replay:
        consumed = sessions.consume(speech_session_id)
        if consumed is None:
            raise ApiError(409, "MOCK_INTERVIEW_SPEECH_SESSION_INVALID")
        result, audio = consumed

        def check(db: Session) -> MockInterview:
            interview = service.require_owned(db, user.id, interview_id)
            if (
                result.user_id != user.id or result.interview_id != interview.id
                or result.question_id != int(question_id)
            ):
                raise MockInterviewError(409, "MOCK_INTERVIEW_SPEECH_SESSION_INVALID")
            db.expunge(interview)
            return interview

        try:
            owned = await _in_session(request, check)
        except ApiError:
            sessions.restore(result, audio)
            raise
        if not result.text:
            sessions.restore(result, audio)
            raise ApiError(422, "MOCK_INTERVIEW_SPEECH_EMPTY")
        object_name = None
        if result.purpose == "voice_answer":
            if not audio:
                sessions.restore(result, audio)
                raise ApiError(409, "MOCK_INTERVIEW_SPEECH_SESSION_INVALID")
            # Distinct attempts must never overwrite another accepted answer's audio.
            object_name = service.recording_object_name(owned, result.question_id).removesuffix(".wav") + f"-{result.session_id}.wav"
            try:
                await asyncio.to_thread(_store_owned_recording, request, user.id, object_name, audio)
            except Exception as error:
                sessions.restore(result, audio)
                raise ApiError(502, "MOCK_INTERVIEW_RECORDING_STORE_FAILED") from error
        voice = VoiceAnswer(
            source="voice" if result.purpose == "voice_answer" else "voice_input",
            transcript=result.text,
            words=result.words,
            duration_ms=result.duration_ms,
            recording_object_name=object_name,
        )
        if voice.source == "voice":
            answer = result.text

    def record(db: Session) -> tuple[int, bool, int, str | None, bool]:
        interview, needs_turn = service.submit_answer(
            db,
            user.id,
            interview_id,
            question_id=int(question_id),
            text=answer,
            idempotency_key=idempotency_key,
            voice=voice,
        )
        question = db.get(MockInterviewQuestion, int(question_id))
        return interview.id, needs_turn, interview.lock_version, question.recording_object_name, question.answer_status == "skipped"

    try:
        internal_id, needs_turn, lock_version, stored_name, skipped = await _in_session(request, record)
    except ApiError:
        if consumed is not None:
            if voice is not None and voice.recording_object_name:
                try:
                    await asyncio.to_thread(request.app.state.storage.delete, voice.recording_object_name)
                except Exception:
                    logger.exception("mock interview unaccepted recording cleanup failed")
            sessions.restore(*consumed)
        raise
    if voice is not None and voice.recording_object_name and stored_name != voice.recording_object_name:
        await asyncio.to_thread(_purge, request.app.state.storage, [voice.recording_object_name])
    accepted = _sse(
        "answer.accepted",
        {"question_id": question_id, "skipped": skipped, "lock_version": lock_version},
    )
    if not needs_turn:
        async def replay() -> AsyncIterator[bytes]:
            yield accepted

        return _streaming(replay())
    speaker = await _speaker_for(request, internal_id, user.id)
    return _streaming(_turn_stream(runner, internal_id, [accepted], speaker=speaker))


def _wav(pcm: bytes) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(SAMPLE_RATE)
        file.writeframes(pcm)
    return output.getvalue()


def _store_owned_recording(request: Request, user_id: int, object_name: str, audio: bytes) -> None:
    from linkresume.modules.identity.dependencies import lock_active_user

    # Keep the owner lock through the object write, so cleanup cannot finish
    # before a recording upload that was authorized by an earlier request.
    with request.app.state.session_factory() as db:
        lock_active_user(db, user_id)
        _store_recording(request.app.state.storage, object_name, audio)


def _store_recording(storage, object_name: str, pcm: bytes) -> None:
    storage.upload_stream(
        object_name, io.BytesIO(_wav(pcm)), "audio/wav", max_bytes=len(pcm) + 1024
    )


@router.post("/{interview_id}/answers")
async def answer_mock_interview(
    interview_id: str,
    request: Request,
    payload: MockInterviewAnswerRequest,
    idempotency_key: str = Header(alias="Idempotency-Key", pattern=_IDEMPOTENCY_PATTERN),
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> StreamingResponse:
    return await _record_answer(
        request, user, runner, interview_id, payload.question_id, payload.answer, idempotency_key,
        payload.speech_session_id,
    )


@router.post("/{interview_id}/skip")
async def skip_mock_interview_question(
    interview_id: str,
    request: Request,
    payload: MockInterviewSkipRequest,
    idempotency_key: str = Header(alias="Idempotency-Key", pattern=_IDEMPOTENCY_PATTERN),
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> StreamingResponse:
    return await _record_answer(
        request, user, runner, interview_id, payload.question_id, None, idempotency_key
    )


@router.post("/{interview_id}/reply:retry")
async def retry_mock_interview_reply(
    interview_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> StreamingResponse:
    def check(db: Session) -> int:
        interview = service.require_owned(db, user.id, interview_id)
        if not service.needs_reply(db, interview):
            raise MockInterviewError(409, "MOCK_INTERVIEW_STATE_INVALID")
        return interview.id

    internal_id = await _in_session(request, check)
    speaker = await _speaker_for(request, internal_id, user.id)
    return _streaming(_turn_stream(runner, internal_id, [], speaker=speaker))


@router.post("/{interview_id}/finish", response_model=MockInterviewResponse)
async def finish_mock_interview(
    interview_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> MockInterviewResponse:
    def run(db: Session) -> tuple[int, str | None, MockInterviewDetail]:
        interview, should_evaluate = service.finish(db, user.id, interview_id)
        token = str(interview.task_token) if should_evaluate else None
        return interview.id, token, _detail(db, interview)

    internal_id, token, detail = await _in_session(request, run)
    if token:
        runner.spawn(runner.evaluate(internal_id, token))
    bind_audit_target(request, detail.id)
    return MockInterviewResponse(mock_interview=detail)


@router.post("/{interview_id}/abandon", response_model=MockInterviewResponse)
def abandon_mock_interview(
    interview_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MockInterviewResponse:
    try:
        interview = service.abandon(db, user.id, interview_id)
    except MockInterviewError as error:
        _raise(error)
        raise AssertionError("unreachable")
    return MockInterviewResponse(mock_interview=_detail(db, interview))


@router.post("/{interview_id}/retry", response_model=MockInterviewResponse)
async def retry_mock_interview(
    interview_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> MockInterviewResponse:
    try:
        await request.app.state.llm_service.ensure_configured(MOCK_INTERVIEW)
    except LLMError as error:
        _raise(error)

    def run(db: Session) -> tuple[int, str, str, MockInterviewDetail]:
        interview = service.retry(db, user.id, interview_id)
        return interview.id, interview.status, str(interview.task_token), _detail(db, interview)

    internal_id, status, token, detail = await _in_session(request, run)
    runner.spawn(
        runner.prepare(internal_id, token)
        if status == "preparing"
        else runner.evaluate(internal_id, token)
    )
    return MockInterviewResponse(mock_interview=detail)


@router.post("/{interview_id}/repeat", response_model=MockInterviewResponse, status_code=201)
async def repeat_mock_interview(
    interview_id: str,
    request: Request,
    payload: MockInterviewRepeatRequest | None = Body(default=None),
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> MockInterviewResponse:
    try:
        await request.app.state.llm_service.ensure_configured(MOCK_INTERVIEW)
    except LLMError as error:
        _raise(error)

    source_mode = (payload.answer_mode if payload is not None else None) or await _in_session(
        request, lambda db: service.require_owned(db, user.id, interview_id).answer_mode
    )
    snapshot = await _ensure_voice_available(request) if source_mode == "voice" else None

    def run(db: Session) -> tuple[int, str, MockInterviewDetail]:
        source = service.require_owned(db, user.id, interview_id)
        if source.resume_id is None:
            raise MockInterviewError(422, "MOCK_INTERVIEW_RESUME_REQUIRED")
        interview = service.start(
            db, user.id, service.repeat_request(source, answer_mode=source_mode), repeat_of_id=source.id,
            speech_snapshot=snapshot,
        )
        return interview.id, str(interview.task_token), _detail(db, interview)

    internal_id, token, detail = await _in_session(request, run)
    runner.spawn(runner.prepare(internal_id, token))
    bind_audit_target(request, detail.id)
    return MockInterviewResponse(mock_interview=detail)


@router.delete("/{interview_id}", response_model=DeleteResponse)
def delete_mock_interview(
    interview_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteResponse:
    try:
        service.delete_interview(db, user.id, interview_id, purge=lambda prefix: _purge_prefix(request.app.state.storage, prefix))
    except MockInterviewError as error:
        _raise(error)
        raise AssertionError("unreachable")
    bind_audit_target(request, interview_id)
    return DeleteResponse(deleted=True)


def _purge_prefix(storage, prefix: str, known_names: list[str] | None = None) -> None:
    try:
        names = storage.list_names(prefix)
    except Exception as error:
        logger.exception("mock interview recording listing failed")
        raise MockInterviewError(502, "MOCK_INTERVIEW_RECORDING_DELETE_FAILED") from error
    # Failed uploads/cleanup can leave attempts without a database reference.
    _purge(storage, list(dict.fromkeys([*(known_names or []), *names])))


def _purge(storage, names: list[str]) -> None:
    for name in names:
        try:
            storage.delete(name)
        except Exception as error:
            logger.exception("mock interview recording delete failed")
            raise MockInterviewError(502, "MOCK_INTERVIEW_RECORDING_DELETE_FAILED") from error


def _same_origin(websocket: WebSocket) -> bool:
    """Cookies ride along on cross-site WebSocket handshakes; require our origin."""
    origin = websocket.headers.get("origin")
    host = websocket.headers.get("host")
    if not origin or not host:
        return False
    parsed = urlsplit(origin)
    return parsed.scheme in ("http", "https") and parsed.netloc == host


def _desktop_bearer(websocket: WebSocket, settings) -> str | None:
    """A desktop Bearer token, only when no auth cookie rides along (channels never mix)."""
    scheme, _, token = (websocket.headers.get("authorization") or "").partition(" ")
    if scheme.lower() != "bearer" or not token or " " in token:
        return None
    if any(name in websocket.cookies for name in (
        settings.access_cookie_name, settings.refresh_cookie_name, settings.session_cookie_name,
    )):
        return None
    return token


@router.websocket("/{interview_id}/speech")
async def speech_socket(
    websocket: WebSocket,
    interview_id: str,
    question_id: str = Query(pattern=r"^[1-9][0-9]{0,19}$"),
    purpose: str = Query(pattern=r"^(voice_input|voice_answer)$"),
) -> None:
    app = websocket.app
    # Native clients authenticate with a desktop Bearer header, which a cross-site page
    # cannot attach to a WebSocket handshake; cookie handshakes still require our origin.
    bearer = _desktop_bearer(websocket, app.state.settings)
    if bearer is None and not _same_origin(websocket):
        await websocket.close(code=4403)
        return

    def authorize() -> tuple[int, int, list[str], str] | str:
        with app.state.session_factory() as db:
            user = _load_user(
                bearer if bearer is not None else websocket.cookies.get(app.state.settings.access_cookie_name),
                "desktop" if bearer is not None else WEB_CHANNEL,
                websocket, db, app.state.settings, app.state.redis,
            )
            if user is None:
                return "UNAUTHORIZED"
            try:
                interview = service.require_owned(db, user.id, interview_id)
            except MockInterviewError as error:
                return error.code
            expected = "voice" if purpose == "voice_answer" else "text"
            if (
                interview.status != "in_progress" or interview.answer_mode != expected
                or interview.current_question_id != int(question_id)
            ):
                return "MOCK_INTERVIEW_STATE_INVALID"
            return user.id, interview.id, list(interview.hotwords_json or []), interview.language

    auth = await asyncio.to_thread(authorize)
    if isinstance(auth, str):
        await websocket.close(code=4401 if auth == "UNAUTHORIZED" else 4409, reason=auth)
        return
    user_id, internal_id, hotwords, language = auth
    await websocket.accept()

    async def frames() -> AsyncIterator[bytes | None]:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                raise ConnectionError
            if message.get("bytes"):
                yield message["bytes"]
            elif message.get("text"):
                try:
                    command = json.loads(message["text"])
                except ValueError:
                    continue
                if isinstance(command, dict) and command.get("type") == "stop":
                    yield None
                    return

    async def emit(event: dict[str, object]) -> None:
        try:
            await websocket.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            pass

    try:
        result, audio = await run_recognition(
            app.state.llm_service, user_id=user_id, interview_id=internal_id,
            question_id=int(question_id), purpose=purpose, hotwords=hotwords,
            language=language, frames=frames(), emit=emit,
        )
    except LLMError as error:
        code = "MOCK_INTERVIEW_SPEECH_UNAVAILABLE" if error.code == "LLM_MODEL_NOT_CONFIGURED" else error.code
        await emit({"type": "error", "code": code})
        await _close(websocket)
        return
    except SpeechProviderError as error:
        await emit({"type": "error", "code": error.code})
        await _close(websocket)
        return
    # Voice input never keeps the recording; only the duration is recorded.
    get_speech_sessions(websocket).save(result, audio if purpose == "voice_answer" else None)
    await emit({
        "type": "final", "session_id": result.session_id, "text": result.text,
        "duration_ms": result.duration_ms, "words": result.words, "partial": result.partial,
    })
    await _close(websocket)


async def _close(websocket: WebSocket) -> None:
    try:
        await websocket.close()
    except RuntimeError:
        pass


@router.post("/{interview_id}/transcripts:correct", response_model=TranscriptCorrectionResponse)
async def correct_transcripts(
    interview_id: str, request: Request, user: User = Depends(get_current_user)
) -> TranscriptCorrectionResponse:
    llm = request.app.state.llm_service
    try:
        await llm.ensure_configured(TRANSCRIPT_CORRECTION)
    except LLMError as error:
        _raise(error)
    internal_id = await _in_session(request, lambda db: transcripts.claim_correction(db, user.id, interview_id).id)
    owner, glossary, context, items = await _in_session(
        request, lambda db: transcripts.correction_inputs(db, internal_id)
    )
    try:
        results = await transcripts.correct_answers(llm, owner, glossary, context, items)
    except LLMError as error:
        await _in_session(request, lambda db: transcripts.release_correction(db, internal_id))
        _raise(error)
    except BaseException:
        await asyncio.shield(_in_session(request, lambda db: transcripts.release_correction(db, internal_id)))
        raise

    def store(db: Session):
        public = transcripts.store_corrections(db, internal_id, results)
        return public, _detail(db, db.get(MockInterview, internal_id))

    public, detail = await _in_session(request, store)
    bind_audit_target(request, detail.id)
    return TranscriptCorrectionResponse(items=public, mock_interview=detail)


@router.put("/{interview_id}/questions/{question_id}/transcript", response_model=MockInterviewResponse)
def edit_transcript(
    interview_id: str,
    question_id: str,
    payload: TranscriptEditRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MockInterviewResponse:
    try:
        transcripts.edit_transcript(db, user.id, interview_id, _question_id(question_id), payload.text)
        interview = service.require_owned(db, user.id, interview_id)
    except MockInterviewError as error:
        _raise(error)
        raise AssertionError("unreachable")
    bind_audit_target(request, interview_id)
    return MockInterviewResponse(mock_interview=_detail(db, interview))


@router.post("/{interview_id}/questions/{question_id}/re-evaluate", response_model=ReEvaluationResponse)
async def re_evaluate_question(
    interview_id: str, question_id: str, request: Request, user: User = Depends(get_current_user)
) -> ReEvaluationResponse:
    llm = request.app.state.llm_service
    interview, root, questions = await _in_session(
        request, lambda db: transcripts.reevaluation_context(db, user.id, interview_id, _question_id(question_id))
    )
    try:
        value = await transcripts.judge_question(llm, interview, root, questions)
    except LLMError as error:
        _raise(error)

    def store(db: Session):
        result = transcripts.store_reevaluation(db, interview.id, root.id, questions, value)
        return result, _detail(db, db.get(MockInterview, interview.id))

    result, detail = await _in_session(request, store)
    bind_audit_target(request, detail.id)
    return ReEvaluationResponse(**result, mock_interview=detail)


@router.get("/{interview_id}/questions/{question_id}/recording")
def get_recording(
    interview_id: str,
    question_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    try:
        name = transcripts.recording_for(db, user.id, interview_id, _question_id(question_id))
    except MockInterviewError as error:
        _raise(error)
        raise AssertionError("unreachable")
    try:
        data = _read_object(request.app.state.storage, name, MAX_RECORDING_BYTES)
    except Exception as error:
        raise ApiError(404, "MOCK_INTERVIEW_RECORDING_NOT_FOUND") from error
    return Response(
        data, media_type="audio/wav",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


MAX_RECORDING_BYTES = 11 * 1024 * 1024


def _read_object(storage, name: str, max_bytes: int) -> bytes:
    response = storage.get(name)
    if isinstance(response, bytes):
        return response
    chunks: list[bytes] = []
    size = 0
    try:
        for chunk in response.stream(64 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise ValueError("recording exceeds limit")
            chunks.append(chunk)
    finally:
        response.close()
        response.release_conn()
    return b"".join(chunks)


@router.delete("/{interview_id}/recordings", response_model=MockInterviewResponse)
def delete_recordings(
    interview_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MockInterviewResponse:
    try:
        prefix = service.recording_prefix(service.require_owned(db, user.id, interview_id))
        transcripts.delete_recordings(db, user.id, interview_id, purge=lambda names: _purge_prefix(request.app.state.storage, prefix, names))
        interview = service.require_owned(db, user.id, interview_id)
    except MockInterviewError as error:
        _raise(error)
        raise AssertionError("unreachable")
    bind_audit_target(request, interview_id)
    return MockInterviewResponse(mock_interview=_detail(db, interview))


def _question_id(value: str) -> int:
    if not re.fullmatch(r"[1-9][0-9]{0,19}", value):
        raise ApiError(404, "MOCK_INTERVIEW_QUESTION_NOT_FOUND")
    return int(value)
