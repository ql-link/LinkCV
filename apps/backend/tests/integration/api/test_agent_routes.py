import asyncio
import hashlib
import re
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select, update

from linkcv.core.config import Settings
from linkcv.core.database import utc_now
from linkcv.core.errors import ApiError
from linkcv.main import create_app
from linkcv.modules.agent.models import (
    AgentMessage,
    AgentRun,
    AgentSession,
    AgentToolCall,
    ResumeChangeProposal,
)
from linkcv.modules.agent.pi_client import stream_pi_run
from linkcv.modules.agent.service import create_run
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.llm.models import LLMCapabilityBinding, LLMModelConfig
from linkcv.modules.llm.service import LLMError
from linkcv.modules.resumes.models import Resume, ResumeTemplate, ResumeVersion
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import canonical_template_payload


INTERNAL_TOKEN = "internal-agent-token-for-tests-000000000001"


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass

    def delete(self, object_name: str) -> None:
        pass

    def delete_prefix(self, prefix: str) -> None:
        pass


def build_app():
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="agent-routes-test-secret-at-least-32-bytes",
            linkcv_internal_agent_token=INTERNAL_TOKEN,
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    with app.state.session_factory() as db:
        template_data, template_style = canonical_template_payload(key="agent-test")
        template = ResumeTemplate(
            key="agent-test",
            name="Agent 测试模板",
            data_json=template_data,
            style_json=template_style,
            is_active=1,
        )
        db.add(template)
        db.commit()
        app.state.test_template_id = str(template.id)
    return app


def register(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def create_resume(client: TestClient, app) -> dict:
    response = client.post(
        "/api/resumes",
        json={"title": "张三的测试简历", "template_id": app.state.test_template_id},
    )
    assert response.status_code == 201
    return response.json()["resume"]


def bind_pi_agent_model(app) -> None:
    with app.state.session_factory() as db:
        config = LLMModelConfig(
            adapter="deepseek",
            model_call_name="fictional-agent-model",
            model_name="deepseek/fictional-agent-model",
            api_base="https://sensitive.example.invalid/v1",
            encrypted_api_key="v1:fake:not-a-real-secret",
            enabled=True,
            priority=100,
            config_version=2,
        )
        db.add(config)
        db.flush()
        binding = db.get(LLMCapabilityBinding, "pi_agent")
        assert binding is not None
        binding.model_config_id = config.id
        db.commit()


def create_active_run(app, session_public_id: str) -> str:
    with app.state.session_factory() as db:
        session = db.scalar(
            select(AgentSession).where(AgentSession.public_id == session_public_id)
        )
        assert session is not None
        run = AgentRun(
            public_id=str(uuid4()),
            session_id=session.id,
            idempotency_key=uuid4().hex,
            status="running",
            started_at=utc_now(),
        )
        db.add(run)
        db.commit()
        return run.public_id


def internal_headers(token: str = INTERNAL_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def editor_data(base: dict, markdown: str) -> dict:
    data = {**base, "sections": []}
    heading = re.search(r"^## \[\[linkcv-block:(node_[a-z0-9]+)\]\](.+)$", markdown, re.MULTILINE)
    entry = re.search(r"^### \[\[linkcv-block:(node_[a-z0-9]+)\]\](.+)$", markdown, re.MULTILINE)
    bullets = re.findall(r"^- \[\[linkcv-block:(node_[a-z0-9]+)\]\](.+)$", markdown, re.MULTILINE)
    assert heading is not None and entry is not None and bullets

    def value(node_id: str, text: str) -> dict:
        return {"node_id": node_id, "source_refs": [], "value": text}

    def runs(text: str) -> list[dict]:
        return [{
            "inline_type": "text",
            "text": text,
            "marks": [],
            "href": None,
            "style": {"color": None, "font_size_pt": None, "highlight_color": None},
        }]

    data["sections"] = [{
        "node_id": heading.group(1),
        "source_refs": [],
        "semantic_kind": "work",
        "title": value("node_sectiontitle00000001", heading.group(2)),
        "entries": [{
            "node_id": entry.group(1),
            "source_refs": [],
            "fields": {
                "name": None,
                "organization": None,
                "role": value("node_entryrole000000001", entry.group(2)),
                "location": None,
                "start_date": None,
                "end_date": None,
                "url": None,
                "degree": None,
                "major": None,
            },
            "blocks": [{
                "node_id": "node_listblock000000001",
                "block_type": "bullet_list",
                "start": None,
                "items": [
                    {"node_id": node_id, "source_refs": [], "runs": runs(text)}
                    for node_id, text in bullets
                ],
            }],
        }],
        "blocks": [],
    }]
    return data


def test_session_is_owned_and_internal_context_requires_service_token() -> None:
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "agent-owner@example.test")
        resume = create_resume(owner, app)
        created = owner.post(
            "/api/agent/sessions",
            json={"resume_id": resume["id"], "title": "岗位定制"},
        )
        assert created.status_code == 201
        session_id = created.json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        register(stranger, "agent-stranger@example.test")
        hidden = stranger.get(f"/api/agent/sessions/{session_id}")
        assert hidden.status_code == 404
        assert hidden.json() == {"error": "AGENT_SESSION_NOT_FOUND"}

        denied = owner.get(f"/internal/agent/runs/{run_id}/context")
        assert denied.status_code == 401
        assert denied.json() == {"error": "AGENT_SERVICE_UNAUTHORIZED"}

        context = owner.get(
            f"/internal/agent/runs/{run_id}/context",
            headers=internal_headers(),
        )
        assert context.status_code == 200
        assert context.json()["resume_id"] == resume["id"]
        assert context.json()["lock_version"] == 1


def test_context_catalog_is_owner_scoped_and_message_snapshot_binds_first_resume() -> (
    None
):
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "agent-context-owner@example.test")
        owner_resume = create_resume(owner, app)
        register(stranger, "agent-context-stranger@example.test")
        stranger_resume = create_resume(stranger, app)

        catalog = owner.get("/api/agent/contexts?type=resume")
        assert catalog.status_code == 200
        assert [item["id"] for item in catalog.json()["contexts"]] == [
            owner_resume["id"]
        ]
        assert all("data" not in item for item in catalog.json()["contexts"])

        session = owner.post("/api/agent/sessions", json={}).json()["session"]
        sent = owner.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "请分析这份简历",
                "idempotency_key": "context-snapshot-001",
                "contexts": [
                    {
                        "type": "resume",
                        "id": owner_resume["id"],
                        "lock_version": owner_resume["lock_version"],
                        "label": "客户端标签不可信",
                    }
                ],
            },
        )
        assert sent.status_code == 200
        with app.state.session_factory() as db:
            record = db.scalar(
                select(AgentSession).where(AgentSession.public_id == session["id"])
            )
            assert record is not None
            assert str(record.resume_id) == owner_resume["id"]
            message = db.scalar(
                select(AgentMessage).where(AgentMessage.session_id == record.id)
            )
            assert message is not None
            assert message.metadata_json is not None
            assert (
                message.metadata_json["contexts"][0]["label"] == owner_resume["title"]
            )
            assert "data" not in message.metadata_json["contexts"][0]

        hidden = owner.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "读取另一用户资料",
                "idempotency_key": "context-owner-check-001",
                "contexts": [
                    {
                        "type": "resume",
                        "id": stranger_resume["id"],
                        "lock_version": stranger_resume["lock_version"],
                    }
                ],
            },
        )
        assert hidden.status_code == 404
        assert hidden.json() == {"error": "AGENT_CONTEXT_NOT_FOUND"}


