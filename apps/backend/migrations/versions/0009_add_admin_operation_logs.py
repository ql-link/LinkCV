"""新增管理员操作审计日志表。

版本编号：0009
上一版本：0008
创建时间：2026-07-31 00:00:00.000000
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0009.up.sql")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
