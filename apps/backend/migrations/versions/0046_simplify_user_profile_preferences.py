"""Remove professional directions and normalize profile employment types.

Revision 0045 introduced JSON arrays for the profile preferences.  This
revision is intentionally destructive: values other than ``internship`` and
``full_time`` are removed in their existing order, and the now-unused
``professional_directions`` column is dropped.  The Python wrapper fails
closed on schema drift and verifies row identity, row count, and the complete
employment-type conversion after the reviewed SQL has run.

Revision ID: 0046
Revises: 0045
Create Date: 2026-08-28
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"

_PROFESSIONAL_DIRECTIONS_COLUMN = "professional_directions"
_EXPECTED_0045_COLUMNS = {
    "id",
    "user_id",
    "lock_version",
    "candidate_cities",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
    "employment_types",
    "professional_directions",
    "school",
    "school_tier",
    "major",
    "education_level",
    "years_experience",
    "candidate_status",
    "graduation_year",
    "languages",
    "skills",
    "certifications",
    "honors",
    "campus_experiences",
    "created_at",
    "updated_at",
}
_EXPECTED_0046_COLUMNS = _EXPECTED_0045_COLUMNS - {
    _PROFESSIONAL_DIRECTIONS_COLUMN
}
_EXPECTED_0045_CHECKS = {
    "ck_user_profiles_lock_version",
    "ck_user_profiles_salary_period",
    "ck_user_profiles_salary_range",
    "ck_user_profiles_salary_context",
    "ck_user_profiles_salary_currency",
    "ck_user_profiles_education_level",
    "ck_user_profiles_years_experience",
    "ck_user_profiles_languages_array",
    "ck_user_profiles_skills_array",
    "ck_user_profiles_certifications_array",
    "ck_user_profiles_honors_array",
    "ck_user_profiles_campus_experiences_array",
    "ck_user_profiles_school_tier_array",
    "ck_user_profiles_candidate_cities_array",
    "ck_user_profiles_employment_types_array",
    "ck_user_profiles_professional_directions_array",
    "ck_user_profiles_candidate_status",
    "ck_user_profiles_graduation_year",
    "ck_user_profiles_candidate_experience_context",
}
_EXPECTED_0046_CHECKS = _EXPECTED_0045_CHECKS - {
    "ck_user_profiles_professional_directions_array"
}
_ALLOWED_EMPLOYMENT_TYPES = {"internship", "full_time"}


def _decode_json(value: object, *, field: str) -> Any:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    return value


def _decode_json_array(value: object, *, field: str) -> list[Any]:
    decoded = _decode_json(value, field=field)
    if not isinstance(decoded, list):
        raise RuntimeError(f"{field} must be a JSON array")
    return decoded


def _clean_employment_types(values: list[Any]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str) or value not in _ALLOWED_EMPLOYMENT_TYPES:
            continue
        if value in seen:
            continue
        seen.add(value)
        cleaned.append(value)
    return cleaned


def _assert_0045_schema(connection: sa.engine.Connection) -> None:
    inspector = sa.inspect(connection)
    if "user_profiles" not in inspector.get_table_names():
        raise RuntimeError("0046 requires the 0045 user_profiles table")

    columns = {
        str(column["name"]): column
        for column in inspector.get_columns("user_profiles")
    }
    if set(columns) != _EXPECTED_0045_COLUMNS:
        missing = sorted(_EXPECTED_0045_COLUMNS - set(columns))
        extra = sorted(set(columns) - _EXPECTED_0045_COLUMNS)
        raise RuntimeError(
            "user_profiles schema does not match 0045: "
            f"missing={missing}, extra={extra}"
        )

    checks = {
        str(constraint["name"])
        for constraint in inspector.get_check_constraints("user_profiles")
        if constraint.get("name")
    }
    if checks != _EXPECTED_0045_CHECKS:
        missing = sorted(_EXPECTED_0045_CHECKS - checks)
        extra = sorted(checks - _EXPECTED_0045_CHECKS)
        raise RuntimeError(
            "user_profiles checks do not match 0045: "
            f"missing={missing}, extra={extra}"
        )

    for name in ("employment_types", _PROFESSIONAL_DIRECTIONS_COLUMN):
        column = columns[name]
        if "JSON" not in column["type"].__class__.__name__.upper():
            raise RuntimeError(
                f"user_profiles.{name} has unexpected type "
                f"{column['type'].__class__.__name__}"
            )
        if bool(column["nullable"]):
            raise RuntimeError(f"user_profiles.{name} must be NOT NULL before 0046")


def _preflight(
    connection: sa.engine.Connection,
) -> list[tuple[int, list[str]]]:
    _assert_0045_schema(connection)
    rows = connection.execute(
        sa.text(
            "SELECT id, employment_types FROM user_profiles "
            "ORDER BY id FOR UPDATE"
        )
    ).mappings().all()
    snapshots: list[tuple[int, list[str]]] = []
    for row in rows:
        profile_id = int(row["id"])
        values = _decode_json_array(
            row["employment_types"],
            field=f"user_profiles[{profile_id}].employment_types",
        )
        snapshots.append((profile_id, _clean_employment_types(values)))
    return snapshots


def _assert_0046_schema(connection: sa.engine.Connection) -> None:
    inspector = sa.inspect(connection)
    columns = {
        str(column["name"]): column
        for column in inspector.get_columns("user_profiles")
    }
    if set(columns) != _EXPECTED_0046_COLUMNS:
        missing = sorted(_EXPECTED_0046_COLUMNS - set(columns))
        extra = sorted(set(columns) - _EXPECTED_0046_COLUMNS)
        raise RuntimeError(
            "user_profiles schema does not match 0046: "
            f"missing={missing}, extra={extra}"
        )

    checks = {
        str(constraint["name"])
        for constraint in inspector.get_check_constraints("user_profiles")
        if constraint.get("name")
    }
    if checks != _EXPECTED_0046_CHECKS:
        missing = sorted(_EXPECTED_0046_CHECKS - checks)
        extra = sorted(checks - _EXPECTED_0046_CHECKS)
        raise RuntimeError(
            "user_profiles checks do not match 0046: "
            f"missing={missing}, extra={extra}"
        )

    employment_types = columns["employment_types"]
    if "JSON" not in employment_types["type"].__class__.__name__.upper():
        raise RuntimeError("user_profiles.employment_types must remain JSON")
    if bool(employment_types["nullable"]):
        raise RuntimeError("user_profiles.employment_types must remain NOT NULL")


def _verify(
    connection: sa.engine.Connection,
    snapshots: list[tuple[int, list[str]]],
) -> None:
    _assert_0046_schema(connection)
    rows = connection.execute(
        sa.text(
            "SELECT id, employment_types FROM user_profiles ORDER BY id"
        )
    ).mappings().all()
    if len(rows) != len(snapshots):
        raise RuntimeError(
            "0046 changed user_profiles row count: "
            f"before={len(snapshots)} after={len(rows)}"
        )
    for expected, actual_row in zip(snapshots, rows, strict=True):
        profile_id = int(actual_row["id"])
        if profile_id != expected[0]:
            raise RuntimeError("0046 changed a user_profiles primary key")
        actual = _decode_json_array(
            actual_row["employment_types"],
            field=f"user_profiles[{profile_id}].employment_types",
        )
        if actual != expected[1]:
            raise RuntimeError(
                f"0046 normalized employment_types incorrectly for {profile_id}"
            )
        if any(value not in _ALLOWED_EMPLOYMENT_TYPES for value in actual):
            raise RuntimeError(
                f"0046 left an unsupported employment type for {profile_id}"
            )


def upgrade() -> None:
    connection = op.get_bind()
    snapshots = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0046.up.sql")
    _verify(connection, snapshots)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
