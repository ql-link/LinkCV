"""retire interview assets and resume versions.

Revision ID: 0090
Revises: 0089
Create Date: 2026-09-27 20:50:04.949752
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import inspect, text
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0090'
down_revision: str | None = '0089'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    # SQL cannot transfer object-storage files. Require the one-time migration
    # to have drained the old table before dropping its final references.
    if "interview_assets" in inspect(connection).get_table_names():
        if connection.scalar(text("SELECT COUNT(*) FROM interview_assets")):
            raise RuntimeError(
                "Migrate interview assets before 0090: run apps/backend/scripts/release/"
                "migrate_interview_assets.py --execute with API/Workers stopped"
            )
    execute_sql_file(connection, SQL_DIR / "0090.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