def test_stale_context_is_rejected_before_run_or_message_creation() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-context-stale@example.test")
        resume = create_resume(client, app)
        session = client.post("/api/agent/sessions", json={}).json()["session"]
        with app.state.session_factory() as db:
            target_resume = db.scalar(
                select(Resume).where(Resume.id == int(resume["id"]))
            )
            assert target_resume is not None
            target_resume.lock_version = 2
            db.commit()

        stale = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "使用旧资料继续",
                "idempotency_key": "context-stale-001",
                "contexts": [
                    {
                        "type": "resume",
                        "id": resume["id"],
                        "version": "1",
                    }
                ],
            },
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "AGENT_CONTEXT_STALE"}
        with app.state.session_factory() as db:
            assert db.scalar(select(AgentRun.id)) is None
            assert db.scalar(select(AgentMessage.id)) is None


def test_existing_idempotency_replays_before_context_stale_resolution() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-context-replay@example.test")
        resume = create_resume(client, app)
        session = client.post("/api/agent/sessions", json={}).json()["session"]
        payload = {
            "content": "请分析这份简历",
            "idempotency_key": "context-replay-001",
            "contexts": [
                {
                    "type": "resume",
                    "id": resume["id"],
                    "lock_version": resume["lock_version"],
                }
            ],
        }

        first = client.post(
            f"/api/agent/sessions/{session['id']}/messages", json=payload
        )
        assert first.status_code == 200
        with app.state.session_factory() as db:
            target = db.scalar(select(Resume).where(Resume.id == int(resume["id"])))
            assert target is not None
            target.lock_version = 2
            db.commit()

        replay = client.post(
            f"/api/agent/sessions/{session['id']}/messages", json=payload
        )
        assert replay.status_code == 200
        assert '"replayed": true' in replay.text
        with app.state.session_factory() as db:
            assert len(db.scalars(select(AgentRun)).all()) == 1
            assert len(db.scalars(select(AgentMessage)).all()) == 1


def test_context_search_is_applied_before_limit_for_resume_and_job() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-context-search@example.test")
        old_resume = create_resume(client, app)
        newest_resume_response = client.post(
            "/api/resumes",
            json={"title": "最新无关简历", "template_id": app.state.test_template_id},
        )
        assert newest_resume_response.status_code == 201
        newest_resume = newest_resume_response.json()["resume"]
        with app.state.session_factory() as db:
            old_record = db.scalar(
                select(Resume).where(Resume.id == int(old_resume["id"]))
            )
            newest_record = db.scalar(
                select(Resume).where(Resume.id == int(newest_resume["id"]))
            )
            assert old_record is not None and newest_record is not None
            old_record.title = "历史目标简历"
            old_record.updated_at = utc_now() - timedelta(days=1)
            newest_record.updated_at = utc_now()
            db.commit()

        resumes = client.get("/api/agent/contexts?type=resume&q=目标&limit=1")
        assert resumes.status_code == 200
        assert [item["id"] for item in resumes.json()["contexts"]] == [old_resume["id"]]

        def create_job(title: str, company: str) -> dict:
            response = client.post(
                "/api/job-descriptions",
                json={
                    "job_title": title,
                    "company_name": company,
                    "description": f"{company} 的岗位描述",
                    "skills": ["Python"],
                    "source_type": "manual",
                },
            )
            assert response.status_code == 201
            return response.json()["job_description"]

        old_job = create_job("历史目标岗位", "旧公司")
        newest_job = create_job("最新无关岗位", "新公司")
        with app.state.session_factory() as db:
            old_job_record = db.scalar(
                select(JobDescription).where(JobDescription.id == int(old_job["id"]))
            )
            newest_job_record = db.scalar(
                select(JobDescription).where(JobDescription.id == int(newest_job["id"]))
            )
            assert old_job_record is not None and newest_job_record is not None
            old_job_record.updated_at = utc_now() - timedelta(days=1)
            newest_job_record.updated_at = utc_now()
            db.commit()

        jobs = client.get("/api/agent/contexts?type=job&q=目标&limit=1")
        assert jobs.status_code == 200
        assert [item["id"] for item in jobs.json()["contexts"]] == [old_job["id"]]


