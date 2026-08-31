"""Repair a user profile schema that drifted while Alembic was stamped ahead.

The shared 0045 and 0046 revisions already describe the intended profile
conversion, but one environment recorded a later revision while retaining the
old ``user_profiles`` table.  This revision is therefore deliberately
self-contained: it accepts only the complete 0044-era schema or the complete
0046-era schema.  The former is converted by this revision's own SQL file; the
latter is validated and treated as a safe no-op.

This migration is destructive and forward-only.  A post-DDL failure must be
recovered from the pre-migration database backup or repaired by another
forward revision; Alembic downgrade is never a recovery mechanism.

Revision ID: 0051
Revises: 0050
Create Date: 2026-08-30
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import sqlalchemy as sa
from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0051"
down_revision: str | None = "0050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"

_LEGACY_COLUMNS = {
    "id",
    "user_id",
    "lock_version",
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
    "created_at",
    "updated_at",
}
_TARGET_COLUMNS = {
    "id",
    "user_id",
    "lock_version",
    "candidate_cities",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
    "employment_types",
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
_LEGACY_CHECKS = {
    "ck_user_profiles_lock_version",
    "ck_user_profiles_employment_type",
    "ck_user_profiles_work_mode",
    "ck_user_profiles_salary_period",
    "ck_user_profiles_salary_range",
    "ck_user_profiles_salary_context",
    "ck_user_profiles_salary_currency",
    "ck_user_profiles_availability",
    "ck_user_profiles_available_from_context",
    "ck_user_profiles_education_level",
    "ck_user_profiles_years_experience",
    "ck_user_profiles_target_positions_array",
    "ck_user_profiles_exclusions_array",
    "ck_user_profiles_target_companies_array",
    "ck_user_profiles_languages_array",
    "ck_user_profiles_skills_array",
    "ck_user_profiles_certifications_array",
    "ck_user_profiles_honors_array",
    "ck_user_profiles_campus_experiences_array",
    "ck_user_profiles_school_tier_array",
}
_TARGET_CHECKS = {
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
    "ck_user_profiles_candidate_status",
    "ck_user_profiles_graduation_year",
    "ck_user_profiles_candidate_experience_context",
}
_REMOVED_COLUMNS = _LEGACY_COLUMNS - _TARGET_COLUMNS
_CONVERTED_COLUMNS = {"candidate_cities", "employment_types"}
_RETAINED_COLUMNS = tuple(
    sorted(
        _TARGET_COLUMNS - _CONVERTED_COLUMNS - {"candidate_status", "graduation_year"}
    )
)
_JSON_ARRAY_COLUMNS = {
    "target_positions",
    "exclusions",
    "target_companies",
    "school_tier",
    "languages",
    "skills",
    "certifications",
    "honors",
    "campus_experiences",
    "candidate_cities",
    "employment_types",
}
_ALLOWED_EMPLOYMENT_TYPES = {"internship", "full_time"}
_LEGACY_EMPLOYMENT_TYPES = {
    "full_time",
    "part_time",
    "internship",
    "contract",
    "temporary",
}

SchemaState = Literal["legacy", "target"]


@dataclass(frozen=True)
class ProfileSnapshot:
    """Values needed to verify conversion and every retained field."""

    row: dict[str, Any]
    candidate_cities: list[str]
    employment_types: list[str]
    professional_directions: list[Any]


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


def _canonical(value: object, *, field: str) -> object:
    """Normalize driver JSON values without changing scalar semantics."""
    if field in _JSON_ARRAY_COLUMNS:
        return _decode_json_array(value, field=field)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8")
    return value


def _schema_columns_and_checks(
    connection: sa.engine.Connection,
) -> tuple[dict[str, Any], set[str]]:
    inspector = sa.inspect(connection)
    if "user_profiles" not in inspector.get_table_names():
        raise RuntimeError("0051 requires the user_profiles table")
    columns = {
        str(column["name"]): column for column in inspector.get_columns("user_profiles")
    }
    checks = {
        str(constraint["name"])
        for constraint in inspector.get_check_constraints("user_profiles")
        if constraint.get("name")
    }
    return columns, checks


def _assert_column_shape(
    columns: dict[str, Any],
    name: str,
    *,
    type_name: str,
    nullable: bool,
    length: int | None = None,
) -> None:
    column = columns[name]
    actual_type = column["type"].__class__.__name__.upper()
    accepted_type_names = {
        "DECIMAL": ("DECIMAL", "NUMERIC"),
        "VARCHAR": ("VARCHAR", "STRING"),
    }.get(type_name, (type_name,))
    if not any(accepted in actual_type for accepted in accepted_type_names):
        raise RuntimeError(
            f"0051 user_profiles.{name} has unexpected type {actual_type}"
        )
    if length is not None and getattr(column["type"], "length", None) != length:
        raise RuntimeError(
            f"0051 user_profiles.{name} has unexpected length "
            f"{getattr(column['type'], 'length', None)}"
        )
    if bool(column["nullable"]) != nullable:
        raise RuntimeError(f"0051 user_profiles.{name} has unexpected nullability")


def _assert_common_column_shapes(columns: dict[str, Any]) -> None:
    for name, type_name, nullable, length in (
        ("id", "BIGINT", False, None),
        ("user_id", "BIGINT", False, None),
        ("lock_version", "INTEGER", False, None),
        ("salary_min", "DECIMAL", True, None),
        ("salary_max", "DECIMAL", True, None),
        ("salary_currency", "CHAR", True, 3),
        ("salary_period", "VARCHAR", True, 16),
        ("school", "VARCHAR", True, 255),
        ("school_tier", "JSON", False, None),
        ("major", "VARCHAR", True, 100),
        ("education_level", "VARCHAR", True, 24),
        ("years_experience", "INTEGER", True, None),
        ("languages", "JSON", False, None),
        ("skills", "JSON", False, None),
        ("certifications", "JSON", False, None),
        ("honors", "JSON", False, None),
        ("campus_experiences", "JSON", False, None),
        ("created_at", "DATETIME", False, None),
        ("updated_at", "DATETIME", False, None),
    ):
        _assert_column_shape(
            columns,
            name,
            type_name=type_name,
            nullable=nullable,
            length=length,
        )


def _assert_legacy_schema(connection: sa.engine.Connection) -> None:
    columns, checks = _schema_columns_and_checks(connection)
    if set(columns) != _LEGACY_COLUMNS:
        missing = sorted(_LEGACY_COLUMNS - set(columns))
        extra = sorted(set(columns) - _LEGACY_COLUMNS)
        raise RuntimeError(
            "0051 user_profiles schema does not match the complete legacy "
            f"shape: missing={missing}, extra={extra}"
        )
    if checks != _LEGACY_CHECKS:
        missing = sorted(_LEGACY_CHECKS - checks)
        extra = sorted(checks - _LEGACY_CHECKS)
        raise RuntimeError(
            "0051 user_profiles checks do not match the complete legacy "
            f"shape: missing={missing}, extra={extra}"
        )
    _assert_common_column_shapes(columns)
    for name, type_name, nullable, length in (
        ("work_city", "VARCHAR", True, 100),
        ("employment_type", "VARCHAR", True, 24),
        ("work_mode", "VARCHAR", True, 16),
        ("target_positions", "JSON", False, None),
        ("exclusions", "JSON", False, None),
        ("target_companies", "JSON", False, None),
        ("availability", "VARCHAR", True, 16),
        ("available_from", "DATE", True, None),
        ("birth_date", "DATE", True, None),
    ):
        _assert_column_shape(
            columns,
            name,
            type_name=type_name,
            nullable=nullable,
            length=length,
        )


def _assert_target_schema(connection: sa.engine.Connection) -> None:
    columns, checks = _schema_columns_and_checks(connection)
    if set(columns) != _TARGET_COLUMNS:
        missing = sorted(_TARGET_COLUMNS - set(columns))
        extra = sorted(set(columns) - _TARGET_COLUMNS)
        raise RuntimeError(
            "0051 user_profiles schema does not match the complete target "
            f"shape: missing={missing}, extra={extra}"
        )
    if checks != _TARGET_CHECKS:
        missing = sorted(_TARGET_CHECKS - checks)
        extra = sorted(checks - _TARGET_CHECKS)
        raise RuntimeError(
            "0051 user_profiles checks do not match the complete target "
            f"shape: missing={missing}, extra={extra}"
        )
    _assert_common_column_shapes(columns)
    for name, type_name, nullable, length in (
        ("candidate_cities", "JSON", False, None),
        ("employment_types", "JSON", False, None),
        ("candidate_status", "VARCHAR", True, 24),
        ("graduation_year", "SMALLINT", True, None),
    ):
        _assert_column_shape(
            columns,
            name,
            type_name=type_name,
            nullable=nullable,
            length=length,
        )


def _detect_schema_state(connection: sa.engine.Connection) -> SchemaState:
    """Accept exactly one complete input shape and fail before any DDL."""
    columns, checks = _schema_columns_and_checks(connection)
    column_names = set(columns)
    if column_names == _LEGACY_COLUMNS and checks == _LEGACY_CHECKS:
        _assert_legacy_schema(connection)
        return "legacy"
    if column_names == _TARGET_COLUMNS and checks == _TARGET_CHECKS:
        _assert_target_schema(connection)
        return "target"

    missing_legacy = sorted(_LEGACY_COLUMNS - column_names)
    extra_legacy = sorted(column_names - _LEGACY_COLUMNS)
    missing_target = sorted(_TARGET_COLUMNS - column_names)
    extra_target = sorted(column_names - _TARGET_COLUMNS)
    raise RuntimeError(
        "0051 user_profiles schema is unsupported or partially applied; "
        "expected the complete legacy or target shape, "
        f"legacy_missing={missing_legacy}, legacy_extra={extra_legacy}, "
        f"target_missing={missing_target}, target_extra={extra_target}"
    )


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


def _preflight_rows(connection: sa.engine.Connection) -> list[ProfileSnapshot]:
    selected_columns = sorted(_LEGACY_COLUMNS)
    rows = (
        connection.execute(
            sa.text(
                "SELECT "
                + ", ".join(f"`{column}`" for column in selected_columns)
                + " FROM user_profiles ORDER BY id FOR UPDATE"
            )
        )
        .mappings()
        .all()
    )
    snapshots: list[ProfileSnapshot] = []
    for source in rows:
        row = dict(source)
        row_id = row["id"]
        positions = _decode_json_array(
            row["target_positions"],
            field=f"user_profiles[{row_id}].target_positions",
        )
        if len(positions) > 20 or any(
            not isinstance(value, str) or len(value) > 100 for value in positions
        ):
            raise RuntimeError(
                f"user_profiles[{row_id}].target_positions cannot fit the 0051 contract"
            )
        for field in (
            "exclusions",
            "target_companies",
            "school_tier",
            "languages",
            "skills",
            "certifications",
            "honors",
            "campus_experiences",
        ):
            _decode_json_array(row[field], field=f"user_profiles[{row_id}].{field}")

        employment_type = row["employment_type"]
        if employment_type is not None:
            employment_type = str(employment_type).strip()
            if employment_type not in _LEGACY_EMPLOYMENT_TYPES:
                raise RuntimeError(
                    f"user_profiles[{row_id}].employment_type is outside the legacy contract"
                )
        work_city = row["work_city"]
        candidate_cities = (
            []
            if work_city is None or not str(work_city).strip()
            else [str(work_city).strip()]
        )
        employment_types = _clean_employment_types(
            [] if employment_type is None else [employment_type]
        )
        snapshots.append(
            ProfileSnapshot(
                row=row,
                candidate_cities=candidate_cities,
                employment_types=employment_types,
                professional_directions=positions,
            )
        )
    return snapshots


def _preflight(connection: sa.engine.Connection) -> list[ProfileSnapshot]:
    _assert_legacy_schema(connection)
    return _preflight_rows(connection)


def _verify_rows(
    connection: sa.engine.Connection,
    snapshots: list[ProfileSnapshot],
) -> None:
    _assert_target_schema(connection)
    selected_columns = sorted(_TARGET_COLUMNS)
    rows = (
        connection.execute(
            sa.text(
                "SELECT "
                + ", ".join(f"`{column}`" for column in selected_columns)
                + " FROM user_profiles ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
    if len(rows) != len(snapshots):
        raise RuntimeError(
            "0051 changed user_profiles row count: "
            f"before={len(snapshots)} after={len(rows)}"
        )

    for source, actual_mapping in zip(snapshots, rows, strict=True):
        actual = dict(actual_mapping)
        row_id = source.row["id"]
        if actual["id"] != row_id:
            raise RuntimeError("0051 changed a user_profiles primary key")
        if _canonical(actual["candidate_cities"], field="candidate_cities") != (
            source.candidate_cities
        ):
            raise RuntimeError(
                f"0051 converted candidate_cities incorrectly for {row_id}"
            )
        if _canonical(actual["employment_types"], field="employment_types") != (
            source.employment_types
        ):
            raise RuntimeError(
                f"0051 normalized employment_types incorrectly for {row_id}"
            )
        if (
            actual["candidate_status"] is not None
            or actual["graduation_year"] is not None
        ):
            raise RuntimeError(
                f"0051 inferred candidate status for existing profile {row_id}"
            )
        for field in _RETAINED_COLUMNS:
            expected = source.row[field]
            if _canonical(actual[field], field=field) != _canonical(
                expected, field=field
            ):
                raise RuntimeError(
                    f"0051 changed retained user_profiles field {field} for {row_id}"
                )


def _verify_target_rows(connection: sa.engine.Connection) -> None:
    """Validate data when 0051 finds the already-final schema."""
    selected_columns = sorted(_TARGET_COLUMNS)
    rows = (
        connection.execute(
            sa.text(
                "SELECT "
                + ", ".join(f"`{column}`" for column in selected_columns)
                + " FROM user_profiles ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
    for source in rows:
        row = dict(source)
        row_id = row["id"]
        for field in (
            "candidate_cities",
            "employment_types",
            "school_tier",
            "languages",
            "skills",
            "certifications",
            "honors",
            "campus_experiences",
        ):
            _decode_json_array(row[field], field=f"user_profiles[{row_id}].{field}")
        employment_types = _decode_json_array(
            row["employment_types"],
            field=f"user_profiles[{row_id}].employment_types",
        )
        if _clean_employment_types(employment_types) != employment_types:
            raise RuntimeError(
                f"user_profiles[{row_id}].employment_types contains unsupported or duplicate values"
            )


def _verify(connection: sa.engine.Connection, snapshots: list[ProfileSnapshot]) -> None:
    _verify_rows(connection, snapshots)


def upgrade() -> None:
    connection = op.get_bind()
    state = _detect_schema_state(connection)
    if state == "target":
        _verify_target_rows(connection)
        return

    snapshots = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0051.up.sql")
    _verify(connection, snapshots)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
