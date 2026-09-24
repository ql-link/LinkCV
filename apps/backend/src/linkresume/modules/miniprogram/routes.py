from copy import deepcopy

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import find_owned_resume, parse_persisted_resume_snapshot
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.domain.resume import compile_layout_plan
from linkresume.modules.identity.dependencies import get_current_miniprogram_user
from linkresume.modules.identity.models import User
from linkresume.modules.miniprogram.pdf_service import ResumePdfRenderer, ResumePreviewRenderer, build_render_assets
from linkresume.modules.resumes.models import Resume
from linkresume.modules.resumes.routes import resume_record, resume_summary
from linkresume.modules.resumes.schemas import ResumeListResponse, ResumeResponse

router = APIRouter(prefix="/miniprogram/resumes", tags=["miniprogram"])
v2_router = APIRouter(prefix="/miniprogram/v2/resumes", tags=["miniprogram"])


def get_pdf_renderer(request: Request) -> ResumePdfRenderer:
    return getattr(request.app.state, "resume_pdf_renderer", None) or ResumePdfRenderer(request.app.state.settings)


def get_preview_renderer(request: Request) -> ResumePreviewRenderer:
    return getattr(request.app.state, "resume_preview_renderer", None) or ResumePreviewRenderer()


def render_snapshot_pdf(title, data, style, assets, renderer) -> bytes:
    style = deepcopy(style)
    style["portable"]["smart_one_page"] = True
    snapshot = parse_persisted_resume_snapshot(data, style)
    layout = compile_layout_plan(snapshot.data, snapshot.style.template_snapshot, snapshot.style)
    return renderer.render({"title": title, "data": snapshot.data_json, "style": snapshot.style_json,
                            "layout_plan": layout.model_dump(mode="json"), "assets": assets})


def _render_pdf(resume, version, user, storage, renderer) -> bytes:
    return render_snapshot_pdf(resume.title, version.data_json, version.style_json,
        build_render_assets(storage, version.data_json, user_id=user.id, resume_id=resume.id), renderer)


@router.get("")
@router.get("/{resume_id}")
@router.get("/{resume_id}/pdf")
@router.get("/{resume_id}/preview.png")
def retired_resume_reader(user: User = Depends(get_current_miniprogram_user)):
    raise ApiError(426, "CLIENT_UPDATE_REQUIRED")


@v2_router.get("", response_model=ResumeListResponse)
def list_resumes(db: Session = Depends(get_db), user: User = Depends(get_current_miniprogram_user)):
    rows = db.scalars(select(Resume).where(Resume.user_id == user.id).order_by(Resume.updated_at.desc(), Resume.id.desc())).all()
    return ResumeListResponse(resumes=[resume_summary(row) for row in rows])


@v2_router.get("/{resume_id}", response_model=ResumeResponse)
def get_resume(resume_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_miniprogram_user)):
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return ResumeResponse(resume=resume_record(resume))


def current_render_input(db, resume_id, user, lock_version):
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    if resume.lock_version != lock_version:
        raise ApiError(409, "RESUME_EDIT_CONFLICT")
    return resume


def output(content, media_type, lock_version):
    return Response(content=content, media_type=media_type, headers={
        "Cache-Control": "private, no-store", "X-LinkResume-Lock-Version": str(lock_version),
        "X-Content-Type-Options": "nosniff",
    })


@v2_router.get("/{resume_id}/pdf", response_model=None)
def download_resume_pdf(resume_id: str, lock_version: int = Query(ge=1),
    db: Session = Depends(get_db), user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage), renderer: ResumePdfRenderer = Depends(get_pdf_renderer)):
    resume = current_render_input(db, resume_id, user, lock_version)
    return output(_render_pdf(resume, resume, user, storage, renderer), "application/pdf", lock_version)


@v2_router.get("/{resume_id}/preview.png", response_model=None)
def download_resume_preview(resume_id: str, lock_version: int = Query(ge=1),
    db: Session = Depends(get_db), user: User = Depends(get_current_miniprogram_user),
    storage: AssetStorage = Depends(get_storage), pdf_renderer: ResumePdfRenderer = Depends(get_pdf_renderer),
    preview_renderer: ResumePreviewRenderer = Depends(get_preview_renderer)):
    resume = current_render_input(db, resume_id, user, lock_version)
    return output(preview_renderer.render(_render_pdf(resume, resume, user, storage, pdf_renderer)), "image/png", lock_version)
