"""Exercise 0100 on an explicitly configured disposable MySQL, without DDL."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from linkresume.core.migration_sql import execute_sql_file

SQL = Path(__file__).resolve().parents[3] / "migrations/sql/0100.up.sql"


@pytest.fixture
def db():
    raw = os.environ.get("LINKRESUME_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("Set LINKRESUME_TEST_MYSQL_URL to a disposable MySQL at head")
    url = make_url(raw)
    assert url.database == "linkresume" and url.host in {"localhost", "127.0.0.1"}
    engine = create_engine(raw)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            yield connection
        finally:
            transaction.rollback()
    engine.dispose()


def test_append_keeps_existing_catalog_and_adds_79_unclassified_items(db):
    db.execute(text("DELETE FROM resume_templates WHERE `key` LIKE 'muse-%'"))
    before = db.execute(text("SELECT * FROM resume_templates ORDER BY id")).all()
    maximum = db.scalar(text("SELECT MAX(sort_order) FROM resume_templates"))
    execute_sql_file(db, SQL)
    assert db.execute(text("SELECT * FROM resume_templates WHERE `key` NOT LIKE 'muse-%' ORDER BY id")).all() == before
    rows = db.execute(text(
        "SELECT sort_order,style_categories_json,use_cases_json,is_active "
        "FROM resume_templates WHERE `key` LIKE 'muse-%' ORDER BY sort_order"
    )).all()
    assert len(rows) == 79
    assert [row.sort_order for row in rows] == [maximum + 10 * (index + 1) for index in range(79)]
    assert all(row.style_categories_json in (None, "[]") and row.use_cases_json in (None, "[]") and row.is_active == 1 for row in rows)


def test_rerun_preserves_admin_state_sort_and_labels(db):
    db.execute(text(
        "UPDATE resume_templates SET is_active=0,sort_order=7,"
        "style_categories_json=JSON_ARRAY('极简'),use_cases_json=JSON_ARRAY('社招') "
        "WHERE `key`='muse-badge-cn'"
    ))
    before = db.execute(text("SELECT * FROM resume_templates ORDER BY id")).all()
    execute_sql_file(db, SQL)
    assert db.execute(text("SELECT * FROM resume_templates ORDER BY id")).all() == before


def test_definition_conflict_rolls_back_partial_inserts(db):
    db.execute(text("DELETE FROM resume_templates WHERE `key` LIKE 'muse-%' AND `key` != 'muse-righttitle-cn'"))
    db.execute(text("UPDATE resume_templates SET name='管理员自定义名称' WHERE `key`='muse-righttitle-cn'"))
    before = db.execute(text("SELECT * FROM resume_templates ORDER BY id")).all()
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            execute_sql_file(db, SQL)
    assert db.execute(text("SELECT * FROM resume_templates ORDER BY id")).all() == before
