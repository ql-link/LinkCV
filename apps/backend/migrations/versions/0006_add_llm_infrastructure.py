"""新增统一大模型基础设施。

版本编号：0006
上一版本：0005
创建时间：2026-07-28 00:00:00.000000
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0006.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0006.down.sql")
