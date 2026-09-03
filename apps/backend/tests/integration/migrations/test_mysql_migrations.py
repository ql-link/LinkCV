from __future__ import annotations

import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event
from time import sleep
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from linkcv.application.resumes.service import (
    ResumeTitleConflict,
    create_resume_from_template,
)
from linkcv.core.database import utc_now
from linkcv.core.errors import ApiError
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.modules.agent.models import AgentRun, AgentSession, ResumeChangeProposal
from linkcv.modules.agent.service import (
    create_proposal,
    create_session,
    delete_resume_agent_data,
    reject_proposal,
)
from linkcv.modules.resumes.models import Resume, ResumeVersion

REPO_ROOT = Path(__file__).resolve().parents[5]
BACKEND_ROOT = REPO_ROOT / "apps/backend"
EXPECTED_HEAD = "0054"


def canonical_editor_markdown(data: dict[str, Any]) -> str:
    sections = data["sections"]
    assert isinstance(sections, dict)
    custom_sections = sections["custom_sections"]
    assert isinstance(custom_sections, list)
    custom_by_id = {section["id"]: section for section in custom_sections}
    semantic_sections = data["semantic_sections"]
    assert isinstance(semantic_sections, list)
    parts: list[str] = []
    for semantic in semantic_sections:
        assert semantic["content_key"] == "custom_sections"
        custom = custom_by_id[semantic["custom_section_id"]]
        body = "\n\n".join(item["content"]["content"] for item in custom["items"])
        if semantic["semantic_kind"] == "basics":
            parts.append(body)
        else:
            parts.append(f"## {semantic['display_title']}\n\n{body}")
    return "\n\n".join(parts)


def migration_test_url() -> str:
    raw = os.environ.get("LINKCV_TEST_MYSQL_URL")
    if not raw:
        pytest.skip(
            "LINKCV_TEST_MYSQL_URL is required for destructive MySQL migration tests"
        )
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


def reset_test_database_to_base(database_url: str) -> None:
    """Drop every table in the guarded disposable local migration database."""
    engine = create_engine(database_url)
    try:
        table_names = inspect(engine).get_table_names()
        with engine.begin() as connection:
            connection.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            try:
                for table_name in table_names:
                    escaped_name = table_name.replace("`", "``")
                    connection.exec_driver_sql(f"DROP TABLE `{escaped_name}`")
            finally:
                connection.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
    finally:
        engine.dispose()


