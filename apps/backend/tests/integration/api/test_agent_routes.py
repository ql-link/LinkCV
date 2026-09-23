import asyncio
from copy import deepcopy
import hashlib
import re
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select, update

from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.main import create_app
from linkresume.modules.agent import routes as agent_routes
from linkresume.modules.agent.models import (
    AgentMessage,
    AgentRun,
    AgentSession,
    AgentToolCall,
    ResumeChangeProposal,
)
from linkresume.modules.agent.pi_client import (
    _current_clarification_answers,
    stream_pi_run,
)
from linkresume.modules.agent.service import create_run
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.identity.models import User
from linkresume.modules.job_descriptions.models import JobDescription
from linkresume.modules.llm.models import LLMCapabilityBinding, LLMModelConfig
from linkresume.modules.llm.service import LLMError
from linkresume.modules.resumes.models import (
    DATASET_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeTemplate,
    ResumeVersion,
)
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import (
    canonical_resume_payload,
    canonical_template_payload,
)


INTERNAL_TOKEN = "internal-agent-token-for-tests-000000000001"


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def ensure_bucket(self) -> None:
        pass

    def get(self, object_name: str) -> bytes:
        return self.objects[object_name]

    def stat(self, object_name: str) -> SimpleNamespace:
        return SimpleNamespace(size=len(self.objects[object_name]))

    def delete(self, object_name: str) -> None:
        self.objects.pop(object_name, None)

    def copy(self, source_name: str, target_name: str) -> None:
        self.objects[target_name] = self.objects[source_name]

    def delete_prefix(self, prefix: str) -> None:
        pass


class CapturingEmitter:
    def __init__(self) -> None:
        self.system_events: list[dict[str, object]] = []

    def system(self, level: str, message: str, **fields: object) -> bool:
        self.system_events.append({"level": level, "message": message, **fields})
        return True

    def audit(self, **fields: object) -> tuple[bool, str]:
        return True, uuid4().hex


def build_app(*, event_emitter=None):
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="agent-routes-test-secret-at-least-32-bytes",
            linkresume_internal_agent_token=INTERNAL_TOKEN,
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        event_emitter=event_emitter,
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


def create_resume(client: TestClient, app, title: str = "张三的测试简历") -> dict:
    response = client.post(
        "/api/resumes",
        json={"title": title, "template_id": app.state.test_template_id},
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


def create_active_run(
    app, session_public_id: str, *, message_content: str | None = None
) -> str:
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
        db.flush()
        if message_content is not None:
            db.add(
                AgentMessage(
                    session_id=session.id,
                    run_id=run.id,
                    sequence_no=1,
                    role="user",
                    content=message_content,
                )
            )
        db.commit()
        return run.public_id


def internal_headers(token: str = INTERNAL_TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def editor_data(base: dict, markdown: str) -> dict:
    data = {**base, "sections": []}
    heading = re.search(r"^## \[\[linkresume-block:(node_[a-z0-9]+)\]\](.+)$", markdown, re.MULTILINE)
    entry = re.search(r"^### \[\[linkresume-block:(node_[a-z0-9]+)\]\](.+)$", markdown, re.MULTILINE)
    bullets = re.findall(r"^- \[\[linkresume-block:(node_[a-z0-9]+)\]\](.+)$", markdown, re.MULTILINE)
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
            json={"title": "岗位定制"},
        )
        assert created.status_code == 201
        legacy_create = owner.post(
            "/api/agent/sessions", json={"resume_id": resume["id"]}
        )
        assert legacy_create.status_code == 201
        assert "resume_id" not in legacy_create.json()["session"]
        session_id = created.json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        register(stranger, "agent-stranger@example.test")
        hidden = stranger.get(f"/api/agent/sessions/{session_id}")
        assert hidden.status_code == 404
        assert hidden.json() == {"error": "AGENT_SESSION_NOT_FOUND"}

        denied = owner.get(
            f"/internal/agent/runs/{run_id}/context?resume_id={resume['id']}"
        )
        assert denied.status_code == 401
        assert denied.json() == {"error": "AGENT_SERVICE_UNAUTHORIZED"}

        context = owner.get(
            f"/internal/agent/runs/{run_id}/context?resume_id={resume['id']}",
            headers=internal_headers(),
        )
        assert context.status_code == 200
        assert context.json()["resume_id"] == resume["id"]
        assert context.json()["lock_version"] == 1


def test_explicit_resume_title_resolves_for_run_without_binding_session() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-reference-owner@example.test")
        resume = create_resume(client, app)
        created = client.post("/api/agent/sessions", json={})
        assert created.status_code == 201
        session_id = created.json()["session"]["id"]
        run_id = create_active_run(
            app,
            session_id,
            message_content="请整体分析简历：张三的测试简历",
        )

        resolved = client.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"title": "张三的测试简历"},
        )

        assert resolved.status_code == 200
        assert resolved.json()["status"] == "resolved"
        target = resolved.json()["target"]
        assert target["resume_id"] == resume["id"]
        context = client.post(
            f"/internal/agent/runs/{run_id}/context:read",
            headers=internal_headers(),
            json={"target": target, "scope": "resume"},
        )
        assert context.status_code == 200
        assert context.json()["title"] == "张三的测试简历"
        assert context.json()["data"]["schema_version"] == "canonical-resume.v1"
        detail = client.get(f"/api/agent/sessions/{session_id}")
        assert detail.status_code == 200
        assert "resume_id" not in detail.json()["session"]


def test_run_without_message_resume_context_cannot_resolve_a_resume_target() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-no-resume-context@example.test")
        session = client.post("/api/agent/sessions", json={}).json()["session"]
        run_id = create_active_run(app, session["id"])

        unresolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"quoted_text": "张三"},
        )

        assert unresolved.status_code == 409
        assert unresolved.json() == {"error": "AGENT_RESUME_REQUIRED"}
        detail = client.get(f"/api/agent/sessions/{session['id']}")
        assert "resume_id" not in detail.json()["session"]


def test_resume_reference_can_use_title_selected_from_prior_catalog_result() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-reference-guard@example.test")
        create_resume(client, app)
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(
            app,
            session_id,
            message_content="请分析我的简历",
        )

        resolved = client.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"title": "张三的测试简历"},
        )

        assert resolved.status_code == 200
        assert resolved.json()["status"] == "resolved"
        assert resolved.json()["target"]["resume_id"] is not None
        detail = client.get(f"/api/agent/sessions/{session_id}")
        assert "resume_id" not in detail.json()["session"]