def test_proposal_is_idempotent_and_confirmed_once() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-proposal@example.test")
        resume = create_resume(client, app)
        session_id = client.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        ).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposed_data = resume["data"]
        proposed_data["identity"]["headline"] = {
            "node_id": "node_headline00000001",
            "source_refs": [],
            "value": "由智能助手生成的虚构标题",
        }
        payload = {
            "call_key": "proposal-call-1",
            "data": proposed_data,
            "style": resume["style"],
            "summary": "调整简历标题表达",
        }

        first = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json=payload,
        )
        repeated = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json=payload,
        )
        assert first.status_code == repeated.status_code == 201
        proposal_id = first.json()["proposal"]["id"]
        assert repeated.json()["proposal"]["id"] == proposal_id

        confirmed = client.post(f"/api/agent/proposals/{proposal_id}/confirm")
        confirmed_again = client.post(f"/api/agent/proposals/{proposal_id}/confirm")
        assert confirmed.status_code == confirmed_again.status_code == 200
        assert confirmed.json()["resume"]["lock_version"] == 2
        assert confirmed_again.json()["resume"]["lock_version"] == 2
        assert (
            confirmed.json()["resume"]["data"]["identity"]["headline"]["value"]
            == "由智能助手生成的虚构标题"
        )
        with app.state.session_factory() as db:
            version = db.scalar(
                select(ResumeVersion).where(
                    ResumeVersion.resume_id == int(resume["id"]),
                    ResumeVersion.reason == "agent",
                )
            )
            assert version is not None
            assert version.name == "智能助手修改"


def test_scoped_edit_requires_resolved_target_and_diagnosis_before_confirmation() -> (
    None
):
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-scoped@example.test")
        resume = create_resume(client, app)
        markdown = "\n\n".join(
            [
                "## [[linkcv-block:node_section000000001]]工作经历",
                "### [[linkcv-block:node_entry00000000001]]示例公司 · 后端工程师",
                "- [[linkcv-block:node_bullet0000000001]]负责平台性能优化",
                "- [[linkcv-block:node_bullet0000000002]]负责平台性能优化",
            ]
        )
        saved = client.put(
            f"/api/resumes/{resume['id']}",
            json={
                "data": editor_data(resume["data"], markdown),
                "base_lock_version": 1,
            },
        )
        assert saved.status_code == 200
        session_id = client.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        ).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        ambiguous = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"quoted_text": "负责平台性能优化"},
        )
        assert ambiguous.status_code == 200
        assert ambiguous.json()["status"] == "ambiguous"
        assert len(ambiguous.json()["candidates"]) == 2

        entry_selection = "示例公司 · 后端工程师\n负责平台性能优化\n负责平台性能优化"
        entry_resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={
                "selection_context": {
                    "block_ids": [
                        "node_entry00000000001",
                        "node_bullet0000000001",
                        "node_bullet0000000002",
                    ],
                    "from": 2,
                    "to": 30,
                    "selected_text": entry_selection,
                    "selected_text_hash": "sha256:"
                    + hashlib.sha256(entry_selection.encode()).hexdigest(),
                }
            },
        )
        assert entry_resolved.status_code == 200
        assert entry_resolved.json()["status"] == "resolved"
        assert entry_resolved.json()["target"]["block_id"] == "node_entry00000000001"

        selected_text = "负责平台性能优化"
        resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={
                "selection_context": {
                    "block_ids": ["node_bullet0000000002"],
                    "from": 10,
                    "to": 18,
                    "selected_text": selected_text,
                    "selected_text_hash": "sha256:"
                    + hashlib.sha256(selected_text.encode()).hexdigest(),
                }
            },
        )
        assert resolved.status_code == 200
        target = resolved.json()["target"]
        assert resolved.json()["status"] == "resolved"
        assert target["block_id"] == "node_bullet0000000002"
        context = client.post(
            f"/internal/agent/runs/{run_id}/context:read",
            headers=internal_headers(),
            json={"target": target, "scope": "entry"},
        )
        assert context.status_code == 200
        assert [item["target"]["block_id"] for item in context.json()["blocks"]] == [
            "node_entry00000000001",
            "node_bullet0000000001",
            "node_bullet0000000002",
        ]
        diagnosed = client.post(
            f"/internal/agent/runs/{run_id}/diagnoses",
            headers=internal_headers(),
            json={"target": target, "scope": "target"},
        )
        assert diagnosed.status_code == 200
        assert (
            diagnosed.json()["diagnosis"]["quantification"]["has_result_metric"]
            is False
        )

        proposal_payload = {
            "call_key": "scoped-proposal-1",
            "mode": "polish_local",
            "target": target,
            "diagnosis": diagnosed.json()["diagnosis"],
            "diagnosis_fingerprint": diagnosed.json()["diagnosis_fingerprint"],
            "operations": [
                {
                    "op": "replace_target_text",
                    "target": target,
                    "new_text": "优化平台性能，具体结果待补充",
                    "expected_text_hash": target["expected_text_hash"],
                }
            ],
            "rationale": [
                {
                    "code": "MISSING_RESULT_EVIDENCE",
                    "reason": "保留事实边界并提示补充结果",
                }
            ],
            "source_ids": [],
            "summary": "优化行动表达，未虚构量化结果",
        }
        tampered = client.post(
            f"/internal/agent/runs/{run_id}/proposals:v2",
            headers=internal_headers(),
            json={
                **proposal_payload,
                "call_key": "tampered-diagnosis",
                "diagnosis": {**proposal_payload["diagnosis"], "scope": "resume"},
            },
        )
        assert tampered.status_code == 422
        assert tampered.json() == {"error": "DIAGNOSIS_REQUIRED"}

        wrong_target = {
            **target,
            "block_id": "node_bullet0000000001",
        }
        out_of_scope = client.post(
            f"/internal/agent/runs/{run_id}/proposals:v2",
            headers=internal_headers(),
            json={
                **proposal_payload,
                "call_key": "out-of-scope-target",
                "operations": [
                    {
                        **proposal_payload["operations"][0],
                        "target": wrong_target,
                    }
                ],
            },
        )
        assert out_of_scope.status_code == 422
        assert out_of_scope.json() == {"error": "PATCH_OUT_OF_SCOPE"}

        proposed = client.post(
            f"/internal/agent/runs/{run_id}/proposals:v2",
            headers=internal_headers(),
            json=proposal_payload,
        )
        assert proposed.status_code == 201
        proposal = proposed.json()["proposal"]
        assert proposal["proposal_mode"] == "polish_local"
        assert proposal["rationale"][0]["code"] == "MISSING_RESULT_EVIDENCE"
        assert proposal["operations"][0]["target"]["selected_text"] == selected_text
        confirmed = client.post(f"/api/agent/proposals/{proposal['id']}/confirm")
        assert confirmed.status_code == 200
        content = "\n".join(
            run["text"]
            for section in confirmed.json()["resume"]["data"]["sections"]
            for entry in section["entries"]
            for block in entry["blocks"]
            for item in block.get("items", [])
            for run in item["runs"]
            if run["inline_type"] == "text"
        )
        assert "优化平台性能，具体结果待补充" in content
        assert content.count("负责平台性能优化") == 1
        first_item = confirmed.json()["resume"]["data"]["sections"][0]["entries"][0]["blocks"][0]["items"][0]
        assert first_item["node_id"] == "node_bullet0000000001"


