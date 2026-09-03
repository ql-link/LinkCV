from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    desc,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base
from linkcv.modules.job_descriptions.models import ascii_char, timestamp_type


def unsigned_bigint_type():
    return (
        BigInteger()
        .with_variant(mysql.BIGINT(unsigned=True), "mysql")
        .with_variant(Integer(), "sqlite")
    )


def unsigned_int_type():
    return Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql")


def unsigned_smallint_type():
    return SmallInteger().with_variant(mysql.SMALLINT(unsigned=True), "mysql")


def unsigned_tinyint_type():
    return SmallInteger().with_variant(mysql.TINYINT(unsigned=True), "mysql")


long_text_type = Text().with_variant(mysql.LONGTEXT(), "mysql")


class JobApplication(Base):
    __tablename__ = "job_applications"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_job_applications"),
        CheckConstraint(
            "LENGTH(TRIM(company_name_snapshot)) > 0 AND "
            "LENGTH(TRIM(job_title_snapshot)) > 0 AND "
            "LENGTH(TRIM(current_stage_label)) > 0",
            name="ck_job_applications_snapshots_not_blank",
        ),
        CheckConstraint(
            "LOWER(JSON_TYPE(job_snapshot)) = 'object'",
            name="ck_job_applications_job_snapshot_object",
        ),
        CheckConstraint(
            "calendar_color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray')",
            name="ck_job_applications_calendar_color",
        ),
        CheckConstraint(
            "current_stage_type IN ('screening', 'interview', 'hr', 'offer')",
            name="ck_job_applications_stage_type",
        ),
        CheckConstraint(
            "(current_stage_type = 'interview' AND current_round_no >= 1) OR "
            "(current_stage_type <> 'interview' AND current_round_no IS NULL)",
            name="ck_job_applications_round_context",
        ),
        CheckConstraint(
            "stage_state IN ('awaiting_schedule', 'scheduled', 'awaiting_result', 'negotiating')",
            name="ck_job_applications_stage_state",
        ),
        CheckConstraint(
            "status IN ('active', 'rejected', 'withdrawn', 'closed')",
            name="ck_job_applications_status",
        ),
        CheckConstraint(
            "offer_status IN ('none', 'received', 'accepted', 'declined')",
            name="ck_job_applications_offer_status",
        ),
        CheckConstraint(
            "offer_salary_period IS NULL OR "
            "offer_salary_period IN ('hour', 'day', 'month', 'year')",
            name="ck_job_applications_offer_salary_period",
        ),
        CheckConstraint(
            "offer_salary IS NULL OR "
            "(offer_salary_currency IS NOT NULL AND offer_salary_period IS NOT NULL)",
            name="ck_job_applications_offer_salary_context",
        ),
        CheckConstraint(
            "offer_salary_currency IS NULL OR LENGTH(offer_salary_currency) = 3",
            name="ck_job_applications_offer_salary_currency",
        ),
        CheckConstraint(
            "is_favorite IN (0, 1)", name="ck_job_applications_is_favorite"
        ),
        CheckConstraint("lock_version >= 1", name="ck_job_applications_lock_version"),
        Index(
            "idx_job_applications_user_scope_updated",
            "user_id",
            "archived_at",
            "status",
            desc("updated_at"),
            desc("id"),
        ),
        Index(
            "idx_job_applications_user_stage",
            "user_id",
            "archived_at",
            "status",
            "current_stage_type",
            "current_round_no",
            "stage_state",
        ),
        Index(
            "idx_job_applications_user_offer",
            "user_id",
            "archived_at",
            "offer_status",
        ),
        Index("idx_job_applications_job_description", "job_description_id"),
        Index("idx_job_applications_resume_version", "resume_version_id"),
        {"comment": "用户一次完整求职尝试", "sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey("users.id", name="fk_job_applications_user", ondelete="RESTRICT"),
        nullable=False,
    )
    job_description_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "job_descriptions.id",
            name="fk_job_applications_job_description",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    resume_version_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "resume_versions.id",
            name="fk_job_applications_resume_version",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    company_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    job_title_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    job_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON(), nullable=False)
    resume_title_snapshot: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    calendar_color: Mapped[str] = mapped_column(String(16), nullable=False)
    current_stage_type: Mapped[str] = mapped_column(String(24), nullable=False)
    current_round_no: Mapped[int | None] = mapped_column(
        unsigned_smallint_type(), nullable=True
    )
    current_stage_label: Mapped[str] = mapped_column(String(100), nullable=False)
    stage_state: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    offer_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="none"
    )
    offer_base_location: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )
    offer_salary: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    offer_salary_currency: Mapped[str | None] = mapped_column(
        ascii_char(3), nullable=True
    )
    offer_salary_period: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )
    offer_benefits_description: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )
    is_favorite: Mapped[int] = mapped_column(
        unsigned_tinyint_type(), nullable=False, default=0
    )
    applied_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True
    )
    lock_version: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, default=1
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="pk_interview_sessions"),
        UniqueConstraint(
            "application_id",
            "client_request_id",
            name="uk_interview_sessions_application_request",
        ),
        CheckConstraint(
            "stage_type IN ('interview', 'hr', 'offer', 'other')",
            name="ck_interview_sessions_stage_type",
        ),
        CheckConstraint(
            "(stage_type = 'interview' AND round_no >= 1) OR "
            "(stage_type <> 'interview' AND round_no IS NULL)",
            name="ck_interview_sessions_stage_context",
        ),
        CheckConstraint(
            "status IN ('scheduled', 'completed', 'cancelled')",
            name="ck_interview_sessions_status",
        ),
        CheckConstraint(
            "round_result IN ('pending', 'passed', 'rejected')",
            name="ck_interview_sessions_round_result",
        ),
        CheckConstraint("end_at > start_at", name="ck_interview_sessions_time_range"),
        CheckConstraint(
            "mode IN ('video', 'onsite', 'phone', 'other')",
            name="ck_interview_sessions_mode",
        ),
        CheckConstraint(
            "(status = 'scheduled' AND completed_at IS NULL AND cancelled_at IS NULL) OR "
            "(status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL) OR "
            "(status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL "
            "AND round_result = 'pending')",
            name="ck_interview_sessions_lifecycle",
        ),
        CheckConstraint(
            "reminder_minutes IS NULL OR reminder_minutes <= 10080",
            name="ck_interview_sessions_reminder_minutes",
        ),
        CheckConstraint("lock_version >= 1", name="ck_interview_sessions_lock_version"),
        Index(
            "idx_interview_sessions_application_time",
            "application_id",
            "start_at",
            "end_at",
            "id",
        ),
        Index(
            "idx_interview_sessions_application_status_time",
            "application_id",
            "status",
            "start_at",
            "id",
        ),
        Index(
            "idx_interview_sessions_application_completed",
            "application_id",
            "status",
            desc("completed_at"),
            desc("id"),
        ),
        {"comment": "排期与复盘共用的单场面试", "sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(unsigned_bigint_type(), autoincrement=True)
    application_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "job_applications.id",
            name="fk_interview_sessions_application",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    client_request_id: Mapped[str] = mapped_column(ascii_char(36), nullable=False)
    stage_type: Mapped[str] = mapped_column(String(24), nullable=False)
    round_no: Mapped[int | None] = mapped_column(
        unsigned_smallint_type(), nullable=True
    )
    stage_label: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="scheduled")
    round_result: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending"
    )
    start_at: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False)
    end_at: Mapped[datetime] = mapped_column(timestamp_type(), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    mode: Mapped[str] = mapped_column(String(24), nullable=False)
    meeting_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    interviewer_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    interviewer_title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reminder_minutes: Mapped[int | None] = mapped_column(
        unsigned_smallint_type(), nullable=True
    )
    preparation_note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    questions_markdown: Mapped[str | None] = mapped_column(
        long_text_type, nullable=True
    )
    review_summary: Mapped[str | None] = mapped_column(long_text_type, nullable=True)
    improvement_markdown: Mapped[str | None] = mapped_column(
        long_text_type, nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True
    )
    cancellation_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    lock_version: Mapped[int] = mapped_column(
        unsigned_int_type(), nullable=False, default=1
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now()
    )


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
