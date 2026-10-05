"""0099 is forward-only and its SQL matches the new ORM table and column."""

import importlib.util
import re
from pathlib import Path

import pytest

from linkresume.modules.datasets.models import UserDatasetRagSync
from linkresume.modules.mock_interviews.models import MockInterview

ROOT = Path(__file__).resolve().parents[5]
MIGRATIONS = ROOT / "apps/backend/migrations"
SPEC = importlib.util.spec_from_file_location(
    "add_dataset_rag_sync_0099", next((MIGRATIONS / "versions").glob("0099_*.py"))
)
assert SPEC is not None and SPEC.loader is not None
revision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(revision)
SQL = (MIGRATIONS / "sql/0099.up.sql").read_text(encoding="utf-8")
BODY = SQL.split("CREATE TABLE user_dataset_rag_sync (", 1)[1].split(") ENGINE", 1)[0]


def test_revision_chain_and_forward_only() -> None:
    assert revision.revision == "0099"
    assert revision.down_revision == "0098"
    assert not (MIGRATIONS / "sql/0099.down.sql").exists()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_sql_matches_orm_table() -> None:
    table = UserDatasetRagSync.__table__
    declared = {
        m.group(1)
        for m in re.finditer(r"^\s{2}([a-z_]+)\s+[A-Z]", BODY, re.M)
        if m.group(1) not in {"CONSTRAINT", "INDEX"}
    }
    assert declared == {column.name for column in table.columns}
    names = {c.name for c in table.constraints if c.name} | {i.name for i in table.indexes}
    assert names <= set(re.findall(r"\b((?:pk|fk|ck|idx|uk)_[a-z_]+)\b", SQL))
    assert not table.foreign_keys  # rows outlive deleted datasets on purpose


def test_mock_interview_switch_defaults_off() -> None:
    assert "ADD COLUMN materials_in_questions BOOL NOT NULL DEFAULT false" in SQL
    column = MockInterview.__table__.c.is_materials_in_questions
    assert column.nullable is False and column.server_default.arg == "0"
