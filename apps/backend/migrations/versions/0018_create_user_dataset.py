"""create user_dataset.

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-08
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0018.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
