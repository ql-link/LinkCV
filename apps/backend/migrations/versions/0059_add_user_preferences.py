"""add user preferences.

Revision ID: 0059
Revises: 0058
Create Date: 2026-09-11 19:08:04.614857
"""

from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = "0059"
down_revision: str | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0059.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
