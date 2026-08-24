"""add classic technical resume template.

Revision ID: 0024
Revises: 0023
Create Date: 2026-08-20 23:31:11.403030
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = '0024'
down_revision: str | None = '0023'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0024.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
