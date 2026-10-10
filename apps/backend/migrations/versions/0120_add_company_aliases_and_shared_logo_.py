"""add company aliases and shared logo management.

Revision ID: 0120
Revises: 0119
Create Date: 2026-10-10 03:28:06.326573
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0120'
down_revision: str | None = '0119'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0120.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
