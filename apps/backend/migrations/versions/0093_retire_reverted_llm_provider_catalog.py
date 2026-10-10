"""Retire the provider catalog created by historical revision 0088.

Revision ID: 0093
Revises: 0092
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import inspect, text

from drawoffer.core.migration_sql import execute_sql_file

revision: str = "0093"
down_revision: str | None = "0092"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
LEGACY_TABLES = ("llm_provider_models", "llm_providers")


def upgrade() -> None:
    connection = op.get_bind()
    tables = set(inspect(connection).get_table_names())
    for table in LEGACY_TABLES:
        if table in tables and connection.scalar(text(f"SELECT COUNT(*) FROM {table}")):
            raise RuntimeError(
                f"Historical provider table {table} contains rows; review and export them "
                "before upgrading to 0093"
            )
    execute_sql_file(connection, SQL_DIR / "0093.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
