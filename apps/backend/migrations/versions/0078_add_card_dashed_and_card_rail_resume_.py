"""add card dashed and card rail resume templates.

Revision ID: 0078
Revises: 0077
Create Date: 2026-09-21 11:26:26.397574
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0078'
down_revision: str | None = '0077'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0078.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