def test_resume_reference_does_not_expose_another_users_named_resume() -> None:
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "agent-reference-empty@example.test")
        session_id = owner.post("/api/agent/sessions", json={}).json()["session"]["id"]

        register(stranger, "agent-reference-stranger@example.test")
        stranger_resume = create_resume(stranger, app)
        run_id = create_active_run(
            app,
            session_id,
            message_content="请分析张三的测试简历",
        )

        hidden = owner.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"title": "张三的测试简历"},
        )

        assert hidden.status_code == 200
        assert hidden.json() == {
            "status": "not_found",
            "target": None,
            "candidates": [],
        }
        hidden_by_id = owner.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"resume_id": stranger_resume["id"]},
        )
        assert hidden_by_id.status_code == 200
        assert hidden_by_id.json() == {
            "status": "not_found",
            "target": None,
            "candidates": [],
        }
        detail = owner.get(f"/api/agent/sessions/{session_id}")
        assert "resume_id" not in detail.json()["session"]


def test_resume_reference_does_not_auto_select_duplicate_import_titles() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-reference-duplicate@example.test")
        resume = create_resume(client, app)
        with app.state.session_factory() as db:
            source = db.get(Resume, int(resume["id"]))
            assert source is not None
            duplicate = Resume(
                    user_id=source.user_id,
                    template_id=source.template_id,
                    title=source.title,
                    data_json=deepcopy(source.data_json),
                    style_json=deepcopy(source.style_json),
                    source_type="import",
                )
            db.add(duplicate)
            db.commit()
            duplicate_id = str(duplicate.id)
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(
            app,
            session_id,
            message_content="请分析张三的测试简历",
        )

        ambiguous = client.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"title": "张三的测试简历"},
        )

        assert ambiguous.status_code == 200
        assert ambiguous.json()["status"] == "ambiguous"
        assert len(ambiguous.json()["candidates"]) == 2

        resolved = client.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"resume_id": duplicate_id},
        )
        assert resolved.status_code == 200
        assert resolved.json()["status"] == "resolved"
        assert resolved.json()["target"]["resume_id"] == duplicate_id
        detail = client.get(f"/api/agent/sessions/{session_id}")
        assert "resume_id" not in detail.json()["session"]


def test_context_catalog_is_owner_scoped_and_message_snapshot_does_not_bind_session() -> (
    None
):
    emitter = CapturingEmitter()
    app = build_app(event_emitter=emitter)
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
                "contexts": [{"type": "resume", "id": owner_resume["id"]}],
            },
        )
        assert sent.status_code == 200
        with app.state.session_factory() as db:
            record = db.scalar(
                select(AgentSession).where(AgentSession.public_id == session["id"])
            )
            assert record is not None
            message = db.scalar(
                select(AgentMessage).where(AgentMessage.session_id == record.id)
            )
            assert message is not None
            run = db.get(AgentRun, message.run_id)
            assert run is not None
            assert run.public_id == str(
                uuid5(
                    NAMESPACE_URL,
                    f"linkresume:agent-message:{session['id']}:context-snapshot-001",
                )
            )
            assert message.metadata_json is not None
            assert (
                message.metadata_json["contexts"][0]["label"] == owner_resume["title"]
            )
            assert "data" not in message.metadata_json["contexts"][0]
        context_events = [
            event
            for event in emitter.system_events
            if event.get("stage") == "context_preflight"
            and event.get("operation_id") == run.public_id
        ]
        assert [event["result"] for event in context_events] == [
            "started",
            "succeeded",
        ]
        assert context_events[-1]["candidate_count"] == 1
        assert any(
            event.get("stage") == "run_creation"
            and event.get("operation_id") == run.public_id
            and event.get("result") == "created"
            for event in emitter.system_events
        )

        hidden = owner.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "读取另一用户资料",
                "idempotency_key": "context-owner-check-001",
                "contexts": [{"type": "resume", "id": stranger_resume["id"]}],
            },
        )
        assert hidden.status_code == 404
        assert hidden.json() == {"error": "AGENT_CONTEXT_NOT_FOUND"}
        failed_preflight = next(
            event
            for event in reversed(emitter.system_events)
            if event.get("stage") == "context_preflight"
            and event.get("result") == "failed"
        )
        assert failed_preflight["error_code"] == "AGENT_CONTEXT_NOT_FOUND"
        assert failed_preflight["operation_id"]


def test_resume_context_is_persisted_on_message_without_binding_session() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-context-switch@example.test")
        selected_resume = create_resume(client, app, "第二份测试简历")
        session = client.post("/api/agent/sessions", json={}).json()["session"]

        sent = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "这一轮分析第二份简历",
                "idempotency_key": "context-switch-001",
                "contexts": [{
                    "type": "resume",
                    "id": selected_resume["id"],
                    "presentation": "implicit",
                }],
            },
        )

        assert sent.status_code == 200
        detail = client.get(f"/api/agent/sessions/{session['id']}")
        assert "resume_id" not in detail.json()["session"]
        contexts = detail.json()["session"]["messages"][0]["contexts"]
        assert contexts[0]["id"] == selected_resume["id"]
        assert contexts[0]["presentation"] == "implicit"
        with app.state.session_factory() as db:
            stored = db.scalar(
                select(AgentSession).where(AgentSession.public_id == session["id"])
            )
            assert stored is not None


def test_context_preflight_logs_unexpected_failure_without_request_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    emitter = CapturingEmitter()
    app = build_app(event_emitter=emitter)

    def fail_context_resolution(*_args, **_kwargs):
        raise RuntimeError("private diagnostic detail")

    monkeypatch.setattr(agent_routes, "resolve_contexts", fail_context_resolution)
    with TestClient(app, raise_server_exceptions=False) as client:
        register(client, "agent-context-failure@example.test")
        session = client.post("/api/agent/sessions", json={}).json()["session"]
        failed = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "不应进入结构化日志的用户正文",
                "idempotency_key": "context-unexpected-failure-001",
            },
        )

    assert failed.status_code == 500
    event = next(
        item
        for item in reversed(emitter.system_events)
        if item.get("stage") == "context_preflight"
        and item.get("result") == "failed"
    )
    assert event["level"] == "ERROR"
    assert event["error_code"] == "AGENT_CONTEXT_PREFLIGHT_FAILED"
    assert event["exception_type"] == "RuntimeError"
    assert event["operation_id"]
    assert "content" not in event
    assert "private diagnostic detail" not in str(event)


def test_selection_context_requires_resume_context_on_the_same_message() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-selection-context@example.test")
        session = client.post("/api/agent/sessions", json={}).json()["session"]
        selected_text = "负责平台性能优化"

        sent = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "优化选中的内容",
                "idempotency_key": "selection-without-resume-001",
                "selection_context": {
                    "block_ids": ["node_bullet0000000001"],
                    "from": 0,
                    "to": len(selected_text),
                    "selected_text": selected_text,
                    "selected_text_hash": "sha256:"
                    + hashlib.sha256(selected_text.encode()).hexdigest(),
                },
            },
        )

        assert sent.status_code == 422


