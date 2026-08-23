"""unify document parse tasks.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-18 17:29:39.500426
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0021.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
