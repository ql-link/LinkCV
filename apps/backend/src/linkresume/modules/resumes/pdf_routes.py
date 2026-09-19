from __future__ import annotations

import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import (
    find_owned_resume,
    parse_persisted_resume_snapshot,
)
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.storage import AssetStorage, get_storage
from linkresume.domain.resume import compile_layout_plan
from linkresume.modules.identity.dependencies import get_current_user
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.pdf_service import (
    RENDER_PROTOCOL_VERSION,
    ResumePdfRenderer,
    build_render_assets,
)
from linkresume.modules.resumes.models import Resume

router = APIRouter(prefix="/resumes", tags=["resumes"])


def get_pdf_renderer(request: Request) -> ResumePdfRenderer:
    renderer = getattr(request.app.state, "resume_pdf_renderer", None)
    return renderer or ResumePdfRenderer(request.app.state.settings)


def download_name(title: str) -> str:
    # Keep the ASCII fallback safe for all Content-Disposition parsers.  The
    # RFC 5987 filename* value below retains the user's title where supported.
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", title).strip("-._")
    return (normalized or "resume")[:96] + ".pdf"


def render_resume_pdf(
    resume: Resume,
    user_id: int,
    storage: AssetStorage,
    renderer: ResumePdfRenderer,
    *,
    smart_one_page: bool | None = None,
) -> bytes:
    snapshot = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
    style = snapshot.style
    if smart_one_page is not None:
        style = style.model_copy(
            update={
                "portable": style.portable.model_copy(
                    update={"smart_one_page": smart_one_page}
                )
            }
        )
    layout_plan = compile_layout_plan(
        snapshot.data,
        style.template_snapshot,
        style,
    )
    assets = build_render_assets(
        storage,
        resume.data_json,
        user_id=user_id,
        resume_id=resume.id,
    )
    return renderer.render(
        {
            "protocol_version": RENDER_PROTOCOL_VERSION,
            "title": resume.title,
            "data": snapshot.data_json,
            "style": style.model_dump(mode="json"),
            "layout_plan": layout_plan.model_dump(mode="json"),
            "assets": assets,
        }
    )


def resume_pdf_response(resume: Resume, pdf: bytes) -> Response:
    encoded_title = quote(resume.title.encode("utf-8"), safe="")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": (
                f'attachment; filename="{download_name(resume.title)}"; '
                f"filename*=UTF-8''{encoded_title}.pdf"
            ),
            "X-LinkResume-Pdf-Lock-Version": str(resume.lock_version),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{resume_id}/pdf", response_model=None)
def download_resume_pdf(
    resume_id: str,
    lock_version: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    storage: AssetStorage = Depends(get_storage),
    renderer: ResumePdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    resume = find_owned_resume(db, resume_id, user.id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    if resume.lock_version != lock_version:
        raise ApiError(409, "RESUME_PDF_SNAPSHOT_STALE")
    pdf = render_resume_pdf(resume, user.id, storage, renderer)
    return resume_pdf_response(resume, pdf)
