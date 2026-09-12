from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from linkcv.core.migration_sql import sql_statements

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = BACKEND_ROOT / "migrations" / "versions" / "0044_add_user_profiles.py"
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0044.up.sql"

_PROFILE_COLUMNS = (
    "work_city",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
    "employment_type",
    "work_mode",
    "target_positions",
    "exclusions",
    "target_companies",
    "availability",
    "available_from",
    "school",
    "school_tier",
    "major",
    "education_level",
    "years_experience",
    "birth_date",
    "languages",
    "skills",
    "certifications",
    "honors",
    "campus_experiences",
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0044", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_chains_after_0043() -> None:
    revision = load_revision()
    assert revision.revision == "0044"
    assert revision.down_revision == "0043"


def test_downgrade_is_forward_only() -> None:
    revision = load_revision()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_up_sql_creates_user_profiles_table() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert "CREATE TABLE user_profiles" in sql
    assert "CONSTRAINT pk_user_profiles PRIMARY KEY (id)" in sql
    assert "CONSTRAINT uk_user_profiles_user_id UNIQUE (user_id)" in sql
    assert "CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id)" in sql
    for column in _PROFILE_COLUMNS:
        assert column in sql
    assert "CONSTRAINT ck_user_profiles_lock_version" in sql
    assert "CONSTRAINT ck_user_profiles_salary_context" in sql
    assert "CONSTRAINT ck_user_profiles_available_from_context" in sql
    assert "CONSTRAINT ck_user_profiles_years_experience" in sql
    assert "CONSTRAINT ck_user_profiles_school_tier_array" in sql
    assert "KEY idx_user_profiles_user_updated" in sql


def test_up_sql_splits_into_single_statement() -> None:
    statements = sql_statements(SQL_PATH.read_text(encoding="utf-8"))
    assert len(statements) == 1
    assert statements[0].startswith("CREATE TABLE user_profiles")
