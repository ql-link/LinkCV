"""add agent operation trace.

Revision ID: 0083
Revises: 0082
Create Date: 2026-09-24 04:14:59.062892
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0083'
down_revision: str | None = '0082'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0083.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
