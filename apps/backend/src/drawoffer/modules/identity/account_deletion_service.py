"""Validate account closure and durably record cleanup before disabling access."""
from __future__ import annotations

import hmac
import secrets
from uuid import uuid4

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from drawoffer.core.database import utc_now
from drawoffer.core.errors import ApiError
from drawoffer.core.security import hash_secret, verify_password
from drawoffer.modules.agent.models import (
    AgentMessage, AgentOperation, AgentRun, AgentSession, AgentStageEvent, AgentToolCall,
    ResumeChangeProposal,
)
from drawoffer.modules.announcements.models import Announcement, AnnouncementReadCursor
from drawoffer.modules.datasets.models import UserDataset, UserDatasetFolder, UserDatasetRagSync
from drawoffer.modules.identity.capabilities import password_login_enabled, wechat_login_enabled
from drawoffer.modules.identity.dependencies import lock_active_user
from drawoffer.modules.identity.models import AccountDeletionJob, AccountPreference, User, UserProfile
from drawoffer.modules.interviews.models import (
    InterviewRecordingTranscription,
    InterviewReviewQuestionNote,
    InterviewSession,
    JobApplication,
    JobApplicationOfferMaterial,
    JobApplicationStage,
)
from drawoffer.modules.llm.models import LLMCallLog
from drawoffer.modules.mock_interviews.models import MockInterview, MockInterviewQuestion
from drawoffer.modules.product_events.models import ProductEvent
from drawoffer.modules.resumes.models import DocumentParseTask, Resume
from drawoffer.modules.job_descriptions.models import JobDescription
from drawoffer.modules.job_matches.models import JobResumeMatch
from drawoffer.modules.identity import wechat_action_service as actions


def _has(db: Session, statement) -> bool:
    return db.scalar(statement.limit(1).with_for_update()) is not None


def ensure_no_public_responsibility(db: Session, user_id: int) -> None:
    if _has(db, select(Announcement.id).where(or_(
        Announcement.created_by == user_id, Announcement.updated_by == user_id,
        Announcement.published_by == user_id, Announcement.unpublished_by == user_id,
    ))):
        raise ApiError(409, "ACCOUNT_SHARED_RESOURCE_OWNER")


def active_types(db: Session, user_id: int) -> list[str]:
    result = []
    sessions = select(AgentSession.id).where(AgentSession.user_id == user_id)
    if _has(db, select(AgentRun.id).where(AgentRun.session_id.in_(sessions), AgentRun.status == "running")) or _has(
        db, select(LLMCallLog.id).where(LLMCallLog.user_id == user_id, LLMCallLog.status == "pending")
    ):
        result.append("ai")
    if _has(db, select(MockInterview.id).where(
        MockInterview.user_id == user_id,
        MockInterview.status.in_(["preparing", "in_progress", "evaluating"]),
    )):
        result.append("mock_interview")
    if _has(db, select(DocumentParseTask.id).where(
        DocumentParseTask.user_id == user_id,
        or_(DocumentParseTask.upload_status == "uploading", DocumentParseTask.parse_status.in_(["queued", "processing"])),
    )):
        result.append("document_processing")
    return result


def personal_object_prefixes(user_id: int) -> list[str]:
    # Recordings predate the users/ object namespace. Both prefixes include a
    # trailing slash so account 1 cannot match account 10.
    return [f"users/{user_id}/", f"mock-interviews/{user_id}/"]


def request_deletion(db: Session, *, user_id: int, sid: str, payload, settings, redis_client) -> dict:
    if not settings.account_deletion_enabled:
        raise ApiError(404, "NOT_FOUND")
    expected = "password" if password_login_enabled(settings) else "wechat" if wechat_login_enabled(settings) else None
    if expected is None:
        raise ApiError(404, "NOT_FOUND")
    if payload.method != expected:
        raise ApiError(400, "INVALID_ACCOUNT_CONFIRMATION_METHOD")
    if payload.confirmation != "注销账号":
        raise ApiError(400, "INVALID_ACCOUNT_DELETION_CONFIRMATION")
    user = lock_active_user(db, user_id)
    if user.is_admin:
        raise ApiError(403, "ACCOUNT_DELETION_FORBIDDEN")
    if expected == "password":
        if not user.password_hash or not verify_password(payload.current_password, user.password_hash):
            raise ApiError(400, "INVALID_CURRENT_PASSWORD")
    else:
        if not user.wechat_openid:
            raise ApiError(409, "WECHAT_IDENTITY_REQUIRED")
        actions.validate_token(redis_client, payload.action_token, user.id, sid)
    ensure_no_public_responsibility(db, user.id)
    busy = active_types(db, user.id)
    if busy:
        raise ApiError(409, "ACCOUNT_BUSY", details={"activity_types": busy})
    if expected == "wechat":
        actions.consume(redis_client, payload.action_token, user.id, sid)
    receipt = secrets.token_urlsafe(32)
    job = AccountDeletionJob(
        public_id=str(uuid4()), user_id=user.id, receipt_hash=hash_secret(receipt),
        status="pending", phase="database",
        cleanup_manifest={"object_prefix": f"users/{user.id}/", "rag_file_ids": []},
    )
    user.status = 0
    user.deletion_requested_at = utc_now()
    db.add(job)
    db.commit()
    return {"job_id": job.public_id, "receipt_token": receipt, "status": "pending"}


