"""新增用户私有 JD 单表。

版本编号：0007
上一版本：0006
创建时间：2026-07-29 00:00:00.000000
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0007.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0007.down.sql")