def test_mysql_upgrade_and_idempotent_rerun() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)

    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    run_alembic(database_url, "check")

    inspector = inspect(engine)
    assert {
        "alembic_version",
        "users",
        "resume_templates",
        "resumes",
        "resume_versions",
        "document_parse_tasks",
        "job_descriptions",
        "agent_sessions",
        "agent_runs",
        "agent_messages",
        "agent_tool_calls",
        "resume_change_proposals",
        "job_applications",
        "interview_sessions",
        "interview_assets",
        "user_profiles",
    } <= set(inspector.get_table_names())
    assert "admin_operation_logs" not in inspector.get_table_names()
    for agent_table in {
        "agent_sessions",
        "agent_runs",
        "agent_messages",
        "agent_tool_calls",
        "resume_change_proposals",
    }:
        assert inspector.get_foreign_keys(agent_table) == []
    session_columns = {
        column["name"]: column for column in inspector.get_columns("agent_sessions")
    }
    assert session_columns["pinned"]["nullable"] is False
    assert str(session_columns["pinned"]["default"]).strip("'").lower() in {
        "0",
        "false",
    }
    session_indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes("agent_sessions")
    }
    assert session_indexes["idx_agent_sessions_user_pinned_updated"] == [
        "user_id",
        "pinned",
        "updated_at",
        "id",
    ]
    assert session_indexes["idx_agent_sessions_resume_pinned_updated"] == [
        "resume_id",
        "pinned",
        "updated_at",
        "id",
    ]
    proposal_columns = {
        column["name"]: column
        for column in inspector.get_columns("resume_change_proposals")
    }
    scoped_proposal_columns = {
        "proposal_mode",
        "target_locator_json",
        "target_content_hash",
        "diagnosis_json",
        "operations_json",
        "rationale_json",
        "source_refs_json",
    }
    assert scoped_proposal_columns <= set(proposal_columns)
    assert proposal_columns["proposal_mode"]["nullable"] is False
    assert proposal_columns["proposal_mode"]["type"].length == 32
    assert proposal_columns["target_content_hash"]["type"].length == 71
    for json_column in {
        "target_locator_json",
        "diagnosis_json",
        "operations_json",
        "rationale_json",
        "source_refs_json",
    }:
        assert proposal_columns[json_column]["type"].__class__.__name__ == "JSON"
    assert "ck_resume_change_proposals_mode" in {
        constraint["name"]
        for constraint in inspector.get_check_constraints("resume_change_proposals")
    }
    message_columns = {
        column["name"]: column for column in inspector.get_columns("agent_messages")
    }
    assert {"message_type", "metadata_json"} <= set(message_columns)
    assert message_columns["message_type"]["nullable"] is False
    assert message_columns["message_type"]["type"].length == 24
    assert message_columns["metadata_json"]["type"].__class__.__name__ == "JSON"
    assert "ck_agent_messages_message_type" in {
        constraint["name"]
        for constraint in inspector.get_check_constraints("agent_messages")
    }
    assert {column["name"] for column in inspector.get_columns("users")} == {
        "id",
        "email",
        "password_hash",
        "nickname",
        "avatar_object_key",
        "status",
        "is_admin",
        "wechat_openid",
        "last_login_at",
        "wechat_bound_at",
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
        "parse_task_id",
        "title",
        "data_json",
        "style_json",
        "lock_version",
        "source_type",
        "share_token",
        "share_visibility",
        "share_expires_at",
        "share_created_at",
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
        "name",
        "created_at",
    }
    assert {
        column["name"] for column in inspector.get_columns("document_parse_tasks")
    } == {
        "id",
        "source_type",
        "user_id",
        "file_name",
        "file_format",
        "object_name",
        "selected_template_id",
        "selected_template_style_json",
        "source_graph_object_name",
        "converted_object_name",
        "upload_status",
        "upload_duration_ms",
        "parse_status",
        "parse_duration_ms",
        "parse_attempt_count",
        "last_dispatched_at",
        "failure_reason",
        "created_at",
        "updated_at",
    }
    task_columns = {
        column["name"]: column
        for column in inspector.get_columns("document_parse_tasks")
    }
    assert task_columns["selected_template_style_json"]["nullable"] is True
    assert (
        task_columns["selected_template_style_json"]["type"].__class__.__name__
        == "JSON"
    )
    assert {
        constraint["name"]
        for constraint in inspector.get_check_constraints("document_parse_tasks")
    } == {
        "ck_document_parse_tasks_file_format",
        "ck_document_parse_tasks_lifecycle",
        "ck_document_parse_tasks_parse_status",
        "ck_document_parse_tasks_source_type",
        "ck_document_parse_tasks_upload_status",
    }
    task_indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes("document_parse_tasks")
    }
    assert task_indexes["idx_document_parse_tasks_user_created_id"] == [
        "user_id",
        "created_at",
        "id",
    ]
    assert task_indexes["idx_document_parse_tasks_user_state"] == [
        "user_id",
        "upload_status",
        "parse_status",
    ]
    assert task_indexes["idx_document_parse_tasks_dispatch"] == [
        "source_type",
        "parse_status",
        "last_dispatched_at",
        "id",
    ]
    task_foreign_keys = {
        foreign_key["name"]: foreign_key
        for foreign_key in inspector.get_foreign_keys("document_parse_tasks")
    }
    assert set(task_foreign_keys) == {"fk_document_parse_tasks_user"}
    assert {
        constraint["name"] for constraint in inspector.get_unique_constraints("resumes")
    } == {"uk_resumes_parse_task_id", "uk_resumes_share_token"}
    assert all(
        "parse_task_id" not in foreign_key["constrained_columns"]
        for foreign_key in inspector.get_foreign_keys("resumes")
    )
    assert {column["name"] for column in inspector.get_columns("user_dataset")} == {
        "id",
        "user_id",
        "idempotency_key",
        "request_fingerprint",
        "parse_task_id",
        "file_name",
        "file_format",
        "content_type",
        "file_size",
        "object_name",
        "sha256",
        "created_at",
    }
    assert {
        constraint["name"]
        for constraint in inspector.get_unique_constraints("user_dataset")
    } == {
        "uk_user_dataset_object_name",
        "uk_user_dataset_parse_task_id",
        "uk_user_dataset_user_idempotency",
    }
    assert all(
        "parse_task_id" not in foreign_key["constrained_columns"]
        for foreign_key in inspector.get_foreign_keys("user_dataset")
    )
    assert "storage_cleanup_jobs" not in inspector.get_table_names()
    assert "resume_imports" not in inspector.get_table_names()

    assert {
        constraint["name"] for constraint in inspector.get_unique_constraints("users")
    } == {"uk_users_email"}
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
    dataset_columns = {
        column["name"]: column for column in inspector.get_columns("user_dataset")
    }
    task_columns = {
        column["name"]: column
        for column in inspector.get_columns("document_parse_tasks")
    }
    resume_columns = {
        column["name"]: column for column in inspector.get_columns("resumes")
    }
    assert user_columns["id"]["type"].unsigned is True
    assert user_columns["status"]["type"].unsigned is True
    assert user_columns["is_admin"]["type"].unsigned is True
    assert user_columns["created_at"]["type"].fsp == 6
    assert dataset_columns["idempotency_key"]["nullable"] is False
    assert dataset_columns["idempotency_key"]["type"].length == 64
    assert dataset_columns["request_fingerprint"]["nullable"] is False
    assert dataset_columns["request_fingerprint"]["type"].length == 64
    assert dataset_columns["content_type"]["comment"] == "服务端规范化内容类型"
    assert task_columns["parse_attempt_count"]["nullable"] is False
    assert task_columns["parse_attempt_count"]["type"].unsigned is True
    assert task_columns["parse_attempt_count"]["default"] in {0, "0"}
    assert task_columns["last_dispatched_at"]["type"].fsp == 6
    assert resume_columns["id"]["type"].unsigned is True
    assert resume_columns["user_id"]["type"].unsigned is True
    assert resume_columns["data_json"]["type"].__class__.__name__ == "JSON"
    assert resume_columns["style_json"]["type"].__class__.__name__ == "JSON"
    assert resume_columns["created_at"]["type"].fsp == 6
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("users")
    } == {
        "ck_users_is_admin",
        "ck_users_status",
    }
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("resumes")
    } == {
        "ck_resumes_lock_version",
        "ck_resumes_share_fields",
        "ck_resumes_share_visibility",
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
    assert resume_foreign_keys["fk_resumes_user"]["constrained_columns"] == ["user_id"]
    assert resume_foreign_keys["fk_resumes_user"]["referred_table"] == "users"
    assert resume_foreign_keys["fk_resumes_template"]["constrained_columns"] == [
        "template_id"
    ]
    assert (
        resume_foreign_keys["fk_resumes_template"]["referred_table"]
        == "resume_templates"
    )
    assert (
        resume_foreign_keys["fk_resumes_template"]["options"]["ondelete"] == "SET NULL"
    )
    with engine.connect() as connection:
        assert set(
            connection.scalars(
                text(
                    "SELECT `key` FROM resume_templates "
                    "WHERE is_active = 1 ORDER BY `key`"
                )
            )
        ) == {
            "administrative-sidebar-cn",
            "campus-professional-cn",
            "classic-cn",
            "classic-technical-cn",
            "civic-service-cn",
            "creative-orange-cn",
            "modern-two-column-cn",
            "compact-tech-cn",
        }
        for row in connection.execute(
            text(
                "SELECT `key`, data_json, style_json FROM resume_templates "
                "WHERE `key` IN "
                "('administrative-sidebar-cn', 'campus-professional-cn', "
                "'classic-cn', 'classic-technical-cn', 'civic-service-cn', "
                "'creative-orange-cn', 'modern-two-column-cn', 'compact-tech-cn')"
            )
        ).mappings():
            data_json = (
                json.loads(row["data_json"])
                if isinstance(row["data_json"], str)
                else row["data_json"]
            )
            style_json = (
                json.loads(row["style_json"])
                if isinstance(row["style_json"], str)
                else row["style_json"]
            )
            parse_resume_snapshot(data_json, style_json)
            if data_json["semantic_sections"] and all(
                section["content_key"] == "custom_sections"
                for section in data_json["semantic_sections"]
            ):
                editor_markdown = canonical_editor_markdown(data_json)
                assert "简历正文" not in {
                    section["display_title"]
                    for section in data_json["semantic_sections"]
                }
            if row["key"] in {
                "modern-two-column-cn",
                "compact-tech-cn",
                "classic-technical-cn",
            }:
                assert "::: left" in editor_markdown
                assert "::: right" in editor_markdown
            if row["key"] == "classic-technical-cn":
                assert style_json["smart_one_page"] is True
                assert style_json["template_key"] == "classic-technical-cn"
                assert style_json["font_size"] == 11.5
                assert style_json["line_height"] == 1.42
                assert style_json["page"] == {
                    "size": "A4",
                    "margin_top_mm": 9.0,
                    "margin_right_mm": 11.0,
                    "margin_bottom_mm": 9.0,
                    "margin_left_mm": 11.0,
                }
                assert "# 张三" in editor_markdown
                assert "zhangsan@example.com" in editor_markdown
                assert "极昼气象服务有限公司" in editor_markdown
                assert "TraceHarbor" in editor_markdown
                for rejected_sample in (
                    "星河云科技有限公司",
                    "KnowledgeFlow",
                    "销售预测",
                    "JMM",
                    "Qdrant",
                ):
                    assert rejected_sample not in editor_markdown
            if row["key"] == "administrative-sidebar-cn":
                assert ":::: sidebar" in editor_markdown
                assert ":::: main" in editor_markdown
                assert "沟通协调" in editor_markdown
            if row["key"] == "campus-professional-cn":
                assert ":::: meta" in editor_markdown
                assert "周均跟进 80 余项任务" in editor_markdown
            if row["key"] == "civic-service-cn":
                assert "校青年志愿者协会" in editor_markdown
            if row["key"] == "creative-orange-cn":
                assert ":::: trio" in editor_markdown
                serialized_data = json.dumps(data_json, ensure_ascii=False)
                assert (
                    '"title_icon": {"inline_type": "icon", "name": "GraduationCap"}'
                    in serialized_data
                )
                assert ":icon[GraduationCap]:" not in serialized_data
                assert "拾光城市文化活动小程序" in editor_markdown
            if row["key"] in {
                "administrative-sidebar-cn",
                "campus-professional-cn",
                "civic-service-cn",
                "creative-orange-cn",
            }:
                assert "/templates/avatar-cat.jpg" in editor_markdown

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
                "(resume_id, version_no, data_json, style_json, reason, name) "
                "VALUES (:resume_id, 1, JSON_OBJECT('schema_version', '1.0'), "
                "JSON_OBJECT('schema_version', '1.0'), 'initial', '初始版本')"
            ),
            {"resume_id": resume_id},
        )
        connection.execute(
            text("DELETE FROM resume_templates WHERE id = :template_id"),
            {"template_id": template_id},
        )
        assert (
            connection.scalar(
                text("SELECT template_id FROM resumes WHERE id = :resume_id"),
                {"resume_id": resume_id},
            )
            is None
        )

    run_alembic(database_url, "upgrade", "head")
    run_alembic(database_url, "check")

    inspector = inspect(engine)
    assert {
        "alembic_version",
        "users",
        "resume_templates",
        "resumes",
        "resume_versions",
        "document_parse_tasks",
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
        "wechat_openid",
        "last_login_at",
        "wechat_bound_at",
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
        "parse_task_id",
        "title",
        "data_json",
        "style_json",
        "lock_version",
        "source_type",
        "share_token",
        "share_visibility",
        "share_expires_at",
        "share_created_at",
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
        "name",
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
        column["name"] for column in inspector.get_columns("llm_capability_bindings")
    } == {"capability", "model_config_id", "created_at", "updated_at"}
    assert {column["name"] for column in inspector.get_columns("llm_call_logs")} == {
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
    user_columns = {column["name"]: column for column in inspector.get_columns("users")}
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
    assert resume_columns["created_at"]["type"].fsp == 6
    assert call_columns["user_id"]["type"].unsigned is True
    assert call_columns["source"]["type"].length == 32
    assert call_columns["source"]["type"].collation == "ascii_bin"
    assert call_columns["source"]["nullable"] is False
    assert str(call_columns["source"]["default"]).strip("'") == "connection_test"
    assert call_columns["created_at"]["type"].fsp == 6
    assert {
        constraint["name"] for constraint in inspector.get_unique_constraints("users")
    } == {"uk_users_email"}
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("users")
    } == {"ck_users_is_admin", "ck_users_status"}
    assert {
        constraint["name"] for constraint in inspector.get_check_constraints("resumes")
    } == {
        "ck_resumes_lock_version",
        "ck_resumes_share_fields",
        "ck_resumes_share_visibility",
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
    assert resume_foreign_keys["fk_resumes_user"]["constrained_columns"] == ["user_id"]
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
    assert (
        call_foreign_keys["fk_llm_call_logs_user_id_users"]["referred_table"] == "users"
    )
    assert call_foreign_keys["fk_llm_call_logs_model_config_id_llm_model_configs"][
        "constrained_columns"
    ] == ["model_config_id"]
    assert (
        call_foreign_keys["fk_llm_call_logs_model_config_id_llm_model_configs"][
            "referred_table"
        ]
        == "llm_model_configs"
    )

    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == EXPECTED_HEAD
        )
        assert (
            connection.scalar(
                text("SELECT is_admin FROM users WHERE id = :user_id"),
                {"user_id": user_id},
            )
            == 0
        )
        assert connection.scalar(text("SELECT COUNT(*) FROM users")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM resume_templates")) == 8
        assert (
            connection.scalar(
                text("SELECT COUNT(*) FROM resume_templates WHERE is_active = 1")
            )
            == 8
        )
        assert connection.scalar(text("SELECT COUNT(*) FROM resumes")) == 1
        assert connection.scalar(text("SELECT COUNT(*) FROM resume_versions")) == 1
        assert connection.execute(
            text("SELECT capability, model_config_id FROM llm_capability_bindings")
        ).one() == ("chat", None)

    run_alembic(database_url, "upgrade", "head")
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM resume_versions"))
        connection.execute(text("DELETE FROM resumes"))
        connection.execute(text("DELETE FROM resume_templates"))
        connection.execute(text("DELETE FROM users"))

    upgraded_fk = {
        foreign_key["name"]: foreign_key
        for foreign_key in inspect(engine).get_foreign_keys("resumes")
    }["fk_resumes_template"]
    assert upgraded_fk["options"]["ondelete"] == "SET NULL"

    reset_test_database_to_base(database_url)
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
    assert "resume_imports" not in inspect(engine).get_table_names()
    assert "document_parse_tasks" in inspect(engine).get_table_names()
    engine.dispose()


def test_storage_cleanup_forward_migration_refuses_pending_tasks() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0009")

    engine = create_engine(database_url)
    try:
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
        assert "storage_cleanup_jobs" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_0036_preflight_failure_keeps_every_snapshot_unmodified() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0035")
    with engine.begin() as connection:
        template_ids = connection.scalars(
            text("SELECT id FROM resume_templates ORDER BY id LIMIT 2")
        ).all()
        assert len(template_ids) == 2
        connection.execute(
            text(
                "UPDATE resume_templates SET data_json = JSON_SET(data_json, '$.schema_version', 'unsupported') "
                "WHERE id = :id"
            ),
            {"id": template_ids[1]},
        )

    refused = invoke_alembic(database_url, "upgrade", "0036")
    assert refused.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0035"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                    "FROM resume_templates WHERE id = :id"
                ),
                {"id": template_ids[0]},
            )
            == "1.0"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                    "FROM resume_templates WHERE id = :id"
                ),
                {"id": template_ids[1]},
            )
            == "unsupported"
        )
    engine.dispose()


