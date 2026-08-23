"""Add resume share link fields.

每份简历一个分享链接：token、可见性、有效期与创建时间均落在 resumes 表，
分享内容不落库，读取时实时取最新正式版本。新字段全部可空，存量数据不受影响。

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-05
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
    raise RuntimeError("LinkCV database migrations are forward-only")
