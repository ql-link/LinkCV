"""add wechat login users (email/password_hash nullable).

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-14 00:10:00.000000
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkcv.core.migration_sql import execute_sql_file

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0020.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
