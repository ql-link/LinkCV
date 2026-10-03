"""Owned ASR drafts; all admission, cancellation and worker writes lock the user first."""
from dataclasses import asdict
import math
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select

from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.modules.datasets.models import DatasetTranscriptionTask, TRANSCRIPTION_ACTIVE, UserDataset
from linkresume.modules.identity.dependencies import lock_active_user
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import InterviewSession, JobApplication
from linkresume.modules.llm.models import LLMCallLog, LLMModelRoute, LLMProviderConnection
from linkresume.modules.llm.resolver import RECORDING_TRANSCRIPTION, RoutePlan, resolve_candidates
from linkresume.modules.llm.service import LLMError
from linkresume.modules.resumes.models import DocumentParseTask


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def call_id(task) -> str:
    return "llmcall_" + uuid5(NAMESPACE_URL, f"linkresume/asr/{task.user_id}/{task.client_request_id}").hex


def route_snapshot(plan: RoutePlan) -> dict:
    value = asdict(plan)
    value.pop("credential_ciphertext")
    value.pop("pricing")
    return value


def current_plan(db, snapshot: dict) -> RoutePlan:
    connection = db.get(LLMProviderConnection, snapshot["connection_id"])
    route = db.get(LLMModelRoute, snapshot["route_id"])
    if (connection is None or route is None or connection.runtime_config_version != snapshot["runtime_config_version"]
            or connection.provider_code != snapshot["provider_code"] or dict(connection.settings_json or {}) != snapshot["settings"]
            or route.connection_id != connection.id or route.model_id != snapshot["model_id"]
            or route.invoke_target != snapshot["invoke_target"] or route.target_kind != snapshot["target_kind"]):
        raise LLMError("INTERVIEW_TRANSCRIPTION_CONFIG_CHANGED")
    return RoutePlan(**snapshot, credential_ciphertext=connection.credential_ciphertext,
                     pricing=dict(route.pricing_json) if route.pricing_json else None)


def select_plan(db, llm):
    for plan in resolve_candidates(db, RECORDING_TRANSCRIPTION):
        try:
            llm.file_transcription_target(plan)
            return plan
        except LLMError:
            continue
    raise ApiError(503, "INTERVIEW_TRANSCRIPTION_MODEL_UNAVAILABLE")


def context(db, user_id, session_id, dataset_id=None, *, writable=False):
    from linkresume.application.interviews.service import require_owned_session, find_owned_asset
    result = require_owned_session(db, user_id, session_id, for_update=writable)
    if writable and (result.application.archived_at is not None or result.session.status == "cancelled"):
        raise ApiError(409, "INTERVIEW_INVALID_TRANSITION")
    if dataset_id is None:
        return result, None
    found = find_owned_asset(db, user_id, dataset_id)
    if found is None or found[0].interview_session_id != session_id:
        raise ApiError(404, "INTERVIEW_ASSET_NOT_FOUND")
    dataset, upload = found
    if upload.upload_status != "succeeded":
        raise ApiError(409, "INTERVIEW_TRANSCRIPTION_UPLOAD_PENDING")
    return result, dataset


def latest(db, user_id, dataset_id):
    return db.scalar(select(DatasetTranscriptionTask).where(
        DatasetTranscriptionTask.user_id == user_id, DatasetTranscriptionTask.dataset_id == dataset_id,
    ).order_by(DatasetTranscriptionTask.id.desc()).limit(1))


