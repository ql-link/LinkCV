"""remove the legacy model candidate capability column.

Revision ID: 0028
Revises: 0027
Create Date: 2026-08-21 12:00:01.000000
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0028.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0028.down.sql")
