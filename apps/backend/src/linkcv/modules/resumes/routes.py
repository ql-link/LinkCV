import hashlib
import json
import logging

import redis as redis_lib
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, load_only

from fastapi import APIRouter, Depends, Request

from linkcv.application.resumes.service import (
    InvalidResumeTitle,
    ResumeLimitExceeded,
    ResumeTemplateCompositionInvalid,
    ResumeTemplateUnavailable,
    ResumeTitleConflict,
    apply_resume_template,
    create_resume_from_template,
    find_owned_resume,
    lock_owned_resume,
    parse_decimal_id,
    update_resume_snapshot,
)
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.core.storage import (
    AssetStorage,
    build_import_cleanup_object_names,
    get_storage,
)
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.integrations.resume_semantic_classification import classify_resume_sections
from linkcv.modules.agent.service import delete_resume_agent_data
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.llm.dependencies import get_llm_service
from linkcv.modules.llm.service import LLMError, LLMService
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeVersion,
)
from linkcv.modules.resumes.schemas import (
    DeleteResumeResponse,
    ResumeCreateRequest,
    ResumeListResponse,
    ResumePreview,
    ResumeRecord,
    ResumeResponse,
    ResumeApplyTemplateRequest,
    ResumeSummary,
    ResumeUpdateRequest,
    SemanticClassificationRequest,
    SemanticClassificationResponse,
)
from linkcv.modules.observability.audit import bind_audit_target
router = APIRouter(prefix="/resumes", tags=["resumes"])
logger = logging.getLogger(__name__)


def require_owned_resume(db: Session, resume_id: str, user_id: int) -> Resume:
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume


def resume_summary(resume: Resume) -> ResumeSummary:
    preview: ResumePreview | None = None
    try:
        snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
        preview = ResumePreview(data=snapshot.data, style=snapshot.style)
    except (TypeError, ValueError):
        pass
    return ResumeSummary(
        id=str(resume.id),
        title=resume.title,
        source_type=resume.source_type,
        lock_version=resume.lock_version,
        created_at=resume.created_at,
        updated_at=resume.updated_at,
        preview=preview,
    )


def resume_record(resume: Resume) -> ResumeRecord:
    try:
        snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    return ResumeRecord(
        **resume_summary(resume).model_dump(),
        template_id=str(resume.template_id) if resume.template_id is not None else None,
        data=snapshot.data,
        style=snapshot.style,
    )


def resume_content_hash(data: object) -> str:
    serialized = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(serialized.encode()).hexdigest()


@router.get("", response_model=ResumeListResponse)
def list_resumes(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeListResponse:
    resumes = db.scalars(
        select(Resume)
        .options(
            load_only(
                Resume.id,
                Resume.title,
                Resume.source_type,
                Resume.lock_version,
                Resume.created_at,
                Resume.updated_at,
                Resume.data_json,
                Resume.style_json,
            )
        )
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id.desc())
    ).all()
    return ResumeListResponse(resumes=[resume_summary(resume) for resume in resumes])


