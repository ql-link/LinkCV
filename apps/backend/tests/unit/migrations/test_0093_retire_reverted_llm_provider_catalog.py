"""The 0088 provider catalog must never be silently discarded with rows."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect, text


ROOT = Path(__file__).resolve().parents[5]
SPEC = importlib.util.spec_from_file_location(
    "retire_0093",
    next((ROOT / "apps/backend/migrations/versions").glob("0093_*.py")),
)
assert SPEC is not None and SPEC.loader is not None
revision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(revision)


@pytest.mark.parametrize("nonempty_table", ["llm_providers", "llm_provider_models"])
def test_preflight_refuses_nonempty_legacy_table(monkeypatch, nonempty_table):
    engine = create_engine("sqlite://")
    executed = []
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE llm_providers (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE llm_provider_models (id INTEGER PRIMARY KEY)"))
        connection.execute(text(f"INSERT INTO {nonempty_table} VALUES (1)"))
        monkeypatch.setattr(revision, "op", SimpleNamespace(get_bind=lambda: connection))
        monkeypatch.setattr(revision, "execute_sql_file", lambda conn, path: executed.append(path.name))
        with pytest.raises(RuntimeError, match=nonempty_table):
            revision.upgrade()
        assert executed == []
        assert connection.scalar(text(f"SELECT COUNT(*) FROM {nonempty_table}")) == 1
    engine.dispose()


def test_empty_legacy_tables_are_removed_and_partial_retry_is_safe(monkeypatch):
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE llm_providers (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE llm_provider_models (id INTEGER PRIMARY KEY)"))
        monkeypatch.setattr(revision, "op", SimpleNamespace(get_bind=lambda: connection))
        revision.upgrade()
        revision.upgrade()
        assert {"llm_providers", "llm_provider_models"}.isdisjoint(
            inspect(connection).get_table_names()
        )
    engine.dispose()


def test_downgrade_requires_backup():
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()
