"""Add wechat login binding fields to users.

WeChat login users have no email or password, so both columns become
nullable. The MySQL unique index allows multiple NULL rows, so the existing
email uniqueness constraint remains valid.

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-04 00:18:06.710797
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0013.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0013.down.sql")
