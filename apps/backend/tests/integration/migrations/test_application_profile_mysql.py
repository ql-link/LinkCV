"""Verify new and historical MySQL 8.4 upgrades on disposable databases only."""
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from linkresume.core.config import load_settings
from linkresume.modules.identity.models import UserProfile


@pytest.mark.parametrize("start", [None, "0117"])
def test_application_data_upgrade_preserves_legacy_rows_and_orm_parity(start):
    raw = os.environ.get("LINKRESUME_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("Explicit disposable local MySQL URL required")
    url = make_url(raw)
    assert url.host in {"localhost", "127.0.0.1"} and url.database == "linkresume"
    admin = create_engine(url)
    name = "linkresume_facts_test_" + uuid4().hex[:12]
    with admin.begin() as db:
        assert str(db.scalar(text("SELECT VERSION()"))).startswith("8.4.")
        db.execute(text(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"))
    target = url.set(database=name)
    engine = create_engine(target)
    old = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = target.render_as_string(hide_password=False)
    try:
        load_settings.cache_clear()
        cfg = Config(str(Path(__file__).resolve().parents[3] / "alembic.ini"))
        cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[3] / "migrations"))
        if start:
            command.upgrade(cfg, start)
            with engine.begin() as db:
                db.execute(text("INSERT INTO user_profile (user_id,lock_version,candidate_cities,employment_types,school_tier,languages,skills,certifications,honors,campus_experiences) VALUES (1,7,'[]','[]','[]','[]','[\"Python\"]','[]','[]','[]')"))
        command.upgrade(cfg, "head")
        schema = inspect(engine)
        assert {col["name"] for col in schema.get_columns("user_profile")} == set(UserProfile.__table__.columns.keys())
        assert "ck_user_profile_application_data_object" in {check["name"] for check in schema.get_check_constraints("user_profile")}
        with engine.connect() as db:
            assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0118"
            if start:
                row = db.execute(text("SELECT lock_version, application_data, skills FROM user_profile WHERE user_id=1")).one()
                assert row.lock_version == 7 and row.application_data is None and "Python" in row.skills
    finally:
        if old is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = old
        load_settings.cache_clear()
        engine.dispose()
        with admin.begin() as db:
            db.execute(text(f"DROP DATABASE `{name}`"))
        admin.dispose()
