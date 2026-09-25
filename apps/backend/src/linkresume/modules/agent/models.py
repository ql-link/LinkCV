from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
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


UNSIGNED_BIGINT = (
    BigInteger()
    .with_variant(Integer(), "sqlite")
    .with_variant(mysql.BIGINT(unsigned=True), "mysql")
)
TIMESTAMP = DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")


class AgentSession(Base):
    __tablename__ = "agent_sessions"
    __table_args__ = (
        UniqueConstraint("public_id", name="uk_agent_sessions_public_id"),
        CheckConstraint(
            "status IN ('active', 'archived')", name="ck_agent_sessions_status"
        ),
        Index(
            "idx_agent_sessions_user_pinned_updated",
            "user_id",
            "pinned",
            "updated_at",
            "id",
        ),
        {"comment": "用户智能助手会话"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT, primary_key=True, autoincrement=True
    )
    public_id: Mapped[str] = mapped_column(String(36), nullable=False)
    user_id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    pi_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    pinned: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
        comment="是否置顶",
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    last_message_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AgentRun(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (
        UniqueConstraint("public_id", name="uk_agent_runs_public_id"),
        UniqueConstraint(
            "session_id", "idempotency_key", name="uk_agent_runs_session_idempotency"
        ),
        CheckConstraint(
            "status IN ('running', 'succeeded', 'failed', 'cancelled')",
            name="ck_agent_runs_status",
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="ck_agent_runs_input_tokens_nonnegative",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="ck_agent_runs_output_tokens_nonnegative",
        ),
        CheckConstraint(
            "estimated_cost IS NULL OR estimated_cost >= 0",
            name="ck_agent_runs_cost_nonnegative",
        ),
        Index("idx_agent_runs_session_created", "session_id", "created_at", "id"),
        Index("idx_agent_runs_status_updated", "status", "updated_at", "id"),
        Index("idx_agent_runs_created", "created_at", "id"),
        {"comment": "智能助手单次运行"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT, primary_key=True, autoincrement=True
    )
    public_id: Mapped[str] = mapped_column(String(36), nullable=False)
    session_id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    model_config_id: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    model_config_version: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT, nullable=True
    )
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    estimated_cost: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AgentOperation(Base):
    __tablename__ = "agent_operations"
    __table_args__ = (
        UniqueConstraint("public_id", name="uk_agent_operations_public_id"),
        CheckConstraint(
            "state IN ('preflighting', 'failed', 'run_created')",
            name="ck_agent_operations_state",
        ),
        Index("idx_agent_operations_state_created", "state", "created_at", "id"),
        Index("idx_agent_operations_created", "created_at", "id"),
        Index("idx_agent_operations_session", "session_id", "id"),
        {"comment": "智能助手消息操作排障摘要"},
    )

    id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(36), nullable=False)
    session_id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey("agent_sessions.id", ondelete="RESTRICT", name="fk_agent_operations_session"),
        nullable=False,
    )
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_stage: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now()
    )


class AgentStageEvent(Base):
    __tablename__ = "agent_stage_events"
    __table_args__ = (
        UniqueConstraint(
            "agent_operation_id", "event_key", name="uk_agent_stage_events_operation_key"
        ),
        CheckConstraint(
            "result IN ('started', 'succeeded', 'failed', 'cancelled')",
            name="ck_agent_stage_events_result",
        ),
        Index(
            "idx_agent_stage_events_operation_time",
            "agent_operation_id", "occurred_at", "id",
        ),
        {"comment": "智能助手安全阶段事件"},
    )

    id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, primary_key=True, autoincrement=True)
    agent_operation_id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey("agent_operations.id", ondelete="CASCADE", name="fk_agent_stage_events_operation"),
        nullable=False,
    )
    event_key: Mapped[str] = mapped_column(String(160), nullable=False)
    stage: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    tool_call_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    proposal_id: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now()
    )


class AgentMessage(Base):
    __tablename__ = "agent_messages"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "sequence_no", name="uk_agent_messages_session_sequence"
        ),
        CheckConstraint("role IN ('user', 'assistant')", name="ck_agent_messages_role"),
        CheckConstraint(
            "message_type IN ('text', 'clarification')",
            name="ck_agent_messages_message_type",
        ),
        Index("idx_agent_messages_session_created", "session_id", "created_at", "id"),
        {"comment": "智能助手对话消息"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT, primary_key=True, autoincrement=True
    )
    session_id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    run_id: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    sequence_no: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    message_type: Mapped[str] = mapped_column(
        String(24), nullable=False, default="text", server_default="text"
    )
    content: Mapped[str] = mapped_column(
        Text().with_variant(mysql.MEDIUMTEXT(), "mysql"), nullable=False
    )
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now()
    )


