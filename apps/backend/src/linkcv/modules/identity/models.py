from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Integer,
    PrimaryKeyConstraint,
    SmallInteger,
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
        PrimaryKeyConstraint("id", name="pk_users"),
        UniqueConstraint("email", name="uk_users_email"),
        CheckConstraint("status IN (0, 1)", name="ck_users_status"),
        CheckConstraint("is_admin IN (0, 1)", name="ck_users_is_admin"),
        {"comment": "用户账号"},
    )

    id: Mapped[int] = mapped_column(
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite"),
        autoincrement=True,
        comment="用户自增主键",
    )
    email: Mapped[str] = mapped_column(
        String(254), nullable=False, comment="规范化后的登录邮箱"
    )
    password_hash: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="密码摘要，不保存明文"
    )
    nickname: Mapped[str] = mapped_column(
        String(50), nullable=False, comment="用户展示昵称"
    )
    avatar_object_key: Mapped[str | None] = mapped_column(
        String(512), nullable=True, comment="私有头像对象键"
    )
    status: Mapped[int] = mapped_column(
        SmallInteger().with_variant(mysql.TINYINT(unsigned=True), "mysql"),
        nullable=False,
        default=1,
        comment="账号状态：0 禁用，1 启用",
    )
    is_admin: Mapped[int] = mapped_column(
        SmallInteger().with_variant(mysql.TINYINT(unsigned=True), "mysql"),
        nullable=False,
        default=0,
        comment="管理员标记：0 否，1 是",
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=True,
        comment="最近一次成功登录时间（UTC）",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间（UTC）",
    )
