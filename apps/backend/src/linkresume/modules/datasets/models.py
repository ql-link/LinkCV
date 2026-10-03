from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkresume.core.database import Base

TRANSCRIPTION_ACTIVE = ("queued", "submitting", "transcribing")


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
        UniqueConstraint(
            "legacy_interview_asset_id",
            name="uk_user_dataset_legacy_asset",
        ),
        CheckConstraint(
            "file_format IN ('docx', 'pdf', 'md', 'txt', 'webm', 'm4a', 'mp3', "
            "'wav', 'ogg', 'mp4', 'mov')",
            name="ck_user_dataset_file_format",
        ),
        CheckConstraint(
            "asset_kind IN ('document', 'audio', 'video')",
            name="ck_user_dataset_asset_kind",
        ),
        CheckConstraint(
            "(asset_kind = 'document' "
            "AND file_format IN ('docx', 'pdf', 'md', 'txt')) OR "
            "(asset_kind IN ('audio', 'video') "
            "AND file_format IN ('webm', 'm4a', 'mp3', 'wav', 'ogg', 'mp4', 'mov'))",
            name="ck_user_dataset_kind_format",
        ),
        CheckConstraint(
            "interview_source_type IS NULL OR "
            "interview_source_type IN ('recorded', 'uploaded')",
            name="ck_user_dataset_interview_context",
        ),
        CheckConstraint(
            "duration_ms IS NULL OR "
            "(asset_kind IN ('audio', 'video') AND duration_ms > 0)",
            name="ck_user_dataset_duration",
        ),
        Index(
            "idx_user_dataset_session_created",
            "interview_session_id",
            "created_at",
            "id",
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
    asset_kind: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="document",
        server_default="document",
        comment="资料种类：document/audio/video",
    )
    interview_session_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "interview_sessions.id",
            name="fk_user_dataset_interview_session",
            ondelete="SET NULL",
        ),
        nullable=True,
        comment="关联面试场次 ID；NULL 为普通资料",
    )
    interview_source_type: Mapped[str | None] = mapped_column(
        String(24),
        nullable=True,
        comment="面试素材来源：recorded/uploaded；NULL 为普通资料",
    )
    duration_ms: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        nullable=True,
        comment="音视频时长毫秒",
    )
    legacy_interview_asset_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        nullable=True,
        comment="迁移来源 interview_assets.id",
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


RAG_SYNC_STATUSES = ("pending", "parsing", "ready", "failed")


class UserDatasetRagSync(Base):
    """Mapping of one dataset to its LinkRag file, written only by the sync loop.

    There is deliberately no foreign key to ``user_dataset``: the row must
    outlive a deleted dataset so the sync loop can delete the RAG copy.
    """

    __tablename__ = "user_dataset_rag_sync"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_user_dataset_rag_sync"),
        UniqueConstraint("dataset_id", name="uk_user_dataset_rag_sync_dataset"),
        CheckConstraint(
            "status IN ('pending', 'parsing', 'ready', 'failed')",
            name="ck_user_dataset_rag_sync_status",
        ),
        Index("idx_user_dataset_rag_sync_status", "status", "next_attempt_at", "id"),
        Index("idx_user_dataset_rag_sync_user", "user_id", "status"),
        {"comment": "资料到 LinkRag 向量索引的同步记录"},
    )

    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True)
    dataset_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False)
    user_id: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    content_revision: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False)
    synced_revision: Mapped[int | None] = mapped_column(unsigned_bigint_type(), nullable=True)
    rag_file_id: Mapped[int | None] = mapped_column(unsigned_bigint_type(), nullable=True)
    attempt_count: Mapped[int] = mapped_column(
        Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql"),
        nullable=False,
        default=0,
        server_default="0",
    )
    last_error: Mapped[str | None] = mapped_column(String(64), nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class DatasetTranscriptionTask(Base):
    __tablename__ = "dataset_transcription_tasks"
    __table_args__ = (
        UniqueConstraint("user_id", "client_request_id", name="uk_transcription_user_request"),
        CheckConstraint("status IN ('queued','submitting','transcribing','ready','failed','cancelled')", name="ck_transcription_status"),
        CheckConstraint("status IN ('queued','submitting','transcribing') OR (lease_token IS NULL AND lease_until IS NULL)", name="ck_transcription_terminal_lease"),
        Index("idx_transcription_dataset", "dataset_id", "id"),
        Index("idx_transcription_poll", "status", "updated_at", "id"),
        Index("idx_transcription_session", "interview_session_id", "status"),
        {"comment": "面试录音异步识别任务及可校对稿件"},
    )
    id: Mapped[int] = mapped_column(unsigned_bigint_type(), primary_key=True, autoincrement=True, comment="任务自增主键")
    user_id: Mapped[int] = mapped_column(unsigned_bigint_type(), ForeignKey("users.id", name="fk_transcription_user", ondelete="RESTRICT"), nullable=False, comment="所属用户")
    dataset_id: Mapped[int] = mapped_column(unsigned_bigint_type(), ForeignKey("user_dataset.id", name="fk_transcription_dataset", ondelete="CASCADE"), nullable=False, comment="原音频资料")
    interview_session_id: Mapped[int | None] = mapped_column(unsigned_bigint_type(), ForeignKey("interview_sessions.id", name="fk_transcription_session", ondelete="SET NULL"), comment="发起时场次")
    client_request_id: Mapped[str] = mapped_column(String(36).with_variant(mysql.CHAR(36, charset="ascii", collation="ascii_bin"), "mysql"), nullable=False, comment="客户端幂等 UUID")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued", server_default="queued", comment="任务状态")
    route_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, comment="非秘密模型线路快照")
    provider_task_id: Mapped[str | None] = mapped_column(String(64), comment="供应商任务标识")
    result_json: Mapped[dict | None] = mapped_column(JSON, comment="版本化文字与句子时间结果")
    error_code: Mapped[str | None] = mapped_column(String(64), comment="脱敏错误码")
    lease_token: Mapped[str | None] = mapped_column(String(36).with_variant(mysql.CHAR(36, charset="ascii", collation="ascii_bin"), "mysql"), comment="后台领取令牌")
    lease_until: Mapped[datetime | None] = mapped_column(timestamp_type(), comment="领取有效时间 UTC")
    created_at: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), comment="创建时间 UTC")
    updated_at: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False, server_default=func.now(), comment="最后处理时间 UTC")
