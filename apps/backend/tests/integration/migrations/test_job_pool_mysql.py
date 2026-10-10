"""Opt-in real MySQL 8.4 migration, ngram, and concurrent join coverage.

Requires LINKRESUME_TEST_MYSQL_URL for a disposable localhost database named linkresume.
Creates and drops only a generated isolated database; never targets shared Dev/production.
"""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from linkresume.application.job_pool import service
from linkresume.application.job_pool.types import SyncResult
from linkresume.core.config import load_settings
from linkresume.modules.identity.models import User
from linkresume.modules.job_descriptions.models import GlobalCompany, JobDescription
from linkresume.modules.job_pool.models import GlobalJobSource
from tests.integration.api.test_job_pool import observation

BACKEND = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def mysql():
    raw = os.environ.get("LINKRESUME_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("Explicit disposable MySQL 8.4 is unavailable")
    url = make_url(raw)
    if url.host not in {"127.0.0.1", "localhost"} or url.database != "linkresume":
        pytest.fail("Job pool migration tests require an explicit disposable local database named linkresume")
    admin = create_engine(url)
    name = "linkresume_pool_test_" + uuid4().hex[:12]
    with admin.connect() as db:
        assert str(db.scalar(text("SELECT VERSION()"))).startswith("8.4.")
        db.execute(text(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"))
    engine = create_engine(url.set(database=name))
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url.set(database=name).render_as_string(hide_password=False)
    try:
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "migrations"))
        load_settings.cache_clear()
        assert make_url(load_settings().sqlalchemy_url).database == name
        command.upgrade(cfg, "0118")
        with engine.begin() as db:
            db.execute(text("INSERT INTO `user` (email,password_hash,nickname) VALUES ('zhangsan@example.test','fictional-hash','张三')"))
            user_id = db.scalar(text("SELECT id FROM `user` WHERE email='zhangsan@example.test'"))
            db.execute(text("INSERT INTO job_description (user_id,job_title,company_name,description,skills,source_type) VALUES (:uid,'已有岗位','示例科技','已有个人正文',JSON_ARRAY(),'manual')"), {"uid": user_id})
            db.execute(text("INSERT INTO global_company (company_name,normalized_name,logo_url) VALUES ('已有公司','已有公司','https://cdn.example.test/legacy.png')"))
        command.upgrade(cfg, "0120")
        with engine.begin() as db:
            db.execute(text("INSERT INTO global_company (company_name,normalized_name,logo_url,logo_source) VALUES "
                "('插件外链公司','插件外链公司','https://img.example.test/plugin.png','plugin'),"
                "('站内图标公司','站内图标公司','/api/company-logos/" + "b" * 64 + ".webp','plugin'),"
                "('管理员外链公司','管理员外链公司','https://cdn.example.test/admin.png','admin')"))
        command.upgrade(cfg, "head")
        # A repeated upgrade is a no-op through Alembic's recorded revision.
        command.upgrade(cfg, "head")
        yield engine
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous
        load_settings.cache_clear()
        engine.dispose()
        with admin.connect() as db:
            db.execute(text(f"DROP DATABASE `{name}`"))
        admin.dispose()


def test_forward_migration_schema_indexes_and_legacy_data(mysql):
    schema = inspect(mysql)
    company_columns = {column["name"]: column for column in schema.get_columns("global_company")}
    assert {"aliases", "logo_source", "lock_version"} <= company_columns.keys()
    assert not company_columns["aliases"]["nullable"]
    assert len(schema.get_columns("global_job_source")) == 14
    assert len(schema.get_columns("global_job")) == 20
    indexes = schema.get_indexes("global_job")
    assert {index["name"] for index in indexes} == {"uk_global_job_source_key", "idx_global_job_search", "idx_global_job_create_time"}
    with mysql.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0122"
        assert db.scalar(text("SELECT description FROM job_description WHERE global_job_id IS NULL")) == "已有个人正文"
        legacy = db.execute(text("SELECT aliases,logo_source,lock_version,logo_url FROM global_company WHERE normalized_name='已有公司'")).first()
        assert legacy.aliases == "[]" and legacy.logo_source == "unknown" and legacy.lock_version == 0
        assert legacy.logo_url == "https://cdn.example.test/legacy.png"
        ddl = db.execute(text("SHOW CREATE TABLE global_job")).first()[1]
        assert "FULLTEXT KEY" in ddl and "ngram" in ddl
        rows = {row.normalized_name: row for row in db.execute(text(
            "SELECT normalized_name,logo_url,logo_source,logo_dhash,lock_version FROM global_company"))}
        # 0122 clears plugin external defaults and keeps hosted images and other sources; fingerprints are backfilled by script.
        assert rows["插件外链公司"].logo_url is None and rows["插件外链公司"].logo_source == "unknown"
        assert rows["插件外链公司"].lock_version == 1
        assert rows["站内图标公司"].logo_url.endswith("b" * 64 + ".webp") and rows["站内图标公司"].logo_dhash is None
        assert rows["管理员外链公司"].logo_url == "https://cdn.example.test/admin.png"
        assert rows["已有公司"].logo_url == "https://cdn.example.test/legacy.png"
    for table in ("global_company_logo_fingerprint", "global_company_unmatched_name"):
        assert schema.has_table(table)
    assert not schema.has_table("global_company_logo_observation")
    assert {index["name"] for index in inspect(mysql).get_indexes("global_company_unmatched_name")} >= {
        "idx_global_company_unmatched_name_ignored_hits", "uk_global_company_unmatched_name_normalized_name"}


def test_real_ngram_json_city_filter_and_concurrent_idempotent_join(mysql):
    factory = sessionmaker(mysql, expire_on_commit=False)
    with factory() as db:
        user = db.scalar(select(User).where(User.email == "zhangsan@example.test"))
        user_id = user.id
        company = GlobalCompany(company_name="虚构科技", normalized_name="虚构科技")
        db.add(company); db.flush()
        source = GlobalJobSource(company_id=company.id, adapter_key="tencent", tenant_key="careers.tencent.com", portal_config={"schema_version": 1, "host": "careers.tencent.com", "portals": ["social"], "site_id": None}, is_enabled=1)
        db.add(source); db.commit()
        service.queue_source(db, source.id, enabled=True)
        task = service.claim_source(db, source.id, interval_seconds=43200)
        jobs = [observation("mysql1", description="虚构平台研发，要求掌握中文检索。")]
        assert service.write_observations(db, source.id, task[1], jobs)
        assert service.finish(db, source.id, task[1], SyncResult(jobs=jobs, is_complete=True))
    with factory() as db:
        page = service.list_jobs(db, user_id, keyword="中文检索", city="上海")
        assert len(page["items"]) == 1
        identifier = page["items"][0]["id"]
        assert service.list_jobs(db, user_id, keyword="不存在的词", city="上海")["items"] == []
        assert service.list_jobs(db, user_id, city="杭州")["items"] == []
    def join():
        with factory() as db:
            return service.join_job(db, user_id, identifier)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: join(), range(2)))
    assert len({result["application_id"] for result in results}) == 1
    with factory() as db:
        assert len(list(db.scalars(select(JobDescription).where(JobDescription.global_job_id == int(identifier))))) == 1


def test_0122_concurrent_plugin_logo_fill_preserves_one_default(mysql):
    from linkresume.application.job_descriptions.company_service import set_company_logo
    from linkresume.application.job_descriptions.logo_service import normalize_logo
    from tests.integration.api.test_company_logos import LogoStorage, picture
    factory = sessionmaker(mysql, expire_on_commit=False)
    storage = LogoStorage()
    with factory.begin() as db:
        company = GlobalCompany(company_name="并发图标测试公司", normalized_name="并发图标测试公司")
        db.add(company)
        db.flush()
        identifier = company.id
    images = [normalize_logo(picture(color)) for color in ("red", "blue")]
    def fill(index):
        with factory.begin() as db:
            return set_company_logo(db, storage, identifier, "plugin", images[index])
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(fill, range(2)))
    assert sorted(results) == [False, True]
    with factory() as db:
        company = db.get(GlobalCompany, identifier)
        assert company.logo_source == "plugin" and company.lock_version == 1
        assert company.logo_url.startswith("/api/company-logos/") and len(company.logo_dhash) == 16
