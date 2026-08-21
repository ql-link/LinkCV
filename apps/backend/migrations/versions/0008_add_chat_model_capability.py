"""新增 Chat 候选模型、能力当前绑定与调用快照。

版本编号：0008
上一版本：0007
创建时间：2026-07-31 00:00:00.000000

本 revision 不迁移旧模型配置和调用日志。upgrade 在执行 DDL 前按外键
依赖顺序清空两张旧表，再建立新的 Chat 能力结构。数据删除和 DDL 均位于
配对 SQL 文件，downgrade 不恢复被清理的旧数据。
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0008.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0008.down.sql")
