from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, JSON, String, Text, func
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base


class Resume(Base):
    __tablename__ = "resumes"
    __table_args__ = (
        Index("idx_resumes_user_updated", "user_id", "updated_at"),
        CheckConstraint("split_ratio > 0", name="ck_resumes_split_ratio_positive"),
        CheckConstraint(
            "preview_scale > 0",
            name="ck_resumes_preview_scale_positive",
        ),
    )

    id: Mapped[str] = mapped_column(String(39), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(37),
        ForeignKey(
            "users.id",
            name="fk_resumes_user_id_users",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    markdown: Mapped[str] = mapped_column(
        Text().with_variant(mysql.LONGTEXT(), "mysql"),
        nullable=False,
    )
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    split_ratio: Mapped[float] = mapped_column(
        Float().with_variant(mysql.DOUBLE(), "mysql"),
        nullable=False,
        default=0.4,
    )
    preview_scale: Mapped[float] = mapped_column(
        Float().with_variant(mysql.DOUBLE(), "mysql"),
        nullable=False,
        default=1.0,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
