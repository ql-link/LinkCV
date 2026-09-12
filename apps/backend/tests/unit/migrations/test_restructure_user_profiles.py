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
    / "0045_restructure_user_profiles.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0045.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0045", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_chains_after_0044() -> None:
    revision = load_revision()
    assert revision.revision == "0045"
    assert revision.down_revision == "0044"


def test_downgrade_is_forward_only() -> None:
    revision = load_revision()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_up_sql_converts_and_removes_the_reviewed_profile_fields() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")

    for column in (
        "candidate_cities",
        "employment_types",
        "professional_directions",
        "candidate_status",
        "graduation_year",
    ):
        assert f"ADD COLUMN {column}" in sql
    assert "JSON_ARRAY(TRIM(work_city))" in sql
    assert "JSON_ARRAY(TRIM(employment_type))" in sql
    assert "professional_directions = COALESCE(target_positions, JSON_ARRAY())" in sql
    assert "candidate_status = NULL" in sql
    assert "graduation_year = NULL" in sql

    for constraint in (
        "ck_user_profiles_employment_type",
        "ck_user_profiles_work_mode",
        "ck_user_profiles_availability",
        "ck_user_profiles_available_from_context",
        "ck_user_profiles_target_positions_array",
        "ck_user_profiles_exclusions_array",
        "ck_user_profiles_target_companies_array",
    ):
        assert f"DROP CHECK {constraint}" in sql
    for column in (
        "work_city",
        "employment_type",
        "work_mode",
        "target_positions",
        "exclusions",
        "target_companies",
        "availability",
        "available_from",
        "birth_date",
    ):
        assert f"DROP COLUMN {column}" in sql
    for constraint in (
        "ck_user_profiles_candidate_cities_array",
        "ck_user_profiles_employment_types_array",
        "ck_user_profiles_professional_directions_array",
        "ck_user_profiles_candidate_status",
        "ck_user_profiles_graduation_year",
        "ck_user_profiles_candidate_experience_context",
    ):
        assert f"ADD CONSTRAINT {constraint}" in sql


def test_up_sql_uses_statement_only_forward_migration_format() -> None:
    statements = sql_statements(SQL_PATH.read_text(encoding="utf-8"))
    assert len(statements) == 4
    assert statements[0].startswith("ALTER TABLE user_profiles")
    assert statements[1].startswith("UPDATE user_profiles")
    assert statements[2].startswith("ALTER TABLE user_profiles")
    assert statements[3].startswith("ALTER TABLE user_profiles")
    assert not (SQL_PATH.with_name("0045.down.sql")).exists()
