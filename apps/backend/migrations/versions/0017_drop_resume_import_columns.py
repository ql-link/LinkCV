"""drop resume import columns.

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-08 16:24:42.590571
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import text

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    row_count = connection.scalar(
        text("SELECT COUNT(*) FROM resumes WHERE source_type = 'import'")
    )
    if row_count:
        raise RuntimeError(
            "0017 requires legacy imported resumes to be removed first: "
            f"count={row_count}"
        )
    execute_sql_file(connection, SQL_DIR / "0017.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
