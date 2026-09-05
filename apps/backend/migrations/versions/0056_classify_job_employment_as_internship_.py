"""Classify job employment as internship campus or formal.

Revision ID: 0056
Revises: 0055
Create Date: 2026-09-05 13:18:10.667616
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = '0056'
down_revision: str | None = '0055'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0056.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
