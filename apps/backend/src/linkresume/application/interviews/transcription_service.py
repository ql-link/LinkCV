"""Background transcription of interview recordings.

One job per recording. Linking an audio/video file to a session queues it; a
worker round submits the recording to the speech provider through a
short-lived public presigned link, polls the provider task and finally writes
the transcript into the session — or keeps it for an explicit replace when the
session already has a transcript. Unlinking or deleting the recording cancels
the job, so a late result never lands in a session it no longer belongs to.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from time import perf_counter

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from linkresume.core.errors import ApiError
from linkresume.core.database import utc_now
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.interviews.models import (
    InterviewRecordingTranscription,
    InterviewSession,
    JobApplicationStage,
)
from linkresume.modules.llm.resolver import SPEECH_TO_TEXT
from linkresume.modules.llm.service import LLMError
from linkresume.modules.speech.file_transcription import (
    FileTranscriber,
    Transcript,
    TranscriptionProviderError,
)
from linkresume.modules.speech.gateway import SpeechTarget

logger = logging.getLogger(__name__)

MEDIA_KINDS = frozenset({"audio", "video"})
ACTIVE = ("queued", "running")
RETRYABLE = frozenset({"failed", "cancelled"})
MAX_SUBMIT_ATTEMPTS = 3
SUBMIT_RETRY_DELAYS = (timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=15))
TASK_TIMEOUT = timedelta(hours=3)
LINK_TTL = timedelta(hours=6)
ROUND_LIMIT = 20
LEASE = timedelta(minutes=2)


def _naive_utc(value: datetime) -> datetime:
    # MySQL and SQLite return naive UTC timestamps.
    return value.replace(tzinfo=None) if value.tzinfo is not None else value


def _now() -> datetime:
    return _naive_utc(utc_now())


def _is_written_test(db: Session, session: InterviewSession) -> bool:
    if session.application_stage_id is None:
        return False
    stage_type = db.scalar(
        select(JobApplicationStage.stage_type).where(
            JobApplicationStage.id == session.application_stage_id
        )
    )
    return stage_type == "written_test"


def ensure_task(
    db: Session, *, session: InterviewSession, dataset: UserDataset, enabled: bool
) -> InterviewRecordingTranscription | None:
    """Queue a job for a recording just linked to ``session``; caller commits."""
    if not enabled or dataset.asset_kind not in MEDIA_KINDS or _is_written_test(db, session):
        return None
    row = db.scalar(
        select(InterviewRecordingTranscription)
        .where(InterviewRecordingTranscription.dataset_id == dataset.id)
        .with_for_update()
    )
    now = _now()
    if row is None:
        row = InterviewRecordingTranscription(
            user_id=dataset.user_id,
            session_id=session.id,
            dataset_id=dataset.id,
            status="queued",
            attempts=0,
            next_attempt_at=now,
            is_pending_replace=False,
        )
        db.add(row)
        return row
    if row.session_id != session.id or row.status == "cancelled":
        _requeue(row, session.id, now)
    return row


def _requeue(row: InterviewRecordingTranscription, session_id: int, now: datetime) -> None:
    row.session_id = session_id
    row.status = "queued"
    row.attempts = 0
    row.next_attempt_at = now
    row.lease_until = None
    row.submitted_at = None
    row.provider_task_id = None
    row.result_markdown = None
    row.result_duration_ms = None
    row.is_pending_replace = False
    row.error_code = None
    row.update_time = now


def cancel_for_dataset(db: Session, dataset_id: int) -> None:
    """The recording left its session; drop any running or unapplied result."""
    row = db.scalar(
        select(InterviewRecordingTranscription)
        .where(InterviewRecordingTranscription.dataset_id == dataset_id)
        .with_for_update()
    )
    if row is None:
        return
    if row.status in ACTIVE:
        row.status = "cancelled"
        row.error_code = None
    row.is_pending_replace = False
    row.update_time = _now()


def list_for_sessions(
    db: Session, session_ids: list[int]
) -> dict[int, list[InterviewRecordingTranscription]]:
    if not session_ids:
        return {}
    rows = db.scalars(
        select(InterviewRecordingTranscription)
        .where(InterviewRecordingTranscription.session_id.in_(session_ids))
        .order_by(InterviewRecordingTranscription.id)
    )
    grouped: dict[int, list[InterviewRecordingTranscription]] = {}
    for row in rows:
        grouped.setdefault(row.session_id, []).append(row)
    return grouped


def _owned_linked_row(
    db: Session, user_id: int, session_id: int, dataset_id: int
) -> tuple[InterviewSession, UserDataset, InterviewRecordingTranscription | None]:
    from linkresume.application.interviews.service import InvalidInterviewRequest, require_owned_session
    from linkresume.modules.identity.dependencies import lock_active_user

    lock_active_user(db, user_id)
    session = require_owned_session(db, user_id, session_id, for_update=True).session
    dataset = db.scalar(
        select(UserDataset).where(UserDataset.id == dataset_id, UserDataset.user_id == user_id)
    )
    if dataset is None or dataset.interview_session_id != session_id:
        raise InvalidInterviewRequest
    row = db.scalar(
        select(InterviewRecordingTranscription)
        .where(InterviewRecordingTranscription.dataset_id == dataset_id)
        .with_for_update()
    )
    return session, dataset, row


def retry(db: Session, user_id: int, session_id: int, dataset_id: int, *, enabled: bool) -> None:
    session, dataset, row = _owned_linked_row(db, user_id, session_id, dataset_id)
    if not enabled:
        raise ApiError(503, "INTERVIEW_TRANSCRIPTION_DISABLED")
    if dataset.asset_kind not in MEDIA_KINDS:
        raise ApiError(400, "INTERVIEW_TRANSCRIPTION_NOT_MEDIA")
    if row is None:
        if ensure_task(db, session=session, dataset=dataset, enabled=True) is None:
            raise ApiError(400, "INTERVIEW_TRANSCRIPTION_NOT_MEDIA")
    elif row.status in RETRYABLE or row.session_id != session_id:
        _requeue(row, session_id, _now())
    else:
        raise ApiError(409, "INTERVIEW_TRANSCRIPTION_INVALID_STATE")
    db.commit()


def apply(db: Session, user_id: int, session_id: int, dataset_id: int, base_lock_version: int) -> None:
    from linkresume.application.interviews.service import InterviewEditConflict

    session, _, row = _owned_linked_row(db, user_id, session_id, dataset_id)
    if row is None or row.status != "succeeded" or not row.is_pending_replace or not row.result_markdown:
        raise ApiError(409, "INTERVIEW_TRANSCRIPTION_INVALID_STATE")
    if session.lock_version != base_lock_version:
        raise InterviewEditConflict
    now = _now()
    session.questions_markdown = row.result_markdown
    session.transcript_source = "transcription"
    session.lock_version += 1
    session.update_time = now
    row.is_pending_replace = False
    row.update_time = now
    db.commit()


def store_result(db: Session, row: InterviewRecordingTranscription, transcript: Transcript) -> None:
    """Write into an empty session transcript, otherwise keep for an explicit replace."""
    session = db.scalar(
        select(InterviewSession).where(InterviewSession.id == row.session_id).with_for_update()
    )
    now = _now()
    row.status = "succeeded"
    row.result_markdown = transcript.markdown
    row.result_duration_ms = transcript.duration_ms
    row.error_code = None
    row.lease_until = None
    row.update_time = now
    if session is None:
        row.status = "cancelled"
        return
    if (session.questions_markdown or "").strip():
        row.is_pending_replace = True
        return
    session.questions_markdown = transcript.markdown
    session.transcript_source = "transcription"
    session.lock_version += 1
    session.update_time = now
    row.is_pending_replace = False


@dataclass(frozen=True)
class _Work:
    id: int
    user_id: int
    status: str
    object_name: str
    provider_task_id: str | None


@dataclass(frozen=True)
class _Billing:
    user_id: int
    audio_seconds: float | None
    error_code: str | None


class TranscriptionRunner:
    """One worker round: submit queued jobs and poll running ones."""

    def __init__(
        self, session_factory, storage, llm_service, transcriber: FileTranscriber, *, poll_seconds: int = 20
    ) -> None:
        self._poll_interval = timedelta(seconds=poll_seconds)
        self._factory = session_factory
        self._storage = storage
        self._llm = llm_service
        self._transcriber = transcriber

    async def run_once(self) -> int:
        ids = await asyncio.to_thread(self._due_ids)
        if not ids:
            return 0
        try:
            plan = await self._llm.speech_plan(SPEECH_TO_TEXT)
            target = self._llm.speech_target_for_plan(plan)
        except LLMError:
            await asyncio.to_thread(self._fail_all, ids, "INTERVIEW_TRANSCRIPTION_NOT_CONFIGURED")
            return len(ids)
        for job_id in ids:
            billing = await asyncio.to_thread(self._advance, job_id, target)
            if billing is not None:
                await self._log_call(plan, billing)
        return len(ids)

    async def _log_call(self, plan, billing: _Billing) -> None:
        try:
            call_id = await self._llm.start_speech_call(
                plan, source="interview_transcription", user_id=billing.user_id
            )
            details = {"audio_seconds": billing.audio_seconds} if billing.audio_seconds else None
            await self._llm.finish_speech_call(
                call_id, started=perf_counter(), error_code=billing.error_code, details=details
            )
        except Exception:
            logger.warning("interview transcription call log failed", exc_info=True)

    def _due_ids(self) -> list[int]:
        now = _now()
        with self._factory() as db:
            return list(
                db.scalars(
                    select(InterviewRecordingTranscription.id)
                    .where(
                        InterviewRecordingTranscription.status.in_(ACTIVE),
                        InterviewRecordingTranscription.next_attempt_at <= now,
                        or_(
                            InterviewRecordingTranscription.lease_until.is_(None),
                            InterviewRecordingTranscription.lease_until < now,
                        ),
                    )
                    .order_by(InterviewRecordingTranscription.next_attempt_at)
                    .limit(ROUND_LIMIT)
                )
            )

    def _fail_all(self, ids: list[int], code: str) -> None:
        with self._factory() as db:
            for row in db.scalars(
                select(InterviewRecordingTranscription)
                .where(
                    InterviewRecordingTranscription.id.in_(ids),
                    InterviewRecordingTranscription.status.in_(ACTIVE),
                )
                .with_for_update()
            ):
                row.status = "failed"
                row.error_code = code
                row.lease_until = None
                row.update_time = _now()
            db.commit()

    def _claim(self, job_id: int) -> _Work | None:
        now = _now()
        with self._factory() as db:
            row = db.scalar(
                select(InterviewRecordingTranscription)
                .where(InterviewRecordingTranscription.id == job_id)
                .with_for_update()
            )
            if (
                row is None
                or row.status not in ACTIVE
                or _naive_utc(row.next_attempt_at) > now
                or (row.lease_until is not None and _naive_utc(row.lease_until) >= now)
            ):
                return None
            dataset = db.get(UserDataset, row.dataset_id)
            if dataset is None or dataset.interview_session_id != row.session_id:
                row.status = "cancelled"
                row.update_time = now
                db.commit()
                return None
            if row.status == "running" and row.submitted_at is not None and _naive_utc(row.submitted_at) + TASK_TIMEOUT < now:
                row.status = "failed"
                row.error_code = "INTERVIEW_TRANSCRIPTION_TIMEOUT"
                row.update_time = now
                db.commit()
                return None
            row.lease_until = now + LEASE
            db.commit()
            return _Work(row.id, row.user_id, row.status, dataset.object_name, row.provider_task_id)

    def _finish(self, job_id: int, mutate) -> None:
        with self._factory() as db:
            row = db.scalar(
                select(InterviewRecordingTranscription)
                .where(InterviewRecordingTranscription.id == job_id)
                .with_for_update()
            )
            # Cancelled or re-queued while the provider call was in flight.
            if row is None or row.status not in ACTIVE or row.lease_until is None:
                db.rollback()
                return
            dataset = db.get(UserDataset, row.dataset_id)
            if dataset is None or dataset.interview_session_id != row.session_id:
                row.status = "cancelled"
                row.lease_until = None
                row.update_time = _now()
            else:
                mutate(db, row)
                row.lease_until = None
                row.update_time = _now()
            db.commit()

    def _advance(self, job_id: int, target: SpeechTarget) -> _Billing | None:
        work = self._claim(job_id)
        if work is None:
            return None
        poll = self._poll_interval
        if work.status == "queued":
            return self._submit(work, target, poll)
        return self._poll(work, target, poll)

    def _submit(self, work: _Work, target: SpeechTarget, poll: timedelta) -> None:
        if not getattr(self._storage, "public_downloads_enabled", False):
            self._finish(work.id, _failed("INTERVIEW_TRANSCRIPTION_STORAGE_UNAVAILABLE"))
            return None
        try:
            url = self._storage.presigned_public_get_url(work.object_name, LINK_TTL)
            task_id = self._transcriber.submit(target, url)
        except TranscriptionProviderError as error:
            def record(db, row) -> None:
                row.attempts += 1
                if error.retryable and row.attempts < MAX_SUBMIT_ATTEMPTS:
                    row.next_attempt_at = _now() + SUBMIT_RETRY_DELAYS[row.attempts - 1]
                    row.error_code = error.code
                else:
                    row.status = "failed"
                    row.error_code = error.code

            self._finish(work.id, record)
            return None

        def running(db, row) -> None:
            row.attempts += 1
            row.status = "running"
            row.provider_task_id = task_id
            row.submitted_at = _now()
            row.next_attempt_at = _now() + poll
            row.error_code = None

        self._finish(work.id, running)
        return None

    def _poll(self, work: _Work, target: SpeechTarget, poll: timedelta) -> _Billing | None:
        if not work.provider_task_id:
            self._finish(work.id, _failed("INTERVIEW_TRANSCRIPTION_FAILED"))
            return None
        try:
            status = self._transcriber.query(target, work.provider_task_id)
            transcript = (
                self._transcriber.fetch(status.result_url)
                if status.state == "succeeded" and status.result_url
                else None
            )
        except TranscriptionProviderError as error:
            if error.retryable:
                self._finish(work.id, _later(poll))
                return None
            self._finish(work.id, _failed(error.code))
            return _Billing(work.user_id, None, error.code)
        if status.state in {"pending", "running"}:
            self._finish(work.id, _later(poll))
            return None
        if transcript is None:
            code = status.error_code or "INTERVIEW_TRANSCRIPTION_FAILED"
            self._finish(work.id, _failed(code))
            return _Billing(work.user_id, None, code)
        self._finish(work.id, lambda db, row: store_result(db, row, transcript))
        seconds = round(transcript.duration_ms / 1000, 2) if transcript.duration_ms else None
        return _Billing(work.user_id, seconds, None)


def _failed(code: str):
    def mutate(db, row) -> None:
        row.status = "failed"
        row.error_code = code

    return mutate


def _later(delay: timedelta):
    def mutate(db, row) -> None:
        row.next_attempt_at = _now() + delay

    return mutate