def test_internal_resource_catalog_lists_owned_resume_dataset_and_interview_metadata() -> (
    None
):
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "agent-resource-owner@example.test")
        owner_resume = create_resume(owner, app)
        with app.state.session_factory() as db:
            owner_user_id = db.scalar(
                select(User.id).where(User.email == "agent-resource-owner@example.test")
            )
            assert owner_user_id is not None
            task = DocumentParseTask(
                source_type=DATASET_SOURCE_TYPE,
                user_id=owner_user_id,
                file_name="面试准备资料.md",
                file_format="md",
                object_name=f"users/{owner_user_id}/datasets/source/interview.md",
                converted_object_name=(
                    f"users/{owner_user_id}/datasets/converted/interview.md"
                ),
                upload_status="succeeded",
                upload_duration_ms=1,
                parse_status="succeeded",
                parse_duration_ms=1,
            )
            db.add(task)
            db.flush()
            dataset = UserDataset(
                user_id=owner_user_id,
                idempotency_key="agent-resource-catalog-001",
                request_fingerprint="3" * 64,
                parse_task_id=task.id,
                file_name="面试准备资料.md",
                file_format="md",
                content_type="text/markdown",
                file_size=32,
                object_name=task.object_name,
                sha256="4" * 64,
            )
            db.add(dataset)
            db.commit()

        job = owner.post(
            "/api/job-descriptions",
            json={
                "job_title": "后端开发工程师",
                "company_name": "示例科技",
                "description": "负责虚构业务的服务端开发。",
                "source_type": "manual",
            },
        )
        assert job.status_code == 201, job.text
        job_id = job.json()["job_description"]["id"]
        application = owner.post(
            "/api/job-applications",
            json={
                "job_description_id": job_id,
                "current_stage_type": "interview",
                "current_round_no": 1,
                "current_stage_label": "一面",
                "stage_state": "awaiting_schedule",
            },
        )
        assert application.status_code == 201, application.text
        application_id = application.json()["application"]["id"]
        start_at = (utc_now() + timedelta(days=1)).replace(second=0, microsecond=0)
        interview = owner.post(
            f"/api/job-applications/{application_id}/interview-sessions",
            json={
                "client_request_id": "55555555-5555-4555-8555-555555555555",
                "stage_type": "interview",
                "round_no": 1,
                "stage_label": "一面",
                "start_at": start_at.isoformat(),
                "end_at": (start_at + timedelta(hours=1)).isoformat(),
                "timezone": "Asia/Shanghai",
                "mode": "video",
            },
        )
        assert interview.status_code == 201, interview.text
        interview_id = interview.json()["session"]["id"]

        register(stranger, "agent-resource-stranger@example.test")
        stranger_resume = create_resume(stranger, app)

        agent_session = owner.post("/api/agent/sessions", json={}).json()["session"]
        run_id = create_active_run(app, agent_session["id"])
        denied = owner.post(
            f"/internal/agent/runs/{run_id}/resources:list",
            json={},
        )
        assert denied.status_code == 401
        assert denied.json() == {"error": "AGENT_SERVICE_UNAUTHORIZED"}

        listed = owner.post(
            f"/internal/agent/runs/{run_id}/resources:list",
            headers=internal_headers(),
            json={},
        )
        assert listed.status_code == 200, listed.text
        resources = listed.json()["resources"]
        assert [item["type"] for item in resources] == [
            "resume",
            "dataset",
            "interview",
        ]
        assert owner_resume["id"] in {item["id"] for item in resources}
        assert stranger_resume["id"] not in {item["id"] for item in resources}
        assert interview_id in {item["id"] for item in resources}
        assert all("content" not in item and "data" not in item for item in resources)

        interviews = owner.post(
            f"/internal/agent/runs/{run_id}/resources:list",
            headers=internal_headers(),
            json={"types": ["interview"], "query": "示例科技", "limit": 5},
        )
        assert interviews.status_code == 200, interviews.text
        assert [item["id"] for item in interviews.json()["resources"]] == [
            interview_id
        ]


def test_active_run_lookup_is_owned_and_missing_stream_is_finalized() -> None:
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "agent-active-run-owner@example.test")
        session_id = owner.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        register(stranger, "agent-active-run-stranger@example.test")
        hidden = stranger.get(f"/api/agent/sessions/{session_id}/active-run")
        assert hidden.status_code == 404
        assert hidden.json() == {"error": "AGENT_SESSION_NOT_FOUND"}

        active = owner.get(f"/api/agent/sessions/{session_id}/active-run")
        assert active.status_code == 200
        assert active.json()["run"] == {
            "run_id": run_id,
            "status": "running",
            "started_at": active.json()["run"]["started_at"],
        }

        replay = owner.get(f"/api/agent/runs/{run_id}/events")
        assert replay.status_code == 200
        assert "event: run.failed" in replay.text
        assert "AGENT_STREAM_INCOMPLETE" in replay.text

        after = owner.get(f"/api/agent/sessions/{session_id}/active-run")
        assert after.status_code == 200
        assert after.json() == {"run": None}


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
        prefix_resumes = client.get(
            "/api/agent/contexts?type=resume&q=目标&prefix=true&limit=1"
        )
        assert prefix_resumes.status_code == 200
        assert prefix_resumes.json()["contexts"] == []

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


def test_dataset_context_is_searchable_owner_scoped_and_resolved_for_message() -> None:
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "agent-dataset-owner@example.test")
        with app.state.session_factory() as db:
            owner_user_id = db.scalar(
                select(User.id).where(User.email == "agent-dataset-owner@example.test")
            )
            assert owner_user_id is not None
            task = DocumentParseTask(
                source_type=DATASET_SOURCE_TYPE,
                user_id=owner_user_id,
                file_name="资料1.md",
                file_format="md",
                object_name=f"users/{owner_user_id}/datasets/source/资料1.md",
                converted_object_name=(
                    f"users/{owner_user_id}/datasets/converted/资料1.md"
                ),
                upload_status="succeeded",
                upload_duration_ms=1,
                parse_status="succeeded",
                parse_duration_ms=1,
            )
            db.add(task)
            db.flush()
            dataset = UserDataset(
                user_id=owner_user_id,
                idempotency_key="agent-dataset-context-001",
                request_fingerprint="1" * 64,
                parse_task_id=task.id,
                file_name="资料1.md",
                file_format="md",
                content_type="text/markdown",
                file_size=16,
                object_name=task.object_name,
                sha256="2" * 64,
            )
            db.add(dataset)
            db.commit()
            dataset_id = str(dataset.id)
            dataset_version = dataset.sha256
            assert task.converted_object_name is not None
            app.state.storage.objects[task.converted_object_name] = b"# Fictional material"

        found = owner.get(
            "/api/agent/contexts?type=dataset&q=资料&prefix=true&limit=8"
        )
        assert found.status_code == 200
        contexts = found.json()["contexts"]
        assert len(contexts) == 1
        assert contexts[0]["type"] == "dataset"
        assert contexts[0]["id"] == dataset_id
        assert contexts[0]["version"] == dataset_version
        assert contexts[0]["label"] == "资料1.md"
        assert contexts[0]["description"] == "资料库文件"
        assert "content" not in contexts[0]

        register(stranger, "agent-dataset-stranger@example.test")
        hidden = stranger.get("/api/agent/contexts?type=dataset&q=资料&limit=8")
        assert hidden.status_code == 200
        assert hidden.json()["contexts"] == []

        session = owner.post("/api/agent/sessions", json={}).json()["session"]
        sent = owner.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "请参考 @资料1.md",
                "idempotency_key": "dataset-context-message-001",
                "contexts": [
                    {
                        "type": "dataset",
                        "id": dataset_id,
                        "version": dataset_version,
                    }
                ],
            },
        )
        assert sent.status_code == 200
        with app.state.session_factory() as db:
            message = db.scalar(select(AgentMessage))
            assert message is not None
            assert message.metadata_json is not None
            assert message.metadata_json["contexts"][0]["type"] == "dataset"
            assert message.metadata_json["contexts"][0]["label"] == "资料1.md"


