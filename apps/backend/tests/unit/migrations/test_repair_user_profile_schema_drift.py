from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
import sqlalchemy as sa

from linkcv.core.migration_sql import sql_statements

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0051_repair_user_profile_schema_drift.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0051.up.sql"


def load_revision() -> ModuleType:
    spec = importlib.util.spec_from_file_location("linkcv_revision_0051", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Rows:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> _Rows:
        return self

    def all(self) -> list[dict[str, Any]]:
        return self.rows


class _Inspector:
    def __init__(self, columns: list[dict[str, Any]], checks: set[str]) -> None:
        self.columns = columns
        self.checks = checks

    def get_table_names(self) -> list[str]:
        return ["user_profiles"]

    def get_columns(self, table_name: str) -> list[dict[str, Any]]:
        assert table_name == "user_profiles"
        return self.columns

    def get_check_constraints(self, table_name: str) -> list[dict[str, str]]:
        assert table_name == "user_profiles"
        return [{"name": name} for name in self.checks]


class _Connection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.queries: list[str] = []

    def execute(self, statement: object, _params: dict[str, Any] | None = None):
        query = str(statement)
        self.queries.append(query)
        if "FROM user_profiles" in query:
            return _Rows(self.rows)
        raise AssertionError(query)


def _column(name: str, type_: object, *, nullable: bool) -> dict[str, object]:
    return {"name": name, "type": type_, "nullable": nullable}


def _legacy_columns(revision: ModuleType) -> list[dict[str, object]]:
    json_columns = {
        "target_positions",
        "exclusions",
        "target_companies",
        "school_tier",
        "languages",
        "skills",
        "certifications",
        "honors",
        "campus_experiences",
    }
    columns: list[dict[str, object]] = []
    for name in sorted(revision._LEGACY_COLUMNS):
        if name in json_columns:
            type_ = sa.JSON()
            nullable = False
        elif name in {"id", "user_id"}:
            type_ = sa.BigInteger()
            nullable = False
        elif name == "lock_version":
            type_ = sa.Integer()
            nullable = False
        elif name in {"salary_min", "salary_max"}:
            type_ = sa.Numeric(12, 2)
            nullable = True
        elif name == "salary_currency":
            type_ = sa.CHAR(3)
            nullable = True
        elif name == "school":
            type_ = sa.String(255)
            nullable = True
        elif name == "major":
            type_ = sa.String(100)
            nullable = True
        elif name == "education_level":
            type_ = sa.String(24)
            nullable = True
        elif name == "years_experience":
            type_ = sa.Integer()
            nullable = True
        elif name in {"work_city"}:
            type_ = sa.String(100)
            nullable = True
        elif name in {
            "employment_type",
            "work_mode",
            "availability",
            "salary_period",
        }:
            type_ = sa.String(24 if name == "employment_type" else 16)
            nullable = True
        elif name in {"available_from", "birth_date"}:
            type_ = sa.Date()
            nullable = True
        else:
            type_ = sa.DateTime()
            nullable = False
        columns.append(_column(name, type_, nullable=nullable))
    return columns


def _target_columns(revision: ModuleType) -> list[dict[str, object]]:
    columns = [
        column
        for column in _legacy_columns(revision)
        if column["name"] not in revision._REMOVED_COLUMNS
    ]
    columns.extend(
        [
            _column("candidate_cities", sa.JSON(), nullable=False),
            _column("employment_types", sa.JSON(), nullable=False),
            _column("candidate_status", sa.String(24), nullable=True),
            _column("graduation_year", sa.SmallInteger(), nullable=True),
        ]
    )
    return columns


def _legacy_row(revision: ModuleType) -> dict[str, Any]:
    row: dict[str, Any] = {
        name: [] if name in revision._JSON_ARRAY_COLUMNS else None
        for name in revision._LEGACY_COLUMNS
    }
    row.update(
        {
            "id": 7,
            "user_id": 11,
            "lock_version": 3,
            "work_city": " 上海 ",
            "salary_min": 12000,
            "salary_max": 18000,
            "salary_currency": "CNY",
            "salary_period": "month",
            "employment_type": "full_time",
            "work_mode": "hybrid",
            "target_positions": ["平台工程师", "前端工程师"],
            "school": "南方虚构大学",
            "school_tier": ["project_211"],
            "major": "计算机科学",
            "education_level": "master",
            "years_experience": 4,
            "languages": ["英语"],
            "skills": ["Python"],
            "certifications": [],
            "honors": [],
            "campus_experiences": [],
            "created_at": "2026-08-01 12:00:00",
            "updated_at": "2026-08-02 12:00:00",
        }
    )
    return row


def _target_row(revision: ModuleType) -> dict[str, Any]:
    row = _legacy_row(revision)
    for name in revision._REMOVED_COLUMNS:
        row.pop(name)
    row.update(
        {
            "candidate_cities": ["上海"],
            "employment_types": ["full_time"],
            "candidate_status": None,
            "graduation_year": None,
        }
    )
    return row


def test_revision_is_0051_after_0050_and_forward_only() -> None:
    revision = load_revision()

    assert revision.revision == "0051"
    assert revision.down_revision == "0050"
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_up_sql_contains_the_reviewed_two_stage_conversion_without_down_sql() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")
    statements = sql_statements(sql)

    assert len(statements) == 10
    assert statements[0].startswith("ALTER TABLE user_profiles")
    assert "JSON_ARRAY(TRIM(work_city))" in sql
    assert "JSON_ARRAY(TRIM(employment_type))" in sql
    assert "WHERE parsed.employment_type_value IN ('internship', 'full_time')" in sql
    assert "ROW_NUMBER() OVER" in sql
    assert "DROP COLUMN professional_directions" in sql
    assert "DROP TEMPORARY TABLE user_profile_employment_types_0051" in sql
    assert not SQL_PATH.with_name("0051.down.sql").exists()


def test_schema_state_accepts_only_complete_legacy_or_target_shapes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = load_revision()
    legacy_connection = _Connection([_legacy_row(revision)])
    monkeypatch.setattr(
        revision.sa,
        "inspect",
        lambda _connection: _Inspector(
            _legacy_columns(revision), revision._LEGACY_CHECKS
        ),
    )
    assert revision._detect_schema_state(legacy_connection) == "legacy"

    target_connection = _Connection([_target_row(revision)])
    monkeypatch.setattr(
        revision.sa,
        "inspect",
        lambda _connection: _Inspector(
            _target_columns(revision), revision._TARGET_CHECKS
        ),
    )
    assert revision._detect_schema_state(target_connection) == "target"

    partial_columns = _target_columns(revision)[:-1]
    monkeypatch.setattr(
        revision.sa,
        "inspect",
        lambda _connection: _Inspector(partial_columns, revision._TARGET_CHECKS),
    )
    with pytest.raises(RuntimeError, match="unsupported or partially applied"):
        revision._detect_schema_state(_Connection([]))


def test_legacy_preflight_preserves_rows_and_applies_0045_0046_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = load_revision()
    row = _legacy_row(revision)
    row["employment_type"] = "contract"
    connection = _Connection([row])
    monkeypatch.setattr(
        revision.sa,
        "inspect",
        lambda _connection: _Inspector(
            _legacy_columns(revision), revision._LEGACY_CHECKS
        ),
    )

    snapshots = revision._preflight(connection)

    assert len(snapshots) == 1
    assert snapshots[0].row["id"] == 7
    assert snapshots[0].candidate_cities == ["上海"]
    assert snapshots[0].employment_types == []
    assert snapshots[0].professional_directions == ["平台工程师", "前端工程师"]


def test_target_upgrade_is_a_noop_after_complete_data_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = load_revision()
    row = _target_row(revision)
    connection = _Connection([row])
    monkeypatch.setattr(
        revision.sa,
        "inspect",
        lambda _connection: _Inspector(
            _target_columns(revision), revision._TARGET_CHECKS
        ),
    )
    monkeypatch.setattr(revision.op, "get_bind", lambda: connection)
    sql_calls: list[Path] = []
    monkeypatch.setattr(
        revision,
        "execute_sql_file",
        lambda _connection, path: sql_calls.append(path),
    )

    revision.upgrade()

    assert sql_calls == []
    assert connection.rows == [row]
    assert any("FROM user_profiles" in query for query in connection.queries)


def test_unknown_schema_fails_before_sql_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = load_revision()
    connection = _Connection([])
    monkeypatch.setattr(
        revision.sa,
        "inspect",
        lambda _connection: _Inspector(
            _target_columns(revision)[:-1], revision._TARGET_CHECKS
        ),
    )
    monkeypatch.setattr(revision.op, "get_bind", lambda: connection)
    sql_calls: list[Path] = []
    monkeypatch.setattr(
        revision,
        "execute_sql_file",
        lambda _connection, path: sql_calls.append(path),
    )

    with pytest.raises(RuntimeError, match="unsupported or partially applied"):
        revision.upgrade()

    assert sql_calls == []
    assert connection.queries == []
