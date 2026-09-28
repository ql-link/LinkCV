"""remove dataset replacement and cleanup tables.

Revision ID: 0089
Revises: 0088
Create Date: 2026-09-27 20:32:52.697840
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import inspect, text
from linkresume.core.llm_schema_repair import model_config_schema_state
from linkresume.core.migration_sql import execute_sql_file

revision: str = '0089'
down_revision: str | None = '0088'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    # Direct Alembic invocations must also reject unknown/occupied 0088
    # layouts before this revision drops legacy data tables.
    if connection.dialect.name == "mysql":
        model_config_schema_state(connection)
    # Object storage cannot be cleaned by SQL. Refuse to discard its last
    # references until the maintenance command has drained both legacy tables.
    tables = set(inspect(connection).get_table_names())
    for table in ("dataset_replacements", "dataset_object_cleanup"):
        if table in tables and connection.scalar(text(f"SELECT COUNT(*) FROM {table}")):
            raise RuntimeError(
                "Stop API/Workers and run scripts/release/retire_dataset_operations.py "
                "before upgrading to 0089"
            )
    execute_sql_file(connection, SQL_DIR / "0089.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
