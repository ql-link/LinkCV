"""dataset_folder_description.

Revision ID: 0118
Revises: 0117
Create Date: 2026-10-10 12:00:00.000000
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0121'
down_revision: str | None = '0120'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0121.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
