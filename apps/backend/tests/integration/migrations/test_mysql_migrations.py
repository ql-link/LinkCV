from __future__ import annotations

import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.engine import make_url

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "apps/backend"
EXPECTED_HEAD = "0012"


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


def invoke_alembic(
    database_url: str, *arguments: str
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "development",
            "DATABASE_URL": database_url,
            "LINKCV_ENV_FILE": str(REPO_ROOT / ".env.nonexistent-migration-test"),
        }
    )
    return subprocess.run(
        ["uv", "run", "alembic", *arguments],
        cwd=BACKEND_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def run_alembic(database_url: str, *arguments: str) -> None:
    result = invoke_alembic(database_url, *arguments)
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
        "job_descriptions",
    } <= set(inspector.get_table_names())
    assert "admin_operation_logs" not in inspector.get_table_names()
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
        "reason",
        "created_at",
    }
    assert "storage_cleanup_jobs" not in inspector.get_table_names()

    run_alembic(database_url, "downgrade", "0009")
    downgraded_inspector = inspect(engine)
    assert {
        column["name"]
        for column in downgraded_inspector.get_columns("storage_cleanup_jobs")
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
    assert {
        "legacy_data_json_backup",
        "legacy_style_json_backup",
    } <= {
        column["name"]
        for column in downgraded_inspector.get_columns("resumes")
    }
    assert {
        "legacy_data_json_backup",
        "legacy_style_json_backup",
    } <= {
        column["name"]
        for column in downgraded_inspector.get_columns("resume_versions")
    }
    assert "admin_operation_logs" in downgraded_inspector.get_table_names()

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO storage_cleanup_jobs (operation, object_key) "
                "VALUES ('object', 'users/1/resume-imports/pending/file.pdf')"
            )
        )
    refused_upgrade = invoke_alembic(database_url, "upgrade", "head")
    assert refused_upgrade.returncode != 0
    assert "refuses to drop storage_cleanup_jobs" in refused_upgrade.stderr
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM storage_cleanup_jobs"))

    run_alembic(database_url, "upgrade", "head")
    inspector = inspect(engine)
    assert "storage_cleanup_jobs" not in inspector.get_table_names()

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
    run_alembic(database_url, "check")

    inspector = inspect(engine)
    assert {
        "alembic_version",
        "users",
        "resume_templates",
        "resumes",
        "resume_versions",
        "llm_model_configs",
        "llm_capability_bindings",
        "llm_call_logs",
        "job_descriptions",
    } <= set(inspector.get_table_names())
    assert "admin_operation_logs" not in inspector.get_table_names()
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
    assert {
        column["name"] for column in inspector.get_columns("resume_templates")
    } == {
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
        "lock_version",
        "source_type",
        "source_filename",
        "source_object_key",
        "extracted_markdown",
        "created_at",
        "updated_at",
    }
    assert {
        column["name"] for column in inspector.get_columns("resume_versions")
    } == {
        "id",
        "resume_id",
        "version_no",
        "data_json",
        "style_json",
        "reason",
        "created_at",
    }
    assert {
        column["name"] for column in inspector.get_columns("llm_model_configs")
    } == {
        "id",
        "capability",
        "model_name",
        "adapter",
        "model_call_name",
        "api_base",
        "encrypted_api_key",
        "enabled",
        "priority",
        "input_price_per_million",
        "output_price_per_million",
        "config_version",
        "created_at",
        "updated_at",
    }
    assert {
        column["name"]
        for column in inspector.get_columns("llm_capability_bindings")
    } == {"capability", "model_config_id", "created_at", "updated_at"}
    assert {
        column["name"] for column in inspector.get_columns("llm_call_logs")
    } == {
        "id",
        "call_id",
        "capability",
        "source",
        "user_id",
        "model_config_id",
        "model_name",
        "adapter",
        "model_call_name",
        "status",
        "metering_status",
        "input_tokens",
        "output_tokens",
        "input_price_per_million",
        "output_price_per_million",
        "estimated_cost",
        "latency_ms",
        "error_code",
        "created_at",
    }
    assert {
        column["name"]: column["comment"]
        for column in inspector.get_columns("llm_model_configs")
    } == {
        "id": "模型配置主键",
        "capability": "系统模型能力标识，当前仅 chat",
        "model_name": "LiteLLM 模型标识",
        "adapter": "LiteLLM adapter 标识",
        "model_call_name": "不含 adapter 前缀的模型调用名",
        "api_base": "模型服务基础地址",
        "encrypted_api_key": "版本化加密凭据，禁止保存明文",
        "enabled": "是否启用模型配置",
        "priority": "调用优先级，数值越小越优先",
        "input_price_per_million": "每百万输入令牌的美元价格",
        "output_price_per_million": "每百万输出令牌的美元价格",
        "config_version": "模型候选乐观锁版本",
        "created_at": "创建时间（UTC）",
        "updated_at": "最后更新时间（UTC）",
    }
    assert inspector.get_table_comment("llm_model_configs")["text"] == (
        "系统模型能力的候选连接配置（含发布兼容列）"
    )
    assert {
        column["name"]: column["comment"]
        for column in inspector.get_columns("llm_call_logs")
    } == {
        "id": "调用日志主键",
        "call_id": "逻辑调用唯一标识",
        "capability": "实际模型能力快照",
        "source": "稳定调用来源代码",
        "user_id": "发起调用的用户主键",
        "model_config_id": "实际使用的模型配置主键，未选中模型时为空",
        "model_name": "实际模型标识快照",
        "adapter": "实际 LiteLLM adapter 快照",
        "model_call_name": "实际模型调用名快照",
        "status": (
            "调用状态：pending（待处理）、succeeded（成功）、"
            "failed（失败）、cancelled（已取消）"
        ),
        "metering_status": (
            "计量状态：complete（完整）、partial（部分）、unknown（未知）"
        ),
        "input_tokens": "输入令牌数量",
        "output_tokens": "输出令牌数量",
        "input_price_per_million": "每百万输入令牌的美元价格快照",
        "output_price_per_million": "每百万输出令牌的美元价格快照",
        "estimated_cost": "预估调用成本（美元）",
        "latency_ms": "调用耗时（毫秒）",
        "error_code": "非敏感稳定错误码",
        "created_at": "调用创建时间（UTC）",
    }
    user_columns = {
        column["name"]: column for column in inspector.get_columns("users")
    }
    resume_columns = {
        column["name"]: column for column in inspector.get_columns("resumes")
    }
    call_columns = {
        column["name"]: column for column in inspector.get_columns("llm_call_logs")
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
    assert call_columns["user_id"]["type"].unsigned is True
    assert call_columns["source"]["type"].length == 32
    assert call_columns["source"]["type"].collation == "ascii_bin"
    assert call_columns["source"]["nullable"] is False
    assert str(call_columns["source"]["default"]).strip("'") == "connection_test"
    assert call_columns["created_at"]["type"].fsp == 6
    assert {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("users")
    } == {"uk_users_email"}
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("users")
    } == {"ck_users_is_admin", "ck_users_status"}
    assert {
        constraint["name"]
        for constraint in inspector.get_check_constraints("resumes")
    } == {
        "ck_resumes_lock_version",
        "ck_resumes_source_fields",
        "ck_resumes_source_type",
        "ck_resumes_title_not_blank",
    }
    assert {
        constraint["name"]
        for constraint in inspector.get_check_constraints("llm_call_logs")
    } == {
        "ck_llm_call_logs_estimated_cost_nonnegative",
        "ck_llm_call_logs_adapter_pair",
        "ck_llm_call_logs_input_price_nonnegative",
        "ck_llm_call_logs_input_tokens_nonnegative",
        "ck_llm_call_logs_latency_nonnegative",
        "ck_llm_call_logs_metering_status",
        "ck_llm_call_logs_output_price_nonnegative",
        "ck_llm_call_logs_output_tokens_nonnegative",
        "ck_llm_call_logs_source_not_blank",
        "ck_llm_call_logs_status",
    }
    assert any(
        index["name"] == "idx_resumes_user_updated_id"
        and index["column_names"] == ["user_id", "updated_at", "id"]
        for index in inspector.get_indexes("resumes")
    )
    assert {
        constraint["name"]
        for constraint in inspector.get_check_constraints("llm_model_configs")
    } == {
        "ck_llm_model_configs_adapter_pair",
        "ck_llm_model_configs_config_version",
        "ck_llm_model_configs_input_price_nonnegative",
        "ck_llm_model_configs_output_price_nonnegative",
    }
    assert {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("llm_model_configs")
    } == {"uk_llm_model_configs_capability_id"}
    assert any(
        index["name"] == "idx_llm_model_configs_enabled_priority"
        and index["column_names"] == ["enabled", "priority", "id"]
        for index in inspector.get_indexes("llm_model_configs")
    )
    call_indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes("llm_call_logs")
    }
    assert call_indexes["idx_llm_call_logs_created"] == ["created_at", "id"]
    assert call_indexes["idx_llm_call_logs_user_created"] == [
        "user_id",
        "created_at",
        "id",
    ]
    assert call_indexes["idx_llm_call_logs_model_created"] == [
        "model_config_id",
        "created_at",
        "id",
    ]
    assert call_indexes["idx_llm_call_logs_status_created"] == [
        "status",
        "created_at",
        "id",
    ]
    assert call_indexes["idx_llm_call_logs_model_source_created"] == [
        "model_config_id",
        "source",
        "created_at",
        "id",
    ]
    binding_foreign_keys = {
        foreign_key["name"]: foreign_key
        for foreign_key in inspector.get_foreign_keys("llm_capability_bindings")
    }
    assert binding_foreign_keys["fk_llm_capability_bindings_model"][
        "constrained_columns"
    ] == ["capability", "model_config_id"]
    assert binding_foreign_keys["fk_llm_capability_bindings_model"][
        "referred_columns"
    ] == ["capability", "id"]

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
    call_foreign_keys = {
        foreign_key["name"]: foreign_key
        for foreign_key in inspector.get_foreign_keys("llm_call_logs")
    }
    assert call_foreign_keys["fk_llm_call_logs_user_id_users"][
        "constrained_columns"
    ] == ["user_id"]
    assert call_foreign_keys["fk_llm_call_logs_user_id_users"][
        "referred_table"
    ] == "users"
    assert call_foreign_keys[
        "fk_llm_call_logs_model_config_id_llm_model_configs"
    ]["constrained_columns"] == ["model_config_id"]
    assert call_foreign_keys[
        "fk_llm_call_logs_model_config_id_llm_model_configs"
    ]["referred_table"] == "llm_model_configs"

    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == EXPECTED_HEAD
        assert connection.scalar(
            text("SELECT is_admin FROM users WHERE id = :user_id"),
            {"user_id": user_id},
        ) == 0
        assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM resume_templates")) == 0
        assert connection.scalar(text("SELECT COUNT(*) FROM resumes")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM resume_versions")) == 1
        assert connection.execute(
            text(
                "SELECT capability, model_config_id "
                "FROM llm_capability_bindings"
            )
        ).one() == ("chat", None)

    run_alembic(database_url, "upgrade", "head")
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
    assert "llm_model_configs" not in inspect(engine).get_table_names()
    assert "llm_capability_bindings" not in inspect(engine).get_table_names()
    assert "llm_call_logs" not in inspect(engine).get_table_names()
    assert "job_descriptions" not in inspect(engine).get_table_names()
    assert "admin_operation_logs" not in inspect(engine).get_table_names()

    run_alembic(database_url, "upgrade", "head")
    assert {
        "users",
        "resume_templates",
        "resumes",
        "resume_versions",
        "llm_model_configs",
        "llm_capability_bindings",
        "llm_call_logs",
        "job_descriptions",
    } <= set(inspect(engine).get_table_names())
    assert "admin_operation_logs" not in inspect(engine).get_table_names()
    assert "storage_cleanup_jobs" not in inspect(engine).get_table_names()
    engine.dispose()


def test_job_descriptions_mysql_schema_and_source_uniqueness() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    run_alembic(database_url, "downgrade", "base")
    run_alembic(database_url, "upgrade", "head")

    inspector = inspect(engine)
    columns = {
        column["name"]: column
        for column in inspector.get_columns("job_descriptions")
    }
    assert set(columns) == {
        "id",
        "user_id",
        "job_title",
        "company_name",
        "employment_type",
        "description",
        "skills",
        "education_requirement",
        "experience_requirement",
        "work_schedule",
        "work_city",
        "work_address",
        "work_mode",
        "salary_text",
        "salary_min",
        "salary_max",
        "salary_currency",
        "salary_period",
        "salary_months_per_year",
        "company_legal_name",
        "company_industry",
        "company_size",
        "company_financing_stage",
        "company_description",
        "recruiter_name",
        "recruiter_title",
        "source_type",
        "source_site",
        "source_job_id",
        "source_url",
        "source_url_hash",
        "imported_at",
        "notes",
        "archived_at",
        "lock_version",
        "created_at",
        "updated_at",
    }
    assert columns["id"]["type"].unsigned is True
    assert columns["user_id"]["type"].unsigned is True
    assert columns["employment_type"]["type"].length == 24
    assert columns["education_requirement"]["type"].length == 100
    assert columns["experience_requirement"]["type"].length == 100
    assert columns["work_schedule"]["type"].length == 100
    assert columns["salary_months_per_year"]["type"].unsigned is True
    assert columns["salary_currency"]["type"].__class__.__name__ == "CHAR"
    assert columns["salary_currency"]["type"].length == 3
    assert columns["salary_currency"]["type"].collation == "ascii_bin"
    assert columns["company_size"]["type"].length == 50
    assert columns["company_financing_stage"]["type"].length == 50
    assert columns["description"]["type"].__class__.__name__ == "LONGTEXT"
    assert columns["company_description"]["type"].__class__.__name__ == "LONGTEXT"
    assert columns["source_site"]["type"].length == 32
    assert columns["source_site"]["type"].collation == "ascii_bin"
    assert columns["source_job_id"]["type"].length == 128
    assert columns["source_job_id"]["type"].collation == "ascii_bin"
    assert columns["source_url_hash"]["type"].length == 32
    assert columns["created_at"]["type"].fsp == 6

    assert {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("job_descriptions")
    } == {
        "uk_job_descriptions_user_source_job",
        "uk_job_descriptions_user_source_url",
    }
    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints("job_descriptions")
    }
    assert {
        "ck_job_descriptions_job_title_not_blank",
        "ck_job_descriptions_company_name_not_blank",
        "ck_job_descriptions_description_not_blank",
        "ck_job_descriptions_skills_array",
        "ck_job_descriptions_source_type",
        "ck_job_descriptions_source_fields",
        "ck_job_descriptions_lock_version",
    } <= check_names
    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes("job_descriptions")
    }
    assert indexes["idx_job_descriptions_user_archive_updated_id"] == [
        "user_id",
        "archived_at",
        "updated_at",
        "id",
    ]
    assert indexes["idx_job_descriptions_user_updated_id"] == [
        "user_id",
        "updated_at",
        "id",
    ]
    foreign_key = {
        item["name"]: item
        for item in inspector.get_foreign_keys("job_descriptions")
    }["fk_job_descriptions_user"]
    assert foreign_key["constrained_columns"] == ["user_id"]
    assert foreign_key["referred_table"] == "users"
    assert foreign_key["options"]["ondelete"] == "RESTRICT"

    with engine.begin() as connection:
        first_user = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('jd-one@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        second_user = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('jd-two@example.invalid', '$2b$12$fictional', '李四')"
            )
        ).lastrowid
        source_hash = bytes.fromhex("11" * 32)
        values = {
            "user_id": first_user,
            "source_hash": source_hash,
        }
        connection.execute(
            text(
                "INSERT INTO job_descriptions "
                "(user_id, job_title, company_name, description, skills, source_type, "
                "source_site, source_job_id, source_url, source_url_hash, imported_at) "
                "VALUES (:user_id, 'Java 开发', '示例科技', '虚构岗位', JSON_ARRAY('Java'), "
                "'external_import', 'boss', 'abc123', "
                "'https://www.zhipin.com/job_detail/abc123.html', :source_hash, UTC_TIMESTAMP(6))"
            ),
            values,
        )
        connection.execute(
            text(
                "INSERT INTO job_descriptions "
                "(user_id, job_title, company_name, description, skills, source_type, "
                "source_site, source_job_id, source_url, source_url_hash, imported_at) "
                "VALUES (:user_id, 'Java 开发', '示例科技', '虚构岗位', JSON_ARRAY('Java'), "
                "'external_import', 'boss', 'abc123', "
                "'https://www.zhipin.com/job_detail/abc123.html', :source_hash, UTC_TIMESTAMP(6))"
            ),
            {"user_id": second_user, "source_hash": source_hash},
        )

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO job_descriptions "
                    "(user_id, job_title, company_name, description, skills, source_type, "
                    "source_site, source_job_id, source_url, source_url_hash, imported_at) "
                    "VALUES (:user_id, '重复岗位', '示例科技', '虚构岗位', JSON_ARRAY(), "
                    "'external_import', 'boss', 'abc123', "
                    "'https://www.zhipin.com/job_detail/abc123.html', :source_hash, UTC_TIMESTAMP(6))"
                ),
                {"user_id": first_user, "source_hash": bytes.fromhex("11" * 32)},
            )

    barrier = Barrier(2)

    def insert_concurrent_source() -> str:
        try:
            with engine.begin() as connection:
                barrier.wait(timeout=5)
                connection.execute(
                    text(
                        "INSERT INTO job_descriptions "
                        "(user_id, job_title, company_name, description, skills, source_type, "
                        "source_site, source_job_id, source_url, source_url_hash, imported_at) "
                        "VALUES (:user_id, '并发岗位', '示例科技', '虚构岗位', JSON_ARRAY(), "
                        "'external_import', 'boss', 'concurrent42', "
                        "'https://www.zhipin.com/job_detail/concurrent42.html', "
                        ":source_hash, UTC_TIMESTAMP(6))"
                    ),
                    {
                        "user_id": first_user,
                        "source_hash": bytes.fromhex("22" * 32),
                    },
                )
        except IntegrityError:
            return "duplicate"
        return "created"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _index: insert_concurrent_source(), range(2)))

    assert sorted(results) == ["created", "duplicate"]

    run_alembic(database_url, "downgrade", "0006")
    assert "job_descriptions" not in inspect(engine).get_table_names()
    run_alembic(database_url, "upgrade", "head")
    assert "job_descriptions" in inspect(engine).get_table_names()
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM users"))
    run_alembic(database_url, "downgrade", "base")
    engine.dispose()


