"""Mock interview state machine, background preparation/evaluation and turns.

Database work is synchronous and short; model calls happen outside any open
transaction. Each write re-locks the interview row and re-checks its state so a
concurrent request or a stale background task cannot overwrite newer progress.
"""

from __future__ import annotations

from linkresume.modules.identity.dependencies import lock_active_user

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from linkresume.application.mock_interviews import prompts, rubric, voice_metrics
from linkresume.modules.product_events import service as product_events
from linkresume.application.mock_interviews.outputs import (
    BackgroundAnalysis,
    ClaimExtraction,
    ClaimVerification,
    InterviewPlan,
    InterviewerTurn,
    OverallEvaluation,
    QuestionEvaluation,
    SignalJudgement,
)
from linkresume.application.mock_interviews.retrieval import (
    SNIPPET_CHARS,
    EvidenceSnippet,
    MaterialDocument,
    MaterialRetriever,
)
from linkresume.application.resumes.service import parse_persisted_resume_snapshot
from linkresume.core.database import utc_now
from linkresume.integrations.linkrag_client import LinkRagError
from linkresume.modules.agent.resume_tools import BLOCK_MARKER_PATTERN, editor_markdown
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.interviews.models import JobApplication, JobApplicationStage
from linkresume.modules.job_descriptions.models import JobDescription
from linkresume.modules.llm.resolver import MOCK_INTERVIEW
from linkresume.modules.llm.schemas import ChatMessage, ChatUsage
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.mock_interviews.models import (
    MOCK_INTERVIEW_ACTIVE_STATUSES,
    MockInterview,
    MockInterviewQuestion,
)
from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask, Resume
from linkresume.services.dataset_content_service import content_key, read_markdown, source_version
from linkresume.services.rag_sync_service import recall_dataset_snippets

logger = logging.getLogger(__name__)

LLM_SOURCE = "mock_interview"
RESUME_CHARS = 24_000
JOB_DESCRIPTION_CHARS = 16_000
MAX_MATERIALS = 10
MATERIAL_TOTAL_BYTES = 1_000_000
MATERIAL_SNIPPETS_FOR_ANALYSIS = 12
MAX_FACT_CLAIMS = 15
TASK_LEASE = timedelta(minutes=10)
IDLE_TIMEOUT = timedelta(hours=24)
ANSWER_CHARS = 8_000
DEFAULT_QUESTION_COUNT = 5
HOTWORD_LIMIT = 200
RECORDING_PREFIX = "mock-interviews"

STAGE_TYPE_DEFAULTS = {"hr": "hr"}


class _LeaseLost(Exception):
    """This background task no longer owns the interview's lease."""


