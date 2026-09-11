from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from linkcv.core.migration_sql import sql_statements

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT / "migrations" / "versions" / "0059_add_user_preferences.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0059.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0059", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_chains_after_0058() -> None:
    revision = load_revision()
    assert revision.revision == "0059"
    assert revision.down_revision == "0058"


def test_downgrade_is_forward_only() -> None:
    revision = load_revision()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_up_sql_creates_restrained_user_preferences_table() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert "CREATE TABLE user_preferences" in sql
    assert "user_id BIGINT UNSIGNED NOT NULL" in sql
    assert (
        "preference_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"
        in sql
    )
    assert "value_json JSON NOT NULL" in sql
    assert "PRIMARY KEY (user_id, preference_key)" in sql
    assert "FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT" in sql
    assert "LOWER(JSON_TYPE(value_json)) = 'object'" in sql
    for unneeded_column in (
        " id ",
        "created_at",
        "updated_at",
        "schema_version",
        "lock_version",
        "deleted_at",
    ):
        assert unneeded_column not in sql


def test_up_sql_uses_single_forward_statement() -> None:
    statements = sql_statements(SQL_PATH.read_text(encoding="utf-8"))
    assert len(statements) == 1
    assert statements[0].startswith("CREATE TABLE user_preferences")
    assert not SQL_PATH.with_name("0059.down.sql").exists()
