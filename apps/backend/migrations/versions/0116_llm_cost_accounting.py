"""llm_cost_accounting.

Revision ID: 0116
Revises: 0115
Create Date: 2026-10-06 21:01:39.798765
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from drawoffer.core.migration_sql import execute_sql_file

revision: str = '0116'
down_revision: str | None = '0115'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0116.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
