from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "apps/backend"
EXPECTED_HEAD = "0001"


def migration_test_url() -> str:
    raw = os.environ.get("LINKCV_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("LINKCV_TEST_MYSQL_URL is required for destructive MySQL migration tests")
    url = make_url(raw)
    if url.database != "linkcv" or url.host not in {"127.0.0.1", "localhost"}:
        pytest.fail(
            "LINKCV_TEST_MYSQL_URL must target a local, disposable database named linkcv"
        )
    return raw


def run_alembic(database_url: str, *arguments: str) -> None:
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "development",
            "DATABASE_URL": database_url,
            "LINKCV_ENV_FILE": str(REPO_ROOT / ".env.nonexistent-migration-test"),
        }
    )
    result = subprocess.run(
        ["uv", "run", "alembic", *arguments],
        cwd=BACKEND_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"


def test_mysql_upgrade_downgrade_and_idempotent_rerun() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)

    run_alembic(database_url, "downgrade", "base")
    run_alembic(database_url, "upgrade", "head")
    run_alembic(database_url, "check")

    inspector = inspect(engine)
    assert {"alembic_version", "users", "resumes"} <= set(
        inspector.get_table_names()
    )
    assert {column["name"] for column in inspector.get_columns("users")} == {
        "id",
        "email",
        "password_hash",
        "status",
        "auth_version",
        "created_at",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("resumes")} == {
        "id",
        "user_id",
        "title",
        "markdown",
        "settings",
        "split_ratio",
        "preview_scale",
        "created_at",
        "updated_at",
    }
    assert {constraint["name"] for constraint in inspector.get_unique_constraints("users")} == {
        "uk_users_email"
    }
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    resume_columns = {
        column["name"]: column for column in inspector.get_columns("resumes")
    }
    assert user_columns["auth_version"]["type"].unsigned is True
    assert user_columns["created_at"]["type"].fsp == 6
    assert resume_columns["markdown"]["type"].__class__.__name__ == "LONGTEXT"
    assert resume_columns["split_ratio"]["type"].__class__.__name__ == "DOUBLE"
    assert resume_columns["preview_scale"]["type"].__class__.__name__ == "DOUBLE"
    assert resume_columns["created_at"]["type"].fsp == 6
    assert {constraint["name"] for constraint in inspector.get_check_constraints("users")} == {
        "ck_users_auth_version_positive"
    }
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("resumes")
    } == {
        "ck_resumes_preview_scale_positive",
        "ck_resumes_split_ratio_positive",
    }
    assert any(
        index["name"] == "idx_resumes_user_updated"
        and index["column_names"] == ["user_id", "updated_at"]
        for index in inspector.get_indexes("resumes")
    )
    assert inspector.get_foreign_keys("resumes") == [
        {
            "name": "fk_resumes_user_id_users",
            "constrained_columns": ["user_id"],
            "referred_schema": None,
            "referred_table": "users",
            "referred_columns": ["id"],
            "options": {"ondelete": "CASCADE"},
        }
    ]

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, email, password_hash, status, auth_version) "
                "VALUES ('user_00000000000000000000000000000000', "
                "'zhangsan@example.invalid', '$2b$12$fictional', 'active', 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO resumes "
                "(id, user_id, title, markdown, settings, split_ratio, preview_scale) "
                "VALUES ('resume_00000000000000000000000000000000', "
                "'user_00000000000000000000000000000000', '张三', '# 张三', "
                "JSON_OBJECT('theme', 'classic'), 0.4, 1.0)"
            )
        )

    run_alembic(database_url, "upgrade", "head")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_HEAD
        assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM resumes")) == 1

    run_alembic(database_url, "downgrade", "base")
    assert "users" not in inspect(engine).get_table_names()
    assert "resumes" not in inspect(engine).get_table_names()

    run_alembic(database_url, "upgrade", "head")
    assert {"users", "resumes"} <= set(inspect(engine).get_table_names())
    engine.dispose()
