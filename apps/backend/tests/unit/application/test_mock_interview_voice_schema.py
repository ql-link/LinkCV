"""SQL-first migration 0095 and the ORM must describe the same columns."""

from __future__ import annotations

import re
from pathlib import Path

from linkresume.modules.mock_interviews.models import MockInterview, MockInterviewQuestion

SQL = (Path(__file__).resolve().parents[3] / "migrations/sql/0095.up.sql").read_text(encoding="utf-8")


def _added(table: str) -> set[str]:
    block = SQL.split(f"ALTER TABLE {table}\n", 1)[1].split(";", 1)[0]
    return set(re.findall(r"ADD COLUMN (\w+)", block))


def _constraints(table: str) -> set[str]:
    block = SQL.split(f"ALTER TABLE {table}\n", 1)[1].split(";", 1)[0]
    return set(re.findall(r"ADD CONSTRAINT (\w+)", block))


def _orm_checks(model) -> set[str]:
    return {item.name for item in model.__table__.constraints if item.name and item.name.startswith("ck_")}


def test_0095_columns_and_checks_match_orm() -> None:
    for model in (MockInterview, MockInterviewQuestion):
        table = model.__tablename__
        added = _added(table)
        assert added and added <= set(model.__table__.columns.keys())
        assert _constraints(table) <= _orm_checks(model)
