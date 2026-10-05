"""0097 is forward-only, keeps existing models selectable and matches the ORM column."""

import importlib.util
import re
from pathlib import Path

import pytest

from linkresume.modules.llm.models import LLMModel

ROOT = Path(__file__).resolve().parents[5]
MIGRATIONS = ROOT / "apps/backend/migrations"
SPEC = importlib.util.spec_from_file_location(
    "add_llm_model_user_selectable_0097", next((MIGRATIONS / "versions").glob("0097_*.py"))
)
assert SPEC is not None and SPEC.loader is not None
revision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(revision)
SQL = (MIGRATIONS / "sql/0097.up.sql").read_text(encoding="utf-8")


def test_revision_chain_and_forward_only() -> None:
    assert revision.revision == "0097"
    assert revision.down_revision == "0096"
    assert not (MIGRATIONS / "sql/0097.down.sql").exists()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_sql_adds_non_null_column_defaulting_to_selectable() -> None:
    assert re.search(
        r"ALTER TABLE llm_models\s+ADD COLUMN user_selectable TINYINT\(1\) NOT NULL DEFAULT 1", SQL
    )
    column = LLMModel.__table__.c.user_selectable
    assert column.nullable is False
    assert column.server_default is not None