def test_0037_preflight_failure_keeps_official_templates_unmodified() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0036")
    with engine.begin() as connection:
        before = connection.execute(
            text(
                "SELECT data_json, style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        ).one()
        connection.execute(
            text(
                "UPDATE resume_templates SET data_json = JSON_SET("
                "data_json, '$.sections.custom_sections[0].items[0].content.content', '') "
                "WHERE `key` = 'classic-technical-cn'"
            )
        )

    refused = invoke_alembic(database_url, "upgrade", "0037")
    assert refused.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0036"
        )
        after = connection.execute(
            text(
                "SELECT data_json, style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        ).one()
        assert after == before
    engine.dispose()


def test_0038_preflight_failure_keeps_official_templates_unmodified() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0037")
    with engine.begin() as connection:
        before = connection.execute(
            text(
                "SELECT data_json, style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        ).one()
        connection.execute(
            text(
                "UPDATE resume_templates SET data_json = JSON_SET("
                "data_json, '$.semantic_sections[0].content_key', 'basics', "
                "'$.semantic_sections[0].custom_section_id', NULL) "
                "WHERE `key` = 'classic-technical-cn'"
            )
        )

    refused = invoke_alembic(database_url, "upgrade", "0038")
    assert refused.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0037"
        )
        after = connection.execute(
            text(
                "SELECT data_json, style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        ).one()
        assert after == before
    engine.dispose()


def test_0039_preflight_failure_keeps_official_templates_unmodified() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0038")
    with engine.begin() as connection:
        before = connection.execute(
            text(
                "SELECT data_json, style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        ).one()
        connection.execute(
            text(
                "UPDATE resume_templates SET data_json = JSON_SET("
                "data_json, '$.semantic_sections[0].custom_section_id', 'missing_section') "
                "WHERE `key` = 'classic-technical-cn'"
            )
        )

    refused = invoke_alembic(database_url, "upgrade", "0039")
    assert refused.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0038"
        )
        after = connection.execute(
            text(
                "SELECT data_json, style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        ).one()
        assert after == before
    engine.dispose()


def test_0040_repairs_existing_official_column_template_manifest() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0039")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        style_value = connection.scalar(
            text(
                "SELECT style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        )
        style = json.loads(style_value) if isinstance(style_value, str) else style_value
        sidebar_index = next(
            index
            for index, slot in enumerate(style["manifest"]["slots"])
            if slot["region_id"] == "sidebar"
        )
        accepts = style["manifest"]["slots"][sidebar_index]["accepts"]
        if "basics" not in accepts:
            accepts.insert(0, "basics")
        connection.execute(
            text(
                "UPDATE resume_templates SET style_json = :style_json "
                "WHERE `key` = 'administrative-sidebar-cn'"
            ),
            {"style_json": json.dumps(style, ensure_ascii=False)},
        )

    run_alembic(database_url, "upgrade", "0040")
    with engine.connect() as connection:
        repaired_value = connection.scalar(
            text(
                "SELECT style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        )
        repaired = (
            json.loads(repaired_value)
            if isinstance(repaired_value, str)
            else repaired_value
        )
        sidebar = next(
            slot
            for slot in repaired["manifest"]["slots"]
            if slot["region_id"] == "sidebar"
        )
        assert "basics" not in sidebar["accepts"]
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0040"
        )
    engine.dispose()


def test_0041_removes_official_template_page_projection_without_losing_content() -> (
    None
):
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0040")
    engine = create_engine(database_url)
    with engine.connect() as connection:
        before_value = connection.scalar(
            text(
                "SELECT data_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        )
        before = (
            json.loads(before_value) if isinstance(before_value, str) else before_value
        )
        assert ":::: sidebar" in canonical_editor_markdown(before)

    run_alembic(database_url, "upgrade", "0041")
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT data_json, style_json FROM resume_templates "
                "WHERE `key` = 'administrative-sidebar-cn'"
            )
        ).one()
        data = (
            json.loads(row.data_json)
            if isinstance(row.data_json, str)
            else row.data_json
        )
        style = (
            json.loads(row.style_json)
            if isinstance(row.style_json, str)
            else row.style_json
        )
        snapshot = parse_resume_snapshot(data, style)
        markdown = canonical_editor_markdown(data)
        sidebar = next(
            slot
            for slot in snapshot.style.manifest.slots
            if slot.region_id == "sidebar"
        )

        assert ":::: sidebar" not in markdown
        assert ":::: main" not in markdown
        assert {"profile", "skills", "interests"} <= {
            section.semantic_kind for section in snapshot.data.semantic_sections
        }
        assert {"profile", "interests"} <= set(sidebar.accepts)
        assert "维护会议、采购、合同与固定资产台账" in markdown
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0041"
        )
    engine.dispose()


def test_0042_deletes_blank_template_without_deleting_resumes_and_restores_layout() -> (
    None
):
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0041")
    engine = create_engine(database_url)

    def json_object(value: object) -> dict[str, Any]:
        decoded = json.loads(value) if isinstance(value, str) else value
        assert isinstance(decoded, dict)
        return decoded

    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('template-retirement@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        templates = {
            row.key: row
            for row in connection.execute(
                text(
                    "SELECT id, `key`, data_json, style_json FROM resume_templates "
                    "WHERE `key` IN ('blank-cn', 'classic-technical-cn')"
                )
            )
        }
        blank = templates["blank-cn"]
        classic = templates["classic-technical-cn"]
        blank_data = json_object(blank.data_json)
        blank_style = json_object(blank.style_json)
        classic_data = json_object(classic.data_json)
        classic_style = json_object(classic.style_json)
        assert classic_style["page"] == {
            "size": "A4",
            "margin_top_mm": 12.0,
            "margin_right_mm": 14.0,
            "margin_bottom_mm": 12.0,
            "margin_left_mm": 14.0,
        }

        blank_resume_id = connection.execute(
            text(
                "INSERT INTO resumes "
                "(user_id, template_id, title, data_json, style_json, source_type) "
                "VALUES (:user_id, :template_id, '历史空白简历', :data_json, :style_json, 'template')"
            ),
            {
                "user_id": user_id,
                "template_id": blank.id,
                "data_json": json.dumps(blank_data, ensure_ascii=False),
                "style_json": json.dumps(blank_style, ensure_ascii=False),
            },
        ).lastrowid
        classic_resume_id = connection.execute(
            text(
                "INSERT INTO resumes "
                "(user_id, template_id, title, data_json, style_json, source_type) "
                "VALUES (:user_id, :template_id, '经典技术简历', :data_json, :style_json, 'template')"
            ),
            {
                "user_id": user_id,
                "template_id": classic.id,
                "data_json": json.dumps(classic_data, ensure_ascii=False),
                "style_json": json.dumps(classic_style, ensure_ascii=False),
            },
        ).lastrowid
        for resume_id, data, style in (
            (blank_resume_id, blank_data, blank_style),
            (classic_resume_id, classic_data, classic_style),
        ):
            connection.execute(
                text(
                    "INSERT INTO resume_versions "
                    "(resume_id, version_no, data_json, style_json, reason, name) "
                    "VALUES (:resume_id, 1, :data_json, :style_json, 'initial', '初始版本')"
                ),
                {
                    "resume_id": resume_id,
                    "data_json": json.dumps(data, ensure_ascii=False),
                    "style_json": json.dumps(style, ensure_ascii=False),
                },
            )

    run_alembic(database_url, "upgrade", "0042")
    with engine.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT COUNT(*) FROM resume_templates WHERE `key` = 'blank-cn'")
            )
            == 0
        )
        retired_resume = connection.execute(
            text(
                "SELECT template_id, data_json, style_json FROM resumes WHERE id = :id"
            ),
            {"id": blank_resume_id},
        ).one()
        assert retired_resume.template_id is None
        assert json_object(retired_resume.data_json) == blank_data
        assert json_object(retired_resume.style_json) == blank_style

        expected_page = {
            "size": "A4",
            "margin_top_mm": 9.0,
            "margin_right_mm": 11.0,
            "margin_bottom_mm": 9.0,
            "margin_left_mm": 11.0,
        }
        classic_styles = [
            connection.scalar(
                text(
                    "SELECT style_json FROM resume_templates "
                    "WHERE `key` = 'classic-technical-cn'"
                )
            ),
            connection.scalar(
                text("SELECT style_json FROM resumes WHERE id = :id"),
                {"id": classic_resume_id},
            ),
            connection.scalar(
                text(
                    "SELECT style_json FROM resume_versions "
                    "WHERE resume_id = :resume_id AND version_no = 1"
                ),
                {"resume_id": classic_resume_id},
            ),
        ]
        assert [json_object(style)["page"] for style in classic_styles] == [
            expected_page,
            expected_page,
            expected_page,
        ]
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0042"
        )
    engine.dispose()


def test_0047_binds_retired_blank_history_to_inactive_tombstone() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0041")
    engine = create_engine(database_url)
    try:
        def json_object(value: object) -> dict[str, Any]:
            decoded = json.loads(value) if isinstance(value, str) else value
            assert isinstance(decoded, dict)
            return decoded

        with engine.begin() as connection:
            user_id = connection.execute(
                text(
                    "INSERT INTO users (email, password_hash, nickname) "
                    "VALUES ('retired-history@example.invalid', '$2b$12$fictional', '张三')"
                )
            ).lastrowid
            blank = connection.execute(
                text(
                    "SELECT id, data_json, style_json FROM resume_templates "
                    "WHERE `key` = 'blank-cn'"
                )
            ).one()
            blank_data = json_object(blank.data_json)
            blank_style = json_object(blank.style_json)
            resume_style = json.loads(json.dumps(blank_style, ensure_ascii=False))
            resume_style["accent_color"] = "#123456"
            resume_style["font_size"] = 12
            version_style = json.loads(json.dumps(blank_style, ensure_ascii=False))
            version_style["accent_color"] = "#654321"
            version_style["font_size"] = 15
            version_style["page"] = {
                "size": "A4",
                "margin_top_mm": 4.0,
                "margin_right_mm": 7.0,
                "margin_bottom_mm": 5.0,
                "margin_left_mm": 8.0,
            }
            resume_data = json.loads(json.dumps(blank_data, ensure_ascii=False))
            resume_data["basics"]["name"] = "历史当前简历"
            version_data = json.loads(json.dumps(blank_data, ensure_ascii=False))
            version_data["basics"]["name"] = "历史版本快照"
            resume_id = connection.execute(
                text(
                    "INSERT INTO resumes "
                    "(user_id, template_id, title, data_json, style_json, source_type) "
                    "VALUES (:user_id, :template_id, '历史空白简历', :data_json, :style_json, 'template')"
                ),
                {
                    "user_id": user_id,
                    "template_id": blank.id,
                    "data_json": json.dumps(resume_data, ensure_ascii=False),
                    "style_json": json.dumps(resume_style, ensure_ascii=False),
                },
            ).lastrowid
            version_id = connection.execute(
                text(
                    "INSERT INTO resume_versions "
                    "(resume_id, version_no, data_json, style_json, reason, name) "
                    "VALUES (:resume_id, 1, :data_json, :style_json, 'initial', '初始版本')"
                ),
                {
                    "resume_id": resume_id,
                    "data_json": json.dumps(version_data, ensure_ascii=False),
                    "style_json": json.dumps(version_style, ensure_ascii=False),
                },
            ).lastrowid

        run_alembic(database_url, "upgrade", "0042")
        with engine.connect() as connection:
            assert connection.scalar(
                text("SELECT COUNT(*) FROM resume_templates WHERE `key` = 'blank-cn'")
            ) == 0
            assert connection.scalar(
                text("SELECT template_id FROM resumes WHERE id = :id"),
                {"id": resume_id},
            ) is None

        run_alembic(database_url, "upgrade", "0047")
        with engine.connect() as connection:
            tombstone = connection.execute(
                text(
                    "SELECT id, is_active, data_json, style_json FROM resume_templates "
                    "WHERE `key` = 'blank-cn'"
                )
            ).one()
            assert tombstone.is_active == 0
            tombstone_data = json_object(tombstone.data_json)
            assert tombstone_data["identity"]["name"] is None
            retired_resume = connection.execute(
                text(
                    "SELECT template_id, data_json, style_json FROM resumes WHERE id = :id"
                ),
                {"id": resume_id},
            ).one()
            retired_version = connection.execute(
                text(
                    "SELECT template_id, data_json, style_json "
                    "FROM resume_versions WHERE id = :id"
                ),
                {"id": version_id},
            ).one()
            for row, expected_name in (
                (retired_resume, "历史当前简历"),
                (retired_version, "历史版本快照"),
            ):
                assert row.template_id == tombstone.id
                data = json_object(row.data_json)
                style = json_object(row.style_json)
                assert data["schema_version"] == "canonical-resume.v1"
                assert data["identity"]["name"]["value"] == expected_name
                assert style["schema_version"] == "resume-presentation.v1"
                assert style["template_snapshot"]["template_key"] == "blank-cn"
            assert retired_resume.style_json is not None
            assert json_object(retired_resume.style_json)["template_snapshot"]["tokens"][
                "font_size_pt"
            ] == 12
            assert json_object(retired_version.style_json)["template_snapshot"]["tokens"][
                "font_size_pt"
            ] == 15
            assert json_object(retired_resume.style_json)["portable"]["accent_color"] == "#123456"
            assert json_object(retired_version.style_json)["portable"]["accent_color"] == "#654321"
            assert connection.scalar(
                text(
                    "SELECT COUNT(*) FROM resume_templates "
                    "WHERE `key` = 'blank-cn' AND is_active = 1"
                )
            ) == 0

        resume_columns = {
            column["name"]: column for column in inspect(engine).get_columns("resumes")
        }
        version_columns = {
            column["name"]: column
            for column in inspect(engine).get_columns("resume_versions")
        }
        assert resume_columns["template_id"]["nullable"] is False
        assert version_columns["template_id"]["nullable"] is False

        run_alembic(database_url, "upgrade", "head")
        with engine.connect() as connection:
            assert set(
                connection.scalars(
                    text(
                        "SELECT `key` FROM resume_templates "
                        "WHERE is_active = 1 ORDER BY `key`"
                    )
                )
            ) == {
                "administrative-sidebar-cn",
                "campus-professional-cn",
                "classic-cn",
                "classic-technical-cn",
                "civic-service-cn",
                "creative-orange-cn",
                "modern-two-column-cn",
                "compact-tech-cn",
            }
            assert connection.scalar(
                text("SELECT template_id FROM resumes WHERE id = :id"),
                {"id": resume_id},
            ) == tombstone.id
    finally:
        engine.dispose()


def test_0043_adds_dataset_idempotency_and_dispatch_recovery_fields() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0042")
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            user_id = connection.execute(
                text(
                    "INSERT INTO users (email, password_hash, nickname) "
                    "VALUES ('dataset-migration@example.invalid', "
                    "'$2b$12$fictional', '张三')"
                )
            ).lastrowid
            task_id = connection.execute(
                text(
                    "INSERT INTO document_parse_tasks "
                    "(source_type, user_id, file_name, file_format, object_name, "
                    "upload_status, upload_duration_ms, parse_status) VALUES "
                    "('dataset', :user_id, 'notes.md', 'md', "
                    "CONCAT('users/', :user_id, '/datasets/legacy-notes.md'), "
                    "'succeeded', 12, 'processing')"
                ),
                {"user_id": user_id},
            ).lastrowid
            dataset_id = connection.execute(
                text(
                    "INSERT INTO user_dataset "
                    "(user_id, parse_task_id, file_name, file_format, content_type, "
                    "file_size, object_name, sha256) VALUES "
                    "(:user_id, :task_id, 'notes.md', 'md', 'text/markdown', 12, "
                    "CONCAT('users/', :user_id, '/datasets/legacy-notes.md'), :sha256)"
                ),
                {
                    "user_id": user_id,
                    "task_id": task_id,
                    "sha256": "a" * 64,
                },
            ).lastrowid

        run_alembic(database_url, "upgrade", "0043")
        inspector = inspect(engine)
        assert {column["name"] for column in inspector.get_columns("user_dataset")} >= {
            "idempotency_key",
            "request_fingerprint",
        }
        assert {
            column["name"] for column in inspector.get_columns("document_parse_tasks")
        } >= {"parse_attempt_count", "last_dispatched_at"}
        assert {
            constraint["name"]
            for constraint in inspector.get_unique_constraints("user_dataset")
        } >= {"uk_user_dataset_user_idempotency"}
        assert {
            index["name"] for index in inspector.get_indexes("document_parse_tasks")
        } >= {"idx_document_parse_tasks_dispatch"}

        with engine.connect() as connection:
            dataset = connection.execute(
                text(
                    "SELECT idempotency_key, request_fingerprint "
                    "FROM user_dataset WHERE id = :id"
                ),
                {"id": dataset_id},
            ).one()
            assert dataset == (f"legacy-{dataset_id}", "a" * 64)
            task = connection.execute(
                text(
                    "SELECT parse_attempt_count, last_dispatched_at "
                    "FROM document_parse_tasks WHERE id = :id"
                ),
                {"id": task_id},
            ).one()
            assert task == (0, None)
            queued_task_id = connection.execute(
                text(
                    "INSERT INTO document_parse_tasks "
                    "(source_type, user_id, file_name, file_format, object_name, "
                    "upload_status, upload_duration_ms, parse_status) VALUES "
                    "('dataset', :user_id, 'queued.md', 'md', "
                    "CONCAT('users/', :user_id, '/datasets/queued.md'), "
                    "'succeeded', 1, 'queued')"
                ),
                {"user_id": user_id},
            ).lastrowid
            assert queued_task_id is not None
            assert (
                connection.scalar(
                    text(
                        "SELECT parse_attempt_count FROM document_parse_tasks "
                        "WHERE id = :id"
                    ),
                    {"id": queued_task_id},
                )
                == 0
            )
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == "0043"
            )
    finally:
        engine.dispose()
        reset_test_database_to_base(database_url)


def test_0045_restructures_user_profiles_and_removes_obsolete_columns() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0044")
    engine = create_engine(database_url)

    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('profile-migration@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        profile_id = connection.execute(
            text(
                "INSERT INTO user_profiles ("
                "user_id, lock_version, work_city, salary_min, salary_max, "
                "salary_currency, salary_period, employment_type, work_mode, "
                "target_positions, exclusions, target_companies, availability, "
                "available_from, school, school_tier, major, education_level, "
                "years_experience, birth_date, languages, skills, certifications, "
                "honors, campus_experiences, created_at, updated_at"
                ") VALUES ("
                ":user_id, 3, '上海', 12000, 18000, 'CNY', 'month', 'full_time', "
                "'hybrid', :target_positions, :exclusions, :target_companies, "
                "'custom', '2026-10-01', '南方虚构大学', :school_tier, '计算机科学', "
                "'master', 4, '1994-02-03', :languages, :skills, :certifications, "
                ":honors, :campus_experiences, '2026-08-01 12:00:00.000000', "
                "'2026-08-02 12:00:00.000000')"
            ),
            {
                "user_id": user_id,
                "target_positions": json.dumps(
                    ["前端工程师", "平台工程师"], ensure_ascii=False
                ),
                "exclusions": json.dumps(["无长期出差"], ensure_ascii=False),
                "target_companies": json.dumps(["虚构科技"], ensure_ascii=False),
                "school_tier": json.dumps(["project_211"], ensure_ascii=False),
                "languages": json.dumps(["英语 CET-6"], ensure_ascii=False),
                "skills": json.dumps(["React", "Python"], ensure_ascii=False),
                "certifications": json.dumps(["AWS SAA"], ensure_ascii=False),
                "honors": json.dumps(["校级奖学金"], ensure_ascii=False),
                "campus_experiences": json.dumps(["虚构校园项目"], ensure_ascii=False),
            },
        ).lastrowid
        assert profile_id is not None
        before = dict(
            connection.execute(
                text(
                    "SELECT user_id, lock_version, salary_min, salary_max, "
                    "salary_currency, salary_period, school, school_tier, major, "
                    "education_level, years_experience, languages, skills, "
                    "certifications, honors, campus_experiences, created_at, updated_at "
                    "FROM user_profiles WHERE id = :profile_id"
                ),
                {"profile_id": profile_id},
            )
            .mappings()
            .one()
        )

    run_alembic(database_url, "upgrade", "0045")
    inspector = inspect(engine)
    columns = {
        column["name"]: column for column in inspector.get_columns("user_profiles")
    }
    assert set(columns) == {
        "id",
        "user_id",
        "lock_version",
        "candidate_cities",
        "salary_min",
        "salary_max",
        "salary_currency",
        "salary_period",
        "employment_types",
        "professional_directions",
        "school",
        "school_tier",
        "major",
        "education_level",
        "years_experience",
        "candidate_status",
        "graduation_year",
        "languages",
        "skills",
        "certifications",
        "honors",
        "campus_experiences",
        "created_at",
        "updated_at",
    }
    assert columns["candidate_cities"]["nullable"] is False
    assert columns["employment_types"]["nullable"] is False
    assert columns["professional_directions"]["nullable"] is False
    assert columns["candidate_status"]["nullable"] is True
    assert columns["graduation_year"]["nullable"] is True
    assert {
        constraint["name"]
        for constraint in inspector.get_check_constraints("user_profiles")
    } == {
        "ck_user_profiles_lock_version",
        "ck_user_profiles_salary_period",
        "ck_user_profiles_salary_range",
        "ck_user_profiles_salary_context",
        "ck_user_profiles_salary_currency",
        "ck_user_profiles_education_level",
        "ck_user_profiles_years_experience",
        "ck_user_profiles_languages_array",
        "ck_user_profiles_skills_array",
        "ck_user_profiles_certifications_array",
        "ck_user_profiles_honors_array",
        "ck_user_profiles_campus_experiences_array",
        "ck_user_profiles_school_tier_array",
        "ck_user_profiles_candidate_cities_array",
        "ck_user_profiles_employment_types_array",
        "ck_user_profiles_professional_directions_array",
        "ck_user_profiles_candidate_status",
        "ck_user_profiles_graduation_year",
        "ck_user_profiles_candidate_experience_context",
    }
    assert not {
        "work_city",
        "employment_type",
        "work_mode",
        "target_positions",
        "exclusions",
        "target_companies",
        "availability",
        "available_from",
        "birth_date",
    } & set(columns)

    def json_array(value: object) -> list[Any]:
        decoded = json.loads(value) if isinstance(value, (str, bytes)) else value
        assert isinstance(decoded, list)
        return decoded

    with engine.connect() as connection:
        row = dict(
            connection.execute(
                text(
                    "SELECT user_id, lock_version, candidate_cities, "
                    "employment_types, professional_directions, candidate_status, "
                    "graduation_year, salary_min, salary_max, salary_currency, "
                    "salary_period, school, school_tier, major, education_level, "
                    "years_experience, languages, skills, certifications, honors, "
                    "campus_experiences, created_at, updated_at "
                    "FROM user_profiles WHERE id = :profile_id"
                ),
                {"profile_id": profile_id},
            )
            .mappings()
            .one()
        )
        assert row["user_id"] == before["user_id"]
        assert row["lock_version"] == before["lock_version"]
        assert json_array(row["candidate_cities"]) == ["上海"]
        assert json_array(row["employment_types"]) == ["full_time"]
        assert json_array(row["professional_directions"]) == [
            "前端工程师",
            "平台工程师",
        ]
        assert row["candidate_status"] is None
        assert row["graduation_year"] is None
        for field in (
            "salary_min",
            "salary_max",
            "salary_currency",
            "salary_period",
            "school",
            "major",
            "education_level",
            "years_experience",
            "created_at",
            "updated_at",
        ):
            assert row[field] == before[field]
        for field in (
            "school_tier",
            "languages",
            "skills",
            "certifications",
            "honors",
            "campus_experiences",
        ):
            assert json_array(row[field]) == json_array(before[field])
        assert connection.scalar(text("SELECT COUNT(*) FROM user_profiles")) == 1
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0045"
        )

    with pytest.raises(DBAPIError):
        with engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE user_profiles SET candidate_status = 'fresh_graduate', "
                    "graduation_year = 2026, years_experience = 1 WHERE id = :profile_id"
                ),
                {"profile_id": profile_id},
            )
    with pytest.raises(DBAPIError):
        with engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE user_profiles SET candidate_status = NULL, "
                    "graduation_year = 2026 WHERE id = :profile_id"
                ),
                {"profile_id": profile_id},
            )
    engine.dispose()


def test_0046_simplifies_profile_preferences_and_removes_professional_directions() -> (
    None
):
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0045")
    engine = create_engine(database_url)

    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('profile-0046@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        profile_id = connection.execute(
            text(
                "INSERT INTO user_profiles ("
                "user_id, lock_version, candidate_cities, salary_min, salary_max, "
                "salary_currency, salary_period, employment_types, "
                "professional_directions, school, school_tier, major, "
                "education_level, years_experience, candidate_status, "
                "graduation_year, languages, skills, certifications, honors, "
                "campus_experiences"
                ") VALUES ("
                ":user_id, 7, :candidate_cities, NULL, NULL, NULL, NULL, "
                ":employment_types, :professional_directions, NULL, :school_tier, "
                "NULL, NULL, NULL, NULL, NULL, :languages, :skills, "
                ":certifications, :honors, :campus_experiences"
                ")"
            ),
            {
                "user_id": user_id,
                "candidate_cities": json.dumps(["上海"], ensure_ascii=False),
                "employment_types": json.dumps(
                    [
                        "contract",
                        "full_time",
                        "internship",
                        "full_time",
                        "temporary",
                        "internship",
                    ],
                    ensure_ascii=False,
                ),
                "professional_directions": json.dumps(
                    ["旧职业方向"], ensure_ascii=False
                ),
                "school_tier": json.dumps([], ensure_ascii=False),
                "languages": json.dumps([], ensure_ascii=False),
                "skills": json.dumps([], ensure_ascii=False),
                "certifications": json.dumps([], ensure_ascii=False),
                "honors": json.dumps([], ensure_ascii=False),
                "campus_experiences": json.dumps([], ensure_ascii=False),
            },
        ).lastrowid
        assert profile_id is not None
        before_count = connection.scalar(text("SELECT COUNT(*) FROM user_profiles"))

    run_alembic(database_url, "upgrade", "0046")
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("user_profiles")}
    assert "professional_directions" not in columns
    assert columns == {
        "id",
        "user_id",
        "lock_version",
        "candidate_cities",
        "salary_min",
        "salary_max",
        "salary_currency",
        "salary_period",
        "employment_types",
        "school",
        "school_tier",
        "major",
        "education_level",
        "years_experience",
        "candidate_status",
        "graduation_year",
        "languages",
        "skills",
        "certifications",
        "honors",
        "campus_experiences",
        "created_at",
        "updated_at",
    }
    checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints("user_profiles")
    }
    assert "ck_user_profiles_professional_directions_array" not in checks
    assert "ck_user_profiles_employment_types_array" in checks

    with engine.connect() as connection:
        value = connection.scalar(
            text("SELECT employment_types FROM user_profiles WHERE id = :profile_id"),
            {"profile_id": profile_id},
        )
        decoded = json.loads(value) if isinstance(value, (str, bytes)) else value
        assert decoded == ["full_time", "internship"]
        assert (
            connection.scalar(text("SELECT COUNT(*) FROM user_profiles"))
            == before_count
        )
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0046"
        )

    engine.dispose()


