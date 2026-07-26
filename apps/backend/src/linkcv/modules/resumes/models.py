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
        JSON(), nullable=False, comment="ResumeDocumentV1 初始内容"
    )
    style_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="ResumeStyleV1 默认样式"
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
        CheckConstraint(
            "(source_type = 'blank' AND template_id IS NULL "
            "AND source_filename IS NULL AND source_object_key IS NULL "
            "AND extracted_markdown IS NULL) OR "
            "(source_type = 'template' "
            "AND source_filename IS NULL AND source_object_key IS NULL "
            "AND extracted_markdown IS NULL) OR "
            "(source_type = 'import' AND template_id IS NULL "
            "AND source_filename IS NOT NULL AND source_object_key IS NOT NULL "
            "AND extracted_markdown IS NOT NULL)",
            name="ck_resumes_source_fields",
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
    template_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "resume_templates.id",
            name="fk_resumes_template",
            ondelete="SET NULL",
        ),
        nullable=True,
        comment="创建来源模板",
    )
    title: Mapped[str] = mapped_column(
        String(255), nullable=False, comment="简历标题"
    )
    data_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="当前 ResumeDocumentV1 内容"
    )
    style_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="当前 ResumeStyleV1 样式"
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
    source_filename: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="导入文件原名"
    )
    source_object_key: Mapped[str | None] = mapped_column(
        String(512), nullable=True, comment="私有导入原文件对象键"
    )
    extracted_markdown: Mapped[str | None] = mapped_column(
        Text().with_variant(mysql.LONGTEXT(), "mysql"),
        nullable=True,
        comment="导入解析的中间文本证据",
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


class ResumeVersion(Base):
    __tablename__ = "resume_versions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_resume_versions"),
        UniqueConstraint(
            "resume_id", "version_no", name="uk_resume_versions_no"
        ),
        CheckConstraint("version_no >= 1", name="ck_resume_versions_no"),
        CheckConstraint(
            "reason IN ('initial', 'manual', 'before_restore', 'restore')",
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
    version_no: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, comment="简历内单调递增版本号"
    )
    data_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="ResumeDocumentV1 内容快照"
    )
    style_json: Mapped[dict[str, Any]] = mapped_column(
        JSON(), nullable=False, comment="ResumeStyleV1 样式快照"
    )
    reason: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="创建原因：initial、manual、before_restore 或 restore",
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(),
        nullable=False,
        server_default=func.now(),
        comment="快照创建时间（UTC）",
    )
