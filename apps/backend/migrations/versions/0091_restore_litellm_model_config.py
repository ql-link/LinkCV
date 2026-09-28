"""restore LiteLLM model config schema after the provider-layer revert.

Revision ID: 0091
Revises: 0090
"""

from collections.abc import Sequence
from pathlib import Path

from alembic import op
from linkresume.core.llm_schema_repair import model_config_schema_state
from linkresume.core.migration_sql import execute_sql_file

revision: str = "0091"
down_revision: str | None = "0090"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"


def upgrade() -> None:
    connection = op.get_bind()
    if model_config_schema_state(connection) == "provider":
        execute_sql_file(connection, SQL_DIR / "0091.up.sql")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
