"""The two historical 0105 schemas must converge without overwriting data."""

import importlib.util
from pathlib import Path
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parents[5]
PATH = ROOT / "apps/backend/migrations/versions/0106_complete_account.py"
SPEC = importlib.util.spec_from_file_location("account_0106", PATH)
assert SPEC is not None and SPEC.loader is not None
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


def schema(offer=False, account=False):
    columns = {name: {"id"} for name in ("users", "job_applications", "interview_sessions")}
    for present, additions, tables in (
        (offer, migration.OFFER_COLUMNS, migration.OFFER_TABLES),
        (account, migration.ACCOUNT_COLUMNS, migration.ACCOUNT_TABLES),
    ):
        if present:
            for name, values in additions.items():
                columns[name].update(values)
            columns.update({name: set(values) for name, values in tables.items()})
    inspector = Mock()
    inspector.get_table_names.side_effect = lambda: list(columns)
    inspector.get_columns.side_effect = lambda name: [{"name": x} for x in columns[name]]
    return inspector, columns


@pytest.mark.parametrize(
    ("offer", "account", "sql_files"),
    [
        (False, False, ["0105.up.sql", "0106.up.sql"]),
        (True, False, ["0106.up.sql"]),
        (False, True, ["0105.up.sql"]),
        (True, True, []),
    ],
)
def test_known_histories_only_execute_missing_sql(monkeypatch, offer, account, sql_files):
    inspector, _ = schema(offer, account)
    monkeypatch.setattr(migration, "inspect", lambda _: inspector)
    monkeypatch.setattr(migration.op, "get_bind", lambda: object())
    executed = []
    monkeypatch.setattr(migration, "execute_sql_file", lambda _, p: executed.append(p.name))
    migration.upgrade()
    assert executed == sql_files


@pytest.mark.parametrize("group", ["Offer", "account"])
def test_partial_schema_stops_before_any_ddl(monkeypatch, group):
    inspector, columns = schema()
    columns["users" if group == "account" else "job_applications"].add(
        "contact_email" if group == "account" else "offer_received_on"
    )
    monkeypatch.setattr(migration, "inspect", lambda _: inspector)
    monkeypatch.setattr(migration.op, "get_bind", lambda: object())
    execute = Mock()
    monkeypatch.setattr(migration, "execute_sql_file", execute)
    with pytest.raises(RuntimeError, match=f"partial {group} schema"):
        migration.upgrade()
    execute.assert_not_called()


def test_incompatible_existing_table_stops_before_ddl(monkeypatch):
    inspector, columns = schema(account=True)
    columns["account_preferences"].remove("locale")
    monkeypatch.setattr(migration, "inspect", lambda _: inspector)
    monkeypatch.setattr(migration.op, "get_bind", lambda: object())
    execute = Mock()
    monkeypatch.setattr(migration, "execute_sql_file", execute)
    with pytest.raises(RuntimeError, match="incompatible account table"):
        migration.upgrade()
    execute.assert_not_called()


def test_numbering_and_forward_only():
    assert migration.revision == "0106"
    assert migration.down_revision == "0105"
    with pytest.raises(RuntimeError, match="forward-only"):
        migration.downgrade()
