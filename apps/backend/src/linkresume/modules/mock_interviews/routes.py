from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from typing import TypeVar

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from linkresume.application.mock_interviews import service
from linkresume.application.mock_interviews.service import (
    MockInterviewError,
    MockInterviewRunner,
    StartRequest,
)
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User
from linkresume.modules.llm.resolver import MOCK_INTERVIEW
from linkresume.modules.llm.service import LLMError
from linkresume.modules.mock_interviews.models import MockInterview
from linkresume.modules.mock_interviews.schemas import (
    DeleteResponse,
    MockInterviewAnswerRequest,
    MockInterviewCreateRequest,
    MockInterviewDetail,
    MockInterviewListResponse,
    MockInterviewResponse,
    MockInterviewSkipRequest,
    MockInterviewStatus,
    MockInterviewSummary,
)
from linkresume.modules.observability.audit import bind_audit_target

router = APIRouter(prefix="/mock-interviews", tags=["mock-interviews"])

_IDEMPOTENCY_PATTERN = r"^[A-Za-z0-9_.:-]{8,64}$"
T = TypeVar("T")


def get_mock_interview_runner(request: Request) -> MockInterviewRunner:
    runner = getattr(request.app.state, "mock_interview_runner", None)
    if runner is None:
        runner = MockInterviewRunner(
            request.app.state.session_factory,
            request.app.state.llm_service,
            request.app.state.storage,
        )
        request.app.state.mock_interview_runner = runner
    return runner


def _raise(error: Exception) -> None:
    if isinstance(error, MockInterviewError):
        raise ApiError(error.status_code, error.code) from error
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
        follow_up_enabled=interview.follow_up_enabled,
        language=interview.language,  # type: ignore[arg-type]
        total_score=float(interview.total_score) if interview.total_score is not None else None,
        low_confidence=interview.low_confidence,
        error_code=interview.error_code,
        started_at=interview.started_at,
        finished_at=interview.finished_at,
        created_at=interview.created_at,
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
    return MockInterviewDetail(
        **summary.model_dump(exclude={"repeat_of_id"}),
        repeat_of_id=repeat,
        materials=list(interview.material_refs_json or []),
        current_question_id=str(interview.current_question_id) if interview.current_question_id else None,
        answered_main_questions=sum(
            1 for item in questions if item.parent_id is None and item.answer_status != "pending"
        ),
        needs_reply=bool(questions) and interview.status == "in_progress" and questions[-1].answer_status != "pending",
        questions=[service.serialize_question(item) for item in questions],
        report=report,
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
    )


def _encode_cursor(interview: MockInterview) -> str:
    created = interview.created_at
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
                MockInterview.created_at < created,
                and_(MockInterview.created_at == created, MockInterview.id < identifier),
            )
        )
    rows = list(
        db.scalars(
            statement.order_by(MockInterview.created_at.desc(), MockInterview.id.desc()).limit(limit + 1)
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

    def create(db: Session) -> tuple[int, str, MockInterviewDetail]:
        interview = service.start(db, user.id, start_request)
        return interview.id, str(interview.task_token), _detail(db, interview)

    interview_id, token, detail = await _in_session(request, create)
    runner.spawn(runner.prepare(interview_id, token))
    bind_audit_target(request, detail.id)
    return MockInterviewResponse(mock_interview=detail)


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


async def _turn_stream(
    runner: MockInterviewRunner, interview_id: int, prefix: list[bytes]
) -> AsyncIterator[bytes]:
    for item in prefix:
        yield item
    async for event in runner.stream_turn(interview_id):
        kind = event.pop("event")
        if kind == "delta":
            yield _sse("interviewer.delta", event)
        elif kind == "turn":
            yield _sse("interviewer.turn", event)
        else:
            yield _sse("interviewer.failed", event)


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
) -> StreamingResponse:
    def record(db: Session) -> tuple[int, bool, int]:
        interview, needs_turn = service.submit_answer(
            db,
            user.id,
            interview_id,
            question_id=int(question_id),
            text=answer,
            idempotency_key=idempotency_key,
        )
        return interview.id, needs_turn, interview.lock_version

    internal_id, needs_turn, lock_version = await _in_session(request, record)
    accepted = _sse(
        "answer.accepted",
        {"question_id": question_id, "skipped": answer is None, "lock_version": lock_version},
    )
    if not needs_turn:
        async def replay() -> AsyncIterator[bytes]:
            yield accepted

        return _streaming(replay())
    return _streaming(_turn_stream(runner, internal_id, [accepted]))


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
        request, user, runner, interview_id, payload.question_id, payload.answer, idempotency_key
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
    return _streaming(_turn_stream(runner, internal_id, []))


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
    user: User = Depends(get_current_user),
    runner: MockInterviewRunner = Depends(get_mock_interview_runner),
) -> MockInterviewResponse:
    try:
        await request.app.state.llm_service.ensure_configured(MOCK_INTERVIEW)
    except LLMError as error:
        _raise(error)

    def run(db: Session) -> tuple[int, str, MockInterviewDetail]:
        source = service.require_owned(db, user.id, interview_id)
        if source.resume_id is None:
            raise MockInterviewError(422, "MOCK_INTERVIEW_RESUME_REQUIRED")
        interview = service.start(
            db, user.id, service.repeat_request(source), repeat_of_id=source.id
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
        service.delete_interview(db, user.id, interview_id)
    except MockInterviewError as error:
        _raise(error)
    bind_audit_target(request, interview_id)
    return DeleteResponse(deleted=True)

