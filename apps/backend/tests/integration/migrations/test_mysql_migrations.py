from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "apps/backend"
EXPECTED_HEAD = "0005"


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
    assert {
        "alembic_version",
        "users",
        "resume_templates",
        "resumes",
        "resume_versions",
        "storage_cleanup_jobs",
    } <= set(
        inspector.get_table_names()
    )
    assert {column["name"] for column in inspector.get_columns("users")} == {
        "id",
        "email",
        "password_hash",
        "nickname",
        "avatar_object_key",
        "status",
        "is_admin",
        "last_login_at",
        "created_at",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("resume_templates")} == {
        "id",
        "key",
        "name",
        "description",
        "data_json",
        "style_json",
        "is_active",
        "created_at",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("resumes")} == {
        "id",
        "user_id",
        "template_id",
        "title",
        "data_json",
        "style_json",
        "legacy_data_json_backup",
        "legacy_style_json_backup",
        "lock_version",
        "source_type",
        "source_filename",
        "source_object_key",
        "extracted_markdown",
        "created_at",
        "updated_at",
    }
    assert {column["name"] for column in inspector.get_columns("resume_versions")} == {
        "id",
        "resume_id",
        "version_no",
        "data_json",
        "style_json",
        "legacy_data_json_backup",
        "legacy_style_json_backup",
        "reason",
        "created_at",
    }
    assert {
        column["name"]
        for column in inspector.get_columns("storage_cleanup_jobs")
    } == {
        "id",
        "operation",
        "object_key",
        "attempts",
        "last_error_type",
        "last_attempt_at",
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
    assert user_columns["id"]["type"].unsigned is True
    assert user_columns["status"]["type"].unsigned is True
    assert user_columns["is_admin"]["type"].unsigned is True
    assert user_columns["created_at"]["type"].fsp == 6
    assert resume_columns["id"]["type"].unsigned is True
    assert resume_columns["user_id"]["type"].unsigned is True
    assert resume_columns["data_json"]["type"].__class__.__name__ == "JSON"
    assert resume_columns["style_json"]["type"].__class__.__name__ == "JSON"
    assert resume_columns["extracted_markdown"]["type"].__class__.__name__ == "LONGTEXT"
    assert resume_columns["created_at"]["type"].fsp == 6
    assert {constraint["name"] for constraint in inspector.get_check_constraints("users")} == {
        "ck_users_is_admin",
        "ck_users_status",
    }
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("resumes")
    } == {
        "ck_resumes_lock_version",
        "ck_resumes_source_fields",
        "ck_resumes_source_type",
        "ck_resumes_title_not_blank",
    }
    assert {
        constraint["name"]
        for constraint in inspector.get_check_constraints("storage_cleanup_jobs")
    } == {
        "ck_storage_cleanup_jobs_attempts",
        "ck_storage_cleanup_jobs_operation",
    }
    assert {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("storage_cleanup_jobs")
    } == {"uk_storage_cleanup_jobs_target"}
    assert any(
        index["name"] == "idx_storage_cleanup_jobs_created_id"
        and index["column_names"] == ["created_at", "id"]
        for index in inspector.get_indexes("storage_cleanup_jobs")
    )
    assert any(
        index["name"] == "idx_resumes_user_updated_id"
        and index["column_names"] == ["user_id", "updated_at", "id"]
        for index in inspector.get_indexes("resumes")
    )
    resume_foreign_keys = {
        foreign_key["name"]: foreign_key
        for foreign_key in inspector.get_foreign_keys("resumes")
    }
    assert resume_foreign_keys["fk_resumes_user"]["constrained_columns"] == [
        "user_id"
    ]
    assert resume_foreign_keys["fk_resumes_user"]["referred_table"] == "users"
    assert resume_foreign_keys["fk_resumes_template"]["constrained_columns"] == [
        "template_id"
    ]
    assert (
        resume_foreign_keys["fk_resumes_template"]["referred_table"]
        == "resume_templates"
    )
    assert (
        resume_foreign_keys["fk_resumes_template"]["options"]["ondelete"]
        == "SET NULL"
    )

    with engine.begin() as connection:
        user = connection.execute(
            text(
                "INSERT INTO users "
                "(email, password_hash, nickname) "
                "VALUES ('zhangsan@example.invalid', '$2b$12$fictional', '张三')"
            )
        )
        user_id = user.lastrowid
        template = connection.execute(
            text(
                "INSERT INTO resume_templates "
                "(`key`, name, data_json, style_json) "
                "VALUES ('standard', '标准模板', "
                "JSON_OBJECT('schema_version', '1.0'), "
                "JSON_OBJECT('schema_version', '1.0'))"
            )
        )
        template_id = template.lastrowid
        resume = connection.execute(
            text(
                "INSERT INTO resumes "
                "(user_id, template_id, title, data_json, style_json, source_type) "
                "VALUES (:user_id, :template_id, '张三', "
                "JSON_OBJECT('schema_version', '1.0'), "
                "JSON_OBJECT('schema_version', '1.0'), 'template')"
            ),
            {"user_id": user_id, "template_id": template_id},
        )
        resume_id = resume.lastrowid
        connection.execute(
            text(
                "INSERT INTO resume_versions "
                "(resume_id, version_no, data_json, style_json, reason) "
                "VALUES (:resume_id, 1, JSON_OBJECT('schema_version', '1.0'), "
                "JSON_OBJECT('schema_version', '1.0'), 'initial')"
            ),
            {"resume_id": resume_id},
        )
        connection.execute(
            text("DELETE FROM resume_templates WHERE id = :template_id"),
            {"template_id": template_id},
        )
        assert connection.scalar(
            text("SELECT template_id FROM resumes WHERE id = :resume_id"),
            {"resume_id": resume_id},
        ) is None

    run_alembic(database_url, "upgrade", "head")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_HEAD
        assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM resume_templates")) == 0
        assert connection.scalar(text("SELECT COUNT(*) FROM resumes")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM resume_versions")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM storage_cleanup_jobs")) == 0

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM resume_versions"))
        connection.execute(text("DELETE FROM resumes"))
        connection.execute(text("DELETE FROM resume_templates"))
        connection.execute(text("DELETE FROM users"))

    run_alembic(database_url, "downgrade", "0002")
    downgraded_fk = {
        foreign_key["name"]: foreign_key
        for foreign_key in inspect(engine).get_foreign_keys("resumes")
    }["fk_resumes_template"]
    assert downgraded_fk["options"]["ondelete"] == "RESTRICT"
    run_alembic(database_url, "upgrade", "head")
    upgraded_fk = {
        foreign_key["name"]: foreign_key
        for foreign_key in inspect(engine).get_foreign_keys("resumes")
    }["fk_resumes_template"]
    assert upgraded_fk["options"]["ondelete"] == "SET NULL"

    run_alembic(database_url, "downgrade", "base")
    assert "users" not in inspect(engine).get_table_names()
    assert "resumes" not in inspect(engine).get_table_names()

    run_alembic(database_url, "upgrade", "head")
    assert {
        "users",
        "resume_templates",
        "resumes",
        "resume_versions",
        "storage_cleanup_jobs",
    } <= set(inspect(engine).get_table_names())
    engine.dispose()