@router.post("", response_model=ResumeResponse, status_code=201)
def create_resume(
    payload: ResumeCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    if payload.template_id is None:
        raise ApiError(400, "TEMPLATE_REQUIRED")
    template_id = parse_decimal_id(payload.template_id)
    if template_id is None:
        raise ApiError(422, "TEMPLATE_INACTIVE")

    try:
        resume = create_resume_from_template(
            db=db,
            user_id=user.id,
            title=payload.title,
            template_id=template_id,
        )
    except InvalidResumeTitle as error:
        raise ApiError(400, "INVALID_RESUME_TITLE") from error
    except ResumeTitleConflict as error:
        raise ApiError(409, "RESUME_TITLE_CONFLICT") from error
    except ResumeTemplateUnavailable as error:
        raise ApiError(422, "TEMPLATE_INACTIVE") from error
    except ResumeLimitExceeded as error:
        raise ApiError(409, "RESUME_LIMIT_REACHED") from error
    bind_audit_target(request, resume.id)
    return ResumeResponse(resume=resume_record(resume))


@router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    return ResumeResponse(resume=resume_record(require_owned_resume(db, resume_id, user.id)))


@router.post(
    "/{resume_id}/semantic-classification",
    response_model=SemanticClassificationResponse,
)
async def classify_resume_semantics(
    resume_id: str,
    payload: SemanticClassificationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    llm_service: LLMService = Depends(get_llm_service),
    redis_client: "redis_lib.Redis" = Depends(get_redis),
) -> SemanticClassificationResponse:
    user_id = user.id
    resume = require_owned_resume(db, resume_id, user_id)
    try:
        snapshot = parse_resume_snapshot(resume.data_json, resume.style_json)
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    current_hash = resume_content_hash(snapshot.data.model_dump(mode="json"))
    if payload.content_hash != current_hash:
        raise ApiError(409, "RESUME_SEMANTIC_CLASSIFICATION_STALE")

    selected_ids = set(payload.section_ids) if payload.section_ids is not None else None
    eligible_ids = {
        section.id
        for section in snapshot.data.semantic_sections
        if section.content_key == "custom_sections"
        and section.custom_section_id != "custom_section_editor"
        and section.semantic_kind == "custom"
        and section.semantic_source != "user"
    }
    if selected_ids is not None and not selected_ids.issubset(eligible_ids):
        raise ApiError(400, "INVALID_RESUME_SEMANTIC_CLASSIFICATION")
    selection_key = ",".join(sorted(selected_ids)) if selected_ids is not None else "all"
    cache_key = (
        f"resume-semantic-classification:{user_id}:{resume.id}:"
        f"{current_hash.removeprefix('sha256:')}:{selection_key}"
    )
    cached = redis_client.get(cache_key)
    if cached is not None:
        try:
            cached_text = cached.decode() if isinstance(cached, bytes) else str(cached)
            cached_result = SemanticClassificationResponse.model_validate_json(cached_text)
            if cached_result.content_hash == current_hash:
                return cached_result
        except ValueError:
            redis_client.delete(cache_key)
    resume_db_id = resume.id
    # Do not hold a repeatable-read snapshot open while waiting for the model.
    # A fresh transaction below must observe edits committed during the call.
    db.rollback()
    try:
        result = await classify_resume_sections(
            llm_service,
            user_id=user_id,
            document=snapshot.data,
            selected_section_ids=selected_ids,
        )
    except (LLMError, ValueError) as error:
        raise ApiError(503, "RESUME_SEMANTIC_CLASSIFICATION_UNAVAILABLE") from error
    refreshed = find_owned_resume(db, str(resume_db_id), user_id)
    if refreshed is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    try:
        refreshed_snapshot = parse_resume_snapshot(
            refreshed.data_json,
            refreshed.style_json,
        )
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    if resume_content_hash(refreshed_snapshot.data.model_dump(mode="json")) != current_hash:
        raise ApiError(409, "RESUME_SEMANTIC_CLASSIFICATION_STALE")
    response = SemanticClassificationResponse(
        content_hash=current_hash,
        suggestions=result.suggestions,
    )
    redis_client.set(
        cache_key,
        response.model_dump_json(),
        ex=3600,
    )
    return response


@router.put("/{resume_id}", response_model=ResumeResponse)
def update_resume(
    resume_id: str,
    payload: ResumeUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    resume = require_owned_resume(db, resume_id, user.id)
    try:
        updated = update_resume_snapshot(
            db=db,
            resume=resume,
            user_id=user.id,
            base_lock_version=payload.base_lock_version,
            title=payload.title,
            data=payload.data,
            style=payload.style,
        )
    except InvalidResumeTitle as error:
        raise ApiError(400, "INVALID_RESUME_TITLE") from error
    except ResumeTitleConflict as error:
        raise ApiError(409, "RESUME_TITLE_CONFLICT") from error
    except ValueError as error:
        raise ApiError(500, "RESUME_SCHEMA_INVALID") from error
    if updated is None:
        raise ApiError(409, "RESUME_EDIT_CONFLICT")
    return ResumeResponse(resume=resume_record(updated))


@router.post("/{resume_id}/apply-template", response_model=ResumeResponse)
def apply_template(
    resume_id: str,
    payload: ResumeApplyTemplateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    template_id = parse_decimal_id(payload.template_id)
    if template_id is None:
        raise ApiError(422, "TEMPLATE_INACTIVE")
    resume = require_owned_resume(db, resume_id, user.id)
    try:
        updated = apply_resume_template(
            db=db,
            resume=resume,
            user_id=user.id,
            template_id=template_id,
            base_lock_version=payload.base_lock_version,
            title=payload.title,
            data=payload.data,
        )
    except InvalidResumeTitle as error:
        raise ApiError(400, "INVALID_RESUME_TITLE") from error
    except ResumeTitleConflict as error:
        raise ApiError(409, "RESUME_TITLE_CONFLICT") from error
    except ResumeTemplateUnavailable as error:
        raise ApiError(422, "TEMPLATE_INACTIVE") from error
    except ResumeTemplateCompositionInvalid as error:
        raise ApiError(422, "TEMPLATE_COMPOSITION_INVALID") from error
    if updated is None:
        raise ApiError(409, "RESUME_EDIT_CONFLICT")
    return ResumeResponse(resume=resume_record(updated))


@router.delete("/{resume_id}", response_model=DeleteResumeResponse)
def delete_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
) -> DeleteResumeResponse:
    parsed_id = parse_decimal_id(resume_id)
    if parsed_id is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    resume = lock_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")

    try:
        parse_task = None
        if resume.parse_task_id is not None:
            parse_task = db.scalar(
                select(DocumentParseTask).where(
                    DocumentParseTask.id == resume.parse_task_id,
                    DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                    DocumentParseTask.user_id == user.id,
                )
            )
            if parse_task is None:
                logger.warning(
                    "resume parse task missing during cleanup",
                    extra={
                        "resume_id": resume.id,
                        "parse_task_id": resume.parse_task_id,
                    },
                )
        if parse_task is not None:
            for object_name in build_import_cleanup_object_names(
                user.id,
                parse_task.object_name,
                parse_task.converted_object_name,
            ):
                storage.delete(object_name)
        storage.delete_prefix(f"users/{user.id}/resumes/{resume.id}/")
    except Exception as error:
        db.rollback()
        logger.warning(
            "resume storage cleanup failed",
            extra={"resume_id": resume.id, "error_type": type(error).__name__},
        )
        raise ApiError(502, "ASSET_DELETE_FAILED") from error

    try:
        if parse_task is not None:
            db.execute(
                delete(DocumentParseTask).where(
                    DocumentParseTask.id == parse_task.id,
                    DocumentParseTask.source_type == RESUME_IMPORT_SOURCE_TYPE,
                )
            )
        delete_resume_agent_data(db, resume_id=resume.id, user_id=user.id)
        db.execute(delete(ResumeVersion).where(ResumeVersion.resume_id == resume.id))
        result = db.execute(delete(Resume).where(Resume.id == resume.id))
        db.commit()
    except Exception:
        db.rollback()
        raise

    return DeleteResumeResponse(deleted=bool(result.rowcount))
