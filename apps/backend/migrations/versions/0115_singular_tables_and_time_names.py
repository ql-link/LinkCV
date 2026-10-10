"""singular_tables_and_time_names.

Revision ID: 0115
Revises: 0114
Create Date: 2026-10-05 12:21:42.082985
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from drawoffer.core.migration_sql import execute_sql_file

revision: str = '0115'
down_revision: str | None = '0114'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0115.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
