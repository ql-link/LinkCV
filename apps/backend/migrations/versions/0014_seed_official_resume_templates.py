"""seed official resume templates.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-07 22:19:20.343924
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = '0014'
down_revision: str | None = '0013'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0014.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
