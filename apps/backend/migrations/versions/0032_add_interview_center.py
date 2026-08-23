"""add interview center.

Revision ID: 0032
Revises: 0031
Create Date: 2026-08-23 23:31:57.497748
"""

from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import text
from linkcv.core.migration_sql import execute_sql_file

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0032.up.sql")


def downgrade() -> None:
    connection = op.get_bind()
    counts = {
        table_name: int(
            connection.scalar(text(f"SELECT COUNT(*) FROM {table_name}")) or 0
        )
        for table_name in (
            "job_applications",
            "interview_sessions",
            "interview_assets",
        )
    }
    if any(counts.values()):
        summary = ", ".join(f"{name}={count}" for name, count in counts.items())
        raise RuntimeError(
            "0032 refuses to drop interview center tables while records exist: "
            f"{summary}"
        )
    execute_sql_file(connection, SQL_DIR / "0032.down.sql")