def test_mysql_migrates_and_restores_legacy_resume_snapshots() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    legacy_data = {
        "schema_version": 1,
        "document": {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 1, "textAlign": "center"},
                    "content": [{"type": "text", "text": "张三"}],
                },
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "虚构项目经历"}],
                },
            ],
        },
    }
    legacy_style = {
        "schema_version": 1,
        "settings": {
            "fontFamily": '"Source Han Serif SC", SimSun, serif',
            "fontSize": 10.5,
            "lineHeight": 1.32,
            "pageMargin": 16,
            "verticalPageMargin": 14,
            "theme": "classic",
            "smartOnePage": True,
            "showSource": False,
        },
        "split_ratio": 0.4,
        "preview_scale": 1.0,
    }

    run_alembic(database_url, "downgrade", "base")
    run_alembic(database_url, "upgrade", "0004")
    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('legacy@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        resume_id = connection.execute(
            text(
                "INSERT INTO resumes "
                "(user_id, title, data_json, style_json, source_type, updated_at) "
                "VALUES (:user_id, '旧版虚构简历', :data, :style, 'blank', "
                "'2026-07-01 00:00:00.000000')"
            ),
            {
                "user_id": user_id,
                "data": json.dumps(legacy_data, ensure_ascii=False),
                "style": json.dumps(legacy_style, ensure_ascii=False),
            },
        ).lastrowid
        connection.execute(
            text(
                "INSERT INTO resume_versions "
                "(resume_id, version_no, data_json, style_json, reason) "
                "VALUES (:resume_id, 1, :data, :style, 'initial')"
            ),
            {
                "resume_id": resume_id,
                "data": json.dumps(legacy_data, ensure_ascii=False),
                "style": json.dumps(legacy_style, ensure_ascii=False),
            },
        )

    run_alembic(database_url, "upgrade", "head")
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT "
                "JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) AS current_version, "
                "JSON_UNQUOTE(JSON_EXTRACT(legacy_data_json_backup, '$.schema_version')) AS backup_version, "
                "JSON_UNQUOTE(JSON_EXTRACT(data_json, "
                "'$.sections.custom_sections[0].items[0].content.content')) AS markdown, "
                "updated_at "
                "FROM resumes WHERE id = :resume_id"
            ),
            {"resume_id": resume_id},
        ).mappings().one()
        assert row["current_version"] == "1.0"
        assert row["backup_version"] == "1"
        assert "# 张三" in row["markdown"]
        assert str(row["updated_at"]) == "2026-07-01 00:00:00"
        assert connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                "FROM resume_versions WHERE resume_id = :resume_id"
            ),
            {"resume_id": resume_id},
        ) == "1.0"

    run_alembic(database_url, "downgrade", "0004")
    assert "legacy_data_json_backup" not in {
        column["name"] for column in inspect(engine).get_columns("resumes")
    }
    with engine.connect() as connection:
        assert connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                "FROM resumes WHERE id = :resume_id"
            ),
            {"resume_id": resume_id},
        ) == "1"
        assert connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                "FROM resume_versions WHERE resume_id = :resume_id"
            ),
            {"resume_id": resume_id},
        ) == "1"

    run_alembic(database_url, "upgrade", "head")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_HEAD
        assert connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                "FROM resumes WHERE id = :resume_id"
            ),
            {"resume_id": resume_id},
        ) == "1.0"

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM resume_versions"))
        connection.execute(text("DELETE FROM resumes"))
        connection.execute(text("DELETE FROM users"))
    run_alembic(database_url, "downgrade", "base")
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()