def test_0051_repairs_a_stamped_legacy_profile_schema() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0044")
    engine = create_engine(database_url)

    try:
        with engine.begin() as connection:
            user_id = connection.execute(
                text(
                    "INSERT INTO users (email, password_hash, nickname) "
                    "VALUES ('profile-0051-legacy@example.invalid', '$2b$12$fictional', '张三')"
                )
            ).lastrowid
            profile_id = connection.execute(
                text(
                    "INSERT INTO user_profiles ("
                    "user_id, lock_version, work_city, salary_min, salary_max, "
                    "salary_currency, salary_period, employment_type, work_mode, "
                    "target_positions, exclusions, target_companies, availability, "
                    "available_from, school, school_tier, major, education_level, "
                    "years_experience, birth_date, languages, skills, certifications, "
                    "honors, campus_experiences, created_at, updated_at"
                    ") VALUES ("
                    ":user_id, 9, ' 上海 ', 12000, 18000, 'CNY', 'month', 'full_time', "
                    "'hybrid', :target_positions, JSON_ARRAY('不出差'), "
                    "JSON_ARRAY('虚构科技'), 'custom', '2026-10-01', '南方虚构大学', "
                    "JSON_ARRAY('project_211'), '计算机科学', 'master', 4, "
                    "'1994-02-03', JSON_ARRAY('英语'), JSON_ARRAY('Python'), "
                    "JSON_ARRAY('AWS SAA'), JSON_ARRAY('校级奖学金'), "
                    "JSON_ARRAY('虚构校园项目'), '2026-08-01 12:00:00.000000', "
                    "'2026-08-02 12:00:00.000000')"
                ),
                {
                    "user_id": user_id,
                    "target_positions": json.dumps(
                        ["平台工程师", "前端工程师"], ensure_ascii=False
                    ),
                },
            ).lastrowid
            assert user_id is not None
            assert profile_id is not None
            connection.execute(
                text("UPDATE alembic_version SET version_num = '0050'")
            )

        run_alembic(database_url, "upgrade", "head")

        inspector = inspect(engine)
        columns = {
            column["name"] for column in inspector.get_columns("user_profiles")
        }
        assert "work_city" not in columns
        assert "professional_directions" not in columns
        assert {"candidate_cities", "employment_types", "candidate_status", "graduation_year"} <= columns

        with engine.connect() as connection:
            row = connection.execute(
                text(
                    "SELECT id, user_id, lock_version, candidate_cities, "
                    "employment_types, candidate_status, graduation_year, "
                    "salary_min, salary_max, created_at, updated_at "
                    "FROM user_profiles WHERE id = :profile_id"
                ),
                {"profile_id": profile_id},
            ).mappings().one()
            decoded_cities = (
                json.loads(row["candidate_cities"])
                if isinstance(row["candidate_cities"], (str, bytes))
                else row["candidate_cities"]
            )
            decoded_employment = (
                json.loads(row["employment_types"])
                if isinstance(row["employment_types"], (str, bytes))
                else row["employment_types"]
            )
            assert row["id"] == profile_id
            assert row["user_id"] == user_id
            assert row["lock_version"] == 9
            assert decoded_cities == ["上海"]
            assert decoded_employment == ["full_time"]
            assert row["candidate_status"] is None
            assert row["graduation_year"] is None
            assert row["salary_min"] == 12000
            assert row["salary_max"] == 18000
            assert str(row["created_at"]) == "2026-08-01 12:00:00"
            assert str(row["updated_at"]) == "2026-08-02 12:00:00"
            assert connection.scalar(text("SELECT COUNT(*) FROM user_profiles")) == 1
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == EXPECTED_HEAD
            )
    finally:
        engine.dispose()
        reset_test_database_to_base(database_url)


