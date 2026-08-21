"""set resume template delete null.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-26 14:03:10.224270
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from sqlalchemy import text

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0003.up.sql")


def downgrade() -> None:
    connection = op.get_bind()
    missing_template_count = connection.scalar(
        text(
            "SELECT COUNT(*) FROM resumes "
            "WHERE source_type = 'template' AND template_id IS NULL"
        )
    )
    if missing_template_count:
        raise RuntimeError(
            "0003 downgrade cannot restore deleted template references; "
            f"template resumes without template_id={int(missing_template_count)}"
        )
    execute_sql_file(connection, SQL_DIR / "0003.down.sql")