def test_mysql_0008_clears_legacy_llm_data_and_supports_rollback() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)

    run_alembic(database_url, "downgrade", "base")
    run_alembic(database_url, "upgrade", "0007")
    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('llm-migration@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        model_id = connection.execute(
            text(
                "INSERT INTO llm_model_configs (model_name, enabled, priority) "
                "VALUES ('legacy-provider/fictional-primary', TRUE, 10)"
            )
        ).lastrowid
        connection.execute(
            text(
                "INSERT INTO llm_call_logs "
                "(call_id, user_id, model_config_id, model_name, status, created_at) "
                "VALUES ('llmcall_legacy_before_0008', :user_id, :model_id, "
                "'legacy-provider/fictional-primary', 'succeeded', "
                "'2026-07-31 12:00:00.000000')"
            ),
            {"user_id": user_id, "model_id": model_id},
        )

    run_alembic(database_url, "upgrade", "0008")
    with engine.begin() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM llm_model_configs")) == 0
        assert connection.scalar(text("SELECT COUNT(*) FROM llm_call_logs")) == 0
        connection.execute(
            text(
                "ALTER TABLE llm_model_configs "
                "COMMENT='大模型连接、优先级与可选价格配置'"
            )
        )
        assert connection.execute(
            text(
                "SELECT capability, model_config_id "
                "FROM llm_capability_bindings"
            )
        ).one() == ("chat", None)
        legacy_model_id = connection.execute(
            text(
                "INSERT INTO llm_model_configs (model_name, enabled, priority) "
                "VALUES ('legacy-provider/legacy-model', FALSE, 100)"
            )
        ).lastrowid
        connection.execute(
            text(
                "INSERT INTO llm_call_logs "
                "(call_id, user_id, model_config_id, model_name, status, created_at) "
                "VALUES ('llmcall_old_app_write', :user_id, :model_id, "
                "'legacy-provider/legacy-model', 'failed', "
                "'2026-07-31 12:01:00.000000')"
            ),
            {"user_id": user_id, "model_id": legacy_model_id},
        )
        assert connection.execute(
            text(
                "SELECT capability, source, adapter, model_call_name "
                "FROM llm_call_logs "
                "WHERE call_id = 'llmcall_old_app_write'"
            )
        ).one() == ("chat", "connection_test", None, None)
        new_model_id = connection.execute(
            text(
                "INSERT INTO llm_model_configs "
                "(capability, model_name, adapter, model_call_name, enabled, priority) "
                "VALUES ('chat', 'deepseek/deepseek-v4-flash', 'deepseek', "
                "'deepseek-v4-flash', TRUE, 100)"
            )
        ).lastrowid
        connection.execute(
            text(
                "UPDATE llm_capability_bindings SET model_config_id = :model_id "
                "WHERE capability = 'chat'"
            ),
            {"model_id": new_model_id},
        )
        assert connection.scalar(
            text(
                "SELECT model_config_id FROM llm_capability_bindings "
                "WHERE capability = 'chat'"
            )
        ) == new_model_id
        alternate_model_id = connection.execute(
            text(
                "INSERT INTO llm_model_configs "
                "(capability, model_name, adapter, model_call_name, enabled, priority) "
                "VALUES ('chat', 'openai/fictional-chat', 'openai', "
                "'fictional-chat', FALSE, 100)"
            )
        ).lastrowid

    run_alembic(database_url, "upgrade", "head")
    assert "admin_operation_logs" not in inspect(engine).get_table_names()
    assert inspect(engine).get_table_comment("llm_model_configs")["text"] == (
        "系统模型能力的候选连接配置（含发布兼容列）"
    )
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM llm_model_configs")) == 3
        assert connection.scalar(text("SELECT COUNT(*) FROM llm_call_logs")) == 1
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == EXPECTED_HEAD
        )

    activation_barrier = Barrier(2)

    def activate_candidate(model_id: int) -> int:
        activation_barrier.wait(timeout=5)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "SELECT model_config_id FROM llm_capability_bindings "
                    "WHERE capability = 'chat' FOR UPDATE"
                )
            ).one()
            connection.execute(
                text(
                    "UPDATE llm_capability_bindings SET model_config_id = :model_id "
                    "WHERE capability = 'chat'"
                ),
                {"model_id": model_id},
            )
        return model_id

    with ThreadPoolExecutor(max_workers=2) as executor:
        activated = list(
            executor.map(
                activate_candidate,
                [new_model_id, alternate_model_id],
            )
        )
    assert set(activated) == {new_model_id, alternate_model_id}
    with engine.connect() as connection:
        assert connection.scalar(
            text("SELECT COUNT(*) FROM llm_capability_bindings WHERE capability = 'chat'")
        ) == 1
        assert connection.scalar(
            text(
                "SELECT model_config_id FROM llm_capability_bindings "
                "WHERE capability = 'chat'"
            )
        ) in {new_model_id, alternate_model_id}

    with pytest.raises(DBAPIError) as error:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO llm_call_logs "
                    "(call_id, source, user_id, status) "
                    "VALUES ('llmcall_invalid_source', '', :user_id, 'failed')"
                ),
                {"user_id": user_id},
            )
    assert error.value.orig.args[0] == 3819

    run_alembic(database_url, "downgrade", "0007")
    assert "llm_capability_bindings" not in inspect(engine).get_table_names()
    assert {"capability", "adapter", "model_call_name", "config_version"}.isdisjoint(
        column["name"]
        for column in inspect(engine).get_columns("llm_model_configs")
    )
    assert {"capability", "source", "adapter", "model_call_name"}.isdisjoint(
        column["name"] for column in inspect(engine).get_columns("llm_call_logs")
    )
    assert inspect(engine).get_table_comment("llm_model_configs")["text"] == (
        "大模型连接、优先级与可选价格配置"
    )
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM llm_model_configs")) == 3
        assert connection.scalar(text("SELECT COUNT(*) FROM llm_call_logs")) == 1

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM llm_call_logs"))
        connection.execute(text("DELETE FROM llm_model_configs"))
        connection.execute(text("DELETE FROM users"))

    run_alembic(database_url, "upgrade", "head")
    with engine.connect() as connection:
        assert connection.execute(
            text(
                "SELECT capability, model_config_id "
                "FROM llm_capability_bindings"
            )
        ).one() == ("chat", None)
    run_alembic(database_url, "downgrade", "base")
    run_alembic(database_url, "upgrade", "head")
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

    run_alembic(database_url, "upgrade", "0010")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0010"
        assert connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(legacy_data_json_backup, "
                "'$.schema_version')) FROM resumes WHERE id = :resume_id"
            ),
            {"resume_id": resume_id},
        ) == "1"

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

    run_alembic(database_url, "upgrade", "0010")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0010"
        assert connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(legacy_data_json_backup, "
                "'$.schema_version')) FROM resumes WHERE id = :resume_id"
            ),
            {"resume_id": resume_id},
        ) == "1"

    run_alembic(database_url, "upgrade", "head")
    head_inspector = inspect(engine)
    assert "legacy_data_json_backup" not in {
        column["name"] for column in head_inspector.get_columns("resumes")
    }
    assert "legacy_style_json_backup" not in {
        column["name"] for column in head_inspector.get_columns("resumes")
    }
    assert "legacy_data_json_backup" not in {
        column["name"] for column in head_inspector.get_columns("resume_versions")
    }
    assert "legacy_style_json_backup" not in {
        column["name"] for column in head_inspector.get_columns("resume_versions")
    }
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
