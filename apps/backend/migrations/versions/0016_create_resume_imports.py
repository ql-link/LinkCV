"""create resume imports.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-08 15:57:29.873363
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0016.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
