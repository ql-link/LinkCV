"""boolean_is_prefix_conventions.

Revision ID: 0112
Revises: 0111
Create Date: 2026-10-05 12:21:39.190014
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from drawoffer.core.migration_sql import execute_sql_file

revision: str = '0112'
down_revision: str | None = '0111'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0112.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
