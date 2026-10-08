"""Exercise the guarded sample refresh on an explicitly disposable MySQL."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from linkresume.application.resumes.service import create_resume_from_template
from linkresume.core.migration_sql import execute_sql_file
from linkresume.domain.resume import CanonicalResumeDocument
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import ResumeTemplate
from linkresume.modules.resumes.template_routes import template_record

SQL = Path(__file__).resolve().parents[3] / "migrations/sql/0103.up.sql"
PATTERN = (
    r"UPDATE resume_templates SET data_json = CAST\('((?:[^']|'')*)' AS JSON\)\s+"
    r"WHERE `key` = '([^']+)' AND data_json = CAST\('((?:[^']|'')*)' AS JSON\)\s+"
    r"AND style_json = CAST\('((?:[^']|'')*)' AS JSON\)"
)


def decode(value):
    return json.loads(value.replace("''", "'").replace("\\\\", "\\"))


UPDATES = {key: {"old": decode(old), "new": decode(new), "style": decode(style)}
           for new, key, old, style in re.findall(PATTERN, SQL.read_text(encoding="utf-8"))}


@pytest.fixture
def db():
    raw = os.environ.get("LINKRESUME_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("Set LINKRESUME_TEST_MYSQL_URL to a disposable local MySQL at head")
    url = make_url(raw)
    assert url.database in {"linkresume", "linkresume_sample_fit_0103", "linkresume_curation_0104"} and url.host in {"localhost", "127.0.0.1"}
    engine = create_engine(raw)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(
                "UPDATE resume_templates SET data_json=CAST(:data AS JSON),style_json=CAST(:style AS JSON) "
                "WHERE `key`=:key"
            ), [{"key": key, "data": json.dumps(v["old"], ensure_ascii=False),
                 "style": json.dumps(v["style"], ensure_ascii=False)} for key, v in UPDATES.items()])
            # Exercise the frozen 0103 input even after later curation revisions.
            connection.execute(text("UPDATE resume_templates SET is_active=1 WHERE `key` LIKE 'muse-%'"))
            yield connection
        finally:
            transaction.rollback()
    engine.dispose()


def catalog(db):
    return [dict(r._mapping) for r in db.execute(text("SELECT * FROM resume_templates ORDER BY id"))]


def test_refresh_changes_only_known_samples_and_leaves_existing_resumes(db):
    with Session(bind=db) as session:
        user = User(email="sample-fit@example.com", nickname="张三")
        session.add(user)
        session.flush()
        template = session.scalar(select(ResumeTemplate).where(ResumeTemplate.key == "muse-tabs-cn"))
        create_resume_from_template(db=session, user_id=user.id, title="旧示例简历", template_id=template.id)
        old_resumes = db.execute(text("SELECT * FROM resumes ORDER BY id")).all()
        before = catalog(db)
        execute_sql_file(db, SQL)
        after = catalog(db)
        assert len(before) == len(after)
        assert sum(r["is_active"] for r in after) == 164
        changed = set()
        for old, new in zip(before, after, strict=True):
            if not old["key"].startswith("muse-"):
                assert new == old
            if old["data_json"] != new["data_json"]:
                changed.add(new["key"])
            assert json.loads(new["data_json"]) == UPDATES.get(old["key"], {}).get("new", json.loads(old["data_json"]))
            assert {k: v for k, v in new.items() if k not in {"data_json", "updated_at"}} == {k: v for k, v in old.items() if k not in {"data_json", "updated_at"}}
        assert changed == UPDATES.keys()
        assert db.execute(text("SELECT * FROM resumes ORDER BY id")).all() == old_resumes
        session.expire_all()
        for key in UPDATES:
            refreshed = session.scalar(select(ResumeTemplate).where(ResumeTemplate.key == key))
            record = template_record(refreshed)
            assert record.layout_plan.content_sha256 == record.data.content_sha256()
        new_resume = create_resume_from_template(db=session, user_id=user.id, title="一页示例简历", template_id=template.id)
        assert new_resume.data_json == CanonicalResumeDocument.model_validate(UPDATES["muse-tabs-cn"]["new"]).model_dump(mode="json")


def test_preserves_custom_text_definitions_uploads_and_admin_state(db):
    db.execute(text("UPDATE resume_templates SET data_json=JSON_SET(data_json,'$.identity.name.value','自定义示例') WHERE `key`='muse-tabs-cn'"))
    db.execute(text("UPDATE resume_templates SET style_json=JSON_SET(style_json,'$.tokens.font_size_pt',11) WHERE `key`='muse-code-cn'"))
    db.execute(text(
        "INSERT INTO resume_templates (`key`,name,description,data_json,style_json) "
        "SELECT 'uploaded-sample-test-cn',name,description,data_json,"
        "JSON_SET(style_json,'$.template_key','uploaded-sample-test-cn') "
        "FROM resume_templates WHERE `key`='muse-hairline-cn'"
    ))
    protected = {"muse-tabs-cn", "muse-code-cn", "uploaded-sample-test-cn"}
    before = [r for r in catalog(db) if r["key"] in protected]
    db.execute(text("UPDATE resume_templates SET name='管理员名称',is_active=0,sort_order=7,style_categories_json=JSON_ARRAY('简约'),use_cases_json=JSON_ARRAY('社招'),style_review_status='classified' WHERE `key`='muse-numerals-cn'"))
    admin_before = next(r for r in catalog(db) if r["key"] == "muse-numerals-cn")
    execute_sql_file(db, SQL)
    assert [r for r in catalog(db) if r["key"] in protected] == before
    admin_after = next(r for r in catalog(db) if r["key"] == "muse-numerals-cn")
    assert {k: v for k, v in admin_before.items() if k not in {"data_json", "updated_at"}} == {k: v for k, v in admin_after.items() if k not in {"data_json", "updated_at"}}
    assert json.loads(admin_after["data_json"]) == UPDATES["muse-numerals-cn"]["new"]


def test_refresh_is_idempotent(db):
    execute_sql_file(db, SQL)
    before = catalog(db)
    execute_sql_file(db, SQL)
    assert catalog(db) == before
