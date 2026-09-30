"""Product funnel events: whether and when a user reached a step, never what they wrote."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkresume.core.database import Base

ID = BigInteger().with_variant(Integer(), "sqlite").with_variant(
    mysql.BIGINT(unsigned=True), "mysql"
)
TIME = DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")

EVENT_NAMES = (
    "user_registered",
    "resume_created",
    "ai_customization_applied",
    "mock_interview_completed",
    "resume_pdf_exported",
)


class ProductEvent(Base):
    __tablename__ = "product_events"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uk_product_events_dedupe"),
        CheckConstraint(
            "event_name IN ('user_registered', 'resume_created', 'ai_customization_applied',"
            " 'mock_interview_completed', 'resume_pdf_exported')",
            name="ck_product_events_name",
        ),
        Index("idx_product_events_name_time", "event_name", "occurred_at"),
        Index("idx_product_events_user_name", "user_id", "event_name"),
        {"comment": "产品漏斗事件，只记录行为是否发生、时间与入口"},
    )

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ID,
        ForeignKey("users.id", name="fk_product_events_user", ondelete="CASCADE"),
        nullable=False,
    )
    event_name: Mapped[str] = mapped_column(String(32), nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(
        String(96).with_variant(mysql.VARCHAR(96, charset="ascii", collation="ascii_bin"), "mysql"),
        nullable=True,
    )
    properties_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(TIME, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