def test_proposal_is_idempotent_and_confirmed_once() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-proposal@example.test")
        resume = create_resume(client, app)
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposed_data = resume["data"]
        proposed_data["identity"]["headline"] = {
            "node_id": "node_headline00000001",
            "source_refs": [],
            "value": "由智能助手生成的虚构标题",
        }
        payload = {
            "call_key": "proposal-call-1",
            "resume_id": resume["id"],
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


def test_revision_supersedes_only_after_replacement_and_is_session_scoped() -> None:
    from linkresume.modules.agent.pi_client import _revision_prompt
    from linkresume.modules.agent.service import revision_source

    app = build_app()
    with TestClient(app) as client:
        register(client, "revision@example.test")
        resume = create_resume(client, app)
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        original_run = create_active_run(app, session_id, message_content="优化标题")
        payload = {"call_key": "original", "resume_id": resume["id"], "data": resume["data"],
                   "style": resume["style"], "summary": "原始建议"}
        response = client.post(f"/internal/agent/runs/{original_run}/proposals", headers=internal_headers(), json=payload)
        assert response.status_code == 201
        source_id = response.json()["proposal"]["id"]
        other_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        with app.state.session_factory() as db:
            other = db.scalar(select(AgentSession).where(AgentSession.public_id == other_id))
            with pytest.raises(ApiError) as error:
                revision_source(db, other, source_id)
            assert error.value.code == "AGENT_PROPOSAL_NOT_FOUND"
            db.execute(update(AgentRun).where(AgentRun.public_id == original_run).values(status="succeeded"))
            session = db.scalar(select(AgentSession).where(AgentSession.public_id == session_id))
            revision, _ = create_run(db, session=session, content="写得简洁一些", idempotency_key="revision-request-1",
                                     timeout_seconds=60, revision_proposal_id=source_id)
            revision_id = revision.public_id
        before = client.get(f"/api/agent/proposals?session_id={session_id}").json()["proposals"]
        assert before[0]["status"] == "pending"
        assert before[0]["superseded_by"] is None
        assert "原始建议" in _revision_prompt(app, revision_id, "写得简洁一些")
        invalid = client.post(f"/internal/agent/runs/{revision_id}/proposals", headers=internal_headers(),
                              json={**payload, "call_key": "invalid", "data": {}})
        assert invalid.status_code >= 400
        retained = client.get(f"/api/agent/proposals?session_id={session_id}").json()["proposals"]
        assert next(item for item in retained if item["id"] == source_id)["status"] == "pending"
        replacement = client.post(f"/internal/agent/runs/{revision_id}/proposals", headers=internal_headers(),
                                  json={**payload, "call_key": "replacement", "summary": "新的建议"})
        assert replacement.status_code == 201
        replay = client.post(f"/internal/agent/runs/{revision_id}/proposals", headers=internal_headers(),
                             json={**payload, "call_key": "replacement", "summary": "新的建议"})
        assert replay.json()["proposal"]["id"] == replacement.json()["proposal"]["id"]
        after = client.get(f"/api/agent/proposals?session_id={session_id}&include_history=true").json()["proposals"]
        original = next(item for item in after if item["id"] == source_id)
        assert original["status"] == "rejected"
        assert original["superseded_by"] == replacement.json()["proposal"]["id"]
        assert client.post(f"/api/agent/proposals/{source_id}/confirm").status_code == 409
        detail = client.get(f"/api/agent/sessions/{session_id}").json()["session"]
        assert detail["messages"][0]["run_id"] == original_run


def test_proposal_confirmation_rejects_images_above_pdf_total() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-image-total@example.test")
        resume = create_resume(client, app)
        resume_id = resume["id"]
        first_name = "first.png"
        second_name = "second.jpg"
        app.state.storage.objects[
            f"users/1/resumes/{resume_id}/assets/{first_name}"
        ] = b"x" * (6 * 1024 * 1024)
        app.state.storage.objects[
            f"users/1/resumes/{resume_id}/assets/{second_name}"
        ] = b"y" * (6 * 1024 * 1024)

        proposed_data = resume["data"]
        proposed_data["identity"]["avatar"] = {
            "node_id": "node_avatar00000000003",
            "source_refs": [],
            "media_kind": "avatar",
            "src": f"/api/resumes/{resume_id}/assets/{first_name}",
            "alt": None,
            "width": 96,
            "width_unit": "px",
            "height_px": None,
            "align": None,
            "system_fallback": False,
        }
        proposed_data["sections"] = [
            {
                "node_id": "node_section0000000003",
                "source_refs": [],
                "semantic_kind": "custom",
                "title": None,
                "title_icon": None,
                "entries": [],
                "blocks": [
                    {
                        "node_id": "node_media00000000003",
                        "source_refs": [],
                        "block_type": "media",
                        "media_kind": "resume_image",
                        "src": f"/api/resumes/{resume_id}/assets/{second_name}",
                        "alt": None,
                        "width": 50,
                        "width_unit": "%",
                        "height_px": None,
                        "align": "center",
                        "system_fallback": False,
                    }
                ],
            }
        ]
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposal = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "proposal-image-total",
                "resume_id": resume_id,
                "data": proposed_data,
                "style": resume["style"],
                "summary": "保留现有图片并调整文字",
            },
        )
        assert proposal.status_code == 201

        rejected = client.post(
            f"/api/agent/proposals/{proposal.json()['proposal']['id']}/confirm"
        )

        assert rejected.status_code == 413
        assert rejected.json() == {"error": "RESUME_PDF_ASSETS_TOO_LARGE"}
        current = client.get(f"/api/resumes/{resume_id}").json()["resume"]
        assert current["lock_version"] == 1
        assert current["data"]["identity"]["avatar"] is None


