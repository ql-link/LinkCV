"""Provider connections, logical models, routes, use cases and call accounting."""

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, Index,
    Integer, JSON, Numeric, String, Text, UniqueConstraint, false, func, select, true,
)
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, Session, mapped_column

from linkresume.core.database import Base

ID = BigInteger().with_variant(Integer(), "sqlite").with_variant(
    mysql.BIGINT(unsigned=True), "mysql"
)
TIME = DateTime(timezone=True).with_variant(mysql.DATETIME(fsp=6), "mysql")
COST_MONEY = Numeric(20, 10).with_variant(mysql.DECIMAL(20, 10, unsigned=True), "mysql")
TARGET_ID = String(256).with_variant(
    mysql.VARCHAR(256, collation="utf8mb4_0900_bin"), "mysql"
)


class LLMProviderConnection(Base):
    __tablename__ = "llm_provider_connection"
    __table_args__ = (
        UniqueConstraint("provider_code", "name", name="uk_llm_connections_provider_name"),
        CheckConstraint("runtime_config_version >= 1", name="ck_llm_connections_version"),
        {"comment": "模型接入商的一套独立凭据与连接设置"},
    )

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    provider_code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    credential_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    settings_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    runtime_config_version: Mapped[int] = mapped_column(
        ID, nullable=False, default=1, server_default="1"
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    catalog_state_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    catalog_synced_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(
        TIME, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class LLMModel(Base):
    __tablename__ = "llm_model"
    __table_args__ = ({"comment": "用户选择的稳定逻辑模型"},)

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    developer_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Hidden models stay configured but are excluded from assistant conversation entirely.
    is_user_selectable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(
        TIME, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class LLMModelRoute(Base):
    __tablename__ = "llm_model_route"
    __table_args__ = (
        UniqueConstraint(
            "connection_id", "target_kind", "invoke_target",
            name="uk_llm_routes_connection_target",
        ),
        Index("idx_llm_routes_model_is_enabled", "model_id", "is_enabled", "id"),
        CheckConstraint(
            "target_kind IN ('model', 'endpoint', 'deployment')",
            name="ck_llm_routes_target_kind",
        ),
        CheckConstraint(
            "identifier_kind IN ('pinned', 'alias', 'unknown')",
            name="ck_llm_routes_identifier_kind",
        ),
        CheckConstraint(
            "origin IN ('catalog', 'management', 'manual')",
            name="ck_llm_routes_origin",
        ),
        {"comment": "逻辑模型在一条接入商连接上的实际调用目标"},
    )

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(
        ID, nullable=False,
    )
    connection_id: Mapped[int] = mapped_column(
        ID,
        nullable=False,
    )
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    invoke_target: Mapped[str] = mapped_column(TARGET_ID, nullable=False)
    catalog_model_id: Mapped[str | None] = mapped_column(TARGET_ID, nullable=True)
    identifier_kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unknown", server_default="unknown"
    )
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    pricing_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    pricing_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="provider", server_default="provider")
    current_price_revision_id: Mapped[int | None] = mapped_column(ID, nullable=True)
    is_target_available: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(
        TIME, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class LLMUseCaseRoute(Base):
    __tablename__ = "llm_use_case_route"
    __table_args__ = (
        UniqueConstraint("use_case", "route_id", name="uk_llm_use_case_route_use_case_route"),
        UniqueConstraint("use_case", "priority", name="uk_llm_use_case_priority"),
        Index("idx_llm_use_case_route_route", "route_id"),
        CheckConstraint("priority >= 0", name="ck_llm_use_case_priority"),
        {"comment": "系统能力和对话列表共用的场景线路绑定"},
    )

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    use_case: Mapped[str] = mapped_column(String(48), nullable=False)
    route_id: Mapped[int] = mapped_column(ID, nullable=False)
    protocol_code: Mapped[str] = mapped_column(String(32), nullable=False)
    priority: Mapped[int] = mapped_column(
        Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql"), nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    validated_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    validated_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(
        TIME, nullable=False, server_default=func.now(), onupdate=func.now()
    )



def get_use_case_route(db: Session, use_case: str, route_id: int) -> "LLMUseCaseRoute | None":
    """Look up a binding by its natural key; ``id`` is only the surrogate primary key."""
    return db.scalar(
        select(LLMUseCaseRoute).where(
            LLMUseCaseRoute.use_case == use_case, LLMUseCaseRoute.route_id == route_id
        )
    )


class LLMCallLog(Base):
    __tablename__ = "llm_call_log"
    __table_args__ = (
        UniqueConstraint("call_id", name="uk_llm_call_log_call_id"),
        Index("idx_llm_calls_created", "create_time", "id"),
        Index("idx_llm_calls_user_created", "user_id", "create_time", "id"),
        Index("idx_llm_calls_route_created", "route_id", "create_time", "id"),
        Index("idx_llm_calls_run_created", "agent_run_id", "create_time", "id"),
        Index("idx_llm_calls_request_started", "request_started_at", "id"),
        CheckConstraint(
            "status IN ('pending', 'succeeded', 'failed', 'cancelled')",
            name="ck_llm_calls_status",
        ),
        CheckConstraint(
            "metering_status IN ('complete', 'partial', 'unknown')",
            name="ck_llm_calls_metering",
        ),
        CheckConstraint(
            "estimated_cost IS NULL OR estimated_cost >= 0",
            name="ck_llm_calls_cost",
        ),
        CheckConstraint(
            "estimated_cost IS NULL OR cost_currency IS NOT NULL",
            name="ck_llm_calls_currency",
        ),
        {"comment": "每次上游请求的安全计量与费用快照"},
    )

    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    call_id: Mapped[str] = mapped_column(String(40), nullable=False)
    use_case: Mapped[str] = mapped_column(String(48), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    user_id: Mapped[int | None] = mapped_column(
        ID, nullable=True,
    )
    agent_run_id: Mapped[int | None] = mapped_column(
        ID, nullable=True,
    )
    route_id: Mapped[int] = mapped_column(
        ID, nullable=False,
    )
    runtime_config_version: Mapped[int] = mapped_column(ID, nullable=False)
    protocol_code: Mapped[str] = mapped_column(String(32), nullable=False)
    response_model_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    upstream_request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    selection_source: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    usage_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(ID, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(ID, nullable=True)
    metering_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unknown", server_default="unknown"
    )
    price_snapshot_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(20, 10), nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(ID, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_started_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    request_finished_at: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    time_basis: Mapped[str | None] = mapped_column(String(32), nullable=True)
    normalized_usage_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    price_revision_id: Mapped[int | None] = mapped_column(ID, nullable=True)
    cost_state: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", server_default="pending")
    cost_reason: Mapped[str | None] = mapped_column(String(48), nullable=True)
    current_cost_revision_id: Mapped[int | None] = mapped_column(ID, nullable=True)
    settled_cost: Mapped[Decimal | None] = mapped_column(COST_MONEY, nullable=True)
    settled_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(
        TIME, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class LLMPriceRevision(Base):
    __tablename__ = "llm_price_revision"
    __table_args__ = (UniqueConstraint("route_id", "rule_hash", name="uk_llm_price_revision_rule"),)
    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    route_id: Mapped[int] = mapped_column(ID, nullable=False)
    rule_hash: Mapped[str] = mapped_column(String(64).with_variant(mysql.CHAR(64), "mysql"), nullable=False)
    rule_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(TIME, nullable=False)
    effective_from: Mapped[datetime | None] = mapped_column(TIME, nullable=True)
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False)
    update_time: Mapped[datetime] = mapped_column(TIME, nullable=False)


class LLMCostOperation(Base):
    __tablename__ = "llm_cost_operation"
    __table_args__ = (
        UniqueConstraint("operation_key", name="uk_llm_cost_operation_key"),
        UniqueConstraint("actor_user_id", "idempotency_key", name="uk_llm_cost_operation_idempotency"),
        Index("idx_llm_cost_operation_created", "create_time", "id"),
    )
    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    operation_key: Mapped[str] = mapped_column(String(36).with_variant(mysql.CHAR(36), "mysql"), nullable=False)
    operation_type: Mapped[str] = mapped_column(String(24), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ID, nullable=False)
    state: Mapped[str] = mapped_column(String(24), nullable=False)
    scope_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    source_digest: Mapped[str] = mapped_column(String(64).with_variant(mysql.CHAR(64), "mysql"), nullable=False)
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False)
    update_time: Mapped[datetime] = mapped_column(TIME, nullable=False)


class LLMCallCostRevision(Base):
    __tablename__ = "llm_call_cost_revision"
    __table_args__ = (
        UniqueConstraint("calculation_key", name="uk_llm_call_cost_calculation"),
        UniqueConstraint("connection_id", "provider_record_key", name="uk_llm_call_cost_provider_record"),
        Index("idx_llm_call_cost_call", "call_log_id", "id"),
        Index("idx_llm_call_cost_operation", "operation_id", "id"),
    )
    id: Mapped[int] = mapped_column(ID, primary_key=True, autoincrement=True)
    call_log_id: Mapped[int | None] = mapped_column(ID, nullable=True)
    operation_id: Mapped[int | None] = mapped_column(ID, nullable=True)
    connection_id: Mapped[int] = mapped_column(ID, nullable=False)
    calculation_key: Mapped[str] = mapped_column(String(64).with_variant(mysql.CHAR(64), "mysql"), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    state: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(48), nullable=True)
    price_revision_id: Mapped[int | None] = mapped_column(ID, nullable=True)
    basis_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    estimated_cost: Mapped[Decimal | None] = mapped_column(COST_MONEY, nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    settled_cost: Mapped[Decimal | None] = mapped_column(COST_MONEY, nullable=True)
    settled_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    provider_record_key: Mapped[str | None] = mapped_column(String(128).with_variant(mysql.VARCHAR(128, collation="utf8mb4_0900_bin"), "mysql"), nullable=True)
    provider_request_key: Mapped[str | None] = mapped_column(String(128).with_variant(mysql.VARCHAR(128, collation="utf8mb4_0900_bin"), "mysql"), nullable=True)
    create_time: Mapped[datetime] = mapped_column(TIME, nullable=False)
    update_time: Mapped[datetime] = mapped_column(TIME, nullable=False)
