"""新增 Chat 候选模型、能力当前绑定与调用快照。

版本编号：0008
上一版本：0007
创建时间：2026-07-31 00:00:00.000000

本 revision 尚未进入共享环境。确认范围明确不存在需要迁移的模型配置和
调用日志，因此 upgrade 在执行 DDL 前做空表保护；发现意外存量时停止，
不猜测 adapter、模型调用名或当前绑定。DDL 仍全部位于配对 SQL 文件。
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import text

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def _assert_llm_tables_empty() -> None:
    connection = op.get_bind()
    populated = [
        table_name
        for table_name in ("llm_model_configs", "llm_call_logs")
        if connection.execute(
            text(f"SELECT COUNT(*) FROM {table_name}")
        ).scalar_one()
        > 0
    ]
    if populated:
        joined = ", ".join(populated)
        raise RuntimeError(
            "0008 requires empty LLM tables; manual migration is required for: "
            f"{joined}"
        )


def upgrade() -> None:
    _assert_llm_tables_empty()
    execute_sql_file(op.get_bind(), SQL_DIR / "0008.up.sql")


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0008.down.sql")
