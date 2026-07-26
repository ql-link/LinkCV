import json
from copy import deepcopy

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, load_only

from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.defaults import (
    DEFAULT_RESUME_MARKDOWN,
    DEFAULT_RESUME_SETTINGS,
)
from linkcv.modules.resumes.models import Resume, ResumeVersion
from linkcv.modules.resumes.schemas import (
    DeleteResumeResponse,
    ResumeListResponse,
    ResumeRecord,
    ResumeResponse,
    ResumeSummary,
    ResumeWrite,
)

router = APIRouter(prefix="/resumes", tags=["resumes"])


def parse_id(value: str) -> int | None:
    if not value.isdecimal():
        return None
    parsed = int(value)
    return parsed if parsed > 0 and str(parsed) == value else None


def owned_resume(db: Session, resume_id: str, user_id: int) -> Resume:
    parsed_id = parse_id(resume_id)
    if parsed_id is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    resume = db.scalar(
        select(Resume).where(Resume.id == parsed_id, Resume.user_id == user_id)
    )
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume


def normalized_settings(value: dict[str, object] | None) -> dict[str, object]:
    result = deepcopy(DEFAULT_RESUME_SETTINGS)
    if value:
        result.update(value)
    result["showSource"] = False
    return result


def document_json(markdown: str) -> dict[str, object]:
    try:
        document = json.loads(markdown)
    except json.JSONDecodeError:
        return {"schema_version": 1, "markdown": markdown}
    if not isinstance(document, dict):
        return {"schema_version": 1, "markdown": markdown}
    return {"schema_version": 1, "document": document}


def document_text(value: dict[str, object]) -> str:
    document = value.get("document")
    if isinstance(document, dict):
        return json.dumps(document, ensure_ascii=False, separators=(",", ":"))
    markdown = value.get("markdown")
    if isinstance(markdown, str):
        return markdown
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def style_json(
    settings: dict[str, object], split_ratio: float, preview_scale: float
) -> dict[str, object]:
    return {
        "schema_version": 1,
        "settings": settings,
        "split_ratio": split_ratio,
        "preview_scale": preview_scale,
    }


def resume_summary(resume: Resume) -> ResumeSummary:
    return ResumeSummary(
        id=str(resume.id),
        title=resume.title,
        sourceType=resume.source_type,
        lockVersion=resume.lock_version,
        createdAt=resume.created_at,
        updatedAt=resume.updated_at,
    )


def resume_record(resume: Resume) -> ResumeRecord:
    settings = resume.style_json.get("settings")
    normalized = normalized_settings(settings if isinstance(settings, dict) else None)
    split_ratio = resume.style_json.get("split_ratio", 0.4)
    preview_scale = resume.style_json.get("preview_scale", 1.0)
    return ResumeRecord(
        **resume_summary(resume).model_dump(),
        markdown=document_text(resume.data_json),
        settings=normalized,
        splitRatio=float(split_ratio),
        previewScale=float(preview_scale),
    )


@router.get("", response_model=ResumeListResponse)
def list_resumes(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeListResponse:
    resumes = db.scalars(
        select(Resume).options(
            load_only(
                Resume.id,
                Resume.title,
                Resume.source_type,
                Resume.lock_version,
                Resume.created_at,
                Resume.updated_at,
            )
        )
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc(), Resume.id.desc())
    ).all()
    return ResumeListResponse(
        resumes=[resume_summary(resume) for resume in resumes]
    )


@router.post("", response_model=ResumeResponse, status_code=201)
def create_resume(
    payload: ResumeWrite,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    title = (payload.title or "未命名简历").strip() or "未命名简历"
    markdown = (
        payload.markdown if payload.markdown is not None else DEFAULT_RESUME_MARKDOWN
    )
    settings = normalized_settings(payload.settings)
    split_ratio = payload.split_ratio if payload.split_ratio is not None else 0.4
    preview_scale = payload.preview_scale if payload.preview_scale is not None else 1.0
    resume = Resume(
        user_id=user.id,
        template_id=None,
        title=title,
        data_json=document_json(markdown),
        style_json=style_json(settings, split_ratio, preview_scale),
        source_type="blank",
    )
    db.add(resume)
    db.flush()
    db.add(
        ResumeVersion(
            resume_id=resume.id,
            version_no=1,
            data_json=deepcopy(resume.data_json),
            style_json=deepcopy(resume.style_json),
            reason="initial",
        )
    )
    db.commit()
    db.refresh(resume)
    return ResumeResponse(resume=resume_record(resume))


@router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    resume = owned_resume(db, resume_id, user.id)
    return ResumeResponse(resume=resume_record(resume))


@router.put("/{resume_id}", response_model=ResumeResponse)
def update_resume(
    resume_id: str,
    payload: ResumeWrite,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeResponse:
    resume = owned_resume(db, resume_id, user.id)
    if payload.lock_version is None or payload.lock_version != resume.lock_version:
        raise ApiError(409, "RESUME_EDIT_CONFLICT")

    current_settings = resume.style_json.get("settings")
    settings = normalized_settings(
        payload.settings
        if payload.settings is not None
        else current_settings if isinstance(current_settings, dict) else None
    )
    split_ratio = (
        payload.split_ratio
        if payload.split_ratio is not None
        else float(resume.style_json.get("split_ratio", 0.4))
    )
    preview_scale = (
        payload.preview_scale
        if payload.preview_scale is not None
        else float(resume.style_json.get("preview_scale", 1.0))
    )
    values = {
        "title": (
            payload.title.strip() or "未命名简历"
            if payload.title is not None
            else resume.title
        ),
        "data_json": (
            document_json(payload.markdown)
            if payload.markdown is not None
            else resume.data_json
        ),
        "style_json": style_json(settings, split_ratio, preview_scale),
        "lock_version": Resume.lock_version + 1,
        "updated_at": utc_now(),
    }
    result = db.execute(
        update(Resume)
        .where(
            Resume.id == resume.id,
            Resume.user_id == user.id,
            Resume.lock_version == payload.lock_version,
        )
        .values(**values)
    )
    if result.rowcount != 1:
        db.rollback()
        raise ApiError(409, "RESUME_EDIT_CONFLICT")
    db.commit()
    updated_resume = owned_resume(db, resume_id, user.id)
    return ResumeResponse(resume=resume_record(updated_resume))


@router.delete("/{resume_id}", response_model=DeleteResumeResponse)
def delete_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteResumeResponse:
    parsed_id = parse_id(resume_id)
    if parsed_id is None:
        return DeleteResumeResponse(deleted=False)
    result = db.execute(
        delete(Resume).where(Resume.id == parsed_id, Resume.user_id == user.id)
    )
    db.commit()
    return DeleteResumeResponse(deleted=bool(result.rowcount))
