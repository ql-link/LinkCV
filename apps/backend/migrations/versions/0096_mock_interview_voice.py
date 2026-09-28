"""Add voice answering fields to AI mock interviews.

Revision ID: 0096
Revises: 0095
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkresume.core.migration_sql import execute_sql_file

revision: str = "0096"
down_revision: str | None = "0095"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0096.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
