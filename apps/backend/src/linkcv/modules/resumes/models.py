from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base

RESUME_IMPORT_SOURCE_TYPE = "resume_import"
DATASET_SOURCE_TYPE = "dataset"


def unsigned_bigint_type():
    return (
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite")
    )


def unsigned_int_type():
    return Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql")


def unsigned_tinyint_type():
    return SmallInteger().with_variant(mysql.TINYINT(unsigned=True), "mysql")


def timestamp_type():
    return DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


class ResumeTemplate(Base):
    __tablename__ = "resume_templates"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_resume_templates"),
        UniqueConstraint("key", name="uk_resume_templates_key"),
        CheckConstraint("is_active IN (0, 1)", name="ck_resume_templates_is_active"),
        {"comment": "简历模板"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="模板自增主键"
    )
    key: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="规范化稳定标识"
    )
    name: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="模板展示名称"
    )
    description: Mapped[str | None] = mapped_column(
        Text(), nullable=True, comment="模板说明"
    )
    data_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="ResumeDocument 初始内容"
    )
    style_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="ResumePresentation 默认样式"
    )
    is_active: Mapped[int] = mapped_column(
        unsigned_tinyint_type(),
        nullable=False,
        default=1,
        comment="模板状态：0 停用，1 启用",
    )
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
        comment="最后更新时间（UTC）",
    )


class Resume(Base):
    __tablename__ = "resumes"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_resumes"),
        CheckConstraint(
            "source_type IN ('blank', 'template', 'import')",
            name="ck_resumes_source_type",
        ),
        CheckConstraint(
            "LENGTH(TRIM(title)) > 0",
            name="ck_resumes_title_not_blank",
        ),
        CheckConstraint("lock_version >= 1", name="ck_resumes_lock_version"),
        UniqueConstraint("parse_task_id", name="uk_resumes_parse_task_id"),
        UniqueConstraint("share_token", name="uk_resumes_share_token"),
        CheckConstraint(
            "(share_token IS NULL AND share_visibility IS NULL AND share_created_at IS NULL) "
            "OR (share_token IS NOT NULL AND share_visibility IS NOT NULL "
            "AND share_created_at IS NOT NULL)",
            name="ck_resumes_share_fields",
        ),
        CheckConstraint(
            "share_visibility IS NULL OR share_visibility IN ('private', 'public')",
            name="ck_resumes_share_visibility",
        ),
        {"comment": "用户简历当前版本"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="简历自增主键"
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey("users.id", name="fk_resumes_user", ondelete="RESTRICT"),
        nullable=False,
        comment="简历所有者",
    )
    template_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "resume_templates.id",
            name="fk_resumes_template",
            ondelete="RESTRICT",
        ),
        nullable=False,
        comment="当前绑定模板",
    )
    parse_task_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        nullable=True,
        comment="来源解析任务标识，无数据库外键约束",
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, comment="简历标题")
    data_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="当前 ResumeDocument 内容"
    )
    style_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="当前 ResumePresentation 样式"
    )
    lock_version: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, default=1, comment="乐观锁版本"
    )
    source_type: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="blank",
        comment="来源类型：blank、template 或 import",
    )
    share_token: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="分享链接 token，全局唯一，NULL 表示未分享"
    )
    share_visibility: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
        comment="分享可见性：private 仅自己可见 / public 所有人可见",
    )
    share_expires_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(),
        nullable=True,
        comment="分享过期时间（UTC），NULL 表示长期有效",
    )
    share_created_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True, comment="分享创建时间（UTC）"
    )
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
        comment="最后更新时间（UTC）",
    )


Index(
    "idx_resumes_user_updated_id",
    Resume.user_id,
    Resume.updated_at.desc(),
    Resume.id.desc(),
)
Index("idx_resumes_template_id", Resume.template_id)


