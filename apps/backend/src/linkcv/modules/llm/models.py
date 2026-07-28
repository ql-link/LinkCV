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
        comment="模型配置主键",
    )
    model_name: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        comment="LiteLLM 模型标识",
    )
    api_base: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="模型服务基础地址",
    )
    encrypted_api_key: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="版本化加密凭据，禁止保存明文",
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
        comment="是否启用模型配置",
    )
    priority: Mapped[int] = mapped_column(
        UNSIGNED_SMALLINT,
        nullable=False,
        default=100,
        server_default="100",
        comment="调用优先级，数值越小越优先",
    )
    input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8),
        nullable=True,
        comment="每百万输入令牌的美元价格",
    )
    output_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8),
        nullable=True,
        comment="每百万输出令牌的美元价格",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="最后更新时间（UTC）",
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
        comment="调用日志主键",
    )
    call_id: Mapped[str] = mapped_column(
        String(40), nullable=False, comment="逻辑调用唯一标识"
    )
    user_id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "users.id",
            name="fk_llm_call_logs_user_id_users",
            ondelete="RESTRICT",
        ),
        nullable=False,
        comment="发起调用的用户主键",
    )
    model_config_id: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "llm_model_configs.id",
            name="fk_llm_call_logs_model_config_id_llm_model_configs",
            ondelete="RESTRICT",
        ),
        nullable=True,
        comment="实际使用的模型配置主键，未选中模型时为空",
    )
    model_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="实际模型标识快照",
    )
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="pending",
        server_default="pending",
        comment=(
            "调用状态：pending（待处理）、succeeded（成功）、"
            "failed（失败）、cancelled（已取消）"
        ),
    )
    metering_status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="unknown",
        server_default="unknown",
        comment="计量状态：complete（完整）、partial（部分）、unknown（未知）",
    )
    input_tokens: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT, nullable=True, comment="输入令牌数量"
    )
    output_tokens: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT, nullable=True, comment="输出令牌数量"
    )
    input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8), nullable=True, comment="每百万输入令牌的美元价格快照"
    )
    output_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8), nullable=True, comment="每百万输出令牌的美元价格快照"
    )
    estimated_cost: Mapped[Decimal | None] = mapped_column(
        Numeric(20, 10),
        nullable=True,
        comment="预估调用成本（美元）",
    )
    latency_ms: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT, nullable=True, comment="调用耗时（毫秒）"
    )
    error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="非敏感稳定错误码",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="调用创建时间（UTC）",
    )
