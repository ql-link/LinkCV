"""Server-side contract behind the runtime-orchestrated agent: derived resume access,
unambiguous whole-resume targeting and the versioned intent response."""
from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.modules.agent.intent_schemas import IntentDecision, PLANNING_RULES
from linkresume.modules.agent.models import AgentMessage, AgentRun
from linkresume.modules.llm.service import LLMError
from tests.integration.api.test_agent_routes import (
    build_app, create_active_run, create_resume, internal_headers, register,
)


def plan_run(client, app, contexts, *, tasks):
    resume = create_resume(client, app, "张三的测试简历")
    session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
    run_id = create_active_run(app, session_id, message_content="诊断并准备面试")
    with app.state.session_factory() as db:
        message = db.scalar(select(AgentMessage).join(AgentRun, AgentRun.id == AgentMessage.run_id).where(
            AgentRun.public_id == run_id, AgentMessage.role == "user"))
        message.metadata_json = {"contexts": [
            {"type": "resume", "id": resume["id"], "version": str(resume["lock_version"]), **extra}
            for extra in contexts]}
        db.commit()
    base = f"/internal/agent/runs/{run_id}"
    return resume, base, client.post(f"{base}/tasks:plan", headers=internal_headers(), json=tasks)


TASKS = {"tasks": [
    {"id": "review", "workflow": "resume_diagnosis", "output": "advice", "label": "诊断"},
    {"id": "catalog", "workflow": "resource_catalog", "output": "catalog", "label": "盘点"},
]}


@pytest.mark.parametrize("presentation", ["mention", "implicit"])
def test_selected_or_background_resume_follows_the_request_to_each_resume_task(presentation):
    app = build_app()
    with TestClient(app) as client:
        register(client, "br1-derived@example.test")
        resume, base, planned = plan_run(client, app, [{"presentation": presentation}], tasks=TASKS)
        assert planned.status_code == 200, planned.text
        saved = {task["id"]: task["context_refs"] for task in planned.json()["tasks"]}
        assert saved["review"] == [{"type": "resume", "id": resume["id"]}]
        assert saved["catalog"] == []  # a catalog never reads resume bodies
        assert client.post(f"{base}/tasks/review:status", headers=internal_headers(), json={"status": "running"}).status_code == 200
        assert client.get(f"{base}/context?resume_id={resume['id']}", headers=internal_headers()).status_code == 200


def test_a_resume_both_selected_and_open_in_the_editor_is_authorized_once():
    app = build_app()
    with TestClient(app) as client:
        register(client, "br1-dedupe@example.test")
        resume, _, planned = plan_run(client, app, [{"presentation": "mention"}, {"presentation": "implicit"}], tasks=TASKS)
        assert planned.status_code == 200, planned.text
        assert planned.json()["tasks"][0]["context_refs"] == [{"type": "resume", "id": resume["id"]}]


def test_resume_switch_leaves_the_editor_background_out_of_automatic_access():
    app = build_app()
    with TestClient(app) as client:
        register(client, "br1-switch@example.test")
        _, base, planned = plan_run(client, app, [{"presentation": "implicit"}], tasks={**TASKS, "resume_switch": True})
        assert planned.status_code == 200, planned.text
        assert planned.json()["tasks"][0]["context_refs"] == []


def test_a_model_chosen_resume_cannot_exceed_the_requests_own_selection():
    app = build_app()
    with TestClient(app) as client:
        register(client, "br1-foreign@example.test")
        other = create_resume(client, app, "张三另一份简历")
        tasks = {"tasks": [{**TASKS["tasks"][0], "context_refs": [{"type": "resume", "id": other["id"]}]}]}
        _, _, planned = plan_run(client, app, [{"presentation": "mention"}], tasks=tasks)
        assert planned.status_code == 409
        assert planned.json()["error"] == "AGENT_TASK_CONTEXT_NOT_AUTHORIZED"


def test_whole_resume_target_rejects_quoted_text_instead_of_matching_it():
    app = build_app()
    with TestClient(app) as client:
        register(client, "target-invalid@example.test")
        resume, base, planned = plan_run(client, app, [{"presentation": "mention"}], tasks=TASKS)
        assert client.post(f"{base}/tasks/review:status", headers=internal_headers(), json={"status": "running"}).status_code == 200
        invalid = client.post(f"{base}/targets:resolve", headers=internal_headers(), json={
            "resume_id": resume["id"], "scope_hint": "resume", "quoted_text": "整份简历"})
        assert invalid.status_code == 422
        assert invalid.json()["error"] == "TARGET_REQUEST_INVALID"
        whole = client.post(f"{base}/targets:resolve", headers=internal_headers(), json={
            "resume_id": resume["id"], "scope_hint": "resume"})
        assert whole.json()["status"] == "resolved"


