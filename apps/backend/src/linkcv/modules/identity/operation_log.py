"""AdminOperationLog model for audit trail of admin actions."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base


class AdminOperationLog(Base):
    __tablename__ = "admin_operation_logs"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_admin_operation_logs"),
        CheckConstraint("action IN ('disable', 'enable')", name="ck_admin_op_logs_action"),
        {"comment": "管理员操作审计日志"},
    )

    id: Mapped[int] = mapped_column(
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite"),
        autoincrement=True,
        comment="操作日志自增主键",
    )
    actor_user_id: Mapped[int] = mapped_column(
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite"),
        ForeignKey("users.id", name="fk_admin_op_logs_actor", ondelete="RESTRICT"),
        nullable=False,
        comment="操作人用户 ID",
    )
    target_user_id: Mapped[int] = mapped_column(
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite"),
        ForeignKey("users.id", name="fk_admin_op_logs_target", ondelete="RESTRICT"),
        nullable=False,
        comment="被操作目标用户 ID",
    )
    action: Mapped[str] = mapped_column(
        String(32), nullable=False, comment="操作类型：disable 或 enable"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="操作时间（UTC）",
    )
