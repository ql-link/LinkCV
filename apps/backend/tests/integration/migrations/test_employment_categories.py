"""Opt-in MySQL check; creates only a uniquely named disposable database."""
from __future__ import annotations

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from tests.integration.migrations.test_mysql_migrations import invoke_alembic, run_alembic


def test_employment_categories_upgrade_and_reject_legacy_values() -> None:
    raw = os.environ.get("LINKCV_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("LINKCV_TEST_MYSQL_URL required")
    source = make_url(raw)
    assert source.host in {"127.0.0.1", "localhost"}
    name = f"linkcv_category_test_{uuid4().hex}"
    admin = create_engine(source.set(database=None))
    with admin.begin() as connection:
        connection.exec_driver_sql(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
    url = source.set(database=name).render_as_string(hide_password=False)
    engine = create_engine(url)
    try:
        # Empty database upgrades through the complete historical chain.
        run_alembic(url, "upgrade", "0055")
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO users (id,email,password_hash,nickname) VALUES (91001,'migration@example.com','fixture','张三')"))
            connection.execute(text("INSERT INTO job_descriptions (id,user_id,job_title,company_name,employment_type,description,skills,source_type) VALUES (91002,91001,'测试岗位','测试公司','internship','测试正文',JSON_ARRAY(),'manual')"))
        with engine.begin() as connection:
            connection.execute(text("UPDATE job_descriptions SET employment_type='part_time' WHERE id=91002"))
        rejected = invoke_alembic(url, "upgrade", "head")
        assert rejected.returncode != 0
        with engine.begin() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0055"
            assert connection.execute(text("SELECT employment_type FROM job_descriptions WHERE id=91002")).scalar_one() == "part_time"
            connection.execute(text("UPDATE job_descriptions SET employment_type='internship' WHERE id=91002"))
        run_alembic(url, "upgrade", "head")
        run_alembic(url, "upgrade", "head")
        with engine.begin() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0056"
            assert connection.execute(text("SELECT employment_type FROM job_descriptions WHERE id=91002")).scalar_one() == "internship"
            for category in ("internship", "campus", "full_time", None):
                connection.execute(text("UPDATE job_descriptions SET employment_type=:category WHERE id=91002"), {"category": category})
        for category in ("part_time", "contract", "temporary"):
            with pytest.raises(DBAPIError, match="ck_job_descriptions_employment_type"), engine.begin() as connection:
                connection.execute(text("UPDATE job_descriptions SET employment_type=:category WHERE id=91002"), {"category": category})
        assert "ck_job_descriptions_employment_type" in {item["name"] for item in inspect(engine).get_check_constraints("job_descriptions")}
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f"DROP DATABASE `{name}`")
        admin.dispose()
