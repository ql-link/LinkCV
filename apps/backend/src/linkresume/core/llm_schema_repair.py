"""Recognize the two complete model-config layouts during 0088 recovery."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

LEGACY_COLUMNS = frozenset(
    {
        "id",
        "model_name",
        "adapter",
        "model_call_name",
        "api_base",
        "encrypted_api_key",
        "enabled",
        "priority",
        "input_price_per_million",
        "output_price_per_million",
        "config_version",
        "created_at",
        "updated_at",
    }
)
PROVIDER_COLUMNS = frozenset(
    {
        "id",
        "provider_id",
        "model_call_name",
        "config_version",
        "created_at",
        "updated_at",
    }
)


def model_config_schema_state(connection: Connection) -> str:
    """Return a known complete layout; reject partial/unsafe 0088 states."""
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    if "llm_model_configs" not in tables:
        raise RuntimeError("Model config schema is missing llm_model_configs")
    columns = {
        str(column["name"]): column
        for column in inspector.get_columns("llm_model_configs")
    }
    names = set(columns)
    indexes = {
        str(index["name"]) for index in inspector.get_indexes("llm_model_configs")
    }
    checks = {
        str(check["name"])
        for check in inspector.get_check_constraints("llm_model_configs")
    }
    foreign_keys = {
        str(key["name"]) for key in inspector.get_foreign_keys("llm_model_configs")
    }

    if (
        names == LEGACY_COLUMNS
        and bool(columns["model_call_name"]["nullable"])
        and "idx_llm_model_configs_enabled_priority" in indexes
        and "ck_llm_model_configs_adapter_pair" in checks
        and "ck_llm_model_configs_input_price_nonnegative" in checks
        and "ck_llm_model_configs_output_price_nonnegative" in checks
        and "ck_llm_model_configs_config_version" in checks
        and "fk_llm_model_configs_provider" not in foreign_keys
    ):
        return "legacy"

    if (
        names == PROVIDER_COLUMNS
        and not bool(columns["model_call_name"]["nullable"])
        and {"llm_providers", "llm_provider_models"} <= tables
        and "idx_llm_model_configs_provider" in indexes
        and "ck_llm_model_configs_model_call_name" in checks
        and "ck_llm_model_configs_config_version" in checks
        and "fk_llm_model_configs_provider" in foreign_keys
    ):
        if connection.scalar(text("SELECT COUNT(*) FROM llm_model_configs")):
            raise RuntimeError(
                "Provider model configs require explicit preservation before 0091"
            )
        if connection.scalar(
            text(
                "SELECT COUNT(*) FROM llm_capability_bindings "
                "WHERE model_config_id IS NOT NULL OR validation_id IS NOT NULL"
            )
        ):
            raise RuntimeError(
                "Provider model bindings require explicit preservation before 0091"
            )
        return "provider"

    raise RuntimeError("Unknown partial model config schema; stop before migration DDL")
