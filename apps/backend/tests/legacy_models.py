"""Historical schemas used only by pre-retirement migration tests."""
from datetime import datetime
from typing import Any
from sqlalchemy import CheckConstraint, ForeignKey, Index, JSON, PrimaryKeyConstraint, String, UniqueConstraint, desc, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from linkresume.core.database import Base as RuntimeBase
from linkresume.modules.resumes.models import unsigned_bigint_type, unsigned_int_type, timestamp_type
from linkresume.modules.job_descriptions.models import ascii_char

class Base(DeclarativeBase):
    pass

# Resolve historical foreign keys without registering retired tables in runtime metadata.
for table in RuntimeBase.metadata.sorted_tables:
    table.to_metadata(Base.metadata)

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


class InterviewAsset(Base):
    __tablename__ = "interview_assets"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_interview_assets"),
        UniqueConstraint("object_name", name="uk_interview_assets_object_name"),
        CheckConstraint(
            "source_type IN ('recorded', 'uploaded')",
            name="ck_interview_assets_source_type",
        ),
        CheckConstraint(
            "asset_type IN ('audio', 'video', 'document')",
            name="ck_interview_assets_asset_type",
        ),
        CheckConstraint("file_size > 0", name="ck_interview_assets_file_size"),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms > 0",
            name="ck_interview_assets_duration_ms",
        ),
        CheckConstraint(
            "sha256 IS NULL OR LENGTH(sha256) = 64",
            name="ck_interview_assets_sha256",
        ),
        Index(
            "idx_interview_assets_session_created",
            "interview_session_id",
            desc("created_at"),
            desc("id"),
        ),
        {"comment": "面试录音、视频与文档素材", "sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True)
    interview_session_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "interview_sessions.id",
            name="fk_interview_assets_session",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(String(24), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(24), nullable=False)
    original_file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size: Mapped[int] = mapped_column(unsigned_bigint_type(), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(), nullable=True
    )
    object_name: Mapped[str] = mapped_column(String(512), nullable=False)
    sha256: Mapped[str | None] = mapped_column(ascii_char(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