def deletion_status(db: Session, job_id: str, receipt: str) -> dict:
    job = db.scalar(select(AccountDeletionJob).where(AccountDeletionJob.public_id == job_id))
    if job is None or not hmac.compare_digest(job.receipt_hash, hash_secret(receipt)):
        raise ApiError(404, "NOT_FOUND")
    result = {"status": job.status, "phase": job.phase}
    if job.last_error_code:
        result["error_code"] = job.last_error_code
    return result


def clear_personal_rows(db: Session, job: AccountDeletionJob) -> None:
    """Called with both the cleanup lease and the LinkRag reconciliation lock."""
    user = db.scalar(select(User).where(User.id == job.user_id).with_for_update())
    if user is not None and user.deletion_requested_at is None:
        raise RuntimeError("ACCOUNT_DELETION_STATE_CONFLICT")
    uid = job.user_id
    sessions = select(AgentSession.id).where(AgentSession.user_id == uid)
    runs = select(AgentRun.id).where(AgentRun.session_id.in_(sessions))
    operations = select(AgentOperation.id).where(AgentOperation.session_id.in_(sessions))
    applications = select(JobApplication.id).where(JobApplication.user_id == uid)
    interviews = select(MockInterview.id).where(MockInterview.user_id == uid)
    file_ids = db.scalars(select(UserDatasetRagSync.rag_file_id).where(
        UserDatasetRagSync.user_id == uid, UserDatasetRagSync.rag_file_id.is_not(None),
    )).all()
    job.cleanup_manifest = {
        "object_prefix": f"users/{uid}/",
        "rag_file_ids": sorted(set(job.cleanup_manifest.get("rag_file_ids", []) + list(file_ids))),
    }
    # Self references are removed only on this user's rows before bulk deletion.
    db.execute(update(MockInterviewQuestion).where(MockInterviewQuestion.interview_id.in_(interviews)).values(parent_id=None))
    db.execute(update(MockInterview).where(MockInterview.user_id == uid).values(repeat_of_id=None))
    targets = [
        (ResumeChangeProposal, ResumeChangeProposal.user_id == uid),
        (AgentToolCall, AgentToolCall.run_id.in_(runs)),
        (AgentMessage, AgentMessage.session_id.in_(sessions)),
        (AgentStageEvent, AgentStageEvent.agent_operation_id.in_(operations)),
        (AgentOperation, AgentOperation.session_id.in_(sessions)),
        (LLMCallLog, LLMCallLog.user_id == uid),
        (AgentRun, AgentRun.session_id.in_(sessions)),
        (AgentSession, AgentSession.user_id == uid),
        (MockInterviewQuestion, MockInterviewQuestion.interview_id.in_(interviews)),
        (MockInterview, MockInterview.user_id == uid),
        (UserDatasetRagSync, UserDatasetRagSync.user_id == uid),
        # No database foreign keys: rows that used to cascade are deleted explicitly.
        (InterviewRecordingTranscription, InterviewRecordingTranscription.user_id == uid),
        (InterviewReviewQuestionNote, InterviewReviewQuestionNote.user_id == uid),
        (JobApplicationOfferMaterial, JobApplicationOfferMaterial.application_id.in_(applications)),
        (UserDataset, UserDataset.user_id == uid),
        (JobResumeMatch, JobResumeMatch.user_id == uid),
        (InterviewSession, InterviewSession.application_id.in_(applications)),
        (JobApplicationStage, JobApplicationStage.application_id.in_(applications)),
        (JobApplication, JobApplication.user_id == uid),
        (JobDescription, JobDescription.user_id == uid),
        (UserDatasetFolder, UserDatasetFolder.user_id == uid),
        (Resume, Resume.user_id == uid),
        (DocumentParseTask, DocumentParseTask.user_id == uid),
        (UserProfile, UserProfile.user_id == uid),
        (AccountPreference, AccountPreference.user_id == uid),
        (AnnouncementReadCursor, AnnouncementReadCursor.user_id == uid),
        (ProductEvent, ProductEvent.user_id == uid),
        (User, User.id == uid),
    ]
    for model, condition in targets:
        db.execute(delete(model).where(condition).execution_options(synchronize_session=False))
    job.phase = "objects"
    db.commit()