class AgentToolCall(Base):
    __tablename__ = "agent_tool_calls"
    __table_args__ = (
        UniqueConstraint("run_id", "call_key", name="uk_agent_tool_calls_run_key"),
        CheckConstraint(
            "status IN ('running', 'succeeded', 'failed', 'cancelled')",
            name="ck_agent_tool_calls_status",
        ),
        Index("idx_agent_tool_calls_run_created", "run_id", "created_at", "id"),
        Index("idx_agent_tool_calls_tool_created", "tool_name", "created_at", "id"),
        {"comment": "受控智能助手工具调用审计"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT, primary_key=True, autoincrement=True
    )
    run_id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    call_key: Mapped[str] = mapped_column(String(128), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ResumeChangeProposal(Base):
    __tablename__ = "resume_change_proposals"
    __table_args__ = (
        UniqueConstraint("public_id", name="uk_resume_change_proposals_public_id"),
        UniqueConstraint(
            "run_id", "call_key", name="uk_resume_change_proposals_run_call_key"
        ),
        CheckConstraint(
            "status IN ('pending', 'applied', 'rejected', 'expired', 'conflicted')",
            name="ck_resume_change_proposals_status",
        ),
        CheckConstraint(
            "proposal_mode IN ('legacy_snapshot', 'polish_local', "
            "'rewrite_entry_star', 'generate_from_materials', 'translate_resume')",
            name="ck_resume_change_proposals_mode",
        ),
        CheckConstraint(
            "(proposal_mode = 'translate_resume' AND "
            "((status = 'applied' AND result_resume_id IS NOT NULL) OR "
            "(status <> 'applied' AND result_resume_id IS NULL))) OR "
            "(proposal_mode <> 'translate_resume' AND proposed_title IS NULL "
            "AND result_resume_id IS NULL)",
            name="ck_resume_change_proposals_translation_result",
        ),
        CheckConstraint(
            "base_lock_version >= 1 AND "
            "(applied_lock_version IS NULL OR applied_lock_version >= base_lock_version)",
            name="ck_resume_change_proposals_lock_versions",
        ),
        Index(
            "idx_resume_change_proposals_user_created", "user_id", "created_at", "id"
        ),
        Index(
            "idx_resume_change_proposals_resume_status_created",
            "resume_id",
            "status",
            "created_at",
            "id",
        ),
        Index(
            "idx_resume_change_proposals_pending_expiry",
            "status",
            "expires_at",
            "id",
        ),
        {"comment": "用户确认前的简历修改提案"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT, primary_key=True, autoincrement=True
    )
    public_id: Mapped[str] = mapped_column(String(36), nullable=False)
    run_id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    call_key: Mapped[str] = mapped_column(String(128), nullable=False)
    resume_id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    user_id: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    base_lock_version: Mapped[int] = mapped_column(UNSIGNED_BIGINT, nullable=False)
    proposed_data_json: Mapped[dict[str, Any] | None] = mapped_column(JSON(), nullable=True)
    proposed_style_json: Mapped[dict[str, Any] | None] = mapped_column(JSON(), nullable=True)
    preview_json: Mapped[dict[str, Any] | None] = mapped_column(JSON(), nullable=True)
    summary: Mapped[str] = mapped_column(Text(), nullable=False)
    proposal_mode: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="legacy_snapshot",
        comment="提案模式：旧快照、局部润色、经历整体优化、资料生成或整篇翻译",
    )
    target_locator_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="稳定目标定位；旧快照提案为空"
    )
    target_content_hash: Mapped[str | None] = mapped_column(
        String(71), nullable=True, comment="目标内容 SHA-256 前置条件，含算法前缀"
    )
    diagnosis_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(), nullable=True, comment="创建范围化提案所依据的结构化诊断"
    )
    operations_json: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON(), nullable=True, comment="后端已验证的类型化修改操作"
    )
    rationale_json: Mapped[list[dict[str, str]] | None] = mapped_column(
        JSON(), nullable=True, comment="面向用户的逐项修改依据；旧提案为空"
    )
    source_refs_json: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON(), nullable=True, comment="提案引用的职位或资料来源；旧提案为空"
    )
    proposed_title: Mapped[str | None] = mapped_column(
        String(255), nullable=True, comment="翻译结果的新简历标题"
    )
    result_resume_id: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT, nullable=True, comment="翻译确认后创建的简历标识"
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    applied_lock_version: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT, nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP, nullable=False, server_default=func.now(), onupdate=func.now()
    )