def test_scoped_edit_requires_resolved_target_and_diagnosis_before_confirmation() -> (
    None
):
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-scoped@example.test")
        resume = create_resume(client, app)
        markdown = "\n\n".join(
            [
                "## [[linkresume-block:node_section000000001]]工作经历",
                "### [[linkresume-block:node_entry00000000001]]示例公司 · 后端工程师",
                "- [[linkresume-block:node_bullet0000000001]]负责平台性能优化",
                "- [[linkresume-block:node_bullet0000000002]]负责平台性能优化",
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
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        ambiguous = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"resume_id": resume["id"], "quoted_text": "负责平台性能优化"},
        )
        assert ambiguous.status_code == 200
        assert ambiguous.json()["status"] == "ambiguous"
        assert len(ambiguous.json()["candidates"]) == 2

        entry_selection = "示例公司 · 后端工程师\n负责平台性能优化\n负责平台性能优化"
        entry_resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={
                "resume_id": resume["id"],
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
                "resume_id": resume["id"],
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
                "## [[linkresume-block:node_section000000001]]工作经历",
                "### [[linkresume-block:node_entry00000000001]]示例公司 · 后端工程师",
                "- [[linkresume-block:node_bullet0000000001]]负责平台性能优化",
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
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        selected_entry = "示例公司 · 后端工程师\n负责平台性能优化"
        resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={
                "resume_id": resume["id"],
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


def test_section_anchor_can_authorize_one_local_child_block() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-section-anchor@example.test")
        resume = create_resume(client, app)
        markdown = "\n\n".join(
            [
                "## [[linkresume-block:node_section000000001]]专业技能",
                "### [[linkresume-block:node_entry00000000001]]技能清单",
                "- [[linkresume-block:node_bullet0000000001]]熟悉 Go 服务开发",
                "- [[linkresume-block:node_bullet0000000002]]熟悉可观测性工具",
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
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"resume_id": resume["id"], "quoted_text": "专业技能"},
        )
        assert resolved.status_code == 200
        section_target = resolved.json()["target"]
        context = client.post(
            f"/internal/agent/runs/{run_id}/context:read",
            headers=internal_headers(),
            json={"target": section_target, "scope": "section"},
        )
        assert context.status_code == 200
        child_target = next(
            item["target"]
            for item in context.json()["blocks"]
            if item["target"]["block_id"] == "node_bullet0000000002"
        )
        diagnosed = client.post(
            f"/internal/agent/runs/{run_id}/diagnoses",
            headers=internal_headers(),
            json={"target": section_target, "scope": "section"},
        )
        assert diagnosed.status_code == 200

        proposed = client.post(
            f"/internal/agent/runs/{run_id}/proposals:v2",
            headers=internal_headers(),
            json={
                "call_key": "section-child-proposal",
                "mode": "polish_local",
                "target": section_target,
                "diagnosis": diagnosed.json()["diagnosis"],
                "diagnosis_fingerprint": diagnosed.json()["diagnosis_fingerprint"],
                "operations": [
                    {
                        "op": "replace_target_text",
                        "target": child_target,
                        "new_text": "熟悉 OpenTelemetry 与 Prometheus",
                        "expected_text_hash": child_target["expected_text_hash"],
                    }
                ],
                "summary": "细化可观测性技能表述",
            },
        )
        assert proposed.status_code == 201


def test_named_resume_local_field_can_be_resolved_and_deleted_without_session_binding() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-named-field-delete@example.test")
        resume = create_resume(client, app, title="示例后端简历")
        markdown = "\n\n".join(
            [
                "## [[linkresume-block:node_section000000001]]工作经历",
                "### [[linkresume-block:node_entry00000000001]]示例公司",
                "- [[linkresume-block:node_bullet0000000001]]负责服务开发",
            ]
        )
        data = editor_data(resume["data"], markdown)
        data["sections"][0]["entries"][0]["fields"]["location"] = {
            "node_id": "node_location000000001",
            "source_refs": [],
            "value": "123",
        }
        saved = client.put(
            f"/api/resumes/{resume['id']}",
            json={"data": data, "base_lock_version": 1},
        )
        assert saved.status_code == 200
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        reference = client.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"title": "示例后端简历"},
        )
        assert reference.status_code == 200
        resume_target = reference.json()["target"]
        wrong_scope = client.post(
            f"/internal/agent/runs/{run_id}/context:read",
            headers=internal_headers(),
            json={"target": resume_target, "scope": "target"},
        )
        assert wrong_scope.status_code == 422
        assert wrong_scope.json() == {"error": "SCOPE_FORBIDDEN"}
        resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"resume_id": resume_target["resume_id"], "quoted_text": "123"},
        )
        assert resolved.status_code == 200
        target = resolved.json()["target"]
        assert target["field"] == "location"
        assert target["block_id"] == "node_location000000001"

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
                "call_key": "delete-location-placeholder",
                "mode": "polish_local",
                "target": target,
                "diagnosis": diagnosed.json()["diagnosis"],
                "diagnosis_fingerprint": diagnosed.json()["diagnosis_fingerprint"],
                "operations": [{
                    "op": "replace_target_text",
                    "target": target,
                    "new_text": "",
                    "expected_text_hash": target["expected_text_hash"],
                }],
                "summary": "删除已确认的占位内容",
            },
        )
        assert proposed.status_code == 201
        proposal_id = proposed.json()["proposal"]["id"]
        confirmed = client.post(f"/api/agent/proposals/{proposal_id}/confirm")
        assert confirmed.status_code == 200
        fields = confirmed.json()["resume"]["data"]["sections"][0]["entries"][0]["fields"]
        assert fields["location"] is None


