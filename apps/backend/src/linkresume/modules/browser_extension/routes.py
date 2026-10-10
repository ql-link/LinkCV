from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import find_owned_resume
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.domain.resume.models import CanonicalResumeDocument
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User, UserProfile
from linkresume.modules.llm.dependencies import get_llm_service
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.resumes.models import Resume

from .decisions import decision_messages
from .profile import project
from .schemas import DecisionRequest, FieldDecision

router = APIRouter(tags=["browser-extension"])


@router.get("/browser-extension/resumes")
def list_extension_resumes(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.execute(select(Resume.id, Resume.title, Resume.lock_version, Resume.update_time)
                      .where(Resume.user_id == user.id).order_by(Resume.update_time.desc(), Resume.id.desc())).all()
    return {"user_id": str(user.id), "resumes": [{"id": str(row.id), "title": row.title,
            "lock_version": row.lock_version, "updated_at": row.update_time} for row in rows]}


@router.get("/resumes/{resume_id}/autofill-profile")
def autofill_profile(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    document = CanonicalResumeDocument.model_validate(resume.data_json)
    user_profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    profile, warnings, missing = project(document.model_dump(mode="json"), user_profile, str(resume.id))
    return {"version": 1, "user_id": str(user.id), "resume_id": str(resume.id), "title": resume.title,
            "lock_version": resume.lock_version, "profile_lock_version": user_profile.lock_version if user_profile else None,
            "updated_at": resume.update_time, "profile": profile, "warnings": warnings, "missing": missing}


@router.post("/browser-extension/autofill/decisions", response_model=FieldDecision)
async def decide_field(payload: DecisionRequest, request: Request, user: User = Depends(get_current_user),
                       llm: LLMService = Depends(get_llm_service)):
    # A fixed per-user minute budget bounds both browser retries and parallel clients.
    try:
        key = f"browser-autofill:decisions:{user.id}"
        count = request.app.state.redis.incr(key)
        if count == 1:
            request.app.state.redis.expire(key, 60)
    except Exception as error:
        raise ApiError(503, "AUTOFILL_UNAVAILABLE") from error
    if count > 240:
        raise ApiError(429, "AUTOFILL_RATE_LIMITED")
    try:
        async with asyncio.timeout(20):
            result = await llm.structured_chat(user.id, decision_messages(payload.field), source="browser_autofill",
                                               response_model=FieldDecision, use_case="browser_autofill")
        return result.value
    except TimeoutError as error:
        raise ApiError(504, "LLM_TIMEOUT") from error
    except LLMError as error:
        raise ApiError(503 if error.code == "LLM_MODEL_NOT_CONFIGURED" else 502, error.code) from error
