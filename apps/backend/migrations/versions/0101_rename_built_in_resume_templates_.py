"""rename built-in resume templates artistically.

Revision ID: 0101
Revises: 0100
Create Date: 2026-10-01 11:43:15.957629
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from drawoffer.core.migration_sql import execute_sql_file

revision: str = '0101'
down_revision: str | None = '0100'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0101.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
