from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from linkcv.core.migration_sql import sql_statements

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0047_simplify_user_profile_preferences.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0047.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location(
        "linkcv_revision_0047", REVISION_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_chains_after_0046() -> None:
    revision = load_revision()
    assert revision.revision == "0047"
    assert revision.down_revision == "0046"


def test_downgrade_is_forward_only() -> None:
    revision = load_revision()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_up_sql_filters_and_removes_obsolete_profile_data() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert "CREATE TEMPORARY TABLE user_profile_employment_types_0047" in sql
    assert "JSON_ARRAYAGG(employment_type_value) OVER" in sql
    assert "ORDER BY first_position" in sql
    assert "WHERE parsed.employment_type_value IN ('internship', 'full_time')" in sql
    assert "ROW_NUMBER() OVER" in sql
    assert "DROP CHECK ck_user_profiles_professional_directions_array" in sql
    assert "DROP COLUMN professional_directions" in sql
    assert "可接受工作性质数组：internship/full_time" in sql
    assert "DROP TEMPORARY TABLE user_profile_employment_types_0047" in sql


def test_up_sql_uses_statement_only_forward_migration_format() -> None:
    statements = sql_statements(SQL_PATH.read_text(encoding="utf-8"))
    assert len(statements) == 6
    assert statements[0].startswith("CREATE TEMPORARY TABLE")
    assert statements[1].startswith("INSERT INTO")
    assert statements[2].startswith("INSERT IGNORE INTO")
    assert statements[3].startswith("UPDATE user_profiles")
    assert statements[4].startswith("ALTER TABLE user_profiles")
    assert statements[5].startswith("DROP TEMPORARY TABLE")
    assert not (SQL_PATH.with_name("0047.down.sql")).exists()
