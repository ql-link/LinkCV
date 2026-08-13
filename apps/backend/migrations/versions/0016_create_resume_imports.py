"""create resume imports.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-08 15:57:29.873363
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import text

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0016.up.sql")


def downgrade() -> None:
    connection = op.get_bind()
    row_count = connection.scalar(text("SELECT COUNT(*) FROM resume_imports"))
    if row_count:
        raise RuntimeError(
            "0016 refuses to drop resume_imports while import records exist: "
            f"count={row_count}"
        )
    execute_sql_file(connection, SQL_DIR / "0016.down.sql")
