"""remove the legacy model candidate capability column.

Revision ID: 0029
Revises: 0028
Create Date: 2026-08-21 12:00:01.000000
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0029.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0029.down.sql")
