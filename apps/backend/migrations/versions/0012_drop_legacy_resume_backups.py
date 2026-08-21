"""Drop obsolete legacy resume backup columns.

The discarded legacy JSON is intentionally not preserved. Downgrade restores
only the nullable column shape; recovering the deleted values requires an
external database backup.

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-04 00:18:06.710797
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0012.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0012.down.sql")