def test_compound_cleanup_proposals_delete_nodes_and_rebase_disjoint_targets() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-compound-cleanup@example.test")
        resume = create_resume(client, app, title="张三-后端开发-测试")
        markdown = "\n\n".join(
            [
                "## [[linkresume-block:node_section000000001]]项目经历",
                "### [[linkresume-block:node_entry00000000001]]LinkRag 项目",
                "- [[linkresume-block:node_bullet0000000001]]实现真实检索链路",
                "- [[linkresume-block:node_bullet0000000002]]1",
                "- [[linkresume-block:node_bullet0000000003]]1",
                "- [[linkresume-block:node_bullet0000000004]]1",
            ]
        )
        data = editor_data(resume["data"], markdown)
        data["sections"][0]["entries"][0]["fields"]["location"] = {
            "node_id": "node_location000000001",
            "source_refs": [],
            "value": "asd",
        }
        saved = client.put(
            f"/api/resumes/{resume['id']}",
            json={"data": data, "base_lock_version": 1},
        )
        assert saved.status_code == 200
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)

        field_resolved = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"resume_id": resume["id"], "quoted_text": "asd"},
        ).json()["target"]
        field_diagnosis = client.post(
            f"/internal/agent/runs/{run_id}/diagnoses",
            headers=internal_headers(),
            json={"target": field_resolved, "scope": "target"},
        ).json()
        field_proposal = client.post(
            f"/internal/agent/runs/{run_id}/proposals:v2",
            headers=internal_headers(),
            json={
                "call_key": "delete-education-placeholder",
                "mode": "polish_local",
                "target": field_resolved,
                "diagnosis": field_diagnosis["diagnosis"],
                "diagnosis_fingerprint": field_diagnosis["diagnosis_fingerprint"],
                "operations": [{
                    "op": "replace_target_text",
                    "target": field_resolved,
                    "new_text": "",
                    "expected_text_hash": field_resolved["expected_text_hash"],
                }],
                "summary": "删除教育占位字段",
            },
        )
        assert field_proposal.status_code == 201

        entry_target = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"resume_id": resume["id"], "quoted_text": "LinkRag 项目"},
        ).json()["target"]
        entry_context = client.post(
            f"/internal/agent/runs/{run_id}/context:read",
            headers=internal_headers(),
            json={"target": entry_target, "scope": "entry"},
        ).json()
        placeholder_targets = [
            item["target"] for item in entry_context["blocks"] if item["content"] == "1"
        ]
        assert len(placeholder_targets) == 3
        entry_diagnosis = client.post(
            f"/internal/agent/runs/{run_id}/diagnoses",
            headers=internal_headers(),
            json={"target": entry_target, "scope": "entry"},
        ).json()
        proposal_ids = [field_proposal.json()["proposal"]["id"]]
        for index, placeholder_target in enumerate(placeholder_targets, start=1):
            proposed = client.post(
                f"/internal/agent/runs/{run_id}/proposals:v2",
                headers=internal_headers(),
                json={
                    "call_key": f"delete-linkrag-placeholder-{index}",
                    "mode": "polish_local",
                    "target": entry_target,
                    "diagnosis": entry_diagnosis["diagnosis"],
                    "diagnosis_fingerprint": entry_diagnosis["diagnosis_fingerprint"],
                    "operations": [{
                        "op": "delete_target",
                        "target": placeholder_target,
                        "new_text": "",
                        "expected_text_hash": placeholder_target["expected_text_hash"],
                    }],
                    "summary": f"删除 LinkRag 占位条目 {index}",
                },
            )
            assert proposed.status_code == 201
            proposal_ids.append(proposed.json()["proposal"]["id"])

        listed = client.get(
            f"/api/agent/proposals?session_id={session_id}"
        ).json()["proposals"]
        assert len(listed) == 4
        assert [item["operations"][0]["op"] for item in listed].count(
            "delete_target"
        ) == 3

        result = None
        for proposal_id in proposal_ids:
            result = client.post(f"/api/agent/proposals/{proposal_id}/confirm")
            assert result.status_code == 200
        assert result is not None
        confirmed_entry = result.json()["resume"]["data"]["sections"][0]["entries"][0]
        assert confirmed_entry["fields"]["location"] is None
        assert [
            run["text"]
            for item in confirmed_entry["blocks"][0]["items"]
            for run in item["runs"]
            if run["inline_type"] == "text"
        ] == ["实现真实检索链路"]
        assert result.json()["resume"]["lock_version"] == 6


def test_scoped_proposal_rebase_rejects_a_changed_operation_target() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-scoped-stale-target@example.test")
        resume = create_resume(client, app)
        markdown = "\n\n".join(
            [
                "## [[linkresume-block:node_section000000001]]项目经历",
                "### [[linkresume-block:node_entry00000000001]]LinkRag 项目",
                "- [[linkresume-block:node_bullet0000000001]]1",
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
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        entry_target = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"resume_id": resume["id"], "quoted_text": "LinkRag 项目"},
        ).json()["target"]
        entry_context = client.post(
            f"/internal/agent/runs/{run_id}/context:read",
            headers=internal_headers(),
            json={"target": entry_target, "scope": "entry"},
        ).json()
        placeholder_target = next(
            item["target"] for item in entry_context["blocks"] if item["content"] == "1"
        )
        diagnosis = client.post(
            f"/internal/agent/runs/{run_id}/diagnoses",
            headers=internal_headers(),
            json={"target": entry_target, "scope": "entry"},
        ).json()

        proposed = client.post(
            f"/internal/agent/runs/{run_id}/proposals:v2",
            headers=internal_headers(),
            json={
                "call_key": "delete-stale-placeholder",
                "mode": "polish_local",
                "target": entry_target,
                "diagnosis": diagnosis["diagnosis"],
                "diagnosis_fingerprint": diagnosis["diagnosis_fingerprint"],
                "operations": [{
                    "op": "delete_target",
                    "target": placeholder_target,
                    "new_text": "",
                    "expected_text_hash": placeholder_target["expected_text_hash"],
                }],
                "summary": "删除占位条目",
            },
        )
        assert proposed.status_code == 201

        current = client.get(f"/api/resumes/{resume['id']}").json()["resume"]
        current["data"]["sections"][0]["entries"][0]["blocks"][0]["items"][0][
            "runs"
        ][0]["text"] = "用户已修改"
        changed = client.put(
            f"/api/resumes/{resume['id']}",
            json={"data": current["data"], "base_lock_version": current["lock_version"]},
        )
        assert changed.status_code == 200
        stale = client.post(
            f"/api/agent/proposals/{proposed.json()['proposal']['id']}/confirm"
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "TARGET_STALE"}
        current = client.get(f"/api/resumes/{resume['id']}").json()["resume"]
        assert current["lock_version"] == 3
        assert current["data"]["sections"][0]["entries"][0]["blocks"][0]["items"][0][
            "runs"
        ][0]["text"] == "用户已修改"


def test_proposal_confirmation_never_overwrites_concurrent_resume_edit() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-conflict@example.test")
        resume = create_resume(client, app)
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposal = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "proposal-conflict",
                "resume_id": resume["id"],
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


