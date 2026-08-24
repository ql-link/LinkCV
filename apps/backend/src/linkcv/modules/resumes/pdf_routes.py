from __future__ import annotations

import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from linkcv.application.resumes.service import find_owned_resume
from linkcv.core.database import get_db
from linkcv.core.errors import ApiError
from linkcv.core.storage import AssetStorage, get_storage
from linkcv.modules.identity.dependencies import get_current_user
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.pdf_service import (
    RENDER_PROTOCOL_VERSION,
    ResumePdfRenderer,
    build_render_assets,
)
from linkcv.modules.resumes.models import Resume

router = APIRouter(prefix="/resumes", tags=["resumes"])


def get_pdf_renderer(request: Request) -> ResumePdfRenderer:
    renderer = getattr(request.app.state, "resume_pdf_renderer", None)
    return renderer or ResumePdfRenderer(request.app.state.settings)


def _download_name(title: str) -> str:
    # Keep the ASCII fallback safe for all Content-Disposition parsers.  The
    # RFC 5987 filename* value below retains the user's title where supported.
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", title).strip("-._")
    return (normalized or "resume")[:96] + ".pdf"


def _render_resume_pdf(
    resume: Resume,
    user: User,
    storage: AssetStorage,
    renderer: ResumePdfRenderer,
) -> bytes:
    assets = build_render_assets(
        storage,
        resume.data_json,
        user_id=user.id,
        resume_id=resume.id,
    )
    return renderer.render(
        {
            "protocol_version": RENDER_PROTOCOL_VERSION,
            "title": resume.title,
            "data": resume.data_json,
            "style": resume.style_json,
            "assets": assets,
        }
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
    pdf = _render_resume_pdf(resume, user, storage, renderer)
    encoded_title = quote(resume.title.encode("utf-8"), safe="")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": (
                f'attachment; filename="{_download_name(resume.title)}"; '
                f"filename*=UTF-8''{encoded_title}.pdf"
            ),
            "X-LinkCV-Pdf-Lock-Version": str(resume.lock_version),
            "X-Content-Type-Options": "nosniff",
        },
    )
