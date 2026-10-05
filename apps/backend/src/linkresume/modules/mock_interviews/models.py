from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkresume.core.database import Base
from linkresume.modules.interviews.models import (
    unsigned_bigint_type,
    unsigned_int_type,
    unsigned_smallint_type,
    unsigned_tinyint_type,
)
from linkresume.modules.job_descriptions.models import (
    ascii_char,
    ascii_varchar,
    timestamp_type,
)

MOCK_INTERVIEW_ACTIVE_STATUSES = ("preparing", "in_progress", "evaluating")


def _medium_text():
    return Text().with_variant(mysql.MEDIUMTEXT(), "mysql")


class MockInterview(Base):
    __tablename__ = "mock_interviews"
    __table_args__ = (
        UniqueConstraint("public_id", name="uk_mock_interviews_public_id"),
        UniqueConstraint("active_user_id", name="uk_mock_interviews_active_user"),
        CheckConstraint(
            "source_type IN ('job_application', 'resume')",
            name="ck_mock_interviews_source_type",
        ),
        CheckConstraint(
            "interview_type IN ('technical', 'project_deep_dive', "
            "'hr', 'comprehensive')",
            name="ck_mock_interviews_type",
        ),
        CheckConstraint(
            "difficulty IN ('junior', 'intermediate', 'senior')",
            name="ck_mock_interviews_difficulty",
        ),
        CheckConstraint(
            "question_count BETWEEN 3 AND 10", name="ck_mock_interviews_question_count"
        ),
        CheckConstraint("language IN ('zh', 'en')", name="ck_mock_interviews_language"),
        CheckConstraint(
            "answer_mode IN ('text', 'voice')", name="ck_mock_interviews_answer_mode"
        ),
        CheckConstraint(
            "status IN ('preparing', 'preparation_failed', 'in_progress', 'evaluating', "
            "'evaluation_failed', 'completed', 'abandoned')",
            name="ck_mock_interviews_status",
        ),
        CheckConstraint(
            "total_score IS NULL OR (total_score >= 0 AND total_score <= 100)",
            name="ck_mock_interviews_score",
        ),
        CheckConstraint("lock_version >= 1", name="ck_mock_interviews_lock_version"),
        Index("idx_mock_interviews_user_created", "user_id", "created_at", "id"),
        Index("idx_mock_interviews_application", "job_application_id"),
        Index("idx_mock_interviews_resume", "resume_id"),
        Index("idx_mock_interviews_job", "job_description_id"),
        Index("idx_mock_interviews_repeat_of", "repeat_of_id"),
        {"comment": "AI 模拟面试", "sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), primary_key=True, autoincrement=True
    )
    public_id: Mapped[str] = mapped_column(ascii_char(36), nullable=False)
    user_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey("users.id", name="fk_mock_interviews_user", ondelete="RESTRICT"),
        nullable=False,
    )
    active_user_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        nullable=True,
        comment="进行中时等于 user_id，用于单用户并发唯一约束",
    )
    source_type: Mapped[str] = mapped_column(
        String(24), nullable=False, comment="发起来源：job_application/resume"
    )
    job_application_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "job_applications.id",
            name="fk_mock_interviews_application",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    resume_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey("resumes.id", name="fk_mock_interviews_resume", ondelete="SET NULL"),
        nullable=True,
    )
    job_description_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "job_descriptions.id", name="fk_mock_interviews_job", ondelete="SET NULL"
        ),
        nullable=True,
    )
    repeat_of_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "mock_interviews.id", name="fk_mock_interviews_repeat_of", ondelete="SET NULL"
        ),
        nullable=True,
        comment="再练一次的来源面试",
    )
    resume_title_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    resume_markdown_snapshot: Mapped[str] = mapped_column(_medium_text(), nullable=False)
    job_snapshot_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="公司、职位、JD 正文与求职分类快照"
    )
    stage_snapshot_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="发起时的求职阶段快照"
    )
    target_role: Mapped[str | None] = mapped_column(String(200), nullable=True)
    interview_type: Mapped[str] = mapped_column(String(24), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(16), nullable=False)
    question_count: Mapped[int] = mapped_column(unsigned_tinyint_type(), nullable=False)
    follow_up_enabled: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, default=True, server_default="1"
    )
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    answer_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="text", server_default="text",
        comment="作答方式：text/voice",
    )
    speech_snapshot_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="语音识别与合成线路快照"
    )
    hotwords_json: Mapped[list[str] | None] = mapped_column(
        JSON(), nullable=True, comment="本场语音识别热词表"
    )
    transcript_corrected_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True, comment="整场 AI 修正识别稿的执行时间"
    )
    recordings_deleted_at: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True, comment="本场录音被删除的时间"
    )
    materials_in_questions: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, default=False, server_default="0",
        comment="出题是否参考所选资料；false 时资料只用于报告核验",
    )
    material_refs_json: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON(), nullable=True, comment="参考资料 ID 与发起时正文版本"
    )
    analysis_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="背景分析结果"
    )
    plan_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="定稿考察点计划"
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    current_question_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(), nullable=True
    )
    task_lease_until: Mapped[datetime | None] = mapped_column(
        timestamp_type(), nullable=True, comment="后台准备或评估任务租约到期时间"
    )
    task_token: Mapped[str | None] = mapped_column(
        ascii_char(32), nullable=True, comment="当前持有租约的后台任务标识"
    )
    started_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    total_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    low_confidence: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, default=False, server_default="0"
    )
    report_json: Mapped[dict[str, Any] | None] = mapped_column(JSON(), nullable=True)
    rubric_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_tokens: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, default=0, server_default="0"
    )
    output_tokens: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, default=0, server_default="0"
    )
    lock_version: Mapped[int] = mapped_column(
        unsigned_bigint_type(), nullable=False, default=1, server_default="1"
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class MockInterviewQuestion(Base):
    __tablename__ = "mock_interview_questions"
    __table_args__ = (
        UniqueConstraint(
            "interview_id", "sequence_no", name="uk_mock_interview_questions_sequence"
        ),
        CheckConstraint(
            "depth_level BETWEEN 1 AND 5", name="ck_mock_interview_questions_depth"
        ),
        CheckConstraint(
            "answer_status IN ('pending', 'answered', 'skipped')",
            name="ck_mock_interview_questions_answer_status",
        ),
        CheckConstraint(
            "(answer_status = 'pending' AND answer_text IS NULL AND answered_at IS NULL) OR "
            "(answer_status = 'answered' AND answer_text IS NOT NULL "
            "AND answered_at IS NOT NULL) OR "
            "(answer_status = 'skipped' AND answer_text IS NULL AND answered_at IS NOT NULL)",
            name="ck_mock_interview_questions_answer",
        ),
        CheckConstraint(
            "answer_source IS NULL OR answer_source IN ('text', 'voice_input', 'voice')",
            name="ck_mock_interview_questions_answer_source",
        ),
        CheckConstraint(
            "transcript_state IS NULL OR transcript_state IN "
            "('original', 'corrected', 'correction_rejected', 'edited')",
            name="ck_mock_interview_questions_transcript_state",
        ),
        Index("idx_mock_interview_questions_parent", "parent_id"),
        {"comment": "模拟面试的提问与作答", "sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(
        unsigned_bigint_type(), primary_key=True, autoincrement=True
    )
    interview_id: Mapped[int] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "mock_interviews.id",
            name="fk_mock_interview_questions_interview",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    parent_id: Mapped[int | None] = mapped_column(
        unsigned_bigint_type(),
        ForeignKey(
            "mock_interview_questions.id",
            name="fk_mock_interview_questions_parent",
            ondelete="CASCADE",
        ),
        nullable=True,
        comment="追问指向的主问题",
    )
    sequence_no: Mapped[int] = mapped_column(
        unsigned_smallint_type(), nullable=False, comment="整场对话内的提问顺序"
    )
    plan_index: Mapped[int] = mapped_column(
        unsigned_tinyint_type(), nullable=False, comment="对应面试计划中的考察点序号"
    )
    depth_level: Mapped[int] = mapped_column(unsigned_tinyint_type(), nullable=False)
    content: Mapped[str] = mapped_column(Text(), nullable=False)
    answer_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    answer_text: Mapped[str | None] = mapped_column(Text(), nullable=True)
    answer_idempotency_key: Mapped[str | None] = mapped_column(
        ascii_varchar(64), nullable=True
    )
    answered_at: Mapped[datetime | None] = mapped_column(timestamp_type(), nullable=True)
    answer_source: Mapped[str | None] = mapped_column(
        String(16), nullable=True, comment="作答来源：text/voice_input/voice"
    )
    recording_object_name: Mapped[str | None] = mapped_column(
        String(512), nullable=True, comment="录音对象 key"
    )
    audio_duration_ms: Mapped[int | None] = mapped_column(
        unsigned_int_type(), nullable=True, comment="录音时长（毫秒）"
    )
    raw_transcript: Mapped[str | None] = mapped_column(Text(), nullable=True, comment="原始识别稿")
    words_json: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON(), nullable=True, comment="带时间戳的分词结果"
    )
    corrected_transcript: Mapped[str | None] = mapped_column(
        Text(), nullable=True, comment="AI 修正稿"
    )
    correction_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="AI 修正记录"
    )
    transcript_state: Mapped[str | None] = mapped_column(
        String(24), nullable=True, comment="识别稿状态"
    )
    manual_edit_count: Mapped[int] = mapped_column(
        unsigned_tinyint_type(), nullable=False, default=0, server_default="0",
        comment="手动修改次数",
    )
    re_evaluate_count: Mapped[int] = mapped_column(
        unsigned_tinyint_type(), nullable=False, default=0, server_default="0",
        comment="单题重新评估次数",
    )
    evaluation_history_json: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON(), nullable=True, comment="历史评估结果与所用文本版本"
    )
    evaluation_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="主问题的逐题评价"
    )
    created_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        timestamp_type(), nullable=False, server_default=func.now(), onupdate=func.now()
    )
