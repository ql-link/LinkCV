"""add scoped agent proposals.

Revision ID: 0031
Revises: 0030
Create Date: 2026-08-23 21:16:13.032397
"""

from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0031.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