def test_0051_advances_an_already_final_profile_schema_without_data_changes() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0050")
    engine = create_engine(database_url)

    try:
        with engine.begin() as connection:
            user_id = connection.execute(
                text(
                    "INSERT INTO users (email, password_hash, nickname) "
                    "VALUES ('profile-0051-target@example.invalid', '$2b$12$fictional', '张三')"
                )
            ).lastrowid
            profile_id = connection.execute(
                text(
                    "INSERT INTO user_profiles ("
                    "user_id, lock_version, candidate_cities, salary_min, salary_max, "
                    "salary_currency, salary_period, employment_types, school, "
                    "school_tier, major, education_level, years_experience, "
                    "candidate_status, graduation_year, languages, skills, "
                    "certifications, honors, campus_experiences, created_at, updated_at"
                    ") VALUES ("
                    ":user_id, 4, JSON_ARRAY('上海'), 10000, 15000, 'CNY', 'month', "
                    "JSON_ARRAY('full_time', 'internship'), '南方虚构大学', "
                    "JSON_ARRAY('project_211'), '计算机科学', 'master', 2, NULL, NULL, "
                    "JSON_ARRAY('英语'), JSON_ARRAY('Python'), JSON_ARRAY(), JSON_ARRAY(), "
                    "JSON_ARRAY(), '2026-08-03 12:00:00.000000', '2026-08-04 12:00:00.000000')"
                ),
                {"user_id": user_id},
            ).lastrowid
            assert user_id is not None
            assert profile_id is not None

        with engine.connect() as connection:
            before = connection.execute(
                text(
                    "SELECT id, user_id, lock_version, candidate_cities, "
                    "employment_types, created_at, updated_at "
                    "FROM user_profiles WHERE id = :profile_id"
                ),
                {"profile_id": profile_id},
            ).one()

        run_alembic(database_url, "upgrade", "head")

        with engine.connect() as connection:
            after = connection.execute(
                text(
                    "SELECT id, user_id, lock_version, candidate_cities, "
                    "employment_types, created_at, updated_at "
                    "FROM user_profiles WHERE id = :profile_id"
                ),
                {"profile_id": profile_id},
            ).one()
            assert after == before
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == EXPECTED_HEAD
            )
    finally:
        engine.dispose()
        reset_test_database_to_base(database_url)


