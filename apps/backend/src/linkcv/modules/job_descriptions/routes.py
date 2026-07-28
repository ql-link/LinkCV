from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from linkcv.application.job_descriptions.service import (
    DuplicateJobDescription,
    JobEditConflict,
    JobWriteFailed,
    create_or_resolve_job,
    find_owned_job,
    hard_delete_owned_job,
    list_owned_jobs,
    set_job_archived,
    update_owned_job,
)
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.domain.job_source import InvalidJobSource
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.job_descriptions.schemas import (
    DeleteJobDescriptionResponse,
    JobDescriptionCreateRequest,
    JobDescriptionListResponse,
    JobDescriptionRecord,
    JobDescriptionResponse,
    JobDescriptionSummary,
    JobDescriptionUpdateRequest,
    JobLifecycleRequest,
)

router = APIRouter(prefix="/job-descriptions", tags=["job-descriptions"])


def require_owned_job(db: Session, job_id: str, user_id: int) -> JobDescription:
    job = find_owned_job(db, job_id, user_id)
    if job is None:
        raise ApiError(404, "JD_NOT_FOUND")
    return job


def job_summary(job: JobDescription) -> JobDescriptionSummary:
    return JobDescriptionSummary.model_validate(job)


def job_record(job: JobDescription) -> JobDescriptionRecord:
    return JobDescriptionRecord.model_validate(job)


def duplicate_details(error: DuplicateJobDescription) -> dict[str, object]:
    existing = job_summary(error.existing).model_dump(mode="json")
    allowed_actions = (
        ["restore", "update", "cancel"]
        if error.existing.archived_at is not None
        else ["update", "cancel"]
    )
    return {
        "duplicate": {
            "existing": existing,
            "allowed_actions": allowed_actions,
        }
    }


@router.get("", response_model=JobDescriptionListResponse)
def list_job_descriptions(
    scope: Literal["active", "archived", "all"] = "active",
    keyword: str | None = Query(default=None, max_length=200),
    cursor: str | None = Query(default=None, max_length=4096),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionListResponse:
    try:
        jobs, next_cursor = list_owned_jobs(
            db=db,
            user_id=user.id,
            scope=scope,
            keyword=keyword,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise ApiError(400, "INVALID_JOB_QUERY") from error
    return JobDescriptionListResponse(
        items=[job_summary(job) for job in jobs], next_cursor=next_cursor
    )


@router.post("", response_model=JobDescriptionResponse, status_code=201)
def create_job_description(
    payload: JobDescriptionCreateRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    try:
        result = create_or_resolve_job(db=db, user_id=user.id, payload=payload)
    except InvalidJobSource as error:
        raise ApiError(400, "INVALID_JOB_SOURCE") from error
    except DuplicateJobDescription as error:
        raise ApiError(409, "JD_SOURCE_DUPLICATE", duplicate_details(error)) from error
    except JobEditConflict as error:
        raise ApiError(409, "JD_EDIT_CONFLICT") from error
    except JobWriteFailed as error:
        raise ApiError(500, "JD_WRITE_FAILED") from error
    response.status_code = 201 if result.created else 200
    return JobDescriptionResponse(job_description=job_record(result.job))


@router.get("/{job_id}", response_model=JobDescriptionResponse)
def get_job_description(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    return JobDescriptionResponse(
        job_description=job_record(require_owned_job(db, job_id, user.id))
    )


@router.put("/{job_id}", response_model=JobDescriptionResponse)
def update_job_description(
    job_id: str,
    payload: JobDescriptionUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    job = require_owned_job(db, job_id, user.id)
    try:
        updated_job = update_owned_job(
            db=db,
            job=job,
            user_id=user.id,
            payload=payload,
        )
    except ValueError as error:
        raise ApiError(400, "INVALID_JOB_DESCRIPTION") from error
    if updated_job is None:
        raise ApiError(409, "JD_EDIT_CONFLICT")
    return JobDescriptionResponse(job_description=job_record(updated_job))


@router.post("/{job_id}/archive", response_model=JobDescriptionResponse)
def archive_job_description(
    job_id: str,
    payload: JobLifecycleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    return _change_archive_state(db, user.id, job_id, payload, archived=True)


@router.post("/{job_id}/restore", response_model=JobDescriptionResponse)
def restore_job_description(
    job_id: str,
    payload: JobLifecycleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDescriptionResponse:
    return _change_archive_state(db, user.id, job_id, payload, archived=False)


def _change_archive_state(
    db: Session,
    user_id: int,
    job_id: str,
    payload: JobLifecycleRequest,
    *,
    archived: bool,
) -> JobDescriptionResponse:
    job = require_owned_job(db, job_id, user_id)
    updated_job = set_job_archived(
        db=db,
        job=job,
        user_id=user_id,
        base_lock_version=payload.base_lock_version,
        archived=archived,
    )
    if updated_job is None:
        raise ApiError(409, "JD_EDIT_CONFLICT")
    return JobDescriptionResponse(job_description=job_record(updated_job))


@router.delete("/{job_id}", response_model=DeleteJobDescriptionResponse)
def delete_job_description(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteJobDescriptionResponse:
    job = require_owned_job(db, job_id, user.id)
    if not hard_delete_owned_job(db, job, user.id):
        raise ApiError(404, "JD_NOT_FOUND")
    return DeleteJobDescriptionResponse(deleted=True)