def test_whole_block_proposal_materializes_before_text_and_confirms() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-whole-block-proposal@example.test")
        resume = create_resume(client, app)
        markdown = "\n\n".join(
            [
                "## [[linkcv-block:node_section000000001]]工作经历",
                "### [[linkcv-block:node_entry00000000001]]示例公司 · 后端工程师",
                "- [[linkcv-block:node_bullet0000000001]]负责平台性能优化",
            ]
        )
        saved = client.put(
            f"/api/resumes/{resume['id']}",
            json={
                "data": editor_data(resume["data"], markdown),
                "base_lock_version": 1,
            },
        )
        assert saved.status_code == 200
        session_id = client.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        ).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        selected_entry = "示例公司 · 后端工程师\n负责平台性能优化"
        resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={
                "selection_context": {
                    "block_ids": [
                        "node_entry00000000001",
                        "node_bullet0000000001",
                    ],
                    "from": 1,
                    "to": 24,
                    "selected_text": selected_entry,
                    "selected_text_hash": "sha256:"
                    + hashlib.sha256(selected_entry.encode()).hexdigest(),
                }
            },
        )
        assert resolved.status_code == 200
        target = resolved.json()["target"]
        assert target["selected_text"] is None
        diagnosed = client.post(
            f"/internal/agent/runs/{run_id}/diagnoses",
            headers=internal_headers(),
            json={"target": target, "scope": "target"},
        )
        assert diagnosed.status_code == 200

        proposed = client.post(
            f"/internal/agent/runs/{run_id}/proposals:v2",
            headers=internal_headers(),
            json={
                "call_key": "whole-block-proposal-1",
                "mode": "polish_local",
                "target": target,
                "diagnosis": diagnosed.json()["diagnosis"],
                "diagnosis_fingerprint": diagnosed.json()["diagnosis_fingerprint"],
                "operations": [
                    {
                        "op": "replace_target_text",
                        "target": target,
                        "new_text": "示例公司 · 高级后端工程师",
                        "expected_text_hash": target["expected_text_hash"],
                    }
                ],
                "rationale": [],
                "source_ids": [],
                "summary": "更新岗位标题",
            },
        )
        assert proposed.status_code == 201
        proposal = proposed.json()["proposal"]
        assert (
            proposal["operations"][0]["target"]["selected_text"]
            == "示例公司 · 后端工程师"
        )

        confirmed = client.post(f"/api/agent/proposals/{proposal['id']}/confirm")
        assert confirmed.status_code == 200
        role = confirmed.json()["resume"]["data"]["sections"][0]["entries"][0]["fields"]["role"]
        assert role["value"] == "示例公司 · 高级后端工程师"


