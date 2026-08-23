"""add storage cleanup jobs.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-27 12:37:27.764876
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0004.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
