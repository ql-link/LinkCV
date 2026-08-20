"""add resume version names.

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-20 01:58:11.771741
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = '0023'
down_revision: str | None = '0022'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0023.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0023.down.sql")
