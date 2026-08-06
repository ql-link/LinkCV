"""drop admin operation logs.

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-03 23:11:00.076841
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = '0011'
down_revision: str | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0011.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0011.down.sql")
