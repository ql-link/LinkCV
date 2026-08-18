"""unify document parse tasks.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-18 17:29:39.500426
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import text

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0021.up.sql")


def downgrade() -> None:
    connection = op.get_bind()
    other_task_count = connection.scalar(
        text(
            "SELECT COUNT(*) FROM document_parse_tasks "
            "WHERE source_type <> 'resume_import'"
        )
    )
    if other_task_count:
        raise RuntimeError(
            "0021 refuses downgrade while non-resume document parse tasks exist: "
            f"count={other_task_count}"
        )
    execute_sql_file(connection, SQL_DIR / "0021.down.sql")
