"""Home card: the saved jobs that best match the most recently edited resume.

Reading never calls a model. ``ensure_recommendations`` ranks every saved job
with a free local overlap score, then spends model calls only on the top
``CANDIDATE_LIMIT`` that still lack a fresh result, within a per-resume-version
budget, in background tasks that never block the request.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from linkresume.core.database import utc_now
from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.job_descriptions.models import JobDescription
from linkresume.modules.job_matches.models import JobResumeMatch
from linkresume.modules.job_matches.schemas import (
    RecommendationItem,
    RecommendationResume,
    RecommendationsResponse,
)
from linkresume.modules.llm.resolver import JOB_MATCH
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.resumes.models import Resume

from . import service
from .prefilter import prefilter_score, resume_profile

SCAN_LIMIT = 200
CANDIDATE_LIMIT = 5
DISPLAY_LIMIT = 3
AUTO_BUDGET = 10
CONCURRENCY = 2

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Plan:
    resume: Resume
    items: list[RecommendationItem]
    pending_count: int
    todo: list[JobDescription]


def _latest_resume(db: Session, user_id: int) -> Resume | None:
    return db.scalar(
        select(Resume)
        .where(Resume.user_id == user_id)
        .order_by(Resume.update_time.desc(), Resume.id.desc())
        .limit(1)
    )


def _application_statuses(
    db: Session, user_id: int, job_ids: list[int]
) -> dict[int, str]:
    if not job_ids:
        return {}
    rows = db.scalars(
        select(JobApplication)
        .where(
            JobApplication.user_id == user_id,
            JobApplication.job_description_id.in_(job_ids),
            JobApplication.archived_at.is_(None),
        )
        .order_by(JobApplication.update_time.desc(), JobApplication.id.desc())
    ).all()
    statuses: dict[int, str] = {}
    for application in rows:
        job_id = application.job_description_id
        if job_id is not None and job_id not in statuses:
            statuses[job_id] = (
                "待投递"
                if application.phase == "pending"
                else application.current_stage_label
            )
    return statuses


def plan(db: Session, user_id: int) -> tuple[str | None, Plan | None, int]:
    """Return (terminal state, plan, candidate count). State is set when no plan."""
    resume = _latest_resume(db, user_id)
    if resume is None:
        return "no_resume", None, 0
    jobs = [
        job
        for job in db.scalars(
            select(JobDescription)
            .where(JobDescription.user_id == user_id)
            .order_by(JobDescription.update_time.desc(), JobDescription.id.desc())
            .limit(SCAN_LIMIT)
        )
        if service.has_analyzable_content(job)
    ]
    if not jobs:
        return "no_jobs", None, 0

    resume_text = service.resume_markdown(resume)
    resume_hash = service.content_hash(resume_text)
    profile = resume_profile(resume_text)
    now = utc_now()
    rows = {
        row.job_description_id: row
        for row in db.scalars(
            select(JobResumeMatch).where(
                JobResumeMatch.user_id == user_id,
                JobResumeMatch.resume_id == resume.id,
            )
        )
    }

    fresh: list[tuple[JobDescription, JobResumeMatch]] = []
    pending = 0
    ranked: list[tuple[float, JobDescription, service.MatchInputs]] = []
    for job in jobs:
        text = service.job_text(job)
        inputs = service.MatchInputs(
            job_text=text,
            resume_text=resume_text,
            jd_hash=service.content_hash(text),
            resume_hash=resume_hash,
        )
        row = rows.get(job.id)
        if row is not None and service.is_fresh(row, inputs):
            fresh.append((job, row))
        elif row is not None and service.lease_active(row, now):
            pending += 1
        ranked.append(
            (
                prefilter_score(
                    profile,
                    title=job.job_title,
                    description=job.description or "",
                    skills=list(job.skills or []),
                ),
                job,
                inputs,
            )
        )

    ranked.sort(key=lambda entry: (-entry[0], -entry[1].id))
    auto_used = sum(
        1
        for row in rows.values()
        if row.source == "auto" and row.resume_hash == resume_hash
    )
    budget = max(0, AUTO_BUDGET - auto_used)
    todo: list[JobDescription] = []
    for _, job, inputs in ranked[:CANDIDATE_LIMIT]:
        row = rows.get(job.id)
        if row is not None and (
            service.is_fresh(row, inputs)
            or service.lease_active(row, now)
            or service.exhausted(row, inputs, now)
        ):
            continue
        if len(todo) < budget:
            todo.append(job)

    fresh.sort(key=lambda pair: (-(pair[1].score or 0), -pair[0].id))
    top = fresh[:DISPLAY_LIMIT]
    statuses = _application_statuses(db, user_id, [job.id for job, _ in top])
    items = [
        RecommendationItem(
            job_id=str(job.id),
            job_title=job.job_title,
            company_name=job.company_name,
            logo_url=job.logo_url,
            score=row.score or 0,
            application_status=statuses.get(job.id),
        )
        for job, row in top
    ]
    return None, Plan(resume, items, pending, todo), len(jobs)


def to_response(state: str | None, found: Plan | None) -> RecommendationsResponse:
    if found is None:
        return RecommendationsResponse(
            state=state or "no_resume",  # type: ignore[arg-type]
            resume=None,
            items=[],
            pending_count=0,
            can_compute=False,
        )
    can_compute = bool(found.todo)
    if found.items:
        resolved = "ready"
    elif found.pending_count:
        resolved = "computing"
    elif can_compute:
        resolved = "idle"
    else:
        resolved = "unavailable"
    return RecommendationsResponse(
        state=resolved,  # type: ignore[arg-type]
        resume=RecommendationResume(id=str(found.resume.id), title=found.resume.title),
        items=found.items,
        pending_count=found.pending_count,
        can_compute=can_compute,
    )


def read_recommendations(db: Session, user_id: int) -> RecommendationsResponse:
    state, found, _ = plan(db, user_id)
    return to_response(state, found)


class JobMatchRunner:
    """Owns the background analysis tasks started from the home card."""

    def __init__(
        self, session_factory: sessionmaker[Session], llm: LLMService
    ) -> None:
        self._session_factory = session_factory
        self._llm = llm
        self._tasks: set[asyncio.Task[None]] = set()
        self._gate = asyncio.Semaphore(CONCURRENCY)

    def _spawn(self, coroutine: Any) -> None:
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, user_id: int, job_id: int, resume_id: int, claimed: service.Claim) -> None:
        async with self._gate:
            try:
                await service.run_claimed(
                    self._session_factory, self._llm, user_id, job_id, resume_id, claimed
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                # The row already records the failure; nothing retries on its own.
                logger.info("background job match failed", extra={"job_id": job_id})

    async def ensure(self, user_id: int) -> RecommendationsResponse:
        def read(db: Session) -> tuple[str | None, Plan | None]:
            state, found, _ = plan(db, user_id)
            return state, found

        state, found = await asyncio.to_thread(service.in_session, self._session_factory, read)
        if found is None or not found.todo:
            return to_response(state, found)
        try:
            await self._llm.ensure_configured(JOB_MATCH)
        except LLMError:
            return to_response(
                None,
                Plan(found.resume, found.items, found.pending_count, []),
            )

        def claim_all(db: Session) -> list[tuple[int, int, service.Claim]]:
            claimed: list[tuple[int, int, service.Claim]] = []
            resume = db.get(Resume, found.resume.id)
            if resume is None or resume.user_id != user_id:
                return claimed
            for job in found.todo:
                fresh_job = db.get(JobDescription, job.id)
                if fresh_job is None or fresh_job.user_id != user_id:
                    continue
                result = service.claim(
                    db,
                    user_id,
                    fresh_job,
                    resume,
                    service.build_inputs(fresh_job, resume),
                    source="auto",
                )
                if result.outcome == "claimed":
                    claimed.append((fresh_job.id, resume.id, result))
            return claimed

        claims = await asyncio.to_thread(service.in_session, self._session_factory, claim_all)
        for job_id, resume_id, result in claims:
            self._spawn(self._run(user_id, job_id, resume_id, result))

        def read_again(db: Session) -> RecommendationsResponse:
            return read_recommendations(db, user_id)

        return await asyncio.to_thread(service.in_session, self._session_factory, read_again)
