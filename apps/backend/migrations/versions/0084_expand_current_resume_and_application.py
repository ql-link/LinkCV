"""expand current resume and application resume association.

Revision ID: 0084
Revises: 0083
Create Date: 2026-09-23 22:40:12.841019
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0084'
down_revision: str | None = '0083'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0084.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
