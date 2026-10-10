"""curate muse resume template catalog.

Revision ID: 0104
Revises: 0103
Create Date: 2026-10-01 21:38:44.954884
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from drawoffer.core.migration_sql import execute_sql_file

revision: str = '0104'
down_revision: str | None = '0103'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0104.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
