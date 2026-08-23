from copy import deepcopy
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from linkcv.application.resumes.service import find_owned_resume
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, get_storage
from linkcv.modules.identity.dependencies import get_current_miniprogram_user
from linkcv.modules.identity.models import User
from linkcv.modules.miniprogram.pdf_service import (
    ResumePdfRenderer,
    ResumePreviewRenderer,
    build_render_assets,
    select_readable_version,
    select_readable_versions,
)
from linkcv.modules.miniprogram.schemas import (
    MiniprogramResumeListResponse,
    MiniprogramResumeRecord,
    MiniprogramResumeResponse,
    MiniprogramResumeSummary,
)
from linkcv.modules.resumes.models import Resume, ResumeVersion
from linkcv.modules.resumes.routes import resume_record, resume_summary

router = APIRouter(prefix="/miniprogram/resumes", tags=["miniprogram"])


def get_pdf_renderer(request: Request) -> ResumePdfRenderer:
    renderer = getattr(request.app.state, "resume_pdf_renderer", None)
    return renderer or ResumePdfRenderer(request.app.state.settings)


def get_preview_renderer(request: Request) -> ResumePreviewRenderer:
    renderer = getattr(request.app.state, "resume_preview_renderer", None)
    return renderer or ResumePreviewRenderer()


def _render_pdf(
    resume: Resume,
    version: ResumeVersion,
    user: User,
    storage: AssetStorage,
    renderer: ResumePdfRenderer,
) -> bytes:
    assets = build_render_assets(
        storage,
        version.data_json,
        user_id=user.id,
        resume_id=resume.id,
    )
    style = deepcopy(version.style_json)
    # The mini-program contract is a single long page even when the Web
    # editing preference is fixed A4, because preview.png rasterizes one page.
    style["smart_one_page"] = True
    return renderer.render(
        {
            "title": resume.title,
            "data": version.data_json,
            "style": style,
            "assets": assets,
        }
    )


def _summary(resume: Resume, version: ResumeVersion) -> MiniprogramResumeSummary:
    payload: dict[str, Any] = resume_summary(resume).model_dump()
    payload["preview"] = {"data": version.data_json, "style": version.style_json}
    return MiniprogramResumeSummary(
        **payload,
        pdf_version_id=str(version.id),
        pdf_version_no=version.version_no,
    )


@router.get("", response_model=MiniprogramResumeListResponse)
def list_resumes(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> MiniprogramResumeListResponse:
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
    versions = select_readable_versions(db, [resume.id for resume in resumes])
    return MiniprogramResumeListResponse(
        resumes=[
            _summary(resume, versions[resume.id])
            for resume in resumes
            if resume.id in versions
        ]
    )


@router.get("/{resume_id}", response_model=MiniprogramResumeResponse)
def get_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
) -> MiniprogramResumeResponse:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    version = select_readable_version(db, resume.id)
    if version is None:
        raise ApiError(409, "RESUME_VERSION_UNAVAILABLE")
    payload: dict[str, Any] = resume_record(resume).model_dump()
    payload["data"] = version.data_json
    payload["style"] = version.style_json
    payload["preview"] = {"data": version.data_json, "style": version.style_json}
    return MiniprogramResumeResponse(
        resume=MiniprogramResumeRecord(
            **payload,
            pdf_version_id=str(version.id),
            pdf_version_no=version.version_no,
        )
    )


@router.get("/{resume_id}/pdf", response_model=None)
def download_resume_pdf(
    resume_id: str,
    version_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage),
    renderer: ResumePdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    version = select_readable_version(db, resume.id, version_id=version_id)
    if version is None:
        raise ApiError(409, "RESUME_VERSION_UNAVAILABLE")
    pdf = _render_pdf(resume, version, user, storage, renderer)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="resume.pdf"',
            "X-LinkCV-Pdf-Version-Id": str(version.id),
            "X-LinkCV-Pdf-Version-No": str(version.version_no),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{resume_id}/preview.png", response_model=None)
def download_resume_preview(
    resume_id: str,
    version_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage),
    pdf_renderer: ResumePdfRenderer = Depends(get_pdf_renderer),
    preview_renderer: ResumePreviewRenderer = Depends(get_preview_renderer),
) -> Response:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    version = select_readable_version(db, resume.id, version_id=version_id)
    if version is None:
        raise ApiError(409, "RESUME_VERSION_UNAVAILABLE")
    pdf = _render_pdf(resume, version, user, storage, pdf_renderer)
    preview = preview_renderer.render(pdf)
    return Response(
        content=preview,
        media_type="image/png",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="resume-preview.png"',
            "X-LinkCV-Preview-Version-Id": str(version.id),
            "X-LinkCV-Preview-Version-No": str(version.version_no),
            "X-Content-Type-Options": "nosniff",
        },
    )