def test_proposal_confirmation_never_overwrites_concurrent_resume_edit() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-conflict@example.test")
        resume = create_resume(client, app)
        session_id = client.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        ).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposal = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "proposal-conflict",
                "data": resume["data"],
                "style": resume["style"],
                "summary": "不会覆盖并发编辑",
            },
        )
        assert proposal.status_code == 201

        edited_data = resume["data"]
        edited_data["identity"]["headline"] = {
            "node_id": "node_headline00000001",
            "source_refs": [],
            "value": "用户刚刚手动修改",
        }
        edited = client.put(
            f"/api/resumes/{resume['id']}",
            json={"data": edited_data, "base_lock_version": 1},
        )
        assert edited.status_code == 200

        conflict = client.post(
            f"/api/agent/proposals/{proposal.json()['proposal']['id']}/confirm"
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_EDIT_CONFLICT"}
        current = client.get(f"/api/resumes/{resume['id']}").json()["resume"]
        assert current["lock_version"] == 2
        assert current["data"]["identity"]["headline"]["value"] == "用户刚刚手动修改"


def test_proposal_confirmation_respects_resume_version_limit() -> None:
    app = build_app()
    app.state.settings.resume_version_limit = 2
    with TestClient(app) as client:
        register(client, "agent-version-limit@example.test")
        resume = create_resume(client, app)
        manual = client.post(
            f"/api/resumes/{resume['id']}/versions",
            json={"name": "人工保留版本"},
        )
        assert manual.status_code == 201
        session_id = client.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        ).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposed_data = resume["data"]
        proposed_data["identity"]["headline"] = {
            "node_id": "node_headline00000001",
            "source_refs": [],
            "value": "不应应用的智能助手标题",
        }
        proposal = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "proposal-version-limit",
                "data": proposed_data,
                "style": resume["style"],
                "summary": "版本空间已满时不得应用",
            },
        )

        result = client.post(
            f"/api/agent/proposals/{proposal.json()['proposal']['id']}/confirm"
        )

        assert result.status_code == 409
        assert result.json() == {"error": "RESUME_VERSION_LIMIT_REACHED"}
        current = client.get(f"/api/resumes/{resume['id']}").json()["resume"]
        assert current["lock_version"] == 1
        assert current["data"]["identity"]["headline"] is None


def test_run_concurrency_is_limited_across_user_sessions() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-concurrency@example.test")
        first_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        second_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]

        with app.state.session_factory() as db:
            first = db.scalar(
                select(AgentSession).where(AgentSession.public_id == first_id)
            )
            second = db.scalar(
                select(AgentSession).where(AgentSession.public_id == second_id)
            )
            assert first is not None and second is not None
            idempotency_key = uuid4().hex
            first_run, created = create_run(
                db,
                session=first,
                content="第一条消息",
                idempotency_key=idempotency_key,
                timeout_seconds=300,
            )
            replayed, replay_created = create_run(
                db,
                session=first,
                content="第一条消息",
                idempotency_key=idempotency_key,
                timeout_seconds=300,
            )
            assert created is True
            assert replay_created is False
            assert replayed.id == first_run.id
            with pytest.raises(ApiError) as caught:
                create_run(
                    db,
                    session=second,
                    content="不应并行执行",
                    idempotency_key=uuid4().hex,
                    timeout_seconds=300,
                )
            assert caught.value.code == "AGENT_RUN_IN_PROGRESS"


def test_stale_run_is_failed_before_starting_a_replacement() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-stale-run@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]

        with app.state.session_factory() as db:
            session = db.scalar(
                select(AgentSession).where(AgentSession.public_id == session_id)
            )
            assert session is not None
            stale = AgentRun(
                public_id=str(uuid4()),
                session_id=session.id,
                idempotency_key=uuid4().hex,
                status="running",
                started_at=utc_now() - timedelta(seconds=301),
            )
            db.add(stale)
            db.commit()
            replacement, created = create_run(
                db,
                session=session,
                content="重新开始",
                idempotency_key=uuid4().hex,
                timeout_seconds=300,
            )
            db.refresh(stale)
            assert created is True
            assert replacement.status == "running"
            assert stale.status == "failed"
            assert stale.error_code == "AGENT_TIMEOUT"


def test_deleting_resume_explicitly_cleans_agent_rows_without_foreign_keys() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-delete@example.test")
        resume = create_resume(client, app)
        session_id = client.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        ).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposal = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "delete-cleanup-proposal",
                "data": resume["data"],
                "style": resume["style"],
                "summary": "删除简历时一并清理",
            },
        )
        assert proposal.status_code == 201
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            assert run is not None
            db.add(
                AgentToolCall(
                    run_id=run.id,
                    call_key="delete-cleanup-tool",
                    tool_name="get_resume_context",
                    status="succeeded",
                )
            )
            db.add(
                AgentMessage(
                    session_id=run.session_id,
                    run_id=run.id,
                    sequence_no=1,
                    role="user",
                    content="删除清理测试消息",
                )
            )
            db.commit()

        assert client.delete(f"/api/resumes/{resume['id']}").json() == {"deleted": True}
        with app.state.session_factory() as db:
            assert db.scalar(select(AgentSession.id)) is None
            assert db.scalar(select(AgentRun.id)) is None
            assert db.scalar(select(AgentMessage.id)) is None
            assert db.scalar(select(AgentToolCall.id)) is None
            assert db.scalar(select(ResumeChangeProposal.id)) is None


def test_cancel_does_not_overwrite_a_run_that_completed_while_waiting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-cancel-race@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        async def complete_during_cancel(_app, public_id: str) -> None:
            with app.state.session_factory() as other_db:
                other_db.execute(
                    update(AgentRun)
                    .where(AgentRun.public_id == public_id)
                    .values(status="succeeded", completed_at=utc_now())
                )
                other_db.commit()

        monkeypatch.setattr(
            "linkcv.modules.agent.routes.cancel_pi_run", complete_during_cancel
        )

        response = client.post(f"/api/agent/runs/{run_id}/cancel")

        assert response.status_code == 200
        assert response.json() == {"run_id": run_id, "status": "succeeded"}
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            assert run is not None
            assert run.status == "succeeded"


