"""0098 is forward-only and its SQL matches the ProductEvent ORM."""

import importlib.util
import re
from pathlib import Path

import pytest

from linkresume.modules.product_events.models import EVENT_NAMES, ProductEvent
from tests.migration_naming import current_columns, current_object_names

ROOT = Path(__file__).resolve().parents[5]
MIGRATIONS = ROOT / "apps/backend/migrations"
SPEC = importlib.util.spec_from_file_location(
    "add_product_events_0098", next((MIGRATIONS / "versions").glob("0098_*.py"))
)
assert SPEC is not None and SPEC.loader is not None
revision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(revision)
SQL = (MIGRATIONS / "sql/0098.up.sql").read_text(encoding="utf-8")
BODY = SQL.split("CREATE TABLE product_events (", 1)[1].split(") ENGINE", 1)[0]


def test_revision_chain_and_forward_only() -> None:
    assert revision.revision == "0098"
    assert revision.down_revision == "0097"
    assert not (MIGRATIONS / "sql/0098.down.sql").exists()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_sql_declares_every_orm_constraint_and_index() -> None:
    table = ProductEvent.__table__
    names = {c.name for c in table.constraints if c.name} | {i.name for i in table.indexes}
    declared = set(re.findall(r"\b((?:pk|fk|ck|idx|uk)_[a-z_]+)\b", SQL))
    assert names <= current_object_names("product_events", declared)


def test_sql_columns_match_orm_columns() -> None:
    declared = {
        m.group(1)
        for m in re.finditer(r"^\s{2}([a-z_]+)\s+[A-Z]", BODY, re.M)
        if m.group(1) not in {"CONSTRAINT", "INDEX"}
    }
    assert current_columns("product_events", declared) == {
        column.name for column in ProductEvent.__table__.columns
    }


def test_events_follow_user_deletion_and_names_match() -> None:
    assert "REFERENCES users (id) ON DELETE CASCADE" in SQL
    # 0113 drops the foreign key; account deletion removes events explicitly.
    assert not ProductEvent.__table__.foreign_keys
    for name in EVENT_NAMES:
        assert f"'{name}'" in SQL