def test_translation_proposal_creates_one_independent_editable_resume() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-translation@example.test")
        source = create_resume(client, app)
        source_data, source_style = canonical_resume_payload(key="agent-test")
        source = client.put(
            f"/api/resumes/{source['id']}",
            json={
                "data": source_data,
                "style": source_style,
                "base_lock_version": source["lock_version"],
            },
        ).json()["resume"]
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        resolved = client.post(
            f"/internal/agent/runs/{run_id}/resumes:resolve-reference",
            headers=internal_headers(),
            json={"resume_id": source["id"]},
        )
        assert resolved.status_code == 200
        target = resolved.json()["target"]
        translated_data = deepcopy(source["data"])
        translated_data["identity"]["name"]["value"] = "Zhang San"

        proposed = client.post(
            f"/internal/agent/runs/{run_id}/proposals:translation",
            headers=internal_headers(),
            json={
                "call_key": "translate-resume-1",
                "target": target,
                "target_language": "en",
                "proposed_title": "English Resume",
                "data": translated_data,
                "style": source["style"],
                "summary": "忠实翻译为英文并保留原稿",
            },
        )
        assert proposed.status_code == 201
        proposal = proposed.json()["proposal"]
        assert proposal["proposal_mode"] == "translate_resume"
        assert proposal["proposed_title"] == "English Resume"

        listed = client.get(f"/api/agent/proposals?session_id={session_id}")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["proposals"]] == [proposal["id"]]

        confirmed = client.post(f"/api/agent/proposals/{proposal['id']}/confirm")
        assert confirmed.status_code == 200
        result = confirmed.json()["resume"]
        assert result["id"] != source["id"]
        assert result["title"] == "English Resume"
        assert result["data"]["identity"]["name"]["value"] == "Zhang San"

        current_source = client.get(f"/api/resumes/{source['id']}").json()["resume"]
        assert current_source["lock_version"] == source["lock_version"]
        assert current_source["data"]["identity"]["name"]["value"] != "Zhang San"

        repeated = client.post(f"/api/agent/proposals/{proposal['id']}/confirm")
        assert repeated.status_code == 200
        assert repeated.json()["resume"]["id"] == result["id"]
        with app.state.session_factory() as db:
            assert len(db.scalars(select(Resume)).all()) == 2
            versions = db.scalars(
                select(ResumeVersion).where(ResumeVersion.resume_id == int(result["id"]))
            ).all()
            assert len(versions) == 1


def test_translation_proposal_rejects_changed_factual_tokens() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-invalid-translation@example.test")
        source = create_resume(client, app)
        source_data, source_style = canonical_resume_payload(key="agent-test")
        source = client.put(
            f"/api/resumes/{source['id']}",
            json={
                "data": source_data,
                "style": source_style,
                "base_lock_version": source["lock_version"],
            },
        ).json()["resume"]
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        target = client.post(
            f"/internal/agent/runs/{run_id}/targets:resolve",
            headers=internal_headers(),
            json={"resume_id": source["id"], "scope_hint": "resume"},
        ).json()["target"]
        translated_data = deepcopy(source["data"])
        translated_data["identity"]["node_id"] = "node_changed000000001"

        response = client.post(
            f"/internal/agent/runs/{run_id}/proposals:translation",
            headers=internal_headers(),
            json={
                "call_key": "translate-invalid-1",
                "target": target,
                "target_language": "en",
                "proposed_title": "Invalid Translation",
                "data": translated_data,
                "style": source["style"],
                "summary": "不应创建",
            },
        )
        assert response.status_code in {422, 400}


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
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
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
                "resume_id": resume["id"],
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


def test_deleting_resume_cleans_proposals_but_preserves_independent_conversation() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "agent-delete@example.test")
        resume = create_resume(client, app)
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        proposal = client.post(
            f"/internal/agent/runs/{run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "delete-cleanup-proposal",
                "resume_id": resume["id"],
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
            assert db.scalar(select(AgentSession.id)) is not None
            assert db.scalar(select(AgentRun.id)) is not None
            assert db.scalar(select(AgentMessage.id)) is not None
            assert db.scalar(select(AgentToolCall.id)) is not None
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
            "linkresume.modules.agent.routes.cancel_pi_run", complete_during_cancel
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
    emitter = CapturingEmitter()
    app = build_app(event_emitter=emitter)
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
            "linkresume.modules.agent.pi_client.httpx.AsyncClient",
            lambda **_kwargs: FakeHttpClient(),
        )

        async def collect_events() -> list[bytes]:
            return [item async for item in stream_pi_run(app, run_id, "请优化简历")]

        events = b"".join(asyncio.run(collect_events())).decode()

        assert "event: assistant.delta" in events
        assert "event: run.failed" in events
        assert "AGENT_UPSTREAM_FAILED" in events
        stage_results = [
            (item.get("stage"), item.get("result"), item.get("error_code"))
            for item in emitter.system_events
            if item.get("message") == "agent run stage"
        ]
        assert ("pi_dispatch", "started", None) in stage_results
        assert ("pi_dispatch", "succeeded", None) in stage_results
        assert ("model_execution", "started", None) in stage_results
        assert (
            "model_execution",
            "failed",
            "AGENT_UPSTREAM_FAILED",
        ) in stage_results
        assert (
            "stream_terminal",
            "failed",
            "AGENT_UPSTREAM_FAILED",
        ) in stage_results
        assert ("run_finalize", "started", None) in stage_results
        assert ("run_finalize", "succeeded", None) in stage_results
        assert "请优化简历" not in str(emitter.system_events)
        agent_stage_events = [
            item
            for item in emitter.system_events
            if item.get("message") == "agent run stage"
        ]
        assert all(item.get("operation_id") == run_id for item in agent_stage_events)
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
            "linkresume.modules.agent.pi_client.httpx.AsyncClient",
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
        other_resume = create_resume(client, app, "另一份测试简历")
        session = client.post("/api/agent/sessions", json={}).json()["session"]
        assert session["title"] == "新对话"
        selected_text = "禾赛科技标题行右侧的 123"
        selection_context = {
            "block_ids": ["node_entryfield00000001"],
            "from": 1,
            "to": len(selected_text) + 1,
            "selected_text": selected_text,
            "selected_text_hash": "sha256:"
            + hashlib.sha256(selected_text.encode()).hexdigest(),
        }

        first = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "优化这段项目经历的表达并突出技术影响",
                "idempotency_key": "first_message_001",
                "contexts": [{
                    "type": "resume",
                    "id": resume["id"],
                    "presentation": "implicit",
                }],
                "selection_context": selection_context,
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
            source_message = db.scalar(
                select(AgentMessage)
                .where(
                    AgentMessage.session_id == record.id,
                    AgentMessage.role == "user",
                )
                .order_by(AgentMessage.sequence_no.asc())
                .limit(1)
            )
            assert source_message is not None
            assert source_message.run_id is not None
            db.add(
                AgentMessage(
                    session_id=record.id,
                    run_id=source_message.run_id,
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

        conflict = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "修改范围：实习经历",
                "idempotency_key": "conflicting_context_reply_001",
                "reply_to_sequence_no": latest_sequence + 1,
                "contexts": [{"type": "resume", "id": other_resume["id"]}],
                "clarification_answers": [
                    {"question_id": "scope", "option_id": "internship"}
                ],
            },
        )
        assert conflict.status_code == 409
        assert conflict.json() == {
            "error": "AGENT_CLARIFICATION_CONTEXT_CONFLICT"
        }

        changed_selection_text = "另一处 123"
        selection_conflict = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "修改范围：实习经历",
                "idempotency_key": "conflicting_selection_reply_001",
                "reply_to_sequence_no": latest_sequence + 1,
                "selection_context": {
                    "block_ids": ["node_entryfield00000002"],
                    "from": 1,
                    "to": len(changed_selection_text) + 1,
                    "selected_text": changed_selection_text,
                    "selected_text_hash": "sha256:"
                    + hashlib.sha256(changed_selection_text.encode()).hexdigest(),
                },
                "clarification_answers": [
                    {"question_id": "scope", "option_id": "internship"}
                ],
            },
        )
        assert selection_conflict.status_code == 409
        assert selection_conflict.json() == {
            "error": "AGENT_CLARIFICATION_CONTEXT_CONFLICT"
        }

        accepted = client.post(
            f"/api/agent/sessions/{session['id']}/messages",
            json={
                "content": "修改范围：实习经历",
                "idempotency_key": "structured_reply_001",
                "reply_to_sequence_no": latest_sequence + 1,
                "clarification_answers": [
                    {"question_id": "scope", "option_id": "internship"}
                ],
            },
        )
        assert accepted.status_code == 200
        with app.state.session_factory() as db:
            stored = db.scalar(
                select(AgentMessage)
                .join(AgentSession, AgentSession.id == AgentMessage.session_id)
                .where(
                    AgentSession.public_id == session["id"],
                    AgentMessage.role == "user",
                    AgentMessage.content == "修改范围：实习经历",
                )
            )
            assert stored is not None
            assert stored.metadata_json is not None
            assert stored.metadata_json["reply_to_sequence_no"] == latest_sequence + 1
            assert stored.metadata_json["clarification_answers"] == [
                {
                    "question_id": "scope",
                    "option_id": "internship",
                    "value": "实习经历",
                }
            ]
            assert stored.metadata_json["contexts"][0]["type"] == "resume"
            assert stored.metadata_json["contexts"][0]["id"] == resume["id"]
            assert stored.metadata_json["contexts"][0]["presentation"] == "implicit"
            assert stored.metadata_json["selection_context"] == selection_context
            structured_run = db.get(AgentRun, stored.run_id)
            assert structured_run is not None
        assert _current_clarification_answers(app, structured_run.public_id) == [
            {
                "question_id": "scope",
                "option_id": "internship",
                "value": "实习经历",
            }
        ]


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
                        "assistant.activity.delta",
                        {"runId": run_id, "delta": "I'll ask for the target role."},
                    ),
                    (
                        "assistant.activity.status",
                        {
                            "runId": run_id,
                            "callKey": "task-1",
                            "label": "修改任务 1/1：定位内容",
                            "status": "running",
                        },
                    ),
                    ("assistant.activity.clear", {"runId": run_id}),
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
            "linkresume.modules.agent.pi_client.httpx.AsyncClient",
            lambda **_kwargs: FakeHttpClient(),
        )

        events = b"".join(
            asyncio.run(_collect_stream_events(app, run_id, "请优化简历"))
        ).decode()
        assert "event: assistant.activity.delta" in events
        assert "event: assistant.activity.status" in events
        assert "event: assistant.activity.clear" in events
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
            assert message.content == (
                "继续前需要确认：\n"
                "1. 你的目标岗位是什么？\n"
                "   选项：后端开发 / 产品经理 / 其他"
            )
            assert "I'll ask" not in message.content
            assert "请选择目标岗位" not in message.content