def test_pi_stream_emits_failure_when_upstream_ends_without_terminal_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    app.state.settings.agent_enabled = True
    app.state.settings.pi_service_token = SecretStr(
        "pi-service-token-for-tests-00000000000001"
    )
    with TestClient(app) as client:
        register(client, "agent-incomplete-stream@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        class FakeStreamResponse:
            status_code = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def aiter_lines(self):
                for line in (
                    "event: assistant.delta",
                    'data: {"delta": "半条回复"}',
                    "",
                ):
                    yield line

        class FakeHttpClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            def stream(self, *_args, **_kwargs):
                return FakeStreamResponse()

        monkeypatch.setattr(
            "linkcv.modules.agent.pi_client.httpx.AsyncClient",
            lambda **_kwargs: FakeHttpClient(),
        )

        async def collect_events() -> list[bytes]:
            return [item async for item in stream_pi_run(app, run_id, "请优化简历")]

        events = b"".join(asyncio.run(collect_events())).decode()

        assert "event: assistant.delta" in events
        assert "event: run.failed" in events
        assert "AGENT_UPSTREAM_FAILED" in events
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            assert run is not None
            assert run.status == "failed"
            assert run.error_code == "AGENT_UPSTREAM_FAILED"
            assistant = db.scalar(
                select(AgentMessage).where(
                    AgentMessage.run_id == run.id,
                    AgentMessage.role == "assistant",
                )
            )
            assert assistant is None


def test_pi_stream_persists_successful_usage_and_assistant_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    app.state.settings.agent_enabled = True
    app.state.settings.pi_service_token = SecretStr(
        "pi-service-token-for-tests-00000000000001"
    )
    with TestClient(app) as client:
        register(client, "agent-usage@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        class FakeStreamResponse:
            status_code = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def aiter_lines(self):
                for line in (
                    "event: assistant.delta",
                    'data: {"delta": "完整回复"}',
                    "",
                    "event: run.completed",
                    'data: {"runId": "ignored", "usage": {"inputTokens": 120, "outputTokens": 30, "estimatedCost": "0.00123457"}}',
                    "",
                ):
                    yield line

        class FakeHttpClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            def stream(self, *_args, **_kwargs):
                return FakeStreamResponse()

        monkeypatch.setattr(
            "linkcv.modules.agent.pi_client.httpx.AsyncClient",
            lambda **_kwargs: FakeHttpClient(),
        )

        async def collect_events() -> list[bytes]:
            return [item async for item in stream_pi_run(app, run_id, "请优化简历")]

        events = b"".join(asyncio.run(collect_events())).decode()
        assert "event: run.completed" in events
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            assert run is not None
            assert run.status == "succeeded"
            assert run.input_tokens == 120
            assert run.output_tokens == 30
            assert str(run.estimated_cost) == "0.00123457"
            assistant = db.scalar(
                select(AgentMessage).where(
                    AgentMessage.run_id == run.id,
                    AgentMessage.role == "assistant",
                )
            )
            assert assistant is not None
            assert assistant.content == "完整回复"


def test_new_session_uses_first_message_title_and_rejects_stale_clarification_reply() -> (
    None
):
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-clarification-reply@example.test")
        resume = create_resume(client, app)
        session = client.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        ).json()["session"]
        assert session["title"] == "新对话"

        first = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "优化这段项目经历的表达并突出技术影响",
                "idempotency_key": "first_message_001",
            },
        )
        assert first.status_code == 200
        detail = client.get(f"/api/agent/sessions/{session['id']}").json()["session"]
        assert detail["title"] == "优化这段项目经历的表达并突出技术影响"

        with app.state.session_factory() as db:
            record = db.scalar(
                select(AgentSession).where(AgentSession.public_id == session["id"])
            )
            assert record is not None
            latest_sequence = max(item["sequence_no"] for item in detail["messages"])
            db.add(
                AgentMessage(
                    session_id=record.id,
                    sequence_no=latest_sequence + 1,
                    role="assistant",
                    message_type="clarification",
                    content="请选择修改范围",
                    metadata_json={
                        "version": 1,
                        "questions": [
                            {
                                "id": "scope",
                                "header": "修改范围",
                                "question": "要修改哪段经历？",
                                "options": [
                                    {"id": "internship", "label": "实习经历"},
                                    {"id": "project", "label": "项目经历"},
                                ],
                            }
                        ],
                    },
                )
            )
            db.commit()

        stale = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "实习经历",
                "idempotency_key": "stale_reply_001",
                "reply_to_sequence_no": latest_sequence,
            },
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "AGENT_CLARIFICATION_STALE"}


