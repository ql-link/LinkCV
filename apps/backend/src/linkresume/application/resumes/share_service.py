"""Resume share link business logic.

每份简历一个分享链接，字段落在 resumes 表；分享内容不另存分享快照，公开读取时实时
取简历主记录中最近一次保存成功的草稿。
"""
import secrets
from datetime import timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import (
    find_owned_resume,
    parse_persisted_resume_snapshot,
)
from linkresume.core.database import utc_now
from linkresume.core.storage import AssetStorage
from linkresume.domain.resume import compile_layout_plan
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import Resume
from linkresume.modules.resumes.pdf_service import build_render_assets
from linkresume.modules.resumes.schemas import (
    PublicSharePayload,
    PublicShareSharer,
    ResumeShareState,
)

DEFAULT_SHARE_VISIBILITY = "public"

_TOKEN_GENERATION_TRIES = 3


class ShareLinkUnavailable(RuntimeError):
    """公开或管理侧遇到的统一失效语义：链接不存在、已删除、已过期或无权查看。"""


def _generate_share_token() -> str:
    return secrets.token_urlsafe(16)


def share_state_of(resume: Resume) -> ResumeShareState | None:
    if resume.share_token is None:
        return None
    return ResumeShareState(
        share_token=resume.share_token,
        share_visibility=resume.share_visibility,  # type: ignore[arg-type]
        share_expires_at=resume.share_expires_at,
        share_allow_download=bool(resume.share_allow_download),
        share_created_at=resume.share_created_at,  # type: ignore[arg-type]
    )


def create_or_overwrite_share(
    db: Session,
    resume_id: str,
    user_id: int,
    *,
    visibility: str | None = None,
    expires_at=None,
    allow_download: bool = True,
) -> Resume | None:
    """无链接时生成新链接；已有链接时作废旧 token 并生成新 token。"""
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        return None
    try:
        for _ in range(_TOKEN_GENERATION_TRIES):
            resume.share_token = _generate_share_token()
            resume.share_visibility = visibility or DEFAULT_SHARE_VISIBILITY
            resume.share_expires_at = expires_at
            resume.share_allow_download = int(allow_download)
            resume.share_created_at = utc_now()
            try:
                db.commit()
                break
            except IntegrityError:
                db.rollback()
        else:
            raise RuntimeError("share token collision after retries")
    except Exception:
        db.rollback()
        raise
    db.refresh(resume)
    return resume


def delete_share(
    db: Session,
    resume_id: str,
    user_id: int,
) -> bool | None:
    """清空分享字段，旧地址访问统一失效。重复删除保持幂等。"""
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        return None
    resume.share_token = None
    resume.share_visibility = None
    resume.share_expires_at = None
    resume.share_created_at = None
    db.commit()
    return True


def update_share(
    db: Session,
    resume_id: str,
    user_id: int,
    *,
    visibility: str | None,
    expires_at,
    allow_download: bool | None,
    provided_fields: set[str],
) -> Resume:
    """续期（延长/清除 expires_at）或修改可见性。未开启分享时抛失效异常。"""
    resume = find_owned_resume(db, resume_id, user_id)
    if resume is None:
        raise ShareLinkUnavailable
    if resume.share_token is None:
        raise ShareLinkUnavailable
    if "visibility" in provided_fields:
        resume.share_visibility = visibility  # type: ignore[assignment]
    if "expires_at" in provided_fields:
        resume.share_expires_at = expires_at
    if "allow_download" in provided_fields:
        resume.share_allow_download = int(bool(allow_download))
    db.commit()
    db.refresh(resume)
    return resume


def resolve_public_share(
    db: Session,
    token: str,
    viewer: User | None,
    storage: AssetStorage,
) -> PublicSharePayload:
    """公开读取：校验 token、有效期与可见性后返回当前已保存草稿的脱敏数据。"""
    resume, owner = resolve_public_share_access(db, token, viewer)
    snapshot = parse_persisted_resume_snapshot(resume.data_json, resume.style_json)
    assets = build_render_assets(
        storage,
        resume.data_json,
        user_id=resume.user_id,
        resume_id=resume.id,
    )
    return PublicSharePayload(
        data=snapshot.data,
        style=snapshot.style,
        layout_plan=compile_layout_plan(
            snapshot.data,
            snapshot.style.template_snapshot,
            snapshot.style,
        ),
        assets=assets,
        sharer=PublicShareSharer(nickname=owner.nickname, avatar_url=owner.avatar_url),
        allow_download=bool(resume.share_allow_download),
    )


def resolve_public_share_access(
    db: Session,
    token: str,
    viewer: User | None,
) -> tuple[Resume, User]:
    """Resolve a share token without exposing whether access failed or why."""
    resume = db.scalar(select(Resume).where(Resume.share_token == token))
    if resume is None:
        raise ShareLinkUnavailable
    expires_at = resume.share_expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        # SQLite 不保留时区，按 UTC 解释存储的过期时间。
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is not None and expires_at < utc_now():
        raise ShareLinkUnavailable
    if resume.share_visibility == "private":
        if viewer is None or viewer.id != resume.user_id:
            raise ShareLinkUnavailable
    owner = db.get(User, resume.user_id)
    if owner is None:
        raise ShareLinkUnavailable
    return resume, owner
