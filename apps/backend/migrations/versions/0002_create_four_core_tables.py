"""create four core tables.

The Python preflight is intentionally limited to verifying that every existing
business table is empty. MySQL DDL commits implicitly, so this check also makes
the SQL-first revision safe to retry after a partially applied empty-schema
migration. All schema changes remain in the paired SQL files.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-26 12:41:18.353451
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
BUSINESS_TABLES = ("resume_versions", "resumes", "resume_templates", "users")


def require_empty_business_tables(connection: Connection) -> None:
    existing = set(inspect(connection).get_table_names())
    non_empty: dict[str, int] = {}
    for table in BUSINESS_TABLES:
        if table not in existing:
            continue
        row_count = connection.scalar(text(f"SELECT COUNT(*) FROM `{table}`"))
        if row_count:
            non_empty[table] = int(row_count)
    if non_empty:
        details = ", ".join(
            f"{table}={row_count}" for table, row_count in non_empty.items()
        )
        raise RuntimeError(
            "0002 only supports empty business tables; refusing destructive "
            f"schema replacement: {details}"
        )


def upgrade() -> None:
    connection = op.get_bind()
    require_empty_business_tables(connection)
    execute_sql_file(connection, SQL_DIR / "0002.up.sql")


def downgrade() -> None:
    connection = op.get_bind()
    require_empty_business_tables(connection)
    execute_sql_file(connection, SQL_DIR / "0002.down.sql")
