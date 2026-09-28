import pytest
from sqlalchemy import create_engine, text

from linkresume.core.llm_schema_repair import model_config_schema_state


def test_original_provider_layout_requires_empty_configs_and_bindings() -> None:
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            for statement in (
                "CREATE TABLE llm_providers (id INTEGER PRIMARY KEY)",
                "CREATE TABLE llm_provider_models (id INTEGER PRIMARY KEY)",
                "CREATE TABLE llm_model_configs ("
                "id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL, "
                "model_call_name VARCHAR(128) NOT NULL, config_version INTEGER, "
                "created_at DATETIME, updated_at DATETIME, "
                "CONSTRAINT fk_llm_model_configs_provider "
                "FOREIGN KEY (provider_id) REFERENCES llm_providers(id), "
                "CONSTRAINT ck_llm_model_configs_model_call_name "
                "CHECK (length(model_call_name) > 0), "
                "CONSTRAINT ck_llm_model_configs_config_version "
                "CHECK (config_version >= 1))",
                "CREATE INDEX idx_llm_model_configs_provider "
                "ON llm_model_configs (provider_id, id)",
                "CREATE TABLE llm_capability_bindings ("
                "model_config_id INTEGER, validation_id INTEGER)",
            ):
                connection.execute(text(statement))
            assert model_config_schema_state(connection) == "provider"
            connection.execute(text("INSERT INTO llm_providers (id) VALUES (1)"))
            connection.execute(
                text(
                    "INSERT INTO llm_model_configs "
                    "(id, provider_id, model_call_name) VALUES (1, 1, 'fictional-model')"
                )
            )
            with pytest.raises(RuntimeError, match="explicit preservation"):
                model_config_schema_state(connection)
    finally:
        engine.dispose()


def test_partial_provider_layout_is_rejected() -> None:
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE llm_model_configs ("
                    "id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL, "
                    "model_call_name VARCHAR(128) NOT NULL, config_version INTEGER, "
                    "created_at DATETIME, updated_at DATETIME)"
                )
            )
            with pytest.raises(RuntimeError, match="Unknown partial"):
                model_config_schema_state(connection)
    finally:
        engine.dispose()
