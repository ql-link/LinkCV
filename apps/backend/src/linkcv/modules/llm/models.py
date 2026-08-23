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
ASCII_CAPABILITY = String(32).with_variant(
    mysql.VARCHAR(32, charset="ascii", collation="ascii_bin"), "mysql"
)
ASCII_ADAPTER = String(64).with_variant(
    mysql.VARCHAR(64, charset="ascii", collation="ascii_bin"), "mysql"
)
ASCII_SOURCE = String(32).with_variant(
    mysql.VARCHAR(32, charset="ascii", collation="ascii_bin"), "mysql"
)


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
        CheckConstraint(
            "(adapter IS NULL AND model_call_name IS NULL) OR "
            "(adapter IS NOT NULL AND model_call_name IS NOT NULL "
            "AND length(trim(adapter)) > 0 "
            "AND length(trim(model_call_name)) > 0 "
            "AND length(adapter) + 1 + length(model_call_name) <= 128)",
            name="ck_llm_model_configs_adapter_pair",
        ),
        CheckConstraint(
            "config_version >= 1",
            name="ck_llm_model_configs_config_version",
        ),
        {"comment": "能力中立的模型连接配置"},
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
    adapter: Mapped[str | None] = mapped_column(
        ASCII_ADAPTER,
        nullable=True,
        comment="LiteLLM adapter 标识",
    )
    model_call_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="不含 adapter 前缀的模型调用名",
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
    config_version: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        nullable=False,
        default=1,
        server_default="1",
        comment="模型候选乐观锁版本",
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

    def __init__(self, **kwargs: object) -> None:
        # Older tests/integrations may still pass the pre-contract capability
        # keyword. It is intentionally ignored after the 0025 contract.
        kwargs.pop("capability", None)
        super().__init__(**kwargs)


class LLMCapabilityBinding(Base):
    __tablename__ = "llm_capability_bindings"
    __table_args__ = (
        Index("idx_llm_capability_bindings_model", "model_config_id", "capability"),
        CheckConstraint(
            "capability IN ('chat', 'resume_structuring', 'pi_agent')",
            name="ck_llm_capability_bindings_capability",
        ),
        CheckConstraint(
            "binding_version >= 1",
            name="ck_llm_capability_bindings_version",
        ),
        {"comment": "系统模型能力到唯一当前候选的低基数绑定"},
    )

    capability: Mapped[str] = mapped_column(
        ASCII_CAPABILITY,
        primary_key=True,
        comment="系统模型能力标识",
    )
    model_config_id: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "llm_model_configs.id",
            name="fk_llm_capability_bindings_model",
            ondelete="RESTRICT",
        ),
        nullable=True,
        comment="当前候选模型配置主键，空表示未配置",
    )
    binding_version: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        nullable=False,
        default=1,
        server_default="1",
        comment="能力绑定乐观锁版本",
    )
    validation_id: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "llm_model_validations.id",
            name="fk_llm_capability_bindings_validation",
            ondelete="RESTRICT",
        ),
        nullable=True,
        comment="最近一次成功验证证据主键，存量 Chat 可为空",
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
        Index(
            "idx_llm_call_logs_model_source_created",
            "model_config_id",
            "source",
            "created_at",
            "id",
        ),
        CheckConstraint(
            "length(trim(source)) > 0",
            name="ck_llm_call_logs_source_not_blank",
        ),
        CheckConstraint(
            "(adapter IS NULL AND model_call_name IS NULL) OR "
            "(adapter IS NOT NULL AND model_call_name IS NOT NULL "
            "AND length(trim(adapter)) > 0 "
            "AND length(trim(model_call_name)) > 0)",
            name="ck_llm_call_logs_adapter_pair",
        ),
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
        CheckConstraint(
            "model_config_version IS NULL OR model_config_version >= 1",
            name="ck_llm_call_logs_model_config_version",
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
    capability: Mapped[str] = mapped_column(
        ASCII_CAPABILITY,
        nullable=False,
        default="chat",
        server_default="chat",
        comment="实际模型能力快照",
    )
    source: Mapped[str] = mapped_column(
        ASCII_SOURCE,
        nullable=False,
        default="connection_test",
        server_default="connection_test",
        comment="稳定调用来源代码",
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
    model_config_version: Mapped[int | None] = mapped_column(
        UNSIGNED_BIGINT,
        nullable=True,
        comment="实际模型配置版本快照，未选中模型时为空",
    )
    model_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="实际模型标识快照",
    )
    adapter: Mapped[str | None] = mapped_column(
        ASCII_ADAPTER,
        nullable=True,
        comment="实际 LiteLLM adapter 快照",
    )
    model_call_name: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        comment="实际模型调用名快照",
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


class LLMModelValidation(Base):
    __tablename__ = "llm_model_validations"
    __table_args__ = (
        UniqueConstraint("call_id", name="uk_llm_model_validations_call_id"),
        Index(
            "idx_llm_model_validations_latest",
            "model_config_id",
            "capability",
            "config_version",
            "created_at",
            "id",
        ),
        CheckConstraint(
            "capability IN ('chat', 'resume_structuring', 'pi_agent')",
            name="ck_llm_model_validations_capability",
        ),
        CheckConstraint(
            "status IN ('succeeded', 'failed', 'cancelled')",
            name="ck_llm_model_validations_status",
        ),
        CheckConstraint(
            "config_version >= 1 AND probe_version >= 1",
            name="ck_llm_model_validations_versions",
        ),
        {"comment": "模型配置按能力和版本保存的验证证据"},
    )

    id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        primary_key=True,
        autoincrement=True,
        comment="模型验证主键",
    )
    model_config_id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "llm_model_configs.id",
            name="fk_llm_model_validations_model",
            ondelete="RESTRICT",
        ),
        nullable=False,
        comment="被验证候选主键",
    )
    config_version: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        nullable=False,
        comment="被验证候选版本",
    )
    capability: Mapped[str] = mapped_column(
        ASCII_CAPABILITY,
        nullable=False,
        comment="目标模型能力",
    )
    probe_version: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        nullable=False,
        comment="验证探针版本",
    )
    runtime_version: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="执行组件版本"
    )
    call_id: Mapped[str] = mapped_column(
        String(40),
        ForeignKey(
            "llm_call_logs.call_id",
            name="fk_llm_model_validations_call",
            ondelete="RESTRICT",
        ),
        nullable=False,
        comment="对应逻辑调用标识",
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, comment="验证状态"
    )
    error_code: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="非敏感稳定错误码"
    )
    created_by_user_id: Mapped[int] = mapped_column(
        UNSIGNED_BIGINT,
        ForeignKey(
            "users.id",
            name="fk_llm_model_validations_creator",
            ondelete="RESTRICT",
        ),
        nullable=False,
        comment="发起验证的管理员主键",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql"),
        nullable=False,
        server_default=func.now(),
        comment="创建时间（UTC）",
    )
