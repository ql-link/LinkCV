"""删除对象存储清理任务表。

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-02 15:30:31.323511
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op
from sqlalchemy import text

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    # The old application may still enqueue jobs while the deployment pipeline
    # migrates before replacing the container. MySQL's table lock closes the
    # COUNT-to-DROP race; DROP TABLE releases the lock through its implicit commit.
    connection.execute(text("LOCK TABLES storage_cleanup_jobs WRITE"))
    try:
        pending_jobs = connection.scalar(
            text("SELECT COUNT(*) FROM storage_cleanup_jobs")
        )
        if pending_jobs:
            raise RuntimeError(
                "0010 refuses to drop storage_cleanup_jobs while pending cleanup "
                f"tasks exist: count={pending_jobs}"
            )
        execute_sql_file(connection, SQL_DIR / "0010.up.sql")
    finally:
        connection.execute(text("UNLOCK TABLES"))


def downgrade() -> None:
    execute_sql_file(op.get_bind(), SQL_DIR / "0010.down.sql")