def test_0053_and_0054_merge_offer_statuses_and_use_single_salary() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0051")
    engine = create_engine(database_url)

    try:
        with engine.begin() as connection:
            user_id = connection.execute(
                text(
                    "INSERT INTO users (email, password_hash, nickname) "
                    "VALUES ('offer-0053@example.invalid', '$2b$12$fictional', '张三')"
                )
            ).lastrowid
            for row_id, legacy_status in enumerate(
                ("oc_received", "written_offer_received"), start=1
            ):
                connection.execute(
                    text(
                        "INSERT INTO job_applications ("
                        "id, user_id, company_name_snapshot, job_title_snapshot, "
                        "job_snapshot, calendar_color, current_stage_type, "
                        "current_stage_label, stage_state, offer_status"
                        ") VALUES ("
                        ":id, :user_id, 'Offer 示例公司', '后端开发工程师', "
                        "JSON_OBJECT('schema_version', 1), 'blue', 'offer', "
                        "'Offer', 'negotiating', :offer_status)"
                    ),
                    {
                        "id": row_id,
                        "user_id": user_id,
                        "offer_status": legacy_status,
                    },
                )

        run_alembic(database_url, "upgrade", "0053")

        with engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE job_applications SET offer_salary_min = 20000, "
                    "offer_salary_max = 30000, offer_salary_currency = 'CNY', "
                    "offer_salary_period = 'month' WHERE id = 1"
                )
            )
            connection.execute(
                text(
                    "UPDATE job_applications SET offer_salary_max = 18000, "
                    "offer_salary_currency = 'CNY', offer_salary_period = 'month' "
                    "WHERE id = 2"
                )
            )

        run_alembic(database_url, "upgrade", "head")

        columns = {
            column["name"]: column
            for column in inspect(engine).get_columns("job_applications")
        }
        assert {
            "offer_base_location",
            "offer_salary",
            "offer_salary_currency",
            "offer_salary_period",
            "offer_benefits_description",
        } <= set(columns)
        assert {"offer_salary_min", "offer_salary_max"}.isdisjoint(columns)
        assert columns["offer_salary"]["type"].precision == 12
        assert columns["offer_salary"]["type"].scale == 2
        assert columns["offer_salary_currency"]["type"].length == 3
        assert columns["offer_salary_currency"]["type"].collation == "ascii_bin"

        with engine.connect() as connection:
            statuses = connection.execute(
                text("SELECT offer_status FROM job_applications ORDER BY id")
            ).scalars().all()
            assert statuses == ["received", "received"]
            salaries = connection.execute(
                text("SELECT offer_salary FROM job_applications ORDER BY id")
            ).scalars().all()
            assert salaries == [20000, 18000]
            assert connection.scalar(
                text("SELECT version_num FROM alembic_version")
            ) == EXPECTED_HEAD

        with pytest.raises(DBAPIError):
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE job_applications SET offer_salary = 30000, "
                        "offer_salary_currency = NULL WHERE id = 1"
                    )
                )
    finally:
        engine.dispose()
        reset_test_database_to_base(database_url)


def test_agent_clarification_message_forward_migration() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0031")

    engine = create_engine(database_url)
    try:
        assert {
            column["name"] for column in inspect(engine).get_columns("agent_messages")
        }.isdisjoint({"message_type", "metadata_json"})

        run_alembic(database_url, "upgrade", "0032")
        upgraded = inspect(engine)
        assert {"message_type", "metadata_json"} <= {
            column["name"] for column in upgraded.get_columns("agent_messages")
        }

    finally:
        engine.dispose()


