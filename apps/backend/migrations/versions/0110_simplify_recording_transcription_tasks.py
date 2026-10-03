"""simplify recording transcription tasks.

Revision ID: 0110
Revises: 0109
Create Date: 2026-10-04 01:11:42.935605
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import inspect, text
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0110'
down_revision: str | None = '0109'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    columns = {column["name"] for column in inspect(connection).get_columns("dataset_transcription_tasks")}
    if "lease_until" not in columns:
        return  # MySQL DDL committed, but a previous version-table write failed.
    if connection.scalar(text("SELECT COUNT(*) FROM dataset_transcription_tasks WHERE status IN ('queued','submitting','transcribing')")):
        raise RuntimeError("Finish or cancel active recording transcriptions, stop the old API/Worker, then retry 0110")
    execute_sql_file(connection, SQL_DIR / "0110.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
