"""0094 is forward-only and its SQL matches the ORM constraint and index names."""

import importlib.util
import re
from pathlib import Path

import pytest

from linkresume.modules.announcements.models import Announcement, AnnouncementReadCursor
from tests.migration_naming import current_columns, current_object_names

ROOT = Path(__file__).resolve().parents[5]
MIGRATIONS = ROOT / "apps/backend/migrations"
SPEC = importlib.util.spec_from_file_location(
    "add_announcements_0094", next((MIGRATIONS / "versions").glob("0094_*.py"))
)
assert SPEC is not None and SPEC.loader is not None
revision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(revision)
SQL = (MIGRATIONS / "sql/0094.up.sql").read_text(encoding="utf-8")
# Table names as 0094 created them; later revisions renamed them.
HISTORICAL_TABLES = {Announcement: "announcements", AnnouncementReadCursor: "announcement_read_cursors"}


def test_revision_chain_and_forward_only() -> None:
    assert revision.revision == "0094"
    assert revision.down_revision == "0093"
    assert not (MIGRATIONS / "sql/0094.down.sql").exists()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def orm_names(model) -> set[str]:
    table = model.__table__
    names = {c.name for c in table.constraints if c.name}
    names |= {i.name for i in table.indexes}
    names |= {fk.name for fk in table.foreign_keys if fk.name}
    return names


@pytest.mark.parametrize("model", [Announcement, AnnouncementReadCursor])
def test_sql_declares_every_orm_constraint_and_index(model) -> None:
    sql_names = set(re.findall(r"\b((?:pk|fk|ck|idx|uk)_[a-z_]+)\b", SQL))
    assert orm_names(model) <= current_object_names(HISTORICAL_TABLES[model], sql_names)


def test_sql_columns_match_orm_columns() -> None:
    for model in (Announcement, AnnouncementReadCursor):
        table = HISTORICAL_TABLES[model]
        body = SQL.split(f"CREATE TABLE {table} (", 1)[1].split(") ENGINE", 1)[0]
        declared = {
            match.group(1)
            for match in re.finditer(r"^\s{2}([a-z_]+)\s+[A-Z]", body, re.M)
            if match.group(1) not in {"CONSTRAINT", "INDEX"}
        }
        assert current_columns(table, declared) == {column.name for column in model.__table__.columns}