async def _collect_stream_events(app, run_id: str, content: str) -> list[bytes]:
    return [item async for item in stream_pi_run(app, run_id, content)]


def test_tool_event_terminal_state_is_idempotent_and_cannot_regress() -> None:
    emitter = CapturingEmitter()
    app = build_app(event_emitter=emitter)
    with TestClient(app) as client:
        register(client, "agent-tool-terminal@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        path = f"/internal/agent/runs/{run_id}/tool-events"
        running = {
            "call_key": "local-edit-plan-call-1",
            "tool_name": "execute_local_resume_edit_plan",
            "status": "running",
        }
        succeeded = {
            **running,
            "status": "succeeded",
            "duration_ms": 17,
            "stage": "execute_local_resume_edit_plan",
            "result": "resolved",
            "scope": "target",
            "selection_present": True,
            "candidate_count": 1,
            "target_field": "location",
            "base_lock_version": 7,
        }

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
                select(AgentToolCall).where(
                    AgentToolCall.call_key == "local-edit-plan-call-1"
                )
            )
            assert record is not None
            assert record.status == "succeeded"
            assert record.duration_ms == 17
        completed_event = next(
            item
            for item in emitter.system_events
            if item.get("action") == "execute_local_resume_edit_plan"
            and item.get("result") == "resolved"
        )
        assert completed_event == {
            **completed_event,
            "stage": "execute_local_resume_edit_plan",
            "scope": "target",
            "selection_present": True,
            "candidate_count": 1,
            "target_field": "location",
            "base_lock_version": 7,
            "duration_ms": 17,
        }
        assert "content" not in completed_event


def test_agent_readiness_checks_model_config_and_full_service_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    app.state.llm_service.agent_runtime_model = AsyncMock(
        return_value=SimpleNamespace(adapter="openai")
    )
    check_chain = AsyncMock()
    monkeypatch.setattr("linkresume.modules.agent.routes.check_pi_readiness", check_chain)
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


def test_runtime_config_snapshots_requested_model_on_run() -> None:
    app = build_app()
    app.state.llm_service.agent_runtime_model = AsyncMock(return_value=SimpleNamespace(
        id=42, config_version=3, adapter="openrouter",
        model_call_name="example/model-1", api_base=None, api_key="test-key",
    ))
    with TestClient(app) as client:
        register(client, "model-snapshot@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        response = client.get(
            "/internal/agent/runtime-config",
            params={"run_id": run_id}, headers=internal_headers(),
        )
        assert response.status_code == 200
        assert response.json()["model"] == "example/model-1"
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            assert run is not None
            assert run.model_name == "openrouter/example/model-1"
            assert run.model_config_id == 42
            assert run.model_config_version == 3


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
        target = client.post("/api/agent/sessions", json={}).json()["session"]
        other = client.post("/api/agent/sessions", json={}).json()["session"]
        target_run_id = create_active_run(app, target["id"])
        other_run_id = create_active_run(app, other["id"])

        proposal = client.post(
            f"/internal/agent/runs/{target_run_id}/proposals",
            headers=internal_headers(),
            json={
                "call_key": "session-delete-proposal",
                "resume_id": target_resume["id"],
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