def test_pi_stream_persists_structured_clarification_only_after_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    app.state.settings.agent_enabled = True
    app.state.settings.pi_service_token = SecretStr(
        "pi-service-token-for-tests-00000000000001"
    )
    with TestClient(app) as client:
        register(client, "agent-structured-question@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        clarification = {
            "version": 1,
            "questions": [
                {
                    "id": "role",
                    "header": "目标岗位",
                    "question": "你的目标岗位是什么？",
                    "options": [
                        {"id": "backend", "label": "后端开发"},
                        {"id": "product", "label": "产品经理"},
                    ],
                }
            ],
        }

        class FakeStreamResponse:
            status_code = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def aiter_lines(self):
                frames = (
                    (
                        "clarification.requested",
                        {"runId": run_id, "clarification": clarification},
                    ),
                    ("assistant.delta", {"runId": run_id, "delta": "请选择目标岗位"}),
                    ("run.completed", {"runId": run_id}),
                )
                for event, payload in frames:
                    yield f"event: {event}"
                    import json

                    yield "data: " + json.dumps(payload, ensure_ascii=False)
                    yield ""

        class FakeHttpClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            def stream(self, *_args, **_kwargs):
                return FakeStreamResponse()

        monkeypatch.setattr(
            "linkcv.modules.agent.pi_client.httpx.AsyncClient",
            lambda **_kwargs: FakeHttpClient(),
        )

        events = b"".join(
            asyncio.run(_collect_stream_events(app, run_id, "请优化简历"))
        ).decode()
        assert "event: clarification.requested" in events
        with app.state.session_factory() as db:
            message = db.scalar(
                select(AgentMessage).where(
                    AgentMessage.run_id
                    == db.scalar(
                        select(AgentRun.id).where(AgentRun.public_id == run_id)
                    ),
                    AgentMessage.role == "assistant",
                )
            )
            assert message is not None
            assert message.message_type == "clarification"
            assert message.metadata_json == clarification


async def _collect_stream_events(app, run_id: str, content: str) -> list[bytes]:
    return [item async for item in stream_pi_run(app, run_id, content)]


def test_tool_event_terminal_state_is_idempotent_and_cannot_regress() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-tool-terminal@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        path = f"/internal/agent/runs/{run_id}/tool-events"
        running = {
            "call_key": "context-call-1",
            "tool_name": "get_resume_context",
            "status": "running",
        }
        succeeded = {**running, "status": "succeeded", "duration_ms": 17}

        assert (
            client.post(path, headers=internal_headers(), json=running).status_code
            == 204
        )
        assert (
            client.post(path, headers=internal_headers(), json=succeeded).status_code
            == 204
        )
        repeated = client.post(path, headers=internal_headers(), json=succeeded)
        regressed = client.post(path, headers=internal_headers(), json=running)

        assert repeated.status_code == 204
        assert regressed.status_code == 409
        assert regressed.json() == {"error": "AGENT_TOOL_CALL_TERMINAL"}
        with app.state.session_factory() as db:
            record = db.scalar(
                select(AgentToolCall).where(AgentToolCall.call_key == "context-call-1")
            )
            assert record is not None
            assert record.status == "succeeded"
            assert record.duration_ms == 17


def test_agent_readiness_checks_model_config_and_full_service_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    app.state.llm_service.agent_runtime_model = AsyncMock(
        return_value=SimpleNamespace(adapter="openai")
    )
    check_chain = AsyncMock()
    monkeypatch.setattr("linkcv.modules.agent.routes.check_pi_readiness", check_chain)
    with TestClient(app) as client:
        internal = client.get("/internal/agent/readiness", headers=internal_headers())
        public = client.get("/api/agent/readiness")

    assert internal.status_code == 200
    assert internal.json() == {"ready": True}
    assert public.status_code == 200
    assert public.json() == {"ready": True}
    check_chain.assert_awaited_once_with(app)


def test_agent_model_requires_login_and_returns_only_safe_bound_summary() -> None:
    app = build_app()
    bind_pi_agent_model(app)
    with TestClient(app) as client:
        denied = client.get("/api/agent/model")
        assert denied.status_code == 401
        assert denied.json() == {"error": "UNAUTHORIZED"}

        register(client, "agent-model-summary@example.test")
        response = client.get("/api/agent/model")

    assert response.status_code == 200
    assert response.json() == {
        "model": {"adapter": "deepseek", "name": "fictional-agent-model"}
    }
    assert "sensitive.example.invalid" not in response.text
    assert "not-a-real-secret" not in response.text


def test_agent_model_returns_stable_error_when_pi_binding_is_missing() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-model-unconfigured@example.test")
        response = client.get("/api/agent/model")

    assert response.status_code == 503
    assert response.json() == {"error": "LLM_MODEL_NOT_CONFIGURED"}


def test_agent_model_does_not_expose_llm_call_id_on_service_error() -> None:
    app = build_app()
    app.state.llm_service.agent_model_summary = AsyncMock(
        side_effect=LLMError("LLM_MODEL_NOT_CONFIGURED", "sensitive-call-id")
    )
    with TestClient(app) as client:
        register(client, "agent-model-error@example.test")
        response = client.get("/api/agent/model")

    assert response.status_code == 503
    assert response.json() == {"error": "LLM_MODEL_NOT_CONFIGURED"}
    assert "sensitive-call-id" not in response.text


def test_agent_session_can_be_renamed_and_pinned_and_list_is_pin_first() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-session-management@example.test")
        older = client.post("/api/agent/sessions", json={"title": "旧会话"}).json()[
            "session"
        ]
        newer = client.post("/api/agent/sessions", json={"title": "新会话"}).json()[
            "session"
        ]

        renamed = client.patch(
            f"/api/agent/sessions/{older['id']}",
            json={"title": "  重命名后的会话  "},
        )
        assert renamed.status_code == 200
        assert renamed.json()["session"]["title"] == "重命名后的会话"
        assert renamed.json()["session"]["pinned"] is False

        pinned = client.patch(
            f"/api/agent/sessions/{older['id']}", json={"pinned": True}
        )
        assert pinned.status_code == 200
        assert pinned.json()["session"]["pinned"] is True
        assert pinned.json()["session"]["title"] == "重命名后的会话"

        with app.state.session_factory() as db:
            old_record = db.scalar(
                select(AgentSession).where(AgentSession.public_id == older["id"])
            )
            new_record = db.scalar(
                select(AgentSession).where(AgentSession.public_id == newer["id"])
            )
            assert old_record is not None and new_record is not None
            old_record.updated_at = utc_now() - timedelta(days=1)
            new_record.updated_at = utc_now()
            db.commit()

        listed = client.get("/api/agent/sessions")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["sessions"]] == [
            older["id"],
            newer["id"],
        ]
        assert all("pinned" in item for item in listed.json()["sessions"])


