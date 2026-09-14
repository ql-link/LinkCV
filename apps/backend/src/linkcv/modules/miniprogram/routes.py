from copy import deepcopy
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from linkcv.application.resumes.service import (
    find_owned_resume,
    parse_persisted_resume_snapshot,
)
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, get_storage
from linkcv.domain.resume import compile_layout_plan
from linkcv.modules.identity.dependencies import get_current_miniprogram_user
from linkcv.modules.identity.models import User
from linkcv.modules.miniprogram.pdf_service import (
    ResumePdfRenderer,
    ResumePreviewRenderer,
    build_render_assets,
)
from linkcv.modules.miniprogram.schemas import (
    MiniprogramResumeListResponse,
    MiniprogramResumeRecord,
    MiniprogramResumeResponse,
    MiniprogramResumeSummary,
)
from linkcv.modules.resumes.models import Resume
from linkcv.modules.resumes.routes import resume_record, resume_summary

router = APIRouter(prefix="/miniprogram/resumes", tags=["miniprogram"])


def get_pdf_renderer(request: Request) -> ResumePdfRenderer:
    renderer = getattr(request.app.state, "resume_pdf_renderer", None)
    return renderer or ResumePdfRenderer(request.app.state.settings)


def get_preview_renderer(request: Request) -> ResumePreviewRenderer:
    renderer = getattr(request.app.state, "resume_preview_renderer", None)
    return renderer or ResumePreviewRenderer()


def _draft_revision(resume: Resume) -> str:
    return f"draft:{resume.lock_version}"


def _render_pdf(
    resume: Resume,
    data_json: dict[str, Any],
    style_json: dict[str, Any],
    user: User,
    storage: AssetStorage,
    renderer: ResumePdfRenderer,
) -> bytes:
    assets = build_render_assets(
        storage,
        data_json,
        user_id=user.id,
        resume_id=resume.id,
    )
    snapshot = parse_persisted_resume_snapshot(data_json, style_json)
    style = deepcopy(snapshot.style_json)
    # The mini-program contract is a single long page even when the Web
    # editing preference is fixed A4, because preview.png rasterizes one page.
    style["portable"]["smart_one_page"] = True
    one_page_snapshot = parse_persisted_resume_snapshot(snapshot.data_json, style)
    layout_plan = compile_layout_plan(
        one_page_snapshot.data,
        one_page_snapshot.style.template_snapshot,
        one_page_snapshot.style,
    )
    return renderer.render(
        {
            "title": resume.title,
            "data": snapshot.data_json,
            "style": style,
            "layout_plan": layout_plan.model_dump(mode="json"),
            "assets": assets,
        }
    )


def _summary(resume: Resume) -> MiniprogramResumeSummary:
    return MiniprogramResumeSummary(
        **resume_summary(resume).model_dump(),
        pdf_version_id=_draft_revision(resume),
        pdf_version_no=resume.lock_version,
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
    return MiniprogramResumeListResponse(
        resumes=[_summary(resume) for resume in resumes]
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
    return MiniprogramResumeResponse(
        resume=MiniprogramResumeRecord(
            **resume_record(resume).model_dump(),
            pdf_version_id=_draft_revision(resume),
            pdf_version_no=resume.lock_version,
        )
    )


@router.get("/{resume_id}/pdf", response_model=None)
def download_resume_pdf(
    resume_id: str,
    version_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage),
    renderer: ResumePdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    revision = _draft_revision(resume)
    if version_id is not None and version_id != revision:
        raise ApiError(409, "RESUME_VERSION_UNAVAILABLE")
    pdf = _render_pdf(
        resume, resume.data_json, resume.style_json, user, storage, renderer
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="resume.pdf"',
            "X-LinkCV-Pdf-Version-Id": revision,
            "X-LinkCV-Pdf-Version-No": str(resume.lock_version),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{resume_id}/preview.png", response_model=None)
def download_resume_preview(
    resume_id: str,
    version_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage),
    pdf_renderer: ResumePdfRenderer = Depends(get_pdf_renderer),
    preview_renderer: ResumePreviewRenderer = Depends(get_preview_renderer),
) -> Response:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    revision = _draft_revision(resume)
    if version_id is not None and version_id != revision:
        raise ApiError(409, "RESUME_VERSION_UNAVAILABLE")
    pdf = _render_pdf(
        resume, resume.data_json, resume.style_json, user, storage, pdf_renderer
    )
    preview = preview_renderer.render(pdf)
    return Response(
        content=preview,
        media_type="image/png",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="resume-preview.png"',
            "X-LinkCV-Preview-Version-Id": revision,
            "X-LinkCV-Preview-Version-No": str(resume.lock_version),
            "X-Content-Type-Options": "nosniff",
        },
    )
