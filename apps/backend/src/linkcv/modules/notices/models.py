from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base


class ReleaseNotice(Base):
    __tablename__ = "release_notices"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_release_notices"),
        CheckConstraint("LENGTH(TRIM(title)) > 0", name="ck_release_notices_title_not_blank"),
        CheckConstraint("LENGTH(TRIM(content)) > 0", name="ck_release_notices_content_not_blank"),
        Index("idx_release_notices_published", "published_at", "id"),
        {"comment": "版本更新通知"},
    )

    id: Mapped[int] = mapped_column(
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite"),
        autoincrement=True,
        comment="更新通知自增主键",
    )
    title: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="通知标题"
    )
    content: Mapped[str] = mapped_column(
        Text(), nullable=False, comment="通知正文（受限 Markdown）"
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        comment="发布时间 UTC，用于排序与未读比较",
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=True,
        comment="下架时间 UTC；NULL 表示已发布",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="创建时间 UTC",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间 UTC",
    )
