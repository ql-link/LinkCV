"""Restructure user profile fields and remove obsolete data.

The 0046 migration has no compatibility window.  It converts the three
reusable 0044 fields before physically removing the old columns, and leaves
candidate status and graduation year unset for existing rows because those
values cannot be inferred reliably from the old profile.

The paired SQL is intentionally destructive.  The preflight rejects a schema
or row that does not match the 0044 contract, and the postflight verifies the
complete retained row boundary and final schema.  A failed postflight after
DDL must be recovered from the pre-migration backup or repaired by a new
forward revision; this migration cannot be downgraded.

Revision ID: 0046
Revises: 0045
Create Date: 2026-08-28
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
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
_REMOVED_COLUMNS = {
    "work_city",
    "employment_type",
    "work_mode",
    "target_positions",
    "exclusions",
    "target_companies",
    "availability",
    "available_from",
    "birth_date",
}
_TARGET_COLUMNS = (_LEGACY_COLUMNS - _REMOVED_COLUMNS) | {
    "candidate_cities",
    "employment_types",
    "professional_directions",
    "candidate_status",
    "graduation_year",
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
_TARGET_CHECKS = (_LEGACY_CHECKS - {
    "ck_user_profiles_employment_type",
    "ck_user_profiles_work_mode",
    "ck_user_profiles_availability",
    "ck_user_profiles_available_from_context",
    "ck_user_profiles_target_positions_array",
    "ck_user_profiles_exclusions_array",
    "ck_user_profiles_target_companies_array",
}) | {
    "ck_user_profiles_candidate_cities_array",
    "ck_user_profiles_employment_types_array",
    "ck_user_profiles_professional_directions_array",
    "ck_user_profiles_candidate_status",
    "ck_user_profiles_graduation_year",
    "ck_user_profiles_candidate_experience_context",
}
_CONVERTED_COLUMNS = (
    "candidate_cities",
    "employment_types",
    "professional_directions",
)
_RETAINED_COLUMNS = tuple(
    sorted(
        _TARGET_COLUMNS
        - set(_CONVERTED_COLUMNS)
        - {"candidate_status", "graduation_year"}
    )
)
_EMPLOYMENT_TYPES = {
    "full_time",
    "part_time",
    "internship",
    "contract",
    "temporary",
}


@dataclass(frozen=True)
class ProfileSnapshot:
    """Values needed to verify conversion and all retained fields."""

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
    if field in {
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
        "professional_directions",
    }:
        return _decode_json_array(value, field=field)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8")
    return value


def _assert_legacy_schema(connection: sa.engine.Connection) -> None:
    inspector = sa.inspect(connection)
    if "user_profiles" not in inspector.get_table_names():
        raise RuntimeError("0046 requires the 0043 user_profiles table")
    columns = {str(column["name"]): column for column in inspector.get_columns("user_profiles")}
    if set(columns) != _LEGACY_COLUMNS:
        missing = sorted(_LEGACY_COLUMNS - set(columns))
        extra = sorted(set(columns) - _LEGACY_COLUMNS)
        raise RuntimeError(
            "user_profiles schema does not match 0044: "
            f"missing={missing}, extra={extra}"
        )

    checks = {
        str(constraint["name"])
        for constraint in inspector.get_check_constraints("user_profiles")
        if constraint.get("name")
    }
    if checks != _LEGACY_CHECKS:
        missing = sorted(_LEGACY_CHECKS - checks)
        extra = sorted(checks - _LEGACY_CHECKS)
        raise RuntimeError(
            "user_profiles checks do not match 0044: "
            f"missing={missing}, extra={extra}"
        )

    required_shapes = {
        "work_city": ("VARCHAR", 100, True),
        "employment_type": ("VARCHAR", 24, True),
        "work_mode": ("VARCHAR", 16, True),
        "target_positions": ("JSON", None, False),
        "exclusions": ("JSON", None, False),
        "target_companies": ("JSON", None, False),
        "salary_currency": ("CHAR", 3, True),
        "years_experience": ("INTEGER", None, True),
    }
    for name, (type_name, length, nullable) in required_shapes.items():
        column = columns[name]
        actual_name = column["type"].__class__.__name__.upper()
        if type_name not in actual_name:
            raise RuntimeError(
                f"user_profiles.{name} has unexpected type {actual_name}"
            )
        if length is not None and getattr(column["type"], "length", None) != length:
            raise RuntimeError(
                f"user_profiles.{name} has unexpected length "
                f"{getattr(column['type'], 'length', None)}"
            )
        if bool(column["nullable"]) != nullable:
            raise RuntimeError(
                f"user_profiles.{name} has unexpected nullability"
            )


def _preflight_rows(connection: sa.engine.Connection) -> list[ProfileSnapshot]:
    selected_columns = sorted(_LEGACY_COLUMNS)
    rows = connection.execute(
        sa.text(
            "SELECT "
            + ", ".join(f"`{column}`" for column in selected_columns)
            + " FROM user_profiles ORDER BY id FOR UPDATE"
        )
    ).mappings().all()
    snapshots: list[ProfileSnapshot] = []
    for source in rows:
        row = dict(source)
        row_id = row["id"]
        positions = _decode_json_array(
            row["target_positions"], field=f"user_profiles[{row_id}].target_positions"
        )
        if len(positions) > 20 or any(
            not isinstance(value, str) or len(value) > 100 for value in positions
        ):
            raise RuntimeError(
                f"user_profiles[{row_id}].target_positions cannot fit the 0046 contract"
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
            if employment_type not in _EMPLOYMENT_TYPES:
                raise RuntimeError(
                    f"user_profiles[{row_id}].employment_type is outside 0044 contract"
                )
        work_city = row["work_city"]
        candidate_cities = [] if work_city is None or not str(work_city).strip() else [
            str(work_city).strip()
        ]
        employment_types = [] if employment_type is None else [employment_type]
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


def _assert_target_schema(connection: sa.engine.Connection) -> None:
    inspector = sa.inspect(connection)
    columns = {str(column["name"]): column for column in inspector.get_columns("user_profiles")}
    if set(columns) != _TARGET_COLUMNS:
        missing = sorted(_TARGET_COLUMNS - set(columns))
        extra = sorted(set(columns) - _TARGET_COLUMNS)
        raise RuntimeError(
            "user_profiles schema does not match 0046: "
            f"missing={missing}, extra={extra}"
        )
    checks = {
        str(constraint["name"])
        for constraint in inspector.get_check_constraints("user_profiles")
        if constraint.get("name")
    }
    if checks != _TARGET_CHECKS:
        missing = sorted(_TARGET_CHECKS - checks)
        extra = sorted(checks - _TARGET_CHECKS)
        raise RuntimeError(
            "user_profiles checks do not match 0046: "
            f"missing={missing}, extra={extra}"
        )
    required_shapes = {
        "candidate_cities": ("JSON", None, False),
        "employment_types": ("JSON", None, False),
        "professional_directions": ("JSON", None, False),
        "candidate_status": ("VARCHAR", 24, True),
        "graduation_year": ("SMALLINT", None, True),
    }
    for name, (type_name, length, nullable) in required_shapes.items():
        column = columns[name]
        actual_name = column["type"].__class__.__name__.upper()
        if type_name not in actual_name:
            raise RuntimeError(
                f"user_profiles.{name} has unexpected type {actual_name}"
            )
        if length is not None and getattr(column["type"], "length", None) != length:
            raise RuntimeError(
                f"user_profiles.{name} has unexpected length "
                f"{getattr(column['type'], 'length', None)}"
            )
        if bool(column["nullable"]) != nullable:
            raise RuntimeError(
                f"user_profiles.{name} has unexpected nullability"
            )


def _verify_rows(
    connection: sa.engine.Connection, snapshots: list[ProfileSnapshot]
) -> None:
    selected_columns = sorted(_TARGET_COLUMNS)
    rows = connection.execute(
        sa.text(
            "SELECT "
            + ", ".join(f"`{column}`" for column in selected_columns)
            + " FROM user_profiles ORDER BY id"
        )
    ).mappings().all()
    if len(rows) != len(snapshots):
        raise RuntimeError(
            "0046 changed user_profiles row count: "
            f"before={len(snapshots)} after={len(rows)}"
        )

    for source, actual_mapping in zip(snapshots, rows, strict=True):
        actual = dict(actual_mapping)
        row_id = source.row["id"]
        if actual["id"] != row_id:
            raise RuntimeError("0046 changed a user_profiles primary key")
        if _canonical(actual["candidate_cities"], field="candidate_cities") != source.candidate_cities:
            raise RuntimeError(f"0046 converted candidate_cities incorrectly for {row_id}")
        if _canonical(actual["employment_types"], field="employment_types") != source.employment_types:
            raise RuntimeError(f"0046 converted employment_types incorrectly for {row_id}")
        if _canonical(actual["professional_directions"], field="professional_directions") != source.professional_directions:
            raise RuntimeError(
                f"0046 converted professional_directions incorrectly for {row_id}"
            )
        if actual["candidate_status"] is not None or actual["graduation_year"] is not None:
            raise RuntimeError(
                f"0046 inferred candidate status for existing profile {row_id}"
            )
        for field in _RETAINED_COLUMNS:
            expected = source.row[field]
            if _canonical(actual[field], field=field) != _canonical(expected, field=field):
                raise RuntimeError(
                    f"0046 changed retained user_profiles field {field} for {row_id}"
                )


def _verify(
    connection: sa.engine.Connection, snapshots: list[ProfileSnapshot]
) -> None:
    _assert_target_schema(connection)
    _verify_rows(connection, snapshots)


def upgrade() -> None:
    connection = op.get_bind()
    snapshots = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0046.up.sql")
    _verify(connection, snapshots)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
