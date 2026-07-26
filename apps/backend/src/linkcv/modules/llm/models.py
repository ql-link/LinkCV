from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column

from linkcv.core.database import Base

UNSIGNED_BIGINT = BigInteger().with_variant(Integer(), "sqlite").with_variant(
    mysql.BIGINT(unsigned=True), "mysql"
)
UNSIGNED_SMALLINT = Integer().with_variant(mysql.SMALLINT(unsigned=True), "mysql")


class LLMModelConfig(Base):
    __tablename__ = "llm_model_configs"
    __table_args__ = (
        Index(
            "idx_llm_model_configs_enabled_priority",
            "enabled",
            "priority",
            "id",
        ),
        CheckConstraint(
            "input_price_per_million IS NULL OR input_price_per_million >= 0",
            name="ck_llm_model_configs_input_price_nonnegative",
        ),
        CheckConstraint(
            "output_price_per_million IS NULL OR output_price_per_million >= 0",
            name="ck_llm_model_configs_output_price_nonnegative",
        ),
        {"comment": "大模型连接、优先级与可选价格配置"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        primary_key=True,
        autoincrement=True,
    )
    model_name: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        comment="LiteLLM 模型标识",
    )
    api_base: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="自定义模型服务地址",
    )
    encrypted_api_key: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="版本化加密凭据，不保存明文",
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
    )
    priority: Mapped[int] = mapped_column(
        UNSIGNED_SMALLINT,
        nullable=False,
        default=100,
        server_default="100",
    )
    input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8),
        nullable=True,
        comment="USD/百万输入 Token",
    )
    output_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8),
        nullable=True,
        comment="USD/百万输出 Token",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class LLMCallLog(Base):
    __tablename__ = "llm_call_logs"
    __table_args__ = (
        UniqueConstraint("call_id", name="uk_llm_call_logs_call_id"),
        Index("idx_llm_call_logs_created", "created_at", "id"),
        Index("idx_llm_call_logs_user_created", "user_id", "created_at", "id"),
        Index(
            "idx_llm_call_logs_model_created",
            "model_config_id",
            "created_at",
            "id",
        ),
        Index("idx_llm_call_logs_status_created", "status", "created_at", "id"),
        CheckConstraint(
            "status IN ('pending', 'succeeded', 'failed', 'cancelled')",
            name="ck_llm_call_logs_status",
        ),
        CheckConstraint(
            "metering_status IN ('complete', 'partial', 'unknown')",
            name="ck_llm_call_logs_metering_status",
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="ck_llm_call_logs_input_tokens_nonnegative",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="ck_llm_call_logs_output_tokens_nonnegative",
        ),
        CheckConstraint(
            "input_price_per_million IS NULL OR input_price_per_million >= 0",
            name="ck_llm_call_logs_input_price_nonnegative",
        ),
        CheckConstraint(
            "output_price_per_million IS NULL OR output_price_per_million >= 0",
            name="ck_llm_call_logs_output_price_nonnegative",
        ),
        CheckConstraint(
            "estimated_cost IS NULL OR estimated_cost >= 0",
            name="ck_llm_call_logs_estimated_cost_nonnegative",
        ),
        CheckConstraint(
            "latency_ms IS NULL OR latency_ms >= 0",
            name="ck_llm_call_logs_latency_nonnegative",
        ),
        {"comment": "大模型逻辑调用的状态、计量与成本快照"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        primary_key=True,
        autoincrement=True,
    )
    call_id: Mapped[str] = mapped_column(String(40), nullable=False)
    user_id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "users.id",
            name="fk_llm_call_logs_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    model_config_id: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "llm_model_configs.id",
            name="fk_llm_call_logs_model_config_id_llm_model_configs",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
    model_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="调用时实际模型快照",
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="pending",
        server_default="pending",
        comment="pending/succeeded/failed/cancelled",
    )
    metering_status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="unknown",
        server_default="unknown",
        comment="complete/partial/unknown",
    )
    input_tokens: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8), nullable=True
    )
    output_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8), nullable=True
    )
    estimated_cost: Mapped[Decimal | None] = mapped_column(
        Numeric(20, 10),
        nullable=True,
        comment="USD 估算成本",
    )
    latency_ms: Mapped[int | None] = mapped_column(UNSIGNED_BIGINT, nullable=True)
    error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="非敏感稳定错误分类",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
    )
