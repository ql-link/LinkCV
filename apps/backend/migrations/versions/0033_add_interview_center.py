"""add interview center.

Revision ID: 0033
Revises: 0032
Create Date: 2026-08-24 01:38:00.000000
"""

from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0033.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