def test_whole_resume_read_exposes_every_editable_block():
    from copy import deepcopy
    from uuid import uuid4

    from linkresume.modules.agent.canonical_targets import plain_run

    app = build_app()
    with TestClient(app) as client:
        register(client, "whole-blocks@example.test")
        resume, base, _ = plan_run(client, app, [{"presentation": "mention"}], tasks=TASKS)
        # A section may hold paragraphs directly, without any entry grouping.
        data = deepcopy(resume["data"])
        ids = [f"node_{uuid4().hex}" for _ in range(2)]
        data["sections"] = [{
            "node_id": f"node_{uuid4().hex}", "source_refs": [], "semantic_kind": "work",
            "title": {"node_id": f"node_{uuid4().hex}", "source_refs": [], "value": "实习经历"},
            "entries": [], "blocks": [
                {"node_id": node, "source_refs": [], "block_type": "paragraph", "runs": [plain_run(text)]}
                for node, text in zip(ids, ["虚构实习一", "虚构实习二"])],
        }]
        data["source_dispositions"] = []
        saved = client.put(f"/api/resumes/{resume['id']}", json={
            "data": data, "style": resume["style"], "base_lock_version": resume["lock_version"]})
        assert saved.status_code == 200, saved.text
        client.post(f"{base}/tasks/review:status", headers=internal_headers(), json={"status": "running"})
        target = client.post(f"{base}/targets:resolve", headers=internal_headers(), json={
            "resume_id": resume["id"], "scope_hint": "resume"}).json()["target"]
        read = client.post(f"{base}/context:read", headers=internal_headers(), json={"target": target, "scope": "resume"})
        assert read.status_code == 200, read.text
        blocks = read.json()["blocks"]
        assert {ids[0], ids[1]} <= {block["target"]["block_id"] for block in blocks}
        assert all(block["target"]["expected_text_hash"] for block in blocks)


@pytest.fixture
def intent_context():
    app = build_app(with_model=False)
    with TestClient(app) as client:
        register(client, "intent-v2@example.test")
        resume = create_resume(client, app, "张三的测试简历")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id, message_content="诊断简历")
        with app.state.session_factory() as db:
            message = db.scalar(select(AgentMessage).join(AgentRun, AgentRun.id == AgentMessage.run_id).where(
                AgentRun.public_id == run_id, AgentMessage.role == "user"))
            message.metadata_json = {"contexts": [{"type": "resume", "id": resume["id"], "presentation": "implicit"}]}
            db.commit()
        mock = AsyncMock()
        app.state.llm_service.structured_chat = mock
        yield client, mock, run_id


def recognize(client, run_id):
    return client.post(f"/internal/agent/runs/{run_id}/intent:recognize", headers=internal_headers())


def test_intent_response_is_version_two_and_carries_the_resume_switch(intent_context):
    client, mock, run_id = intent_context
    mock.return_value = SimpleNamespace(call_id="llmcall_test", value=IntentDecision.model_validate({
        "mode": "plan", "resume_switch": True,
        "tasks": [{"id": "review", "workflow": "resume_diagnosis", "output": "advice", "label": "诊断"}]}))
    body = recognize(client, run_id).json()
    assert body["version"] == 2 and body["resume_switch"] is True
    assert body["tasks"][0]["context_refs"] == []  # the background resume was set aside
    replay = recognize(client, run_id).json()
    assert (replay["version"], replay["resume_switch"], replay["tasks"]) == (2, True, body["tasks"])


def test_a_chat_style_diagnosis_spelling_becomes_the_diagnosis_workflow(intent_context):
    client, mock, run_id = intent_context
    mock.return_value = SimpleNamespace(call_id="llmcall_test", value=IntentDecision.model_validate({
        "mode": "plan", "tasks": [{"id": "review", "workflow": "resume_edit", "output": "advice", "label": "诊断"}]}))
    task = recognize(client, run_id).json()["tasks"][0]
    assert (task["workflow"], task["output"]) == ("resume_diagnosis", "advice")
    assert [ref["type"] for ref in task["context_refs"]] == ["resume"]


def test_fallback_carries_the_single_copy_of_the_routing_rules(intent_context):
    client, mock, run_id = intent_context
    mock.side_effect = LLMError("LLM_TIMEOUT")
    body = recognize(client, run_id).json()
    assert body["version"] == 2 and body["mode"] == "fallback"
    assert body["routing_rules"] == PLANNING_RULES
    assert recognize(client, run_id).json()["routing_rules"] == PLANNING_RULES