def test_interview_center_forward_migration() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0032")

    engine = create_engine(database_url)
    try:
        interview_tables = {
            "job_applications",
            "interview_sessions",
            "interview_assets",
        }
        assert interview_tables.isdisjoint(inspect(engine).get_table_names())

        run_alembic(database_url, "upgrade", "0033")
        assert interview_tables <= set(inspect(engine).get_table_names())
        with engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == "0033"
            )
    finally:
        engine.dispose()


def test_job_description_archiving_removal_forward_migration() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0033")

    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            user_id = connection.execute(
                text(
                    "INSERT INTO users (email, password_hash, nickname) "
                    "VALUES ('jd-archive-migration@example.invalid', '$2b$12$fictional', '张三')"
                )
            ).lastrowid
            kept_job_id = connection.execute(
                text(
                    "INSERT INTO job_descriptions "
                    "(user_id, job_title, company_name, description, skills, source_type) "
                    "VALUES (:user_id, '保留岗位', '示例科技', '保留正文', JSON_ARRAY(), 'manual')"
                ),
                {"user_id": user_id},
            ).lastrowid
            archived_job_id = connection.execute(
                text(
                    "INSERT INTO job_descriptions "
                    "(user_id, job_title, company_name, description, skills, source_type, archived_at) "
                    "VALUES (:user_id, '归档岗位', '示例科技', '归档正文', JSON_ARRAY(), "
                    "'manual', UTC_TIMESTAMP(6))"
                ),
                {"user_id": user_id},
            ).lastrowid
            application_id = connection.execute(
                text(
                    "INSERT INTO job_applications "
                    "(user_id, job_description_id, company_name_snapshot, job_title_snapshot, "
                    "job_snapshot, calendar_color, current_stage_type, current_round_no, "
                    "current_stage_label, stage_state) "
                    "VALUES (:user_id, :job_id, '示例科技', '归档岗位', "
                    "JSON_OBJECT('schema_version', 1, 'description', '归档正文'), "
                    "'blue', 'interview', 1, '一面', 'awaiting_schedule')"
                ),
                {"user_id": user_id, "job_id": archived_job_id},
            ).lastrowid

        run_alembic(database_url, "upgrade", "0034")

        inspector = inspect(engine)
        assert "archived_at" not in {
            column["name"] for column in inspector.get_columns("job_descriptions")
        }
        assert "idx_job_descriptions_user_archive_updated_id" not in {
            index["name"] for index in inspector.get_indexes("job_descriptions")
        }
        with engine.connect() as connection:
            assert (
                connection.scalar(
                    text("SELECT COUNT(*) FROM job_descriptions WHERE id = :id"),
                    {"id": kept_job_id},
                )
                == 1
            )
            assert (
                connection.scalar(
                    text("SELECT COUNT(*) FROM job_descriptions WHERE id = :id"),
                    {"id": archived_job_id},
                )
                == 0
            )
            application = (
                connection.execute(
                    text(
                        "SELECT job_description_id, job_title_snapshot, "
                        "JSON_UNQUOTE(JSON_EXTRACT(job_snapshot, '$.description')) AS description "
                        "FROM job_applications WHERE id = :id"
                    ),
                    {"id": application_id},
                )
                .mappings()
                .one()
            )
            assert application["job_description_id"] is None
            assert application["job_title_snapshot"] == "归档岗位"
            assert application["description"] == "归档正文"
    finally:
        engine.dispose()


def test_document_parse_task_forward_migration_preserves_import_data() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0020")

    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('migration@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        template_id = connection.scalar(
            text("SELECT id FROM resume_templates WHERE `key` = 'blank-cn'")
        )
        resume_id = connection.execute(
            text(
                "INSERT INTO resumes "
                "(user_id, template_id, title, data_json, style_json, source_type) "
                "VALUES (:user_id, :template_id, '迁移简历', "
                "JSON_OBJECT('schema_version', '1.0'), "
                "JSON_OBJECT('schema_version', '1.0'), 'import')"
            ),
            {"user_id": user_id, "template_id": template_id},
        ).lastrowid
        import_id = connection.execute(
            text(
                "INSERT INTO resume_imports "
                "(user_id, result_resume_id, source_filename, source_file_format, "
                "source_object_key, upload_status, upload_duration_ms, "
                "parse_status, parse_duration_ms) VALUES "
                "(:user_id, :resume_id, 'resume.md', 'md', "
                "'users/1/resume-imports/task/resume.md', "
                "'succeeded', 12, 'succeeded', 34)"
            ),
            {"user_id": user_id, "resume_id": resume_id},
        ).lastrowid

    run_alembic(database_url, "upgrade", "0021")
    upgraded = inspect(engine)
    assert "resume_imports" not in upgraded.get_table_names()
    assert "document_parse_tasks" in upgraded.get_table_names()
    with engine.connect() as connection:
        assert connection.execute(
            text(
                "SELECT id, source_type, user_id, file_name, file_format, "
                "object_name, converted_object_name, upload_status, "
                "upload_duration_ms, parse_status, parse_duration_ms "
                "FROM document_parse_tasks WHERE id = :import_id"
            ),
            {"import_id": import_id},
        ).one() == (
            import_id,
            "resume_import",
            user_id,
            "resume.md",
            "md",
            "users/1/resume-imports/task/resume.md",
            None,
            "succeeded",
            12,
            "succeeded",
            34,
        )
        assert (
            connection.scalar(
                text("SELECT parse_task_id FROM resumes WHERE id = :resume_id"),
                {"resume_id": resume_id},
            )
            == import_id
        )

    run_alembic(database_url, "upgrade", "head")
    assert "document_parse_tasks" in inspect(engine).get_table_names()
    reset_test_database_to_base(database_url)
    engine.dispose()


def test_resume_template_seed_conflict_does_not_overwrite_existing_data() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0012")

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_templates "
                "(`key`, name, data_json, style_json, is_active) VALUES "
                "('blank-cn', '现场同名模板', JSON_OBJECT('schema_version', '1.0'), "
                "JSON_OBJECT('schema_version', '1.0'), 1)"
            )
        )
    refused_seed = invoke_alembic(database_url, "upgrade", "0014")
    assert refused_seed.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0013"
        )
        assert (
            connection.scalar(
                text("SELECT name FROM resume_templates WHERE `key` = 'blank-cn'")
            )
            == "现场同名模板"
        )
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM resume_templates WHERE `key` = 'blank-cn'")
        )
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()


def test_classic_template_content_migration_refuses_customized_snapshots() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0024")

    headline_path = "$.basics.headline"
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE resume_templates "
                "SET data_json = JSON_SET(data_json, :path, '现场自定义职位') "
                "WHERE `key` = 'classic-technical-cn'"
            ),
            {"path": headline_path},
        )
    refused_upgrade = invoke_alembic(database_url, "upgrade", "0025")
    assert refused_upgrade.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0024"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, :path)) "
                    "FROM resume_templates WHERE `key` = 'classic-technical-cn'"
                ),
                {"path": headline_path},
            )
            == "现场自定义职位"
        )

    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()


def test_professional_template_seed_conflict_is_atomic() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0025")

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO resume_templates "
                "(`key`, name, data_json, style_json, is_active) VALUES "
                "('administrative-sidebar-cn', '现场行政模板', "
                "JSON_OBJECT('schema_version', '1.0'), "
                "JSON_OBJECT('schema_version', '1.0'), 1)"
            )
        )

    refused_upgrade = invoke_alembic(database_url, "upgrade", "0026")
    assert refused_upgrade.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0025"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT name FROM resume_templates "
                    "WHERE `key` = 'administrative-sidebar-cn'"
                )
            )
            == "现场行政模板"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT COUNT(*) FROM resume_templates WHERE `key` IN "
                    "('campus-professional-cn', 'civic-service-cn', 'creative-orange-cn')"
                )
            )
            == 0
        )

    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()


def test_professional_template_preview_refresh_refuses_customized_snapshots() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "0026")
    content_path = "$.sections.custom_sections[0].items[0].content.content"

    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE resume_templates "
                "SET data_json = JSON_SET(data_json, :path, '现场自定义模板正文') "
                "WHERE `key` = 'campus-professional-cn'"
            ),
            {"path": content_path},
        )

    refused_upgrade = invoke_alembic(database_url, "upgrade", "0027")
    assert refused_upgrade.returncode != 0
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0026"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, :path)) "
                    "FROM resume_templates WHERE `key` = 'campus-professional-cn'"
                ),
                {"path": content_path},
            )
            == "现场自定义模板正文"
        )
        assert "/templates/avatar-administrative.svg" in connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, :path)) "
                "FROM resume_templates WHERE `key` = 'administrative-sidebar-cn'"
            ),
            {"path": content_path},
        )

    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()


def test_mysql_serializes_concurrent_normalized_resume_titles() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine = create_engine(database_url)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('concurrent@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        template_id = connection.scalar(
            text("SELECT id FROM resume_templates WHERE `key` = 'classic-technical-cn'")
        )
    assert template_id is not None

    barrier = Barrier(2)

    def create_with_title(title: str) -> tuple[str, str | None]:
        with session_factory() as db:
            barrier.wait()
            try:
                resume = create_resume_from_template(
                    db=db,
                    user_id=user_id,
                    title=title,
                    template_id=template_id,
                )
            except ResumeTitleConflict:
                return "conflict", None
            return "created", resume.title

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                create_with_title,
                ["  Senior   Product Manager  ", "senior product manager"],
            )
        )

    assert sorted(status for status, _ in results) == ["conflict", "created"]
    created_titles = [title for status, title in results if status == "created"]
    assert len(created_titles) == 1
    assert created_titles[0] is not None
    assert created_titles[0].casefold() == "senior product manager"
    with engine.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT COUNT(*) FROM resumes WHERE user_id = :user_id"),
                {"user_id": user_id},
            )
            == 1
        )
        assert (
            connection.scalar(
                text("SELECT COUNT(*) FROM resume_versions WHERE version_no = 1")
            )
            == 1
        )

    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()


