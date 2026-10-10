"""Site-wide in-app announcements and each user's read-through time."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from drawoffer.core.database import Base

ID = BigInteger().with_variant(Integer(), "sqlite").with_variant(
    mysql.BIGINT(unsigned=True), "mysql"
)
TIME = DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")

LEVELS = ("normal", "important")
STATUSES = ("draft", "published", "unpublished")


class Announcement(Base):
    __tablename__ = "announcement"
    __table_args__ = (
        CheckConstraint("level IN ('normal', 'important')", name="ck_announcement_level"),
        CheckConstraint(
            "status IN ('draft', 'published', 'unpublished')", name="ck_announcement_status"
        ),
        CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ck_announcement_window",
        ),
        CheckConstraint(
            "(status = 'draft' AND published_at IS NULL AND published_by IS NULL"
            " AND unpublished_at IS NULL AND unpublished_by IS NULL)"
            " OR (status = 'published' AND published_at IS NOT NULL AND published_by IS NOT NULL"
            " AND unpublished_at IS NULL AND unpublished_by IS NULL)"
            " OR (status = 'unpublished' AND published_at IS NOT NULL AND published_by IS NOT NULL"
            " AND unpublished_at IS NOT NULL AND unpublished_by IS NOT NULL)",
            name="ck_announcement_state_fields",
        ),
        Index("idx_announcement_status_published", "status", "published_at", "id"),
        {"comment": "全站应用内公告"},
    )

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    level: Mapped[str] = mapped_column(
        String(16), nullable=False, default="normal", server_default="normal"
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft"
    )
    starts_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    unpublished_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ID,
        nullable=False,
    )
    updated_by: Mapped[int] = mapped_column(
        ID,
        nullable=False,
    )
    published_by: Mapped[int | None] = mapped_column(
        ID,
        nullable=True,
    )
    unpublished_by: Mapped[int | None] = mapped_column(
        ID,
        nullable=True,
    )
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(
        TIME, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AnnouncementReadCursor(Base):
    """One row per user: announcements shown at or before ``read_through_at`` count as read."""

    __tablename__ = "announcement_read_cursor"
    __table_args__ = (
        UniqueConstraint("user_id", name="uk_announcement_read_cursor_user_id"),
        {"comment": "用户公告已读时间点，每个用户至多一行"},
    )

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ID,
        nullable=False,
    )
    read_through_at: Mapped[datetime] = mapped_column(TIME, nullable=False)
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(
        TIME, nullable=False, server_default=func.now(), onupdate=func.now()
    )
