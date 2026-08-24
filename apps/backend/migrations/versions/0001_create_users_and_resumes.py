"""create users and resumes.

Revision ID: 0001
Revises:
Create Date: 2026-07-25 16:36:42.269791
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0001.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