def create_task(db, user_id, session_id, dataset_id, request_id, *, settings, llm):
    lock_active_user(db, user_id)
    _, dataset = context(db, user_id, session_id, dataset_id, writable=True)
    if dataset.asset_kind != "audio":
        raise ApiError(422, "INTERVIEW_TRANSCRIPTION_AUDIO_REQUIRED")
    previous = db.scalar(select(DatasetTranscriptionTask).where(
        DatasetTranscriptionTask.user_id == user_id, DatasetTranscriptionTask.client_request_id == str(request_id)))
    if previous:
        if previous.dataset_id != dataset_id:
            raise ApiError(409, "INTERVIEW_TRANSCRIPTION_REQUEST_CONFLICT")
        return previous, False
    existing = latest(db, user_id, dataset_id)
    if existing and existing.status in (*TRANSCRIPTION_ACTIVE, "ready"):
        return existing, False
    if db.scalar(select(DatasetTranscriptionTask.id).where(
        DatasetTranscriptionTask.user_id == user_id, DatasetTranscriptionTask.status.in_(TRANSCRIPTION_ACTIVE)).limit(1)):
        raise ApiError(429, "INTERVIEW_TRANSCRIPTION_BUSY")
    if not settings.asr_media_base_url:
        raise ApiError(503, "INTERVIEW_TRANSCRIPTION_MEDIA_UNAVAILABLE")
    plan = select_plan(db, llm)
    now = utc_now()
    task = DatasetTranscriptionTask(user_id=user_id, dataset_id=dataset_id, interview_session_id=session_id,
                                   client_request_id=str(request_id), route_snapshot=route_snapshot(plan),
                                   status="queued", created_at=now, updated_at=now)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task, True


def finish(db, task, status, error=None, *, result=None, duration_seconds=None):
    task.status = status
    task.error_code = error
    task.result_json = result
    task.lease_token = task.lease_until = None
    task.updated_at = utc_now()
    log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id(task), LLMCallLog.status == "pending"))
    if log is not None:
        log.status = "succeeded" if status == "ready" else "cancelled" if status == "cancelled" else "failed"
        log.error_code = error
        log.latency_ms = max(0, int((aware(task.updated_at) - aware(task.created_at)).total_seconds() * 1000))
        if type(duration_seconds) in (int, float) and math.isfinite(duration_seconds) and duration_seconds >= 0:
            log.usage_json = {"audio_seconds": duration_seconds}
            log.metering_status = "partial"  # No token or invented audio price calculation.


def cancel_tasks(db, user_id, *, dataset_id=None, session_id=None):
    query = select(DatasetTranscriptionTask).where(DatasetTranscriptionTask.user_id == user_id,
                                                  DatasetTranscriptionTask.status.in_(TRANSCRIPTION_ACTIVE))
    if dataset_id is not None:
        query = query.where(DatasetTranscriptionTask.dataset_id == dataset_id)
    if session_id is not None:
        query = query.where(DatasetTranscriptionTask.interview_session_id == session_id)
    for task in db.scalars(query.with_for_update()):
        finish(db, task, "cancelled", "INTERVIEW_TRANSCRIPTION_CANCELLED")


def active_context(db, task) -> UserDataset | None:
    user = db.get(User, task.user_id)
    dataset = db.get(UserDataset, task.dataset_id)
    session = db.get(InterviewSession, task.interview_session_id) if task.interview_session_id else None
    application = db.get(JobApplication, session.application_id) if session else None
    upload = db.get(DocumentParseTask, dataset.parse_task_id) if dataset else None
    if (not user or user.status != 1 or user.deletion_requested_at is not None
            or not dataset or dataset.user_id != task.user_id or dataset.asset_kind != "audio"
            or dataset.interview_session_id != task.interview_session_id or not session or not application
            or application.user_id != task.user_id or application.archived_at is not None or session.status == "cancelled"
            or not upload or upload.user_id != task.user_id or upload.upload_status != "succeeded"):
        return None
    return dataset


def task_record(task) -> dict | None:
    if task is None:
        return None
    result = task.result_json if task.status == "ready" else None
    return {"id": str(task.id), "dataset_id": str(task.dataset_id), "status": task.status,
            "text": result.get("text") if result else None, "sentences": result.get("sentences", []) if result else [],
            "duration_ms": result.get("duration_ms") if result else None,
            "error_code": task.error_code if task.status in ("failed", "cancelled") else None,
            "created_at": aware(task.created_at), "updated_at": aware(task.updated_at),
            "completed_at": aware(task.updated_at) if task.status not in TRANSCRIPTION_ACTIVE else None}
