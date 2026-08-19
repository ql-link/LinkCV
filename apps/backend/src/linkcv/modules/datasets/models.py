from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base


def unsigned_bigint_type():
    return (
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite")
    )


def timestamp_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


class UserDataset(Base):
    __tablename__ = "user_dataset"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_user_dataset"),
        UniqueConstraint("object_name", name="uk_user_dataset_object_name"),
        UniqueConstraint("parse_task_id", name="uk_user_dataset_parse_task_id"),
        CheckConstraint(
            "file_format IN ('docx', 'pdf', 'md', 'txt')",
            name="ck_user_dataset_file_format",
        ),
        {"comment": "用户知识库数据集"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="数据集自增主键"
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey("users.id", name="fk_user_dataset_user", ondelete="RESTRICT"),
        nullable=False,
        comment="所属用户 ID",
    )
    parse_task_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        nullable=True,
        comment="关联的解析任务标识，无数据库外键约束",
    )
    file_name: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="原始上传文件名（已安全化）"
    )
    file_format: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="文件格式：docx/pdf/md/txt",
    )
    content_type: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="上传声明的 MIME 类型"
    )
    file_size: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, comment="文件大小（字节）"
    )
    object_name: Mapped[str] = mapped_column(
        String(512), nullable=False, comment="对象存储对象键"
    )
    sha256: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="文件内容 SHA-256 十六进制摘要"
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )


Index(
    "idx_user_dataset_user_created",
    UserDataset.user_id,
    UserDataset.created_at.desc(),
)
