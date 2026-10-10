"""Exercise catalog curation on an explicitly disposable, local MySQL 8.4."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from drawoffer.application.resumes.service import ResumeTemplateUnavailable, create_resume_from_template
from drawoffer.core.errors import ApiError
from drawoffer.core.migration_sql import execute_sql_file
from drawoffer.domain.resume import CanonicalResumeDocument, ResumePresentation, compile_layout_plan
from drawoffer.modules.identity.models import User
from drawoffer.modules.resumes.models import ResumeTemplate
from drawoffer.modules.resumes.template_routes import get_template, list_templates

SQL = Path(__file__).resolve().parents[3] / "migrations/sql/0104.up.sql"
value = re.search(r"SET @muse_curation = CAST\('((?:[^']|'')*)' AS JSON\)", SQL.read_text()).group(1)
ENTRIES = json.loads(value.replace("''", "'").replace("\\\\", "\\"))
RETIRED = {item["key"] for item in ENTRIES if not item["rank"]}


@pytest.fixture
def db():
    raw = os.environ.get("DRAWOFFER_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("Set DRAWOFFER_TEST_MYSQL_URL to a disposable local MySQL at head")
    url = make_url(raw)
    assert url.database == "drawoffer_curation_0104" and url.host in {"localhost", "127.0.0.1"}
    engine = create_engine(raw)
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            # Freeze the pre-0104 seed state independently of the current head.
            connection.execute(text(
                "UPDATE resume_templates SET is_active=1,sort_order=:sort,style_json=CAST(:style AS JSON),"
                "style_categories_json=NULL,use_cases_json=NULL,style_review_status='pending' WHERE `key`=:key"
            ), [{"key": item["key"], "sort": 960 + item["seed_order"] * 10,
                 "style": json.dumps(item["definition"], ensure_ascii=False)} for item in ENTRIES])
            yield connection
        finally:
            if transaction.is_active:
                transaction.rollback()
    engine.dispose()


def catalog(db):
    return {r.key: dict(r._mapping) for r in db.execute(text("SELECT * FROM resume_templates ORDER BY id"))}


def test_downlisting_keeps_original_catalog_and_existing_resume_snapshots(db):
    with Session(bind=db) as session:
        user = User(email="curation-test@example.com", nickname="张三")
        session.add(user)
        session.flush()
        template = session.scalar(select(ResumeTemplate).where(ResumeTemplate.key == "muse-ruled-cn"))
        resume = create_resume_from_template(db=session, user_id=user.id, title="下架前创建", template_id=template.id)
        before = catalog(db)
        old_resumes = db.execute(text("SELECT * FROM resumes ORDER BY id")).all()
        execute_sql_file(db, SQL)
        after = catalog(db)
        assert after.keys() == before.keys()
        assert sum(row["is_active"] for row in after.values()) == 150
        for key, old in before.items():
            new = after[key]
            if not key.startswith("muse-"):
                assert new == old
            else:
                unchanged = set(old) - {"is_active", "sort_order", "style_categories_json", "use_cases_json", "style_review_status", "updated_at"}
                assert {k: new[k] for k in unchanged} == {k: old[k] for k in unchanged}
                assert new["is_active"] == (0 if key in RETIRED else 1)
        assert db.execute(text("SELECT * FROM resumes ORDER BY id")).all() == old_resumes
        session.expire_all()
        plan = compile_layout_plan(CanonicalResumeDocument.model_validate(resume.data_json),
                                   ResumePresentation.model_validate(resume.style_json).template_snapshot)
        assert plan.content_sha256 == CanonicalResumeDocument.model_validate(resume.data_json).content_sha256()
        records = list_templates(db=session, _user=user).templates
        assert len(records) == 150
        assert not RETIRED & {r.key for r in records}
        for retired in RETIRED:
            with pytest.raises(ApiError) as error:
                get_template(str(after[retired]["id"]), db=session, _user=user)
            assert error.value.status_code == 404
        with pytest.raises(ResumeTemplateUnavailable):
            create_resume_from_template(db=session, user_id=user.id, title="下架后创建", template_id=template.id)


def test_groups_order_and_classifications_are_visible_through_template_api(db):
    execute_sql_file(db, SQL)
    with Session(bind=db) as session:
        records = list_templates(db=session, _user=None).templates
        muse = [r for r in records if r.key.startswith("muse-")]
        expected = sorted((item for item in ENTRIES if item["rank"]), key=lambda item: item["rank"])
        assert [r.key for r in muse] == [item["key"] for item in expected]
        assert all(not r.key.startswith("muse-") for r in records[:85])
        for record, item in zip(muse, expected, strict=True):
            assert record.style_categories == item["style_categories"]
            assert record.use_cases == item["use_cases"]


def test_custom_definitions_uploads_and_admin_choices_are_preserved(db):
    db.execute(text("UPDATE resume_templates SET style_json=JSON_SET(style_json,'$.tokens.font_size_pt',11) WHERE `key`='muse-ruled-cn'"))
    db.execute(text("UPDATE resume_templates SET is_active=0 WHERE `key`='muse-badge-cn'"))
    db.execute(text("UPDATE resume_templates SET sort_order=7 WHERE `key`='muse-halo-cn'"))
    db.execute(text("UPDATE resume_templates SET style_categories_json=JSON_ARRAY('简约'),use_cases_json=JSON_ARRAY('社招'),style_review_status='classified' WHERE `key`='muse-hello-cn'"))
    db.execute(text("UPDATE resume_templates SET style_categories_json=JSON_ARRAY(),use_cases_json=JSON_ARRAY(),style_review_status='unsure' WHERE `key`='muse-taupe-cn'"))
    db.execute(text("UPDATE resume_templates SET style_categories_json=JSON_ARRAY('现代') WHERE `key`='muse-mist-cn'"))
    db.execute(text("INSERT INTO resume_templates (`key`,name,data_json,style_json,sort_order) SELECT 'muse-uploaded-test-cn',name,data_json,JSON_SET(style_json,'$.template_key','muse-uploaded-test-cn'),2000 FROM resume_templates WHERE `key`='muse-ruled-cn'"))
    protected = {"muse-ruled-cn", "muse-badge-cn", "muse-hello-cn", "muse-taupe-cn", "muse-mist-cn", "muse-uploaded-test-cn"}
    before = catalog(db)
    execute_sql_file(db, SQL)
    after = catalog(db)
    for key in protected:
        assert after[key] == before[key]
    assert {k: r["sort_order"] for k, r in after.items()} == {k: r["sort_order"] for k, r in before.items()}


def test_rerun_is_idempotent_and_does_not_reset_later_admin_decisions(db):
    execute_sql_file(db, SQL)
    before = catalog(db)
    execute_sql_file(db, SQL)
    assert catalog(db) == before
    db.execute(text("UPDATE resume_templates SET sort_order=5,style_categories_json=JSON_ARRAY('经典'),use_cases_json=JSON_ARRAY('校招'),style_review_status='classified',is_active=0 WHERE `key`='muse-halo-cn'"))
    before = catalog(db)
    execute_sql_file(db, SQL)
    assert catalog(db) == before
