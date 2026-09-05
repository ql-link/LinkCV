"""Add application stage history and lifecycle.

Revision ID: 0057
Revises: 0056
Create Date: 2026-09-05
"""
from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from sqlalchemy import text

revision: str = "0057"
down_revision: str | None = "0056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    bind = op.get_bind()
    execute_sql_file(bind, SQL_DIR / "0057.up.sql")
    orphaned_sessions = bind.execute(
        text(
            "SELECT COUNT(*) FROM interview_sessions "
            "WHERE application_stage_id IS NULL"
        )
    ).scalar_one()
    invalid_current_stages = bind.execute(
        text(
            "SELECT COUNT(*) FROM job_applications AS application "
            "LEFT JOIN job_application_stages AS stage "
            "ON stage.application_id = application.id "
            "AND stage.current_marker = 1 "
            "WHERE application.lifecycle_status = 'active' "
            "AND application.applied_at IS NOT NULL "
            "AND stage.id IS NULL"
        )
    ).scalar_one()
    if orphaned_sessions or invalid_current_stages:
        raise RuntimeError(
            "0057 stage backfill validation failed: "
            f"orphaned_sessions={orphaned_sessions}, "
            f"invalid_current_stages={invalid_current_stages}"
        )


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
