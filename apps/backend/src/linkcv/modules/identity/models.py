from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uk_users_email"),
        CheckConstraint("status IN (0, 1)", name="ck_users_status"),
        CheckConstraint("is_admin IN (0, 1)", name="ck_users_is_admin"),
    )

    # 聚簇主键由 MySQL 顺序生成;对外与 JWT sub/Redis/HTTP 均使用十进制字符串。
    # SQLite 走 Integer 以支持 AUTOINCREMENT,MySQL 落 BIGINT UNSIGNED,
    # 因此用 Integer 主基类再向 MySQL 变体映射,保证两端自增生效。
    id: Mapped[int] = mapped_column(
        Integer().with_variant(mysql.BIGINT(unsigned=True), "mysql"),
        primary_key=True,
        autoincrement=True,
    )
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    avatar_object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # status: 0 禁用、1 启用。is_admin: 0 普通、1 管理员(V1 平台开关)。
    status: Mapped[int] = mapped_column(
        Integer().with_variant(mysql.TINYINT(unsigned=True), "mysql"),
        nullable=False,
        default=1,
    )
    is_admin: Mapped[int] = mapped_column(
        Integer().with_variant(mysql.TINYINT(unsigned=True), "mysql"),
        nullable=False,
        default=0,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=True,
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