def test_mysql_serializes_agent_session_creation_with_resume_deletion() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine = create_engine(database_url)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('agent-delete-race@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        template_id = connection.scalar(
            text("SELECT id FROM resume_templates WHERE `key` = 'classic-technical-cn'")
        )
    assert template_id is not None
    with session_factory() as db:
        resume = create_resume_from_template(
            db=db,
            user_id=user_id,
            title="张三的并发测试简历",
            template_id=template_id,
        )
        resume_id = resume.id

    delete_has_lock = Event()
    allow_delete_commit = Event()
    create_started = Event()

    def delete_resume_while_holding_lock() -> None:
        with session_factory() as db:
            locked = db.scalar(
                select(Resume)
                .where(Resume.id == resume_id, Resume.user_id == user_id)
                .with_for_update()
            )
            assert locked is not None
            delete_has_lock.set()
            assert allow_delete_commit.wait(timeout=5)
            delete_resume_agent_data(db, resume_id=resume_id, user_id=user_id)
            db.execute(
                delete(ResumeVersion).where(ResumeVersion.resume_id == resume_id)
            )
            db.execute(delete(Resume).where(Resume.id == resume_id))
            db.commit()

    def create_agent_session_during_delete() -> str:
        with session_factory() as db:
            create_started.set()
            try:
                create_session(
                    db,
                    user_id=user_id,
                    resume_id=str(resume_id),
                    title=None,
                )
            except ApiError as error:
                return error.code
            return "created"

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            delete_future = executor.submit(delete_resume_while_holding_lock)
            assert delete_has_lock.wait(timeout=5)
            create_future = executor.submit(create_agent_session_during_delete)
            assert create_started.wait(timeout=5)
            sleep(0.2)
            try:
                assert not create_future.done()
            finally:
                allow_delete_commit.set()
            delete_future.result(timeout=5)
            assert create_future.result(timeout=5) == "RESUME_NOT_FOUND"

        with engine.connect() as connection:
            assert (
                connection.scalar(
                    select(AgentSession.id).where(AgentSession.resume_id == resume_id)
                )
                is None
            )
            assert (
                connection.scalar(select(Resume.id).where(Resume.id == resume_id))
                is None
            )
    finally:
        allow_delete_commit.set()
        reset_test_database_to_base(database_url)
        run_alembic(database_url, "upgrade", "head")
        engine.dispose()


def test_mysql_reject_cannot_overwrite_an_applied_proposal() -> None:
    database_url = migration_test_url()
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine = create_engine(database_url)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    with engine.begin() as connection:
        user_id = connection.execute(
            text(
                "INSERT INTO users (email, password_hash, nickname) "
                "VALUES ('agent-proposal-race@example.invalid', '$2b$12$fictional', '张三')"
            )
        ).lastrowid
        template_id = connection.scalar(
            text("SELECT id FROM resume_templates WHERE `key` = 'classic-technical-cn'")
        )
    assert template_id is not None
    with session_factory() as db:
        resume = create_resume_from_template(
            db=db,
            user_id=user_id,
            title="张三的提案并发测试简历",
            template_id=template_id,
        )
        agent_session = create_session(
            db,
            user_id=user_id,
            resume_id=str(resume.id),
            title=None,
        )
        run = AgentRun(
            public_id=str(uuid4()),
            session_id=agent_session.id,
            idempotency_key=uuid4().hex,
            status="running",
            started_at=utc_now(),
        )
        db.add(run)
        db.commit()
        proposal = create_proposal(
            db,
            run=run,
            session=agent_session,
            call_key="proposal-confirm-reject-race",
            data=resume.data_json,
            style=resume.style_json,
            summary="并发终态测试提案",
            ttl_days=30,
        )
        proposal_public_id = proposal.public_id
        resume_id = resume.id

    reject_started = Event()

    def reject_while_confirmation_holds_lock() -> str:
        with session_factory() as db:
            reject_started.set()
            try:
                result = reject_proposal(
                    db,
                    public_id=proposal_public_id,
                    user_id=user_id,
                )
            except ApiError as error:
                return error.code
            return result.status

    try:
        with session_factory() as confirmation_db:
            locked_proposal = confirmation_db.scalar(
                select(ResumeChangeProposal)
                .where(ResumeChangeProposal.public_id == proposal_public_id)
                .with_for_update()
            )
            locked_resume = confirmation_db.scalar(
                select(Resume).where(Resume.id == resume_id).with_for_update()
            )
            assert locked_proposal is not None and locked_resume is not None
            locked_resume.lock_version += 1
            locked_proposal.status = "applied"
            locked_proposal.applied_lock_version = locked_resume.lock_version
            locked_proposal.applied_at = utc_now()

            with ThreadPoolExecutor(max_workers=1) as executor:
                reject_future = executor.submit(reject_while_confirmation_holds_lock)
                assert reject_started.wait(timeout=5)
                sleep(0.2)
                try:
                    assert not reject_future.done()
                finally:
                    confirmation_db.commit()
                assert reject_future.result(timeout=5) == "AGENT_PROPOSAL_NOT_PENDING"

        with session_factory() as db:
            final_proposal = db.scalar(
                select(ResumeChangeProposal).where(
                    ResumeChangeProposal.public_id == proposal_public_id
                )
            )
            final_resume = db.get(Resume, resume_id)
            assert final_proposal is not None and final_resume is not None
            assert final_proposal.status == "applied"
            assert final_proposal.applied_lock_version == 2
            assert final_resume.lock_version == 2
    finally:
        reset_test_database_to_base(database_url)
        run_alembic(database_url, "upgrade", "head")
        engine.dispose()


def test_job_descriptions_mysql_schema_and_source_uniqueness() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")

    inspector = inspect(engine)
    columns = {
        column["name"]: column for column in inspector.get_columns("job_descriptions")
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
    assert indexes["idx_job_descriptions_user_updated_id"] == [
        "user_id",
        "updated_at",
        "id",
    ]
    foreign_key = {
        item["name"]: item for item in inspector.get_foreign_keys("job_descriptions")
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
        results = list(
            executor.map(lambda _index: insert_concurrent_source(), range(2))
        )

    assert sorted(results) == ["created", "duplicate"]

    assert "job_descriptions" in inspect(engine).get_table_names()
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM job_descriptions"))
        connection.execute(text("DELETE FROM users"))
    reset_test_database_to_base(database_url)
    engine.dispose()


def test_mysql_0008_clears_legacy_llm_data_and_supports_forward_upgrade() -> None:
    database_url = migration_test_url()
    engine = create_engine(database_url)

    reset_test_database_to_base(database_url)
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
            text("SELECT capability, model_config_id FROM llm_capability_bindings")
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
        assert (
            connection.scalar(
                text(
                    "SELECT model_config_id FROM llm_capability_bindings "
                    "WHERE capability = 'chat'"
                )
            )
            == new_model_id
        )
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
        assert (
            connection.scalar(
                text(
                    "SELECT COUNT(*) FROM llm_capability_bindings WHERE capability = 'chat'"
                )
            )
            == 1
        )
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

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM llm_call_logs"))
        connection.execute(text("DELETE FROM llm_model_configs"))
        connection.execute(text("DELETE FROM users"))

    run_alembic(database_url, "upgrade", "head")
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT capability, model_config_id FROM llm_capability_bindings")
        ).one() == ("chat", None)
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()


def test_mysql_migrates_legacy_resume_snapshots_forward() -> None:
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

    reset_test_database_to_base(database_url)
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
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0010"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_UNQUOTE(JSON_EXTRACT(legacy_data_json_backup, "
                    "'$.schema_version')) FROM resumes WHERE id = :resume_id"
                ),
                {"resume_id": resume_id},
            )
            == "1"
        )

    with engine.connect() as connection:
        row = (
            connection.execute(
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
            )
            .mappings()
            .one()
        )
        assert row["current_version"] == "1.0"
        assert row["backup_version"] == "1"
        assert "# 张三" in row["markdown"]
        assert str(row["updated_at"]) == "2026-07-01 00:00:00"
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                    "FROM resume_versions WHERE resume_id = :resume_id"
                ),
                {"resume_id": resume_id},
            )
            == "1.0"
        )

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
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version"))
            == EXPECTED_HEAD
        )
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) "
                    "FROM resumes WHERE id = :resume_id"
                ),
                {"resume_id": resume_id},
            )
            is None
        )
        assert (
            connection.scalar(
                text(
                    "SELECT JSON_LENGTH(JSON_EXTRACT(data_json, '$.semantic_sections')) "
                    "FROM resumes WHERE id = :resume_id"
                ),
                {"resume_id": resume_id},
            )
            >= 1
        )
        assert connection.scalar(
            text(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.manifest.renderer_key')) "
                "FROM resumes WHERE id = :resume_id"
            ),
            {"resume_id": resume_id},
        ) in {"flow", "columns"}

    with engine.begin() as connection:
        connection.execute(text("DELETE FROM resume_versions"))
        connection.execute(text("DELETE FROM resumes"))
        connection.execute(text("DELETE FROM users"))
    reset_test_database_to_base(database_url)
    run_alembic(database_url, "upgrade", "head")
    engine.dispose()
