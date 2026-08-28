"""add user_profiles.

Each user owns at most one structured personal profile that aggregates job
search preferences, basic information and skill lists. The row is independent
from the resume content and is the single source of truth for downstream
features such as position suggestions and AI conversation-driven optimization.

Revision ID: 0043
Revises: 0042
Create Date: 2026-08-26
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0043.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