def test_agent_session_update_requires_a_non_null_supported_field() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-session-validation@example.test")
        session = client.post("/api/agent/sessions", json={}).json()["session"]

        empty = client.patch(f"/api/agent/sessions/{session['id']}", json={})
        blank_title = client.patch(
            f"/api/agent/sessions/{session['id']}", json={"title": "   "}
        )
        null_pin = client.patch(
            f"/api/agent/sessions/{session['id']}", json={"pinned": None}
        )

    assert empty.status_code == 422
    assert blank_title.status_code == 422
    assert null_pin.status_code == 422


def test_agent_session_management_is_owner_scoped() -> None:
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "agent-session-owner@example.test")
        session = owner.post("/api/agent/sessions", json={}).json()["session"]
        register(stranger, "agent-session-stranger@example.test")

        renamed = stranger.patch(
            f"/api/agent/sessions/{session['id']}", json={"title": "不应成功"}
        )
        deleted = stranger.delete(f"/api/agent/sessions/{session['id']}")

    assert renamed.status_code == 404
    assert renamed.json() == {"error": "AGENT_SESSION_NOT_FOUND"}
    assert deleted.status_code == 404
    assert deleted.json() == {"error": "AGENT_SESSION_NOT_FOUND"}
    with app.state.session_factory() as db:
        record = db.scalar(
            select(AgentSession).where(AgentSession.public_id == session["id"])
        )
        assert record is not None
        assert record.title == "新对话"


def test_agent_session_delete_rejects_running_run_without_mutation() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-session-delete-running@example.test")
        session = client.post("/api/agent/sessions", json={}).json()["session"]
        run_id = create_active_run(app, session["id"])

        response = client.delete(f"/api/agent/sessions/{session['id']}")

    assert response.status_code == 409
    assert response.json() == {"error": "AGENT_RUN_IN_PROGRESS"}
    with app.state.session_factory() as db:
        assert (
            db.scalar(
                select(AgentSession).where(AgentSession.public_id == session["id"])
            )
            is not None
        )
        run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
        assert run is not None
        assert run.status == "running"


def test_agent_session_delete_cleans_only_target_dependencies_in_order() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-session-delete-cleanup@example.test")
        target_resume = create_resume(client, app)
        target = client.post(
            "/api/agent/sessions", json={"resume_id": target_resume["id"]}
        ).json()["session"]
        other = client.post("/api/agent/sessions", json={}).json()["session"]
        target_run_id = create_active_run(app, target["id"])
        other_run_id = create_active_run(app, other["id"])

        proposal = client.post(
            f"/internal/agent/runs/{target_run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "session-delete-proposal",
                "data": target_resume["data"],
                "style": target_resume["style"],
                "summary": "会话删除测试提案",
            },
        )
        assert proposal.status_code == 201

        with app.state.session_factory() as db:
            target_run = db.scalar(
                select(AgentRun).where(AgentRun.public_id == target_run_id)
            )
            other_run = db.scalar(
                select(AgentRun).where(AgentRun.public_id == other_run_id)
            )
            assert target_run is not None and other_run is not None
            target_run.status = "succeeded"
            other_run.status = "succeeded"
            db.add(
                AgentToolCall(
                    run_id=target_run.id,
                    call_key="session-delete-tool",
                    tool_name="get_resume_context",
                    status="succeeded",
                )
            )
            db.add(
                AgentMessage(
                    session_id=target_run.session_id,
                    run_id=target_run.id,
                    sequence_no=1,
                    role="user",
                    content="会话删除测试消息",
                )
            )
            db.add(
                AgentMessage(
                    session_id=other_run.session_id,
                    run_id=other_run.id,
                    sequence_no=1,
                    role="user",
                    content="其他会话保留消息",
                )
            )
            db.commit()

        response = client.delete(f"/api/agent/sessions/{target['id']}")
        assert response.status_code == 204
        assert response.content == b""

    with app.state.session_factory() as db:
        assert (
            db.scalar(
                select(AgentSession).where(AgentSession.public_id == target["id"])
            )
            is None
        )
        assert (
            db.scalar(select(AgentRun).where(AgentRun.public_id == target_run_id))
            is None
        )
        assert (
            db.scalar(
                select(ResumeChangeProposal).where(
                    ResumeChangeProposal.public_id == proposal.json()["proposal"]["id"]
                )
            )
            is None
        )
        assert (
            db.scalar(
                select(AgentToolCall).where(
                    AgentToolCall.call_key == "session-delete-tool"
                )
            )
            is None
        )
        assert (
            db.scalar(
                select(AgentMessage).where(AgentMessage.content == "会话删除测试消息")
            )
            is None
        )
        assert (
            db.scalar(select(AgentSession).where(AgentSession.public_id == other["id"]))
            is not None
        )
        assert (
            db.scalar(select(AgentRun).where(AgentRun.public_id == other_run_id))
            is not None
        )
        assert (
            db.scalar(
                select(AgentMessage).where(AgentMessage.content == "其他会话保留消息")
            )
            is not None
        )
