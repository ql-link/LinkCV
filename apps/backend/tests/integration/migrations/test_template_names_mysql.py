"""Verify name-only catalog updates on an explicitly disposable local MySQL."""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import create_resume_from_template
from linkresume.core.migration_sql import execute_sql_file
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import ResumeTemplate

@pytest.fixture(params=["0101", "0102"])
def migration(request):
    sql = Path(__file__).resolve().parents[3] / f"migrations/sql/{request.param}.up.sql"
    renames = re.findall(
        r"UPDATE resume_templates SET name = '([^']+)'\s+"
        r"WHERE `key` = '([^']+)' AND BINARY name = BINARY '([^']+)';",
        sql.read_text(encoding="utf-8"),
    )
    return sql, renames


@pytest.fixture
def db(migration):
    _, renames = migration
    raw = os.environ.get("LINKRESUME_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("Set LINKRESUME_TEST_MYSQL_URL to a disposable MySQL at head")
    url = make_url(raw)
    assert url.database == "linkresume_curation_0104" and url.host in {"localhost", "127.0.0.1"}
    engine = create_engine(raw)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            # Reconstruct this revision's input names, with the current schema.
            connection.execute(text("UPDATE resume_templates SET name=:old WHERE `key`=:key"),
                               [{"key": key, "old": old} for _, key, old in renames])
            connection.execute(text("UPDATE resume_templates SET is_active=1 WHERE `key` LIKE 'muse-%'"))
            yield connection
        finally:
            transaction.rollback()
    engine.dispose()


def catalog(db):
    return [dict(row._mapping) for row in db.execute(text("SELECT * FROM resume_templates ORDER BY id"))]


def test_rename_changes_only_catalog_names_and_keeps_existing_resumes(db, migration):
    sql, renames = migration
    with Session(bind=db) as session:
        user = User(email="artistic-names@example.com", nickname="张三")
        session.add(user)
        session.flush()
        template = session.scalar(select(ResumeTemplate).where(ResumeTemplate.key == "muse-hello-cn"))
        create_resume_from_template(db=session, user_id=user.id, title="虚构简历", template_id=template.id)
    resumes = db.execute(text("SELECT * FROM resumes ORDER BY id")).all()
    before = catalog(db)
    expected = {key: name for name, key, _ in renames}
    execute_sql_file(db, sql)
    after = catalog(db)
    assert len(before) == len(after)
    assert len({row["key"] for row in after if row["is_active"]}) == 164
    for old, new in zip(before, after, strict=True):
        if not old["key"].startswith("muse-"):
            assert new == old
        assert new["name"] == expected.get(old["key"], old["name"])
        assert {key: value for key, value in new.items() if key not in {"name", "updated_at"}} == {
            key: value for key, value in old.items() if key not in {"name", "updated_at"}
        }
    assert db.execute(text("SELECT * FROM resumes ORDER BY id")).all() == resumes


def test_preserves_admin_names_and_unmapped_uploads(db, migration):
    sql, _ = migration
    db.execute(text("UPDATE resume_templates SET name='管理员自定名称' WHERE `key`='muse-hello-cn'"))
    db.execute(text(
        "INSERT INTO resume_templates (`key`,name,description,data_json,style_json) "
        "SELECT 'uploaded-name-test-cn',name,description,data_json,"
        "JSON_SET(style_json,'$.template_key','uploaded-name-test-cn') "
        "FROM resume_templates WHERE `key`='muse-code-cn'"
    ))
    before = db.execute(text(
        "SELECT * FROM resume_templates WHERE `key` IN ('muse-hello-cn','uploaded-name-test-cn') ORDER BY id"
    )).all()
    execute_sql_file(db, sql)
    assert db.execute(text(
        "SELECT * FROM resume_templates WHERE `key` IN ('muse-hello-cn','uploaded-name-test-cn') ORDER BY id"
    )).all() == before


def test_rename_keeps_admin_state_and_is_idempotent(db, migration):
    sql, renames = migration
    db.execute(text(
        "UPDATE resume_templates SET is_active=0,sort_order=7,style_categories_json=JSON_ARRAY('简约'),"
        "use_cases_json=JSON_ARRAY('社招'),style_review_status='classified' WHERE `key`='muse-code-cn'"
    ))
    execute_sql_file(db, sql)
    row = db.execute(text(
        "SELECT name,is_active,sort_order,style_categories_json,use_cases_json,style_review_status "
        "FROM resume_templates WHERE `key`='muse-code-cn'"
    )).one()
    name = next(name for name, key, _ in renames if key == 'muse-code-cn')
    assert tuple(row) == (name, 0, 7, '["简约"]', '["社招"]', 'classified')
    before = catalog(db)
    execute_sql_file(db, sql)
    assert catalog(db) == before