class DocumentParseTask(Base):
    __tablename__ = "document_parse_tasks"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_document_parse_tasks"),
        CheckConstraint(
            "source_type IN ('resume_import', 'dataset')",
            name="ck_document_parse_tasks_source_type",
        ),
        CheckConstraint(
            "file_format IN ('md', 'docx', 'pdf', 'txt')",
            name="ck_document_parse_tasks_file_format",
        ),
        CheckConstraint(
            "upload_status IN ('uploading', 'succeeded', 'failed')",
            name="ck_document_parse_tasks_upload_status",
        ),
        CheckConstraint(
            "parse_status IS NULL OR "
            "parse_status IN ('queued', 'processing', 'succeeded', 'failed')",
            name="ck_document_parse_tasks_parse_status",
        ),
        CheckConstraint(
            "(upload_status = 'uploading' "
            "AND upload_duration_ms IS NULL "
            "AND parse_status IS NULL "
            "AND parse_duration_ms IS NULL) OR "
            "(upload_status = 'failed' "
            "AND upload_duration_ms IS NOT NULL "
            "AND parse_status IS NULL "
            "AND parse_duration_ms IS NULL) OR "
            "(upload_status = 'succeeded' "
            "AND upload_duration_ms IS NOT NULL "
            "AND parse_status = 'queued' "
            "AND parse_duration_ms IS NULL) OR "
            "(upload_status = 'succeeded' "
            "AND upload_duration_ms IS NOT NULL "
            "AND parse_status = 'processing' "
            "AND parse_duration_ms IS NULL) OR "
            "(upload_status = 'succeeded' "
            "AND upload_duration_ms IS NOT NULL "
            "AND parse_status = 'failed' "
            "AND parse_duration_ms IS NOT NULL) OR "
            "(upload_status = 'succeeded' "
            "AND upload_duration_ms IS NOT NULL "
            "AND parse_status = 'succeeded' "
            "AND parse_duration_ms IS NOT NULL)",
            name="ck_document_parse_tasks_lifecycle",
        ),
        {"comment": "通用文档上传解析任务"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="解析任务标识"
    )
    source_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="任务来源：resume_import、dataset",
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "users.id",
            name="fk_document_parse_tasks_user",
            ondelete="RESTRICT",
        ),
        nullable=False,
        comment="所属用户标识",
    )
    file_name: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="安全化后的用户源文件名"
    )
    file_format: Mapped[str] = mapped_column(
        String(8), nullable=False, comment="源文件格式：md、txt、docx、pdf"
    )
    object_name: Mapped[str] = mapped_column(
        String(512), nullable=False, comment="私有对象存储中的源文件对象键"
    )
    selected_template_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "resume_templates.id",
            name="fk_document_parse_tasks_selected_template",
            ondelete="RESTRICT",
        ),
        nullable=True,
        comment="简历导入冻结模板；Dataset 任务为空",
    )
    selected_template_style_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(),
        nullable=True,
        comment="简历导入受理时冻结的 TemplateDefinition；Dataset 任务为空",
    )
    source_graph_object_name: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="私有 SourceGraph 对象键",
    )
    converted_object_name: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="转换后 Markdown 在对象存储中的对象键",
    )
    upload_status: Mapped[str] = mapped_column(
        String(16), nullable=False, comment="上传状态：uploading、succeeded、failed"
    )
    upload_duration_ms: Mapped[int | None] = mapped_column(
        unsigned_int_type(), nullable=True, comment="上传进入终态时的实际耗时毫秒"
    )
    parse_status: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
        comment="解析状态：queued、processing、succeeded、failed",
    )
    parse_duration_ms: Mapped[int | None] = mapped_column(
        unsigned_int_type(), nullable=True, comment="解析进入终态时的实际耗时毫秒"
    )
    parse_attempt_count: Mapped[int] = mapped_column(
        unsigned_int_type(),
        nullable=False,
        default=0,
        server_default="0",
        comment="实际开始解析的累计次数，同时作为尝试版本",
    )
    last_dispatched_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(),
        nullable=True,
        comment="最近一次确认消息发布的时间（UTC）",
    )
    failure_reason: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="解析失败分类原因"
    )
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
        comment="最后更新时间（UTC）",
    )


Index(
    "idx_document_parse_tasks_user_created_id",
    DocumentParseTask.user_id,
    DocumentParseTask.created_at.desc(),
    DocumentParseTask.id.desc(),
)
Index(
    "idx_document_parse_tasks_user_state",
    DocumentParseTask.user_id,
    DocumentParseTask.upload_status,
    DocumentParseTask.parse_status,
)
Index(
    "idx_document_parse_tasks_dispatch",
    DocumentParseTask.source_type,
    DocumentParseTask.parse_status,
    DocumentParseTask.last_dispatched_at,
    DocumentParseTask.id,
)
Index(
    "idx_document_parse_tasks_selected_template",
    DocumentParseTask.selected_template_id,
)


class ResumeVersion(Base):
    __tablename__ = "resume_versions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_resume_versions"),
        UniqueConstraint("resume_id", "version_no", name="uk_resume_versions_no"),
        CheckConstraint("version_no >= 1", name="ck_resume_versions_no"),
        CheckConstraint(
            "reason IN ('initial', 'manual', 'before_restore', 'restore', 'agent')",
            name="ck_resume_versions_reason",
        ),
        {"comment": "不可变简历历史快照"},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), autoincrement=True, comment="版本快照自增主键"
    )
    resume_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "resumes.id",
            name="fk_resume_versions_resume",
            ondelete="CASCADE",
        ),
        nullable=False,
        comment="所属简历",
    )
    template_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "resume_templates.id",
            name="fk_resume_versions_template",
            ondelete="RESTRICT",
        ),
        nullable=False,
        comment="版本使用的模板身份",
    )
    version_no: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, comment="简历内单调递增版本号"
    )
    data_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="ResumeDocument 内容快照"
    )
    style_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="ResumePresentation 样式快照"
    )
    reason: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="创建原因：initial、manual、before_restore 或 restore",
    )
    name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        comment="正式版本名称",
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        comment="快照创建时间（UTC）",
    )


Index("idx_resume_versions_template_id", ResumeVersion.template_id)
