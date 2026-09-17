"""Repair the historical logo migration split and add its fingerprint.

One shared Development database applied the original ``0059`` revision, which
created ``user_preferences``.  The repository later reused that revision ID for
the company-logo schema that Production applied.  Both databases therefore
legitimately report ``0061`` while only Production has ``global_companies`` and
``job_descriptions.logo_url``.

This revision accepts those two complete inputs and the known retry prefixes
where MySQL already committed either the added ``logo_url`` column or the full
target DDL.  The legacy Development shape receives the missing additive 0059
DDL before both shapes receive ``logo_sha256``.  Unknown partial shapes are
rejected before DDL so an unregistered drift cannot be silently normalized.

Revision ID: 0062
Revises: 0061
Create Date: 2026-09-13 17:23:02.369163
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal

import sqlalchemy as sa
from alembic import op
from linkresume.core.migration_sql import execute_sql_file

revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"

SchemaState = Literal[
    "legacy_development",
    "legacy_development_logo_url_added",
    "company_logo_ready",
    "target_ddl_committed",
]

_GLOBAL_COMPANY_COLUMNS = {
    "id",
    "company_name",
    "normalized_name",
    "legal_name",
    "logo_url",
    "website_url",
    "industry",
    "company_size",
    "financing_stage",
    "description",
    "created_at",
    "updated_at",
}
_GLOBAL_COMPANY_UNIQUE_CONSTRAINTS = {"uk_global_companies_normalized_name"}
_GLOBAL_COMPANY_CHECK_CONSTRAINTS = {
    "ck_global_companies_company_name_not_blank",
    "ck_global_companies_normalized_name_not_blank",
}


def _assert_global_companies_shape(connection: sa.engine.Connection) -> None:
    inspector = sa.inspect(connection)
    columns = {
        str(column["name"]) for column in inspector.get_columns("global_companies")
    }
    unique_constraints = {
        str(constraint["name"])
        for constraint in inspector.get_unique_constraints("global_companies")
    }
    check_constraints = {
        str(constraint["name"])
        for constraint in inspector.get_check_constraints("global_companies")
    }
    if columns != _GLOBAL_COMPANY_COLUMNS:
        raise RuntimeError(
            "0062 global_companies schema is unsupported: "
            f"missing={sorted(_GLOBAL_COMPANY_COLUMNS - columns)}, "
            f"extra={sorted(columns - _GLOBAL_COMPANY_COLUMNS)}"
        )
    if unique_constraints != _GLOBAL_COMPANY_UNIQUE_CONSTRAINTS:
        raise RuntimeError(
            "0062 global_companies unique constraints are unsupported: "
            f"expected={sorted(_GLOBAL_COMPANY_UNIQUE_CONSTRAINTS)}, "
            f"actual={sorted(unique_constraints)}"
        )
    if not _GLOBAL_COMPANY_CHECK_CONSTRAINTS <= check_constraints:
        raise RuntimeError(
            "0062 global_companies checks are unsupported: "
            f"missing={sorted(_GLOBAL_COMPANY_CHECK_CONSTRAINTS - check_constraints)}"
        )


def _assert_logo_url_shape(job_columns: dict[str, dict[str, Any]]) -> None:
    logo_url = job_columns["logo_url"]
    if getattr(logo_url["type"], "length", None) != 2048:
        raise RuntimeError("0062 job_descriptions.logo_url has the wrong length")
    if not logo_url["nullable"]:
        raise RuntimeError("0062 job_descriptions.logo_url must remain nullable")


def _assert_logo_sha256_shape(job_columns: dict[str, dict[str, Any]]) -> None:
    logo_sha256 = job_columns["logo_sha256"]
    if getattr(logo_sha256["type"], "length", None) != 64:
        raise RuntimeError("0062 job_descriptions.logo_sha256 has the wrong length")
    if not logo_sha256["nullable"]:
        raise RuntimeError("0062 job_descriptions.logo_sha256 must remain nullable")


def _detect_schema_state(connection: sa.engine.Connection) -> SchemaState:
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())
    if "job_descriptions" not in tables:
        raise RuntimeError("0062 requires the job_descriptions table")

    job_columns = {
        str(column["name"]): column
        for column in inspector.get_columns("job_descriptions")
    }
    has_logo_url = "logo_url" in job_columns
    has_logo_sha256 = "logo_sha256" in job_columns
    has_global_companies = "global_companies" in tables
    has_legacy_marker = "user_preferences" in tables

    if has_logo_url and has_logo_sha256 and has_global_companies:
        _assert_logo_url_shape(job_columns)
        _assert_logo_sha256_shape(job_columns)
        _assert_global_companies_shape(connection)
        return "target_ddl_committed"
    if has_logo_sha256:
        raise RuntimeError("0062 logo_sha256 exists in an incomplete schema")
    if has_logo_url and has_global_companies:
        _assert_logo_url_shape(job_columns)
        _assert_global_companies_shape(connection)
        return "company_logo_ready"
    if not has_logo_url and not has_global_companies and has_legacy_marker:
        return "legacy_development"
    if has_logo_url and not has_global_companies and has_legacy_marker:
        _assert_logo_url_shape(job_columns)
        return "legacy_development_logo_url_added"

    raise RuntimeError(
        "0062 company-logo schema is unsupported or partially applied: "
        f"logo_url={has_logo_url}, global_companies={has_global_companies}, "
        f"user_preferences={has_legacy_marker}"
    )


def _assert_target_schema(connection: sa.engine.Connection) -> None:
    inspector = sa.inspect(connection)
    job_columns = {
        str(column["name"]): column
        for column in inspector.get_columns("job_descriptions")
    }
    for name in ("logo_url", "logo_sha256"):
        if name not in job_columns:
            raise RuntimeError(f"0062 did not create job_descriptions.{name}")
    _assert_logo_url_shape(job_columns)
    _assert_logo_sha256_shape(job_columns)
    _assert_global_companies_shape(connection)


def upgrade() -> None:
    connection = op.get_bind()
    state = _detect_schema_state(connection)
    if state != "target_ddl_committed":
        execute_sql_file(connection, SQL_DIR / "0062.up.sql")
    _assert_target_schema(connection)


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
