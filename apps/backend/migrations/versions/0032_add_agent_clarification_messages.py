"""add agent clarification messages.

Revision ID: 0032
Revises: 0031
Create Date: 2026-08-24 00:14:54.906968
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = '0032'
down_revision: str | None = '0031'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0032.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
