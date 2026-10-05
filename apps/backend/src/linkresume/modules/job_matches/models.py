from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Index,
    JSON,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from linkresume.core.database import Base
from linkresume.modules.interviews.models import (
    unsigned_bigint_type,
    unsigned_tinyint_type,
)
from linkresume.modules.job_descriptions.models import ascii_char, timestamp_type


class JobResumeMatch(Base):
    __tablename__ = "job_resume_matches"
    __table_args__ = (
        UniqueConstraint(
            "job_description_id", "resume_id", name="uk_job_resume_matches_job_resume"
        ),
        CheckConstraint(
            "status IN ('pending', 'ready', 'failed')",
            name="ck_job_resume_matches_status",
        ),
        CheckConstraint(
            "source IN ('auto', 'manual')", name="ck_job_resume_matches_source"
        ),
        CheckConstraint(
            "score IS NULL OR score <= 100", name="ck_job_resume_matches_score"
        ),
        CheckConstraint(
            "(status = 'ready') = (score IS NOT NULL AND result_json IS NOT NULL)",
            name="ck_job_resume_matches_ready",
        ),
        Index(
            "idx_job_resume_matches_user_resume_score",
            "user_id",
            "resume_id",
            "status",
            "score",
        ),
        {"comment": "岗位与简历的 AI 匹配分析结果", "sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), primary_key=True, autoincrement=True
    )
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        nullable=False,
    )
    job_description_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        nullable=False,
    )
    resume_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    score: Mapped[int | None] = mapped_column(unsigned_tinyint_type(), nullable=True)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON(), nullable=True)
    jd_hash: Mapped[str] = mapped_column(ascii_char(64), nullable=False)
    resume_hash: Mapped[str] = mapped_column(ascii_char(64), nullable=False)
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    attempts: Mapped[int] = mapped_column(
        unsigned_tinyint_type(), nullable=False, default=0, server_default="0"
    )
    lease_token: Mapped[str | None] = mapped_column(ascii_char(36), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    analyzed_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now()
    )
