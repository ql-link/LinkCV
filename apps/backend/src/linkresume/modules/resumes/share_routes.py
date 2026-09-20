from urllib.parse import unquote

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from sqlalchemy.orm import Session

from linkresume.application.resumes.share_service import (
    ShareLinkUnavailable,
    create_or_overwrite_share,
    delete_share,
    resolve_public_share,
    resolve_share_resume,
    share_state_of,
    update_share,
)
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.storage import (
    AssetStorage,
    get_storage,
    infer_image_content_type,
)
from linkresume.modules.identity.dependencies import get_current_user, get_optional_user
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.asset_routes import stream_object
from linkresume.modules.resumes.models import Resume
from linkresume.modules.resumes.schemas import (
    DeleteResumeShareResponse,
    PublicSharePayload,
    ResumeShareCreateRequest,
    ResumeShareResponse,
    ResumeShareUpdateRequest,
)
from linkresume.application.resumes.service import find_owned_resume

router = APIRouter(prefix="/resumes/{resume_id}/share", tags=["resume-share"])
public_router = APIRouter(prefix="/share", tags=["resume-share"])


def _require_owned_resume(db: Session, resume_id: str, user_id: int) -> Resume:
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return resume


@router.get("", response_model=ResumeShareResponse)
def get_share_state(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeShareResponse:
    resume = _require_owned_resume(db, resume_id, user.id)
    return ResumeShareResponse(share=share_state_of(resume))


@router.post("", response_model=ResumeShareResponse)
def create_share(
    resume_id: str,
    request: ResumeShareCreateRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeShareResponse:
    _require_owned_resume(db, resume_id, user.id)
    updated = create_or_overwrite_share(
        db,
        resume_id,
        user.id,
        visibility=request.visibility if request else None,
        expires_at=request.expires_at if request else None,
    )
    if updated is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return ResumeShareResponse(share=share_state_of(updated))


@router.patch("", response_model=ResumeShareResponse)
def update_share_state(
    resume_id: str,
    request: ResumeShareUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeShareResponse:
    _require_owned_resume(db, resume_id, user.id)
    try:
        updated = update_share(
            db,
            resume_id,
            user.id,
            visibility=request.visibility,
            expires_at=request.expires_at,
            provided_fields=request.model_fields_set,
        )
    except ShareLinkUnavailable as error:
        raise ApiError(404, "SHARE_LINK_UNAVAILABLE") from error
    return ResumeShareResponse(share=share_state_of(updated))


@router.delete("", response_model=DeleteResumeShareResponse)
def delete_share_state(
    resume_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DeleteResumeShareResponse:
    _require_owned_resume(db, resume_id, user.id)
    deleted = delete_share(db, resume_id, user.id)
    if deleted is None:
        raise ApiError(404, "RESUME_NOT_FOUND")
    return DeleteResumeShareResponse(deleted=deleted)


@public_router.get("/{token}", response_model=PublicSharePayload)
def get_public_share(
    token: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
) -> PublicSharePayload:
    try:
        return resolve_public_share(db, token, viewer)
    except ShareLinkUnavailable as error:
        raise ApiError(404, "SHARE_LINK_UNAVAILABLE") from error


def _share_asset_object_key(resume: Resume, object_key: str) -> str:
    """分享域只允许读取分享者的账号资产与该简历自身资产目录。"""
    owner_prefix = f"users/{resume.user_id}/"
    allowed_prefixes = (
        f"{owner_prefix}assets/",
        f"{owner_prefix}resumes/{resume.id}/assets/",
    )
    if not object_key.startswith(allowed_prefixes):
        raise ApiError(404, "ASSET_NOT_FOUND")
    if ".." in object_key.split("/"):
        raise ApiError(404, "ASSET_NOT_FOUND")
    return object_key


@public_router.get("/{token}/assets/{object_key:path}", response_model=None)
def read_public_share_asset(
    token: str,
    object_key: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
    storage: AssetStorage = Depends(get_storage),
) -> StreamingResponse:
    """分享简历内嵌图片的公开读取：沿用分享可见性校验，按对象键白名单前缀放行。"""
    try:
        resume = resolve_share_resume(db, token, viewer)
    except ShareLinkUnavailable as error:
        raise ApiError(404, "SHARE_LINK_UNAVAILABLE") from error
    object_key = _share_asset_object_key(resume, unquote(object_key))
    try:
        response = storage.get(object_key)
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject"}:
            raise ApiError(404, "ASSET_NOT_FOUND") from error
        raise ApiError(502, "ASSET_READ_FAILED") from error
    except Exception as error:
        raise ApiError(502, "ASSET_READ_FAILED") from error
    return StreamingResponse(
        stream_object(response),
        media_type=infer_image_content_type(object_key),
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )
