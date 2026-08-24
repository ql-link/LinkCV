from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from linkcv.core.errors import ApiError
from linkcv.modules.identity.models import User
from linkcv.modules.notices.models import ReleaseNotice
from linkcv.modules.notices.schemas import (
    AdminNoticeItem,
    NoticeItem,
)

TITLE_MAX_LENGTH = 128
CONTENT_MAX_LENGTH = 10_000


def _published_notices(db: Session) -> list[ReleaseNotice]:
    statement = (
        select(ReleaseNotice)
        .where(ReleaseNotice.revoked_at.is_(None))
        .order_by(ReleaseNotice.published_at.desc(), ReleaseNotice.id.desc())
    )
    return list(db.scalars(statement))


def list_published(db: Session, user: User) -> tuple[list[NoticeItem], int]:
    notices = _published_notices(db)
    read_at = user.last_notice_read_at
    unread_count = sum(
        1 for notice in notices if read_at is None or notice.published_at > read_at
    )
    items = [
        NoticeItem(
            id=str(notice.id),
            title=notice.title,
            content=notice.content,
            published_at=notice.published_at,
        )
        for notice in notices
    ]
    return items, unread_count


def mark_read(db: Session, user: User) -> int:
    db.execute(
        update(User)
        .where(User.id == user.id)
        .values(last_notice_read_at=datetime.now(UTC))
    )
    db.commit()
    return 0


def admin_list(db: Session) -> list[AdminNoticeItem]:
    statement = select(ReleaseNotice).order_by(
        ReleaseNotice.published_at.desc(), ReleaseNotice.id.desc()
    )
    return [
        AdminNoticeItem(
            id=str(notice.id),
            title=notice.title,
            content=notice.content,
            published_at=notice.published_at,
            revoked_at=notice.revoked_at,
        )
        for notice in db.scalars(statement)
    ]


def admin_create(db: Session, title: str, content: str) -> ReleaseNotice:
    normalized_title = title.strip()
    normalized_content = content.strip()
    if not normalized_title or len(normalized_title) > TITLE_MAX_LENGTH:
        raise ApiError(400, "NOTICE_TITLE_INVALID")
    if not normalized_content or len(normalized_content) > CONTENT_MAX_LENGTH:
        raise ApiError(400, "NOTICE_CONTENT_INVALID")
    notice = ReleaseNotice(
        title=normalized_title,
        content=normalized_content,
        published_at=datetime.now(UTC),
    )
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return notice


def _get_notice(db: Session, notice_id: int) -> ReleaseNotice:
    notice = db.get(ReleaseNotice, notice_id)
    if notice is None:
        raise ApiError(404, "NOTICE_NOT_FOUND")
    return notice


def admin_revoke(db: Session, notice_id: int) -> ReleaseNotice:
    notice = _get_notice(db, notice_id)
    if notice.revoked_at is None:
        notice.revoked_at = datetime.now(UTC)
        db.commit()
        db.refresh(notice)
    return notice


def admin_restore(db: Session, notice_id: int) -> ReleaseNotice:
    notice = _get_notice(db, notice_id)
    if notice.revoked_at is not None:
        notice.revoked_at = None
        db.commit()
        db.refresh(notice)
    return notice
