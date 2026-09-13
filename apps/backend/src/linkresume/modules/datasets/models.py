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

from linkresume.core.database import Base


def unsigned_bigint_type():
    return (
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite")
    )


def timestamp_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


class UserDatasetFolder(Base):
    __tablename__ = "user_dataset_folders"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_user_dataset_folders"),
        UniqueConstraint(
            "user_id",
            "name",
            name="uk_user_dataset_folders_user_name",
        ),
        {"comment": "用户资料分类文件夹"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="文件夹自增主键"
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "users.id", name="fk_user_dataset_folders_user", ondelete="RESTRICT"
        ),
        nullable=False,
        comment="所属用户 ID",
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False, comment="文件夹名称")
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="更新时间（UTC）",
    )


class UserDataset(Base):
    __tablename__ = "user_dataset"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_user_dataset"),
        UniqueConstraint("object_name", name="uk_user_dataset_object_name"),
        UniqueConstraint("parse_task_id", name="uk_user_dataset_parse_task_id"),
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uk_user_dataset_user_idempotency",
        ),
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
    folder_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "user_dataset_folders.id",
            name="fk_user_dataset_folder",
            ondelete="SET NULL",
        ),
        nullable=True,
        comment="所属文件夹 ID，为 NULL 表示未分类",
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="用户范围内上传幂等键"
    )
    request_fingerprint: Mapped[str] = mapped_column(
        String(64).with_variant(mysql.CHAR(64), "mysql"),
        nullable=False,
        comment="规范化文件名、检测格式、大小和 SHA-256 的请求指纹",
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
        String(128), nullable=False, comment="服务端规范化内容类型"
    )
    file_size: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, comment="文件大小（字节）"
    )
    object_name: Mapped[str] = mapped_column(
        String(512), nullable=False, comment="对象存储对象键"
    )
    sha256: Mapped[str] = mapped_column(
        String(64).with_variant(mysql.CHAR(64), "mysql"),
        nullable=False,
        comment="文件内容 SHA-256 十六进制摘要",
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )

    content_revision: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, default=0, server_default="0"
    )
    content_object_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content_sha256: Mapped[str | None] = mapped_column(
        String(64).with_variant(mysql.CHAR(64), "mysql"), nullable=True
    )
    content_updated_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True
    )
    last_content_request_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )


class DatasetReplacement(Base):
    __tablename__ = "dataset_replacements"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_dataset_replacements"),
        UniqueConstraint(
            "user_id", "idempotency_key", name="uk_dataset_replacements_user_request"
        ),
        UniqueConstraint("active_dataset_id", name="uk_dataset_replacements_active"),
        UniqueConstraint("parse_task_id", name="uk_dataset_replacements_task"),
        CheckConstraint(
            "status IN ('pending','failed','conflict','applied','discarded')",
            name="ck_dataset_replacements_status",
        ),
        CheckConstraint(
            "(status IN ('pending','failed','conflict') AND active_dataset_id IS NOT NULL AND active_dataset_id = dataset_id) OR (status IN ('applied','discarded') AND active_dataset_id IS NULL)",
            name="ck_dataset_replacements_active",
        ),
        Index("idx_dataset_replacements_target", "dataset_id", "created_at"),
        Index("idx_dataset_replacements_cleanup", "status", "updated_at"),
    )
    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "users.id", name="fk_dataset_replacements_user", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    dataset_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "user_dataset.id",
            name="fk_dataset_replacements_dataset",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    parse_task_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(), nullable=True
    )
    source_content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    source_file_size: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False
    )
    source_sha256: Mapped[str] = mapped_column(
        String(64).with_variant(mysql.CHAR(64), "mysql"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(
        String(64).with_variant(mysql.CHAR(64), "mysql"), nullable=False
    )
    base_revision: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    active_dataset_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(), nullable=True
    )
    last_retry_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class DatasetObjectCleanup(Base):
    __tablename__ = "dataset_object_cleanup"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_dataset_object_cleanup"),
        UniqueConstraint("object_name", name="uk_dataset_object_cleanup_object"),
        Index("idx_dataset_object_cleanup_due", "not_before", "id"),
    )
    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True)
    user_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False)
    object_name: Mapped[str] = mapped_column(String(512), nullable=False)
    parse_task_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(), nullable=True
    )
    not_before: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False)
    attempt_count: Mapped[int] = mapped_column(
        Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql"),
        nullable=False,
        default=0,
        server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )


Index(
    "idx_user_dataset_folders_user_created",
    UserDatasetFolder.user_id,
    UserDatasetFolder.created_at.desc(),
)


Index(
    "idx_user_dataset_user_created",
    UserDataset.user_id,
    UserDataset.created_at.desc(),
)

Index(
    "idx_user_dataset_user_folder",
    UserDataset.user_id,
    UserDataset.folder_id,
    UserDataset.created_at.desc(),
)
