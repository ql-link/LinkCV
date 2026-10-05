import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.modules.agent.models import AgentMessage, AgentRun, AgentSession
from linkresume.modules.agent.intent_schemas import IntentDecision
from linkresume.modules.agent.intent import recognize_run_intent
from linkresume.modules.llm.service import LLMError
from tests.integration.api.test_agent_routes import build_app, internal_headers, register


@pytest.fixture
def context():
    app = build_app(with_model=False)
    with TestClient(app) as client:
        register(client, "intent-test@example.test")
        with app.state.session_factory() as db:
            session = AgentSession(public_id=str(uuid4()), user_id=1, title="测试")
            db.add(session); db.flush()
            run = AgentRun(public_id=str(uuid4()), session_id=session.id,
                           idempotency_key="intent-test", started_at=datetime.now(timezone.utc))
            db.add(run); db.flush()
            db.add(AgentMessage(session_id=session.id, run_id=run.id, sequence_no=1,
                                role="user", content="诊断张三的简历",
                                metadata_json={"contexts": [{"type": "resume", "id": "1"}]}))
            db.commit()
            run_id = run.public_id
        mock = AsyncMock()
        app.state.llm_service.structured_chat = mock
        yield app, client, mock, run_id


def decision(mode="plan", **changes):
    payload = {"mode": mode}
    if mode == "plan":
        payload["tasks"] = [{"id": "diagnose", "workflow": "resume_edit", "output": "advice", "label": "诊断",
                             "context_refs": [{"type": "resume", "id": "1"}]}]
    payload.update(changes)
    return SimpleNamespace(value=IntentDecision.model_validate(payload), call_id="llmcall_test")


def recognize(client, run_id):
    return client.post(f"/internal/agent/runs/{run_id}/intent:recognize", headers=internal_headers())


def test_plan_is_saved_replayed_and_logged_with_run(context):
    app, client, mock, run_id = context
    mock.return_value = decision()
    response = recognize(client, run_id)
    assert response.status_code == 200, response.text
    assert response.json()["tasks"][0]["status"] == "planned"
    assert recognize(client, run_id).json()["tasks"] == response.json()["tasks"]
    assert mock.await_count == 1
    assert mock.call_args.kwargs["agent_run_id"] is not None
    with app.state.session_factory() as db:
        metadata = db.scalar(select(AgentMessage)).metadata_json
    assert "tasks" not in metadata["agent_intent"]
    assert metadata["agent_intent"]["call_id"] == "llmcall_test"


@pytest.mark.parametrize("code", ["LLM_MODEL_NOT_CONFIGURED", "LLM_MODEL_UNAVAILABLE", "LLM_RESPONSE_INVALID"])
def test_model_failure_falls_back_without_plan(context, code):
    app, client, mock, run_id = context
    mock.side_effect = LLMError(code)
    response = recognize(client, run_id)
    assert response.status_code == 200
    assert response.json()["mode"] == "fallback"
    assert response.json()["reason"] == code
    recognize(client, run_id)
    assert mock.await_count == 1
    with app.state.session_factory() as db:
        assert "agent_tasks" not in db.scalar(select(AgentMessage)).metadata_json


def test_unauthorized_reference_is_refused_instead_of_fallback(context):
    app, client, mock, run_id = context
    value = decision()
    value.value.tasks[0].context_refs[0].id = "2"
    mock.return_value = value
    response = recognize(client, run_id)
    assert response.status_code == 409
    assert response.json()["error"] == "AGENT_TASK_CONTEXT_NOT_AUTHORIZED"
    with app.state.session_factory() as db:
        assert "agent_tasks" not in db.scalar(select(AgentMessage)).metadata_json


@pytest.mark.parametrize("mode,purposes", [("conversation", []), ("clarify", ["edit_scope"])])
def test_nonplan_decision_is_replayed_without_business_tasks(context, mode, purposes):
    app, client, mock, run_id = context
    mock.return_value = decision(mode, clarification_purposes=purposes)
    assert recognize(client, run_id).json()["mode"] == mode
    assert recognize(client, run_id).json()["mode"] == mode
    assert mock.await_count == 1
    with app.state.session_factory() as db:
        assert "agent_tasks" not in db.scalar(select(AgentMessage)).metadata_json


def test_known_resume_identity_cannot_be_asked_again(context):
    _, client, mock, run_id = context
    mock.return_value = decision("clarify", clarification_purposes=["resume_identity"])
    assert recognize(client, run_id).json()["mode"] == "fallback"


def test_timeout_cancels_provider_before_fallback(context, monkeypatch):
    _, client, mock, run_id = context
    monkeypatch.setattr("linkresume.modules.agent.intent.INTENT_TIMEOUT_SECONDS", 0.02)
    cancelled = []
    async def slow(**kwargs):
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
    mock.side_effect = slow
    response = recognize(client, run_id)
    assert response.json()["reason"] == "INTENT_TIMEOUT"
    assert cancelled == [True]


def test_internal_token_and_active_run_required(context):
    app, client, mock, run_id = context
    path = f"/internal/agent/runs/{run_id}/intent:recognize"
    assert client.post(path).status_code == 401
    with app.state.session_factory() as db:
        db.scalar(select(AgentRun)).status = "cancelled"
        db.commit()
    assert recognize(client, run_id).status_code == 409
    mock.assert_not_awaited()


def test_cancellation_during_recognition_never_saves_fallback(context):
    app, _, mock, run_id = context
    cancelled = []
    async def slow(**kwargs):
        with app.state.session_factory() as db:
            db.scalar(select(AgentRun)).status = "cancelled"
            db.commit()
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
    async def receive():
        await asyncio.sleep(20)
        return {"type": "http.disconnect"}
    mock.side_effect = slow
    async def exercise():
        with app.state.session_factory() as db:
            await recognize_run_intent(SimpleNamespace(app=app, receive=receive), db, run_id)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(exercise())
    assert cancelled == [True]
    with app.state.session_factory() as db:
        metadata = db.scalar(select(AgentMessage)).metadata_json
        assert "agent_intent" not in metadata and "agent_tasks" not in metadata


def test_concurrent_requests_share_one_saved_decision(context):
    app, _, mock, run_id = context
    async def slow(**kwargs):
        await asyncio.sleep(0.02)
        return decision()
    async def receive():
        await asyncio.sleep(20)
        return {"type": "http.disconnect"}
    mock.side_effect = slow
    async def one():
        with app.state.session_factory() as db:
            return await recognize_run_intent(SimpleNamespace(app=app, receive=receive), db, run_id)
    async def exercise():
        return await asyncio.gather(one(), one())
    first, second = asyncio.run(exercise())
    assert first["tasks"] == second["tasks"]
    assert mock.await_count == 1


def test_pi_disconnect_cancels_recognition_without_fallback(context):
    app, _, mock, run_id = context
    cancelled = []
    async def slow(**kwargs):
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
    async def receive():
        await asyncio.sleep(0.02)
        return {"type": "http.disconnect"}
    mock.side_effect = slow
    async def exercise():
        with app.state.session_factory() as db:
            await recognize_run_intent(SimpleNamespace(app=app, receive=receive), db, run_id)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(exercise())
    assert cancelled == [True]
    with app.state.session_factory() as db:
        assert "agent_intent" not in db.scalar(select(AgentMessage)).metadata_json
