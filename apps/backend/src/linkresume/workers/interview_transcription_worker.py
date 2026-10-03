"""Database-scheduled short ASR steps with leases and durable supplier IDs."""
import asyncio
import logging
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import and_, or_, select

from linkresume.application.interviews import transcription_service as service
from linkresume.core.database import utc_now
from linkresume.modules.datasets.models import DatasetTranscriptionTask as Task, TRANSCRIPTION_ACTIVE
from linkresume.modules.identity.models import User
from linkresume.modules.llm.models import LLMCallLog
from linkresume.modules.speech.file_transcription import FileTranscriptionError
from linkresume.modules.speech.media_token import audio_url

logger = logging.getLogger(__name__)
STEP_TIMEOUT_SECONDS = 100  # Leave time to persist before the 120-second lease expires.


@dataclass(frozen=True)
class Step:
    id: int
    user_id: int
    lease: str
    submit: bool
    target: object
    file_url: str | None
    provider_task_id: str | None


class InterviewTranscriptionProcessor:
    def __init__(self, *, session_factory, settings, llm_service):
        self.factory, self.settings, self.llm = session_factory, settings, llm_service

    def _claim(self) -> Step | None:
        now = utc_now()
        with self.factory() as db:
            candidates = db.scalars(select(Task.id).where(Task.status.in_(TRANSCRIPTION_ACTIVE),
                or_(Task.lease_token.is_(None), Task.updated_at <= now - timedelta(seconds=service.LEASE_SECONDS)),
                or_(Task.status.in_(("queued", "submitting")),
                    and_(Task.error_code.is_(None), Task.updated_at <= now - timedelta(seconds=15)),
                    and_(Task.error_code.is_not(None), Task.updated_at <= now - timedelta(seconds=300))),
            ).order_by(Task.updated_at, Task.id).limit(50)).all()
        for task_id in candidates:
            with self.factory() as db:
                owner_id = db.scalar(select(Task.user_id).where(Task.id == task_id))
                if owner_id is None:
                    continue
                db.scalar(select(User).where(User.id == owner_id).with_for_update())
                task = db.scalar(select(Task).where(Task.id == task_id).with_for_update().execution_options(populate_existing=True))
                now = utc_now()  # Claim time must not precede time spent waiting for row locks.
                if not task or task.status not in TRANSCRIPTION_ACTIVE or service.lease_active(task, now):
                    continue
                dataset = service.active_context(db, task)
                if dataset is None:
                    service.finish(db, task, "cancelled", "INTERVIEW_TRANSCRIPTION_SOURCE_CHANGED")
                    db.commit()
                    continue
                if task.status == "submitting":
                    service.finish(db, task, "failed", "INTERVIEW_TRANSCRIPTION_SUBMIT_UNCERTAIN")
                    db.commit()
                    continue
                if service.aware(task.created_at) + timedelta(hours=23) <= now:
                    service.finish(db, task, "failed", "INTERVIEW_TRANSCRIPTION_EXPIRED")
                    db.commit()
                    continue
                interval = 300 if task.error_code else 15
                if task.status == "transcribing" and service.aware(task.updated_at) + timedelta(seconds=interval) > now:
                    continue
                try:
                    plan = service.current_plan(db, task.route_snapshot)
                    target = self.llm.file_transcription_target(plan)
                    url = audio_url(self.settings, task=task, sha256=dataset.sha256)
                except Exception as error:
                    # Do not log secret-bearing route/network exceptions.
                    code = getattr(error, "code", "INTERVIEW_TRANSCRIPTION_CONFIG_CHANGED")
                    service.finish(db, task, "failed", code)
                    db.commit()
                    continue
                submit = task.status == "queued"
                lease = str(uuid4())
                task.lease_token = lease
                if submit:
                    task.status = "submitting"
                    db.add(LLMCallLog(call_id=service.call_id(task), use_case=plan.use_case, source="interview_recording",
                        user_id=owner_id, route_id=plan.route_id, runtime_config_version=plan.runtime_config_version,
                        protocol_code=plan.protocol_code, selection_source=plan.selection_source,
                        price_snapshot_json=plan.pricing, status="pending", metering_status="unknown"))
                task.updated_at = utc_now()
                provider_id = task.provider_task_id
                db.commit()
                return Step(task_id, owner_id, lease, submit, target, url if submit else None, provider_id)
        return None

    def _save(self, step, *, provider_id=None, result=None, duration=None, error=None):
        with self.factory() as db:
            db.scalar(select(User).where(User.id == step.user_id).with_for_update())
            task = db.scalar(select(Task).where(Task.id == step.id).with_for_update().execution_options(populate_existing=True))
            if (not task or task.status not in TRANSCRIPTION_ACTIVE or task.lease_token != step.lease
                    or not service.lease_active(task, utc_now())):
                return
            if service.active_context(db, task) is None:
                service.finish(db, task, "cancelled", "INTERVIEW_TRANSCRIPTION_SOURCE_CHANGED")
            elif error and (step.submit or not error.transient):
                reason = error.code
                if step.submit and reason not in ("INTERVIEW_TRANSCRIPTION_AUTH_REJECTED", "INTERVIEW_TRANSCRIPTION_REQUEST_REJECTED"):
                    reason = "INTERVIEW_TRANSCRIPTION_SUBMIT_UNCERTAIN"
                service.finish(db, task, "failed", reason)
            elif result is not None:
                service.finish(db, task, "ready", result=result, duration_seconds=duration)
            else:
                if provider_id:
                    task.provider_task_id = provider_id
                    task.status = "transcribing"
                task.error_code = error.code if error else None
                task.updated_at = utc_now()
                task.lease_token = None
            db.commit()

    async def run_once(self) -> bool:
        step = await asyncio.to_thread(self._claim)
        if step is None:
            return False
        gateway = self.llm.file_transcription_gateway
        try:
            # httpx read timeouts are per chunk, so a slowly streaming result also
            # needs a wall-clock bound; it must not monopolize the scheduler.
            async with asyncio.timeout(STEP_TIMEOUT_SECONDS):
                if step.submit:
                    provider_id = await gateway.submit(step.target, step.file_url)
                    await asyncio.to_thread(self._save, step, provider_id=provider_id)
                else:
                    polled = await gateway.poll(step.target, step.provider_task_id)
                    result = await gateway.result(step.target, polled["url"]) if polled["status"] == "succeeded" else None
                    await asyncio.to_thread(self._save, step, result=result, duration=polled.get("duration_seconds"))
        except FileTranscriptionError as error:
            await asyncio.to_thread(self._save, step, error=error)
        except asyncio.CancelledError:
            raise  # Lease recovery preserves a known supplier task, never resubmits unknown POST.
        except Exception:
            await asyncio.to_thread(self._save, step, error=FileTranscriptionError("PROVIDER_UNAVAILABLE", transient=True))
        return True


async def run_interview_transcription_loop(processor):
    while True:
        try:
            worked = await processor.run_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Interview ASR scheduler step failed")
            worked = False
        await asyncio.sleep(0.1 if worked else 5)
