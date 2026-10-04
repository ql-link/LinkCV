"""Announcement lifecycle, visibility and per-user read-through time.

Visibility is derived from the persisted status and the current time; there is no
scheduled job. Every consumer (user list, unread count) goes through ``active_filter``
so they cannot disagree.

Read state is one timestamp per user: an active announcement is unread when it was
shown after the user's ``read_through_at``. "Shown" is the later of the scheduled start
and the publish time, so a draft scheduled in the past and published later still
counts as new.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, case, func, or_, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkresume.core.errors import ApiError
from linkresume.modules.announcements.models import Announcement, AnnouncementReadCursor
from linkresume.modules.identity.models import User
from linkresume.modules.identity.dependencies import lock_active_user

NOT_FOUND = "ANNOUNCEMENT_NOT_FOUND"
STATE_CONFLICT = "ANNOUNCEMENT_STATE_CONFLICT"
WINDOW_INVALID = "ANNOUNCEMENT_WINDOW_INVALID"
CURSOR_INVALID = "INVALID_ANNOUNCEMENT_QUERY"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def effective_start(row: Announcement) -> datetime | None:
    return _aware(row.starts_at) or _aware(row.published_at)


def visibility(row: Announcement, now: datetime) -> str:
    if row.status != "published":
        return row.status
    start = effective_start(row)
    end = _aware(row.ends_at)
    if start is not None and now < start:
        return "scheduled"
    if end is not None and now >= end:
        return "expired"
    return "active"


def shown_at():
    """SQL expression for when an announcement first became visible to users."""
    return case(
        (
            and_(
                Announcement.starts_at.is_not(None),
                Announcement.starts_at > Announcement.published_at,
            ),
            Announcement.starts_at,
        ),
        else_=Announcement.published_at,
    )


def active_filter(now: datetime):
    """SQL predicate equivalent to ``visibility(row, now) == 'active'``."""
    start = func.coalesce(Announcement.starts_at, Announcement.published_at)
    return and_(
        Announcement.status == "published",
        start <= now,
        or_(Announcement.ends_at.is_(None), Announcement.ends_at > now),
    )


def scheduled_filter(now: datetime):
    """SQL predicate equivalent to ``visibility(row, now) == 'scheduled'``."""
    start = func.coalesce(Announcement.starts_at, Announcement.published_at)
    return and_(Announcement.status == "published", start > now)


def validate_window(starts_at: datetime | None, ends_at: datetime | None) -> None:
    starts_at, ends_at = _aware(starts_at), _aware(ends_at)
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise ApiError(422, WINDOW_INVALID)


def _get(db: Session, announcement_id: int) -> Announcement:
    row = db.get(Announcement, announcement_id)
    if row is None:
        raise ApiError(404, NOT_FOUND)
    return row


# --- admin writes -----------------------------------------------------------


def create(db: Session, admin: User, fields: dict) -> Announcement:
    validate_window(fields.get("starts_at"), fields.get("ends_at"))
    row = Announcement(**fields, status="draft", created_by=admin.id, updated_by=admin.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_draft(db: Session, admin: User, announcement_id: int, fields: dict) -> Announcement:
    row = _get(db, announcement_id)
    if row.status != "draft":
        raise ApiError(409, STATE_CONFLICT)
    starts_at = fields["starts_at"] if "starts_at" in fields else row.starts_at
    ends_at = fields["ends_at"] if "ends_at" in fields else row.ends_at
    validate_window(starts_at, ends_at)
    for key, value in fields.items():
        setattr(row, key, value)
    row.updated_by = admin.id
    db.commit()
    db.refresh(row)
    return row


def delete_draft(db: Session, announcement_id: int) -> None:
    row = _get(db, announcement_id)
    if row.status != "draft":
        raise ApiError(409, STATE_CONFLICT)
    db.delete(row)
    db.commit()


def _transition(
    db: Session, announcement_id: int, expected: str, values: dict
) -> bool:
    """Conditional update so concurrent requests change state at most once."""
    result = db.execute(
        update(Announcement)
        .where(Announcement.id == announcement_id, Announcement.status == expected)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return result.rowcount == 1


def publish(db: Session, admin: User, announcement_id: int, now: datetime | None = None) -> Announcement:
    now = now or utcnow()
    row = _get(db, announcement_id)
    if row.status != "draft":
        raise ApiError(409, STATE_CONFLICT)
    ends_at = _aware(row.ends_at)
    if ends_at is not None and ends_at <= now:
        raise ApiError(422, WINDOW_INVALID)
    changed = _transition(
        db,
        announcement_id,
        "draft",
        {"status": "published", "published_at": now, "published_by": admin.id,
         "updated_by": admin.id},
    )
    if not changed:
        raise ApiError(409, STATE_CONFLICT)
    db.expire_all()
    return _get(db, announcement_id)


def unpublish(db: Session, admin: User, announcement_id: int, now: datetime | None = None) -> Announcement:
    now = now or utcnow()
    row = _get(db, announcement_id)
    if row.status == "unpublished":
        return row
    if row.status != "published":
        raise ApiError(409, STATE_CONFLICT)
    changed = _transition(
        db,
        announcement_id,
        "published",
        {"status": "unpublished", "unpublished_at": now, "unpublished_by": admin.id,
         "updated_by": admin.id},
    )
    db.expire_all()
    row = _get(db, announcement_id)
    if not changed and row.status != "unpublished":
        raise ApiError(409, STATE_CONFLICT)
    return row


# --- admin reads ------------------------------------------------------------


def encode_cursor(row_id: int) -> str:
    return base64.urlsafe_b64encode(str(row_id).encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        if not raw.isdigit():
            raise ValueError
        value = int(raw)
        if value < 1:
            raise ValueError
        return value
    except (ValueError, UnicodeDecodeError, binascii.Error) as error:
        raise ApiError(400, CURSOR_INVALID) from error


def list_admin(
    db: Session, status: str | None, cursor: str | None, limit: int
) -> tuple[list[Announcement], str | None]:
    query = select(Announcement)
    if status is not None:
        query = query.where(Announcement.status == status)
    if cursor is not None:
        query = query.where(Announcement.id < decode_cursor(cursor))
    rows = list(db.scalars(query.order_by(Announcement.id.desc()).limit(limit + 1)))
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].id) if len(rows) > limit else None
    return page, next_cursor


@dataclass(frozen=True)
class Stats:
    draft: int
    published: int
    unpublished: int
    active: int
    scheduled: int


def stats(db: Session, now: datetime | None = None) -> Stats:
    now = now or utcnow()
    by_status = dict(db.execute(
        select(Announcement.status, func.count()).group_by(Announcement.status)
    ).all())
    active = db.scalar(select(func.count(Announcement.id)).where(active_filter(now))) or 0
    scheduled = db.scalar(select(func.count(Announcement.id)).where(scheduled_filter(now))) or 0
    return Stats(
        draft=by_status.get("draft", 0),
        published=by_status.get("published", 0),
        unpublished=by_status.get("unpublished", 0),
        active=active,
        scheduled=scheduled,
    )


# --- user side --------------------------------------------------------------


def read_through(db: Session, user: User) -> datetime | None:
    return _aware(db.scalar(
        select(AnnouncementReadCursor.read_through_at).where(
            AnnouncementReadCursor.user_id == user.id
        )
    ))


def _unread_filter(cursor: datetime | None):
    # Users who never opened the bell have no row, so every active announcement is unread.
    return shown_at() > cursor if cursor is not None else true()


def _shown(row: Announcement) -> datetime:
    start, published = _aware(row.starts_at), _aware(row.published_at)
    return max(start, published) if start is not None else published


def list_active(db: Session, user: User, now: datetime | None = None) -> list[tuple[Announcement, bool]]:
    now = now or utcnow()
    cursor = read_through(db, user)
    importance = (Announcement.level == "important").desc()
    rows = db.scalars(
        select(Announcement)
        .where(active_filter(now))
        .order_by(importance, shown_at().desc(), Announcement.id.desc())
    ).all()
    return [(row, cursor is not None and _shown(row) <= cursor) for row in rows]


def unread_count(db: Session, user: User, now: datetime | None = None) -> int:
    now = now or utcnow()
    cursor = read_through(db, user)
    return db.scalar(
        select(func.count(Announcement.id)).where(active_filter(now), _unread_filter(cursor))
    ) or 0


def mark_all_read(db: Session, user: User, now: datetime | None = None) -> int:
    """Move the user's read-through time to ``now``; it never moves backwards."""
    user = lock_active_user(db, user.id)
    now = now or utcnow()
    moved = db.execute(
        update(AnnouncementReadCursor)
        .where(
            AnnouncementReadCursor.user_id == user.id,
            AnnouncementReadCursor.read_through_at < now,
        )
        .values(read_through_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount
    if not moved and read_through(db, user) is None:
        try:
            with db.begin_nested():
                db.add(AnnouncementReadCursor(user_id=user.id, read_through_at=now))
        except IntegrityError:
            # A concurrent request created the row first; its time is equally valid.
            pass
    db.commit()
    return unread_count(db, user, now)
