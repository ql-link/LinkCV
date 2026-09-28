"""Preserve the published 0088 revision after the provider-layer revert.

Revision ID: 0088
Revises: 0087

The original 0088 SQL changed model configuration storage and was applied to
Development. It was later removed from Git, but an applied Alembic revision
cannot be removed from the graph. Fresh databases must not replay that
destructive provider-layer SQL after the application reverted to LiteLLM.
Revision 0091 repairs databases that already applied the original SQL.
"""

from collections.abc import Sequence
from alembic import op
from linkresume.core.llm_schema_repair import model_config_schema_state

revision: str = "0088"
down_revision: str | None = "0087"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    # Keep the original 0088.up.sql in Git as the exact published history.
    # Fresh databases must not replay its destructive provider-layer DDL.
    if model_config_schema_state(op.get_bind()) != "legacy":
        raise RuntimeError("0088 requires the pre-provider model config schema")


def downgrade() -> None:
    raise RuntimeError(
        "LinkResume database migrations are forward-only; restore a backup or create a new forward revision"
    )