class MockInterviewError(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _not_found() -> MockInterviewError:
    return MockInterviewError(404, "MOCK_INTERVIEW_NOT_FOUND")


def _state_invalid() -> MockInterviewError:
    return MockInterviewError(409, "MOCK_INTERVIEW_STATE_INVALID")


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _clip(value: str | None, limit: int) -> str:
    text = (value or "").strip()
    return text if len(text) <= limit else text[:limit] + "\n…（已截断）"


@dataclass(frozen=True)
class StartRequest:
    job_application_id: int | None
    resume_id: int | None
    job_description_id: int | None
    job_description_text: str | None
    target_role: str | None
    interview_type: str | None
    difficulty: str
    question_count: int
    follow_up_enabled: bool
    language: str
    material_ids: list[int]
    answer_mode: str = "text"
    materials_in_questions: bool = False


# ---------------------------------------------------------------------------
# Ownership, snapshots and the single in-progress slot
# ---------------------------------------------------------------------------


def require_owned(db: Session, user_id: int, public_id: str, *, lock: bool = False) -> MockInterview:
    statement = select(MockInterview).where(
        MockInterview.public_id == public_id, MockInterview.user_id == user_id
    )
    if lock:
        lock_active_user(db, user_id)
        statement = statement.with_for_update().execution_options(populate_existing=True)
    interview = db.scalar(statement)
    if interview is None:
        raise _not_found()
    return interview


def resume_markdown(resume: Resume) -> str:
    snapshot = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
    markdown = editor_markdown(snapshot.data) or ""
    return _clip(BLOCK_MARKER_PATTERN.sub("", markdown), RESUME_CHARS)


def _job_snapshot_from_job(job: JobDescription) -> dict[str, object]:
    return {
        "company_name": job.company_name,
        "job_title": job.job_title,
        "description": _clip(job.description, JOB_DESCRIPTION_CHARS),
        "skills": list(job.skills or [])[:50],
        "employment_type": job.employment_type,
        "experience_requirement": job.experience_requirement,
        "education_requirement": job.education_requirement,
    }


def _job_snapshot_from_application(application: JobApplication) -> dict[str, object]:
    snapshot = dict(application.job_snapshot or {})
    return {
        "company_name": application.company_name_snapshot,
        "job_title": application.job_title_snapshot,
        "description": _clip(str(snapshot.get("description") or ""), JOB_DESCRIPTION_CHARS),
        "skills": list(snapshot.get("skills") or [])[:50],
        "employment_type": snapshot.get("employment_type"),
        "experience_requirement": snapshot.get("experience_requirement"),
        "education_requirement": snapshot.get("education_requirement"),
    }


def _owned_resume(db: Session, user_id: int, resume_id: int | None) -> Resume:
    if resume_id is None:
        raise MockInterviewError(422, "MOCK_INTERVIEW_RESUME_REQUIRED")
    resume = db.scalar(select(Resume).where(Resume.id == resume_id, Resume.user_id == user_id))
    if resume is None:
        raise MockInterviewError(404, "MOCK_INTERVIEW_SOURCE_NOT_FOUND")
    return resume


def _material_refs(db: Session, user_id: int, material_ids: list[int]) -> list[dict[str, object]]:
    unique_ids = list(dict.fromkeys(material_ids))
    if len(unique_ids) > MAX_MATERIALS:
        raise MockInterviewError(422, "MOCK_INTERVIEW_MATERIAL_INVALID")
    if not unique_ids:
        return []
    rows = {
        dataset.id: (dataset, task)
        for dataset, task in db.execute(
            select(UserDataset, DocumentParseTask)
            .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
            .where(
                UserDataset.id.in_(unique_ids),
                UserDataset.user_id == user_id,
                UserDataset.asset_kind == "document",
                DocumentParseTask.user_id == user_id,
                DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                DocumentParseTask.parse_status == "succeeded",
            )
        ).all()
    }
    if len(rows) != len(unique_ids):
        raise MockInterviewError(422, "MOCK_INTERVIEW_MATERIAL_INVALID")
    return [
        {
            "dataset_id": str(dataset_id),
            "file_name": rows[dataset_id][0].file_name,
            "version": source_version(rows[dataset_id][0]),
        }
        for dataset_id in unique_ids
    ]


def _default_interview_type(stage: JobApplicationStage | None) -> str:
    if stage is not None and (stage.stage_label or "").strip().upper().startswith("HR"):
        return "hr"
    return "comprehensive"


def build_interview(db: Session, user_id: int, request: StartRequest) -> MockInterview:
    """Resolve and snapshot the background; caller adds, commits and handles the slot."""
    stage_snapshot: dict[str, object] | None = None
    stage: JobApplicationStage | None = None
    job_snapshot: dict[str, object] | None = None
    job_description_id: int | None = None
    if request.job_application_id is not None:
        application = db.scalar(
            select(JobApplication).where(
                JobApplication.id == request.job_application_id,
                JobApplication.user_id == user_id,
            )
        )
        if application is None:
            raise MockInterviewError(404, "MOCK_INTERVIEW_SOURCE_NOT_FOUND")
        stage = db.scalar(
            select(JobApplicationStage).where(
                JobApplicationStage.application_id == application.id,
                JobApplicationStage.current_marker == 1,
            )
        )
        if stage is not None:
            stage_snapshot = {
                "stage_type": stage.stage_type,
                "stage_label": stage.stage_label,
                "round_no": stage.interview_round_no,
            }
        job_snapshot = _job_snapshot_from_application(application)
        job_description_id = application.job_description_id
        resume = _owned_resume(db, user_id, request.resume_id or application.resume_id)
        source_type = "job_application"
    else:
        resume = _owned_resume(db, user_id, request.resume_id)
        source_type = "resume"
        if request.job_description_id is not None:
            job = db.scalar(
                select(JobDescription).where(
                    JobDescription.id == request.job_description_id,
                    JobDescription.user_id == user_id,
                )
            )
            if job is None:
                raise MockInterviewError(404, "MOCK_INTERVIEW_SOURCE_NOT_FOUND")
            job_snapshot = _job_snapshot_from_job(job)
            job_description_id = job.id
        elif request.job_description_text and request.job_description_text.strip():
            job_snapshot = {
                "company_name": None,
                "job_title": request.target_role,
                "description": _clip(request.job_description_text, JOB_DESCRIPTION_CHARS),
            }
    try:
        markdown = resume_markdown(resume)
    except Exception as error:
        raise MockInterviewError(422, "MOCK_INTERVIEW_RESUME_INVALID") from error
    return MockInterview(
        public_id=str(uuid4()),
        user_id=user_id,
        active_user_id=user_id,
        source_type=source_type,
        job_application_id=request.job_application_id,
        resume_id=resume.id,
        job_description_id=job_description_id,
        resume_title_snapshot=resume.title[:200],
        resume_markdown_snapshot=markdown,
        job_snapshot_json=job_snapshot,
        stage_snapshot_json=stage_snapshot,
        target_role=(request.target_role or "").strip()[:200] or None,
        interview_type=request.interview_type or _default_interview_type(stage),
        difficulty=request.difficulty,
        question_count=request.question_count,
        is_follow_up_enabled=request.follow_up_enabled,
        language=request.language,
        answer_mode=request.answer_mode,
        material_refs_json=_material_refs(db, user_id, request.material_ids),
        is_materials_in_questions=bool(request.materials_in_questions and request.material_ids),
        status="preparing",
        task_lease_until=utc_now() + TASK_LEASE,
        task_token=new_task_token(),
        last_activity_at=utc_now(),
        # Explicit microsecond timestamps keep list cursors stable on every backend.
        created_at=utc_now(),
    )


def new_task_token() -> str:
    return uuid4().hex


def release_expired(db: Session, user_id: int) -> None:
    """Free the in-progress slot held by an idle or crashed interview.

    Uses conditional UPDATEs instead of a locking read: a ``FOR UPDATE`` that
    matches no row takes an InnoDB gap lock on the unique slot index, and two
    concurrent creates would then deadlock on their INSERTs.
    """
    lock_active_user(db, user_id)
    now = utc_now()
    expired_task = db.execute(
        update(MockInterview)
        .where(
            MockInterview.active_user_id == user_id,
            MockInterview.status.in_(("preparing", "evaluating")),
            MockInterview.task_lease_until < now,
        )
        .values(
            status=_failed_status_expression(),
            error_code="MOCK_INTERVIEW_TASK_INTERRUPTED",
            task_lease_until=None,
            task_token=None,
            active_user_id=None,
            lock_version=MockInterview.lock_version + 1,
        )
        .execution_options(synchronize_session=False)
    ).rowcount
    idle = db.execute(
        update(MockInterview)
        .where(
            MockInterview.active_user_id == user_id,
            MockInterview.status == "in_progress",
            MockInterview.last_activity_at < now - IDLE_TIMEOUT,
        )
        .values(
            status="abandoned",
            finished_at=now,
            current_question_id=None,
            active_user_id=None,
            lock_version=MockInterview.lock_version + 1,
        )
        .execution_options(synchronize_session=False)
    ).rowcount
    if expired_task or idle:
        db.commit()


def _failed_status_expression():
    from sqlalchemy import case

    return case(
        (MockInterview.status == "preparing", "preparation_failed"),
        else_="evaluation_failed",
    )


def _expire_if_stale(interview: MockInterview, now: datetime) -> bool:
    lease = _aware(interview.task_lease_until)
    if interview.status in ("preparing", "evaluating") and lease is not None and lease < now:
        interview.status = (
            "preparation_failed" if interview.status == "preparing" else "evaluation_failed"
        )
        interview.error_code = "MOCK_INTERVIEW_TASK_INTERRUPTED"
        interview.task_lease_until = None
        interview.task_token = None
        _set_slot(interview)
        interview.lock_version += 1
        return True
    last = _aware(interview.last_activity_at)
    if interview.status == "in_progress" and last is not None and now - last > IDLE_TIMEOUT:
        interview.status = "abandoned"
        interview.finished_at = now
        interview.current_question_id = None
        _set_slot(interview)
        interview.lock_version += 1
        return True
    return False


def _set_slot(interview: MockInterview) -> None:
    interview.active_user_id = (
        interview.user_id if interview.status in MOCK_INTERVIEW_ACTIVE_STATUSES else None
    )


def refresh_state(db: Session, interview: MockInterview) -> MockInterview:
    """Apply lazy timeouts when a caller reads an interview."""
    if interview.status not in MOCK_INTERVIEW_ACTIVE_STATUSES:
        return interview
    locked = db.scalar(
        select(MockInterview)
        .where(MockInterview.id == interview.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked is not None and _expire_if_stale(locked, utc_now()):
        db.commit()
    return locked or interview


_SLOT_CONTENTION_CODES = {1205, 1213}  # MySQL lock wait timeout, deadlock


def occupy_slot(db: Session, interview: MockInterview) -> None:
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise MockInterviewError(409, "MOCK_INTERVIEW_IN_PROGRESS") from error
    except OperationalError as error:
        code = getattr(getattr(error, "orig", None), "args", (None,))[0]
        if code not in _SLOT_CONTENTION_CODES:
            raise
        db.rollback()
        raise MockInterviewError(409, "MOCK_INTERVIEW_IN_PROGRESS") from error


def ensure_slot_free(db: Session, user_id: int, *, except_id: int | None = None) -> None:
    release_expired(db, user_id)
    holder = db.scalar(select(MockInterview.id).where(MockInterview.active_user_id == user_id))
    if holder is not None and holder != except_id:
        raise MockInterviewError(409, "MOCK_INTERVIEW_IN_PROGRESS")


# ---------------------------------------------------------------------------
# Transcript helpers
# ---------------------------------------------------------------------------


def list_questions(db: Session, interview_id: int) -> list[MockInterviewQuestion]:
    return list(
        db.scalars(
            select(MockInterviewQuestion)
            .where(MockInterviewQuestion.interview_id == interview_id)
            .order_by(MockInterviewQuestion.sequence_no)
        )
    )


def hotwords(interview: MockInterview, analysis: dict[str, Any], plan: dict[str, Any]) -> list[str]:
    """Terms the candidate is likely to say, reused as STT hot words and correction glossary."""
    terms: list[str] = []
    for claim in analysis.get("claims") or []:
        terms.extend(str(item) for item in claim.get("technologies") or [])
    for item in plan.get("selected") or []:
        terms.append(str(item.get("topic") or ""))
    job = interview.job_snapshot_json or {}
    terms.extend(str(job.get(key) or "") for key in ("company_name", "job_title"))
    for ref in interview.material_refs_json or []:
        terms.append(str(ref.get("file_name") or "").rsplit(".", 1)[0])
    seen: set[str] = set()
    result: list[str] = []
    for term in terms:
        term = term.strip()
        if not term or len(term) > 30 or term.lower() in seen:
            continue
        seen.add(term.lower())
        result.append(term)
    return result[:HOTWORD_LIMIT]


def voice_report(questions: list[MockInterviewQuestion]) -> dict[str, object] | None:
    per_answer = [
        voice_metrics.answer_metrics(list(item.words_json or []), item.audio_duration_ms)
        for item in questions
        if item.answer_status == "answered" and item.answer_source == "voice" and item.words_json
    ]
    return voice_metrics.summarize(per_answer)


def _transcript(questions: list[MockInterviewQuestion]) -> list[dict[str, object]]:
    return [
        {
            "sequence_no": item.sequence_no,
            "kind": "follow_up" if item.parent_id else "main",
            "question": item.content,
            "answer": item.answer_text if item.answer_status == "answered" else None,
            "skipped": item.answer_status == "skipped",
        }
        for item in questions
    ]


def _plan_items(interview: MockInterview) -> list[dict[str, Any]]:
    return list((interview.plan_json or {}).get("selected") or [])


def _root_id(question: MockInterviewQuestion) -> int:
    return question.parent_id or question.id


# ---------------------------------------------------------------------------
# Model calls
# ---------------------------------------------------------------------------


@dataclass
class _Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    def add(self, usage: ChatUsage | None) -> None:
        if usage is None:
            return
        self.input_tokens += usage.input_tokens or 0
        self.output_tokens += usage.output_tokens or 0


async def _structured(llm: LLMService, user_id: int, messages, model, usage: _Usage):
    """Call once and retry once on an invalid structure, per the stability rule."""
    last: LLMError | None = None
    for _ in range(2):
        try:
            result = await llm.structured_chat(
                user_id, messages, source=LLM_SOURCE, response_model=model, use_case=MOCK_INTERVIEW
            )
        except LLMError as error:
            if error.code != "LLM_RESPONSE_INVALID":
                raise
            last = error
            continue
        usage.add(result.usage)
        return result.value
    assert last is not None
    raise last


# ---------------------------------------------------------------------------
# Material loading and retrieval
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LoadedMaterials:
    retriever: MaterialRetriever | None
    truncated: bool
    failed: bool
    updated: list[str]


def load_materials(db: Session, storage: Any, interview: MockInterview) -> LoadedMaterials:
    refs = list(interview.material_refs_json or [])
    if not refs:
        return LoadedMaterials(None, False, False, [])
    documents: list[MaterialDocument] = []
    total = 0
    truncated = False
    updated: list[str] = []
    try:
        for ref in refs:
            row = db.execute(
                select(UserDataset, DocumentParseTask)
                .join(DocumentParseTask, DocumentParseTask.id == UserDataset.parse_task_id)
                .where(
                    UserDataset.id == int(str(ref["dataset_id"])),
                    UserDataset.user_id == interview.user_id,
                    UserDataset.asset_kind == "document",
                    DocumentParseTask.user_id == interview.user_id,
                    DocumentParseTask.source_type == DATASET_SOURCE_TYPE,
                )
            ).one_or_none()
            if row is None:
                continue
            dataset, task = row
            remaining = MATERIAL_TOTAL_BYTES - total
            if remaining <= 0:
                truncated = True
                break
            markdown = read_markdown(storage, content_key(dataset, task), MATERIAL_TOTAL_BYTES)
            encoded = markdown.encode("utf-8")
            if len(encoded) > remaining:
                markdown = encoded[:remaining].decode("utf-8", errors="ignore")
                truncated = True
            total += len(markdown.encode("utf-8"))
            version = source_version(dataset)
            if version != ref.get("version"):
                updated.append(str(dataset.id))
            documents.append(
                MaterialDocument(
                    dataset_id=str(dataset.id),
                    title=dataset.file_name,
                    version=version,
                    markdown=markdown,
                )
            )
    except Exception:
        logger.warning(
            "mock interview material read failed",
            extra={"mock_interview_id": interview.id, "error_code": "MOCK_INTERVIEW_MATERIAL_READ_FAILED"},
        )
        return LoadedMaterials(None, False, True, [])
    retriever = MaterialRetriever(documents)
    return LoadedMaterials(None if retriever.empty else retriever, truncated, False, updated)


def _analysis_snippets(retriever: MaterialRetriever | None, interview: MockInterview) -> list[dict[str, object]]:
    if retriever is None:
        return []
    queries = [interview.resume_markdown_snapshot[:2000]]
    job = interview.job_snapshot_json or {}
    if job.get("description"):
        queries.append(str(job["description"])[:2000])
    seen: set[tuple[str, int]] = set()
    snippets: list[dict[str, object]] = []
    for query in queries:
        for snippet in retriever.search(query, limit=MATERIAL_SNIPPETS_FOR_ANALYSIS):
            key = (snippet.dataset_id, snippet.position)
            if key not in seen and len(snippets) < MATERIAL_SNIPPETS_FOR_ANALYSIS:
                seen.add(key)
                snippets.append(snippet.as_dict())
    if not snippets:
        # Explicitly selected materials must still inform a sparse background.
        snippets = [snippet.as_dict() for snippet in retriever.leading(limit=MATERIAL_SNIPPETS_FOR_ANALYSIS)]
    return snippets


# ---------------------------------------------------------------------------
# Preparation
# ---------------------------------------------------------------------------


class MockInterviewRunner:
    """Owns the background tasks and streamed turns for one application."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        llm: LLMService,
        storage: Any,
        rag: Any | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._llm = llm
        self._storage = storage
        self._rag = rag
        self._tasks: set[asyncio.Task[None]] = set()

    def spawn(self, coroutine) -> None:
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _db(self, function: Callable[..., Any], *args, **kwargs):
        return await asyncio.to_thread(function, *args, **kwargs)

    def _with_db(self, function: Callable[[Session], Any]):
        with self._session_factory() as db:
            try:
                return function(db)
            except BaseException:
                db.rollback()
                raise

    # -- preparation ------------------------------------------------------

    def _claim(self, db: Session, interview_id: int, status: str, token: str) -> bool:
        """True only while this task still owns the interview's lease."""
        interview = db.scalar(
            select(MockInterview)
            .where(MockInterview.id == interview_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return (
            interview is not None
            and interview.status == status
            and interview.task_token == token
        )

    def _heartbeat_sync(self, db: Session, interview_id: int, status: str, token: str) -> bool:
        """Renew the lease before each model call so a live task never expires."""
        renewed = db.execute(
            update(MockInterview)
            .where(
                MockInterview.id == interview_id,
                MockInterview.status == status,
                MockInterview.task_token == token,
            )
            .values(task_lease_until=utc_now() + TASK_LEASE)
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()
        return bool(renewed)

    async def _heartbeat(self, interview_id: int, status: str, token: str) -> None:
        if not await self._db(
            self._with_db, lambda db: self._heartbeat_sync(db, interview_id, status, token)
        ):
            raise _LeaseLost

    async def prepare(self, interview_id: int, token: str) -> None:
        try:
            await self._prepare(interview_id, token)
        except _LeaseLost:
            return
        except Exception as error:
            code = (
                error.code
                if isinstance(error, (LLMError, MockInterviewError))
                else "MOCK_INTERVIEW_PREPARATION_FAILED"
            )
            if not isinstance(error, (LLMError, MockInterviewError)):
                logger.exception("mock interview preparation failed", extra={"mock_interview_id": interview_id})
            await self._db(
                self._with_db, lambda db: self._fail(db, interview_id, "preparing", token, code)
            )

    async def _prepare(self, interview_id: int, token: str) -> None:
        loaded = await self._db(
            self._with_db, lambda db: self._load_for_task(db, interview_id, "preparing", token)
        )
        if loaded is None:
            return
        interview, previous_topics, reused_analysis = loaded
        usage = _Usage()
        if reused_analysis is not None:
            analysis = reused_analysis
        else:
            snippets: list[dict[str, object]] = []
            if interview.materials_in_questions:
                materials = await self._db(
                    self._with_db, lambda db: load_materials(db, self._storage, interview)
                )
                snippets = _analysis_snippets(materials.retriever, interview)
            await self._heartbeat(interview_id, "preparing", token)
            analysis_value = await _structured(
                self._llm,
                interview.user_id,
                prompts.analysis_messages(interview, snippets),
                BackgroundAnalysis,
                usage,
            )
            analysis = analysis_value.model_dump()
        await self._heartbeat(interview_id, "preparing", token)
        plan_value = await _structured(
            self._llm,
            interview.user_id,
            prompts.plan_messages(interview, analysis, previous_topics),
            InterviewPlan,
            usage,
        )
        selected = [
            item.model_copy(update={"start_depth": rubric.clamp_start_depth(interview.difficulty, item.start_depth)})
            for item in plan_value.selected[: interview.question_count]
        ]
        if len(selected) < interview.question_count:
            pool = [item for item in plan_value.candidates if item.topic not in {s.topic for s in selected}]
            selected.extend(
                item.model_copy(update={"start_depth": rubric.clamp_start_depth(interview.difficulty, item.start_depth)})
                for item in pool[: interview.question_count - len(selected)]
            )
        if len(selected) < interview.question_count:
            raise MockInterviewError(502, "MOCK_INTERVIEW_PLAN_INCOMPLETE")
        plan = {"selected": [item.model_dump() for item in selected]}
        stored = await self._db(
            self._with_db,
            lambda db: self._store_plan(db, interview_id, token, analysis, plan, usage),
        )
        if not stored:
            return
        # The opening turn is generated eagerly so the client sees the first
        # question as soon as preparation completes.
        await self._generate_turn_to_completion(interview_id, token)

    def _load_for_task(self, db: Session, interview_id: int, status: str, token: str):
        interview = db.get(MockInterview, interview_id)
        if interview is None or interview.status != status or interview.task_token != token:
            return None
        previous_topics: list[str] = []
        reused: dict[str, object] | None = None
        if interview.repeat_of_id is not None:
            previous = db.get(MockInterview, interview.repeat_of_id)
            if previous is not None and previous.user_id == interview.user_id:
                previous_topics = [str(item.get("topic")) for item in _plan_items(previous)]
                if (
                    previous.analysis_json
                    and previous.resume_markdown_snapshot == interview.resume_markdown_snapshot
                    and previous.job_snapshot_json == interview.job_snapshot_json
                    and previous.material_refs_json == interview.material_refs_json
                    and previous.is_materials_in_questions == interview.is_materials_in_questions
                ):
                    reused = dict(previous.analysis_json)
        db.expunge(interview)
        return interview, previous_topics, reused

    def _store_plan(
        self, db: Session, interview_id: int, token: str, analysis, plan, usage: _Usage
    ) -> bool:
        if not self._claim(db, interview_id, "preparing", token):
            db.rollback()
            return False
        interview = db.get(MockInterview, interview_id)
        interview.analysis_json = analysis
        interview.plan_json = plan
        if interview.answer_mode == "voice":
            interview.hotwords_json = hotwords(interview, analysis, plan)
        interview.input_tokens += usage.input_tokens
        interview.output_tokens += usage.output_tokens
        interview.task_lease_until = utc_now() + TASK_LEASE
        interview.lock_version += 1
        db.commit()
        return True

    def _fail(self, db: Session, interview_id: int, expected: str, token: str, code: str) -> None:
        # A superseded task (lease expired and retried) must not fail the new run.
        if not self._claim(db, interview_id, expected, token):
            db.rollback()
            return
        interview = db.get(MockInterview, interview_id)
        interview.status = "preparation_failed" if expected == "preparing" else "evaluation_failed"
        interview.error_code = code[:64]
        interview.task_lease_until = None
        interview.task_token = None
        _set_slot(interview)
        interview.lock_version += 1
        db.commit()

    # -- interviewer turns -------------------------------------------------

    def _turn_context(self, db: Session, interview_id: int):
        interview = db.get(MockInterview, interview_id)
        if interview is None:
            return None
        questions = list_questions(db, interview_id)
        db.expunge(interview)
        return interview, questions

    def _turn_plan(self, interview: MockInterview, questions: list[MockInterviewQuestion]):
        """Decide what the next model turn is allowed to do."""
        plan = _plan_items(interview)
        if not questions:
            return {"opening": True, "plan_index": 0, "follow_ups": 0, "allow_follow_up": False}
        current = questions[-1]
        root = next(item for item in questions if item.id == _root_id(current))
        follow_ups = sum(1 for item in questions if item.parent_id == root.id)
        allow = (
            interview.is_follow_up_enabled
            and current.answer_status == "answered"
            and follow_ups < rubric.MAX_FOLLOW_UPS
        )
        return {
            "opening": False,
            "plan_index": root.plan_index,
            "follow_ups": follow_ups,
            "allow_follow_up": allow,
            "last_topic": root.plan_index >= len(plan) - 1,
            "root_id": root.id,
        }

    async def stream_turn(
        self, interview_id: int, token: str | None = None
    ) -> AsyncIterator[dict[str, object]]:
        """Stream the interviewer's next message and persist it once complete.

        Always ends with exactly one ``turn`` or ``error`` event. ``token`` is
        set only for the opening turn generated by the preparation task.
        """
        try:
            async for event in self._stream_turn(interview_id, token):
                yield event
        except (asyncio.CancelledError, GeneratorExit):
            raise
        except LLMError as error:
            yield {"event": "error", "error": error.code}
        except Exception:
            logger.exception("mock interview turn failed", extra={"mock_interview_id": interview_id})
            yield {"event": "error", "error": "MOCK_INTERVIEW_TURN_FAILED"}

    async def _stream_turn(
        self, interview_id: int, token: str | None
    ) -> AsyncIterator[dict[str, object]]:
        context = await self._db(self._with_db, lambda db: self._turn_context(db, interview_id))
        if context is None:
            yield {"event": "error", "error": "MOCK_INTERVIEW_NOT_FOUND"}
            return
        interview, questions = context
        decision = self._turn_plan(interview, questions)
        plan = _plan_items(interview)
        if decision["opening"]:
            topic = plan[0] if plan else None
        elif decision["allow_follow_up"]:
            topic = plan[decision["plan_index"]]
        else:
            next_index = decision["plan_index"] + 1
            topic = plan[next_index] if next_index < len(plan) else plan[decision["plan_index"]]
        messages = prompts.interviewer_messages(
            interview,
            plan_item=topic,
            transcript=_transcript(questions),
            follow_ups_used=int(decision["follow_ups"]),
            allow_follow_up=bool(decision["allow_follow_up"]),
            is_opening=bool(decision["opening"]),
            is_last_topic=bool(decision.get("last_topic")),
        )
        header: InterviewerTurn | None = None
        buffer = ""
        body: list[str] = []
        usage = ChatUsage()
        try:
            stream = await self._llm.stream_chat(
                interview.user_id, messages, source=LLM_SOURCE, use_case=MOCK_INTERVIEW
            )
            async for event in stream.events:
                if event.type == "error":
                    yield {"event": "error", "error": event.error_code or "LLM_UNAVAILABLE"}
                    return
                if event.type == "done":
                    usage = event.usage or usage
                    break
                chunk = event.content or ""
                if header is None:
                    buffer += chunk
                    split = _split_header(buffer)
                    if split is None:
                        continue
                    first, rest = split
                    header = _parse_header(first)
                    if header is None:
                        yield {"event": "error", "error": "LLM_RESPONSE_INVALID"}
                        return
                    chunk = rest
                if chunk:
                    body.append(chunk)
                    yield {"event": "delta", "content": chunk}
        except LLMError as error:
            yield {"event": "error", "error": error.code}
            return
        if header is None:
            header = _parse_header(buffer)
            if header is not None:
                body = []
        text = "".join(body).strip()
        if header is None or not text:
            yield {"event": "error", "error": "LLM_RESPONSE_INVALID"}
            return
        result = await self._db(
            self._with_db,
            lambda db: self._store_turn(
                db, interview_id, decision, header, text, usage, len(questions), token
            ),
        )
        if result is None:
            yield {"event": "error", "error": "MOCK_INTERVIEW_STATE_INVALID"}
            return
        evaluation_token = result.pop("evaluation_token", None)
        if evaluation_token:
            # Spawn before yielding: a client that disconnects on the final
            # event cancels this generator at the yield.
            self.spawn(self.evaluate(interview_id, str(evaluation_token)))
        yield {"event": "turn", **result}

    async def _generate_turn_to_completion(self, interview_id: int, token: str) -> None:
        await self._heartbeat(interview_id, "preparing", token)
        async for event in self.stream_turn(interview_id, token):
            if event["event"] == "error":
                await self._db(
                    self._with_db,
                    lambda db: self._fail(db, interview_id, "preparing", token, str(event["error"])),
                )
                return

    def _store_turn(
        self,
        db: Session,
        interview_id: int,
        decision: dict[str, Any],
        header: InterviewerTurn,
        text: str,
        usage: ChatUsage,
        expected_count: int,
        token: str | None,
    ) -> dict[str, object] | None:
        interview = db.scalar(
            select(MockInterview)
            .where(MockInterview.id == interview_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if interview is None:
            db.rollback()
            return None
        # The opening turn belongs to the preparation task; later turns to the
        # in-progress interview. A superseded preparation cannot write either.
        if token is not None:
            if interview.status != "preparing" or interview.task_token != token:
                db.rollback()
                return None
        elif interview.status != "in_progress":
            db.rollback()
            return None
        questions = list_questions(db, interview_id)
        # A concurrent retry already stored this turn.
        if len(questions) != expected_count or (questions and questions[-1].answer_status == "pending"):
            db.rollback()
            return None
        plan = _plan_items(interview)
        if not plan:
            db.rollback()
            return None
        action = header.action
        if decision["opening"]:
            action = "next_question"
        elif action == "follow_up" and not decision["allow_follow_up"]:
            action = "finish" if decision["last_topic"] else "next_question"
        elif action == "next_question" and decision["last_topic"]:
            action = "finish"
        elif action == "finish" and not decision["last_topic"]:
            action = "next_question"
        now = utc_now()
        interview.input_tokens += usage.input_tokens or 0
        interview.output_tokens += usage.output_tokens or 0
        interview.last_activity_at = now
        question: MockInterviewQuestion | None = None
        evaluation_token: str | None = None
        if action == "finish":
            interview.status = "evaluating"
            interview.current_question_id = None
            interview.finished_at = now
            interview.task_lease_until = now + TASK_LEASE
            evaluation_token = new_task_token()
            interview.task_token = evaluation_token
            closing = text
        else:
            closing = None
            if action == "follow_up":
                parent_id = decision["root_id"]
                plan_index = decision["plan_index"]
                depth = rubric.clamp_depth(interview.difficulty, header.depth_level)
            else:
                parent_id = None
                plan_index = 0 if decision["opening"] else decision["plan_index"] + 1
                depth = rubric.clamp_start_depth(
                    interview.difficulty, int(plan[plan_index].get("start_depth") or 1)
                )
            question = MockInterviewQuestion(
                interview_id=interview.id,
                parent_id=parent_id,
                sequence_no=len(questions) + 1,
                plan_index=plan_index,
                depth_level=depth,
                content=text,
            )
            db.add(question)
            db.flush()
            interview.current_question_id = question.id
            if interview.status == "preparing":
                interview.status = "in_progress"
                interview.started_at = now
                interview.task_lease_until = None
                interview.task_token = None
        if closing is not None:
            report = dict(interview.report_json or {})
            report["closing_message"] = closing
            interview.report_json = report
        _set_slot(interview)
        interview.lock_version += 1
        db.commit()
        return {
            "status": interview.status,
            "action": action,
            "question": serialize_question(question) if question is not None else None,
            "closing_message": closing,
            "lock_version": interview.lock_version,
            "evaluation_token": evaluation_token,
        }

    # -- evaluation --------------------------------------------------------

    async def evaluate(self, interview_id: int, token: str) -> None:
        try:
            await self._evaluate(interview_id, token)
        except _LeaseLost:
            return
        except Exception as error:
            code = error.code if isinstance(error, LLMError) else "MOCK_INTERVIEW_EVALUATION_FAILED"
            if not isinstance(error, LLMError):
                logger.exception("mock interview evaluation failed", extra={"mock_interview_id": interview_id})
            await self._db(
                self._with_db, lambda db: self._fail(db, interview_id, "evaluating", token, code)
            )

    def _evaluation_context(self, db: Session, interview_id: int, token: str):
        interview = db.get(MockInterview, interview_id)
        if interview is None or interview.status != "evaluating" or interview.task_token != token:
            return None
        questions = list_questions(db, interview_id)
        db.expunge(interview)
        for item in questions:
            db.expunge(item)
        return interview, questions

    async def _evaluate(self, interview_id: int, token: str) -> None:
        context = await self._db(
            self._with_db, lambda db: self._evaluation_context(db, interview_id, token)
        )
        if context is None:
            return
        interview, questions = context
        plan = _plan_items(interview)
        usage = _Usage()
        roots = [item for item in questions if item.parent_id is None]

        async def evaluate_root(root: MockInterviewQuestion):
            turns = [item for item in questions if _root_id(item) == root.id]
            answered = [item for item in turns if item.answer_status == "answered"]
            if not answered:
                return root.id, None
            await self._heartbeat(interview_id, "evaluating", token)
            value = await _structured(
                self._llm,
                interview.user_id,
                prompts.question_evaluation_messages(interview, plan[root.plan_index], _transcript(turns)),
                QuestionEvaluation,
                usage,
            )
            return root.id, value

        # Each question is judged in its own call so earlier answers cannot bias
        # later scores; calls run sequentially to bound per-user provider load.
        results = dict([await evaluate_root(root) for root in roots])
        question_results: list[dict[str, object]] = []
        scores: list[float] = []
        evaluations: dict[int, dict[str, object]] = {}
        for root in roots:
            item = plan[root.plan_index]
            evaluation = score_root(interview, item, root, questions, results.get(root.id))
            evaluations[root.id] = evaluation
            scores.append(float(evaluation["score"]))
            question_results.append({"topic": item.get("topic"), "sequence_no": root.sequence_no, **evaluation})

        fact_check = await self._fact_check(interview, questions, usage, token)
        await self._heartbeat(interview_id, "evaluating", token)
        overall = await _structured(
            self._llm,
            interview.user_id,
            prompts.overall_evaluation_messages(
                interview,
                voice_metrics=voice_report(questions) if interview.answer_mode == "voice" else None,
                transcript=_transcript(questions),
                question_results=question_results,
                fact_checks=fact_check["items"],
            ),
            OverallEvaluation,
            usage,
        )
        has_job = bool((interview.job_snapshot_json or {}).get("description"))
        weights = rubric.effective_weights(interview.interview_type, has_job=has_job)
        dimensions: list[dict[str, object]] = []
        dimension_scores: dict[str, int] = {}
        for key in rubric.DIMENSIONS:
            judgement = getattr(overall, key)
            if weights[key] == 0 or judgement is None:
                continue
            dimension_scores[key] = judgement.score
            dimensions.append(
                {
                    "key": key,
                    "score": judgement.score,
                    "weight": weights[key],
                    "evidence": judgement.evidence,
                    "comment": judgement.comment,
                }
            )
        weights = {key: value for key, value in weights.items() if key in dimension_scores}
        total_weight = sum(weights.values())
        weights = {key: round(value / total_weight, 4) for key, value in weights.items()} if total_weight else {}
        for item in dimensions:
            item["weight"] = weights[str(item["key"])]
        dimension_total = rubric.dimension_score(dimension_scores, weights)
        total = rubric.total_score(scores, dimension_total)
        answered_roots = sum(1 for root in roots if not evaluations[root.id]["skipped"])
        report = {
            "rubric_version": rubric.RUBRIC_VERSION,
            "answer_mode": interview.answer_mode,
            "voice_metrics": voice_report(questions) if interview.answer_mode == "voice" else None,
            "headline": overall.headline,
            "summary": overall.summary,
            "total_score": total,
            "question_average": round(sum(scores) / len(scores), 2) if scores else 0.0,
            "dimension_score": dimension_total,
            "dimensions": dimensions,
            "questions": question_results,
            "fact_check": fact_check,
            "resume_risks": overall.resume_risks,
            "improvements": overall.improvements,
            "off_topic_detected": overall.off_topic_detected,
            "low_confidence": rubric.low_confidence(answered=answered_roots, total=len(roots)),
        }
        await self._db(
            self._with_db,
            lambda db: self._store_report(db, interview_id, token, report, evaluations, usage),
        )

    async def _fact_check(
        self,
        interview: MockInterview,
        questions: list[MockInterviewQuestion],
        usage: _Usage,
        token: str,
    ) -> dict[str, object]:
        if not interview.material_refs_json:
            return {"status": "not_requested", "items": []}
        materials = await self._db(self._with_db, lambda db: load_materials(db, self._storage, interview))
        if materials.failed:
            return {"status": "failed", "items": []}
        base = {
            "truncated": materials.truncated,
            "updated_materials": materials.updated,
        }
        if materials.retriever is None:
            return {"status": "completed", "items": [], **base}
        await self._heartbeat(interview.id, "evaluating", token)
        extraction = await _structured(
            self._llm,
            interview.user_id,
            prompts.claim_extraction_messages(_transcript(questions)),
            ClaimExtraction,
            usage,
        )
        items: list[dict[str, object]] = []
        rag_state = {"available": self._rag is not None}
        for claim in extraction.claims[:MAX_FACT_CLAIMS]:
            snippets = await self._evidence(interview, materials.retriever, claim.text, rag_state)
            if not snippets:
                items.append({"claim": claim.text, "kind": claim.kind, "question_sequence_no": claim.question_sequence_no, "verdict": "not_found", "quote": "", "source": None, "note": ""})
                continue
            await self._heartbeat(interview.id, "evaluating", token)
            verification = await _structured(
                self._llm,
                interview.user_id,
                prompts.claim_verification_messages(claim.text, [s.as_dict() for s in snippets]),
                ClaimVerification,
                usage,
            )
            source = None
            verdict = verification.verdict
            quote = verification.quote
            if verdict != "not_found":
                index = verification.snippet_index
                chosen = snippets[index] if index is not None and index < len(snippets) else None
                # A verdict without a verbatim quote from the retrieved text is
                # not evidence; downgrade it instead of trusting the model.
                if chosen is None or not quote or _normalize(quote) not in _normalize(chosen.text):
                    verdict, quote = "not_found", ""
                else:
                    source = chosen.as_dict()
            items.append(
                {
                    "claim": claim.text,
                    "kind": claim.kind,
                    "question_sequence_no": claim.question_sequence_no,
                    "verdict": verdict,
                    "quote": quote,
                    "source": source,
                    "note": verification.note,
                }
            )
        return {"status": "completed", "items": items, **base}

    async def _evidence(
        self,
        interview: MockInterview,
        retriever: MaterialRetriever,
        claim: str,
        rag_state: dict[str, bool],
    ) -> list[EvidenceSnippet]:
        """Top 3 snippets from the selected materials for one claim.

        Materials indexed in LinkRag are recalled semantically; the rest keep
        the in-memory retriever. The first RAG failure switches the whole
        fact check to the in-memory retriever so results stay consistent.
        """
        selected = [int(str(ref["dataset_id"])) for ref in interview.material_refs_json or []]
        rag_snippets: list[EvidenceSnippet] = []
        covered: set[int] = set()
        if rag_state["available"] and selected:
            try:
                found, covered = await self._db(
                    self._with_db,
                    lambda db: recall_dataset_snippets(
                        db,
                        self._rag,
                        user_id=interview.user_id,
                        query=claim,
                        dataset_ids=selected,
                        limit=3,
                    ),
                )
            except LinkRagError:
                rag_state["available"] = False
                found, covered = [], set()
            rag_snippets = [
                EvidenceSnippet(
                    dataset_id=str(item.dataset_id),
                    title=item.title,
                    version=item.version,
                    # RAG chunks have no stable local position.
                    position=-1,
                    # Keep the verified quote inside what the model is shown.
                    text=item.text[:SNIPPET_CHARS],
                    score=round(item.score, 4),
                )
                for item in found
            ]
        local = [
            snippet
            for snippet in retriever.search(claim, limit=3 + len(covered) * 3)
            if int(snippet.dataset_id) not in covered
        ]
        return (rag_snippets + local)[:3]

    def _store_report(
        self, db: Session, interview_id: int, token: str, report, evaluations, usage: _Usage
    ) -> None:
        if not self._claim(db, interview_id, "evaluating", token):
            db.rollback()
            return
        interview = db.get(MockInterview, interview_id)
        for question in db.scalars(
            select(MockInterviewQuestion).where(
                MockInterviewQuestion.interview_id == interview_id,
                MockInterviewQuestion.id.in_(list(evaluations)),
            )
        ):
            question.evaluation_json = evaluations[question.id]
        closing = (interview.report_json or {}).get("closing_message")
        if closing:
            report["closing_message"] = closing
        interview.report_json = report
        interview.total_score = Decimal(str(report["total_score"]))
        interview.is_low_confidence = bool(report["low_confidence"])
        interview.rubric_version = rubric.RUBRIC_VERSION
        interview.status = "completed"
        interview.error_code = None
        interview.task_lease_until = None
        interview.task_token = None
        interview.input_tokens += usage.input_tokens
        interview.output_tokens += usage.output_tokens
        _set_slot(interview)
        interview.lock_version += 1
        product_events.mock_interview_completed(db, interview.user_id, interview.id, interview.answer_mode)
        db.commit()


def score_root(
    interview: MockInterview,
    item: dict[str, Any],
    root: MockInterviewQuestion,
    questions: list[MockInterviewQuestion],
    value: QuestionEvaluation | None,
) -> dict[str, object]:
    """Deterministic score for one main question from the model's judgements."""
    signals = list(item.get("expected_signals") or [])
    if value is None:
        verdicts: list[dict[str, object]] = [
            {"signal": signal, "verdict": "miss", "evidence": ""} for signal in signals
        ]
        evaluation = {
            "skipped": True,
            "score": 0.0,
            "achieved_depth": 0,
            "signals": verdicts,
            "factual_errors": [],
            "highlights": [],
            "weaknesses": [],
            "reference_answer": "",
        }
    else:
        answers = " ".join(
            q.answer_text or "" for q in questions if _root_id(q) == root.id
        )
        verdicts = _align_signals(signals, value, answers)
        score = rubric.question_score(
            signal_verdicts=[str(v["verdict"]) for v in verdicts],
            achieved_depth=value.achieved_depth,
            difficulty=interview.difficulty,
            factual_errors=len(value.factual_errors),
            skipped=False,
        )
        evaluation = {
            "skipped": False,
            "score": score,
            "achieved_depth": value.achieved_depth,
            "signals": verdicts,
            "factual_errors": value.factual_errors,
            "highlights": value.highlights,
            "weaknesses": value.weaknesses,
            "reference_answer": value.reference_answer,
        }
    return evaluation


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).casefold()


def _align_signals(
    signals: list[str], value: QuestionEvaluation, answers: str
) -> list[dict[str, object]]:
    """Map judgements onto the planned signals; unquoted judgements count as a miss."""
    remaining = list(value.signals)
    normalized_answers = _normalize(answers)
    # Exact name matches first; leftovers fill unmatched signals positionally.
    # Each judgement is consumed once so one verdict cannot score two signals.
    matched: dict[int, SignalJudgement] = {}
    for index, signal in enumerate(signals):
        hit = next((item for item in remaining if _normalize(item.signal) == _normalize(signal)), None)
        if hit is not None:
            matched[index] = hit
            remaining.remove(hit)
    aligned: list[dict[str, object]] = []
    for index, signal in enumerate(signals):
        judgement = matched.get(index)
        if judgement is None and remaining:
            judgement = remaining.pop(0)
        verdict = judgement.verdict if judgement else "miss"
        evidence = judgement.evidence if judgement else ""
        if verdict != "miss" and (not evidence or _normalize(evidence) not in normalized_answers):
            verdict, evidence = "miss", ""
        aligned.append({"signal": signal, "verdict": verdict, "evidence": evidence})
    return aligned


def _split_header(buffer: str) -> tuple[str, str] | None:
    """Split the leading JSON decision from the spoken text once it is complete."""
    stripped = buffer.lstrip()
    if stripped.startswith("{") and "}" in stripped:
        end = stripped.index("}") + 1
        return stripped[:end], stripped[end:].lstrip("\r\n")
    if "\n" in buffer:
        first, rest = buffer.split("\n", 1)
        return first, rest
    return None


def _parse_header(line: str) -> InterviewerTurn | None:
    match = re.search(r"\{.*\}", line.strip())
    if match is None:
        return None
    try:
        payload = json.loads(match.group(0))
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    try:
        return InterviewerTurn.model_validate({**payload, "message": "-"})
    except Exception:
        return None


# ---------------------------------------------------------------------------
# User actions (synchronous, called from routes)
# ---------------------------------------------------------------------------


def start(
    db: Session,
    user_id: int,
    request: StartRequest,
    *,
    repeat_of_id: int | None = None,
    speech_snapshot: dict[str, object] | None = None,
) -> MockInterview:
    lock_active_user(db, user_id)
    ensure_slot_free(db, user_id)
    interview = build_interview(db, user_id, request)
    interview.repeat_of_id = repeat_of_id
    interview.speech_snapshot_json = speech_snapshot
    db.add(interview)
    occupy_slot(db, interview)
    db.commit()
    return interview


def repeat_request(interview: MockInterview, *, answer_mode: str | None = None) -> StartRequest:
    application_id = (
        interview.job_application_id if interview.source_type == "job_application" else None
    )
    job_id = interview.job_description_id if application_id is None else None
    snapshot_text = str((interview.job_snapshot_json or {}).get("description") or "")
    # When the live source is gone, carry the stored JD snapshot forward so a
    # repeat never silently drops the job context.
    return StartRequest(
        job_application_id=application_id,
        resume_id=interview.resume_id,
        job_description_id=job_id,
        job_description_text=snapshot_text if application_id is None and job_id is None and snapshot_text else None,
        target_role=interview.target_role,
        interview_type=interview.interview_type,
        difficulty=interview.difficulty,
        question_count=interview.question_count,
        follow_up_enabled=interview.is_follow_up_enabled,
        language=interview.language,
        material_ids=[int(str(ref["dataset_id"])) for ref in interview.material_refs_json or []],
        materials_in_questions=interview.is_materials_in_questions,
        answer_mode=answer_mode or interview.answer_mode,
    )


def _current_question(db: Session, interview: MockInterview) -> MockInterviewQuestion | None:
    if interview.current_question_id is None:
        return None
    return db.scalar(
        select(MockInterviewQuestion)
        .where(
            MockInterviewQuestion.id == interview.current_question_id,
            MockInterviewQuestion.interview_id == interview.id,
        )
        .with_for_update()
    )


@dataclass(frozen=True)
class VoiceAnswer:
    """A server-side recognition result backing one answer."""

    source: str  # voice_input | voice
    transcript: str
    words: list[dict[str, object]]
    duration_ms: int
    recording_object_name: str | None


def recording_object_name(interview: MockInterview, question_id: int) -> str:
    return f"{RECORDING_PREFIX}/{interview.user_id}/{interview.public_id}/{question_id}.wav"


def recording_prefix(interview: MockInterview) -> str:
    return f"{RECORDING_PREFIX}/{interview.user_id}/{interview.public_id}/"


def submit_answer(
    db: Session,
    user_id: int,
    public_id: str,
    *,
    question_id: int,
    text: str | None,
    idempotency_key: str,
    voice: VoiceAnswer | None = None,
) -> tuple[MockInterview, bool]:
    """Record an answer or skip. Returns (interview, needs_turn).

    A voice interview accepts only server recognition (``voice``) or a skip;
    typed text for it is rejected so the transcript cannot be forged.
    """
    lock_active_user(db, user_id)
    interview = require_owned(db, user_id, public_id, lock=True)
    if _expire_if_stale(interview, utc_now()):
        db.commit()
    question = db.scalar(
        select(MockInterviewQuestion)
        .where(MockInterviewQuestion.id == question_id, MockInterviewQuestion.interview_id == interview.id)
        .with_for_update()
    )
    if question is not None and question.answer_idempotency_key == idempotency_key:
        # Idempotent replay: the answer is stored; a turn is needed only if the
        # interviewer has not replied yet.
        db.commit()
        return interview, interview.status == "in_progress" and interview.current_question_id == question.id
    if interview.status != "in_progress":
        raise _state_invalid()
    current = _current_question(db, interview)
    if current is None or current.id != question_id:
        raise MockInterviewError(409, "MOCK_INTERVIEW_QUESTION_MISMATCH")
    if current.answer_status != "pending":
        raise MockInterviewError(409, "MOCK_INTERVIEW_QUESTION_MISMATCH")
    if interview.answer_mode == "voice" and text is not None and (voice is None or voice.source != "voice"):
        raise MockInterviewError(422, "MOCK_INTERVIEW_SPEECH_SESSION_INVALID")
    if interview.answer_mode == "text" and voice is not None and voice.source != "voice_input":
        raise MockInterviewError(422, "MOCK_INTERVIEW_SPEECH_SESSION_INVALID")
    now = utc_now()
    if text is None:
        current.answer_status = "skipped"
    else:
        current.answer_status = "answered"
        current.answer_text = text
        current.answer_source = voice.source if voice is not None else "text"
        if voice is not None:
            current.audio_duration_ms = voice.duration_ms
        if voice is not None and voice.source == "voice":
            current.raw_transcript = voice.transcript
            current.words_json = voice.words
            current.recording_object_name = voice.recording_object_name
            current.transcript_state = "original"
    current.answered_at = now
    current.answer_idempotency_key = idempotency_key
    interview.last_activity_at = now
    interview.lock_version += 1
    db.commit()
    return interview, True


def needs_reply(db: Session, interview: MockInterview) -> bool:
    if interview.status != "in_progress":
        return False
    questions = list_questions(db, interview.id)
    return bool(questions) and questions[-1].answer_status != "pending"


def finish(db: Session, user_id: int, public_id: str) -> tuple[MockInterview, bool]:
    """End early. Returns (interview, should_evaluate)."""
    lock_active_user(db, user_id)
    interview = require_owned(db, user_id, public_id, lock=True)
    if interview.status != "in_progress":
        raise _state_invalid()
    now = utc_now()
    questions = list_questions(db, interview.id)
    pending = [item for item in questions if item.answer_status == "pending"]
    for item in pending:
        item.answer_status = "skipped"
        item.answered_at = now
    answered = any(item.answer_status == "answered" for item in questions)
    interview.current_question_id = None
    interview.finished_at = now
    interview.last_activity_at = now
    if answered:
        interview.status = "evaluating"
        interview.task_lease_until = now + TASK_LEASE
        interview.task_token = new_task_token()
    else:
        interview.status = "abandoned"
    _set_slot(interview)
    interview.lock_version += 1
    db.commit()
    return interview, answered


def abandon(db: Session, user_id: int, public_id: str) -> MockInterview:
    lock_active_user(db, user_id)
    interview = require_owned(db, user_id, public_id, lock=True)
    if interview.status not in ("preparing", "preparation_failed", "in_progress"):
        raise _state_invalid()
    interview.status = "abandoned"
    interview.task_lease_until = None
    interview.task_token = None
    interview.current_question_id = None
    interview.finished_at = utc_now()
    _set_slot(interview)
    interview.lock_version += 1
    db.commit()
    return interview


def retry(db: Session, user_id: int, public_id: str) -> MockInterview:
    lock_active_user(db, user_id)
    interview = require_owned(db, user_id, public_id, lock=True)
    _expire_if_stale(interview, utc_now())
    if interview.status == "preparation_failed":
        ensure_slot_free(db, user_id, except_id=interview.id)
        interview.status = "preparing"
        # Preparation restarts cleanly; a partial opening must not survive.
        db.execute(delete(MockInterviewQuestion).where(MockInterviewQuestion.interview_id == interview.id))
        interview.current_question_id = None
        interview.plan_json = None
    elif interview.status == "evaluation_failed":
        ensure_slot_free(db, user_id, except_id=interview.id)
        interview.status = "evaluating"
    else:
        raise _state_invalid()
    interview.error_code = None
    interview.task_lease_until = utc_now() + TASK_LEASE
    # A fresh token supersedes any still-running task from the failed attempt.
    interview.task_token = new_task_token()
    _set_slot(interview)
    interview.lock_version += 1
    occupy_slot(db, interview)
    db.commit()
    return interview


def delete_interview(db: Session, user_id: int, public_id: str, *, purge: Callable[[str], None]) -> None:
    """Keep the row and object references available until storage deletion succeeds."""
    lock_active_user(db, user_id)
    interview = require_owned(db, user_id, public_id, lock=True)
    _expire_if_stale(interview, utc_now())
    if interview.status in MOCK_INTERVIEW_ACTIVE_STATUSES:
        db.commit()
        raise _state_invalid()
    purge(recording_prefix(interview))
    db.execute(
        update(MockInterview)
        .where(MockInterview.repeat_of_id == interview.id)
        .values(repeat_of_id=None)
    )
    db.execute(delete(MockInterviewQuestion).where(MockInterviewQuestion.interview_id == interview.id))
    db.delete(interview)
    db.commit()


def serialize_question(question: MockInterviewQuestion) -> dict[str, object]:
    return {
        "id": str(question.id),
        "parent_id": str(question.parent_id) if question.parent_id else None,
        "sequence_no": question.sequence_no,
        "kind": "follow_up" if question.parent_id else "main",
        "plan_index": question.plan_index,
        "depth_level": question.depth_level,
        "content": question.content,
        "answer_status": question.answer_status,
        "answer_text": question.answer_text,
        "answered_at": question.answered_at,
        "evaluation": question.evaluation_json,
        "answer_source": question.answer_source,
        "audio_duration_ms": question.audio_duration_ms,
        "has_recording": bool(question.recording_object_name),
        "raw_transcript": question.raw_transcript,
        "transcript_state": question.transcript_state,
        "correction": question.correction_json,
        "re_evaluate_count": question.re_evaluate_count,
        "evaluation_history": question.evaluation_history_json,
    }
