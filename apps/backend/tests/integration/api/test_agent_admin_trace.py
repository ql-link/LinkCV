from uuid import uuid4
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from linkresume.modules.agent.models import AgentRun, AgentSession
from linkresume.modules.agent.trace import begin_operation, finish_preflight
from linkresume.modules.identity.models import User
from sqlalchemy import select
from tests.integration.api.test_admin_users import build_app, promote_admin, register


def test_admin_trace_exposes_user_and_stage_without_message_content() -> None:
    app, _ = build_app()
    with TestClient(app) as client:
        assert client.get("/api/admin/agent-operations").status_code == 401
        register(client, "trace-admin@example.invalid")
        assert client.get("/api/admin/agent-operations").status_code == 403
        promote_admin(app, "trace-admin@example.invalid")
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == "trace-admin@example.invalid"))
            assert user is not None
            session = AgentSession(public_id=str(uuid4()), user_id=user.id, title="示例", status="active")
            db.add(session)
            db.commit()
            operation_id = str(uuid4())
            operation = begin_operation(db, public_id=operation_id, session_id=session.id, request_id="test-request")
            finish_preflight(db, operation, request_id="test-request", error_code="AGENT_CONTEXT_PREFLIGHT_FAILED")
            user_id = user.id

        listing = client.get("/api/admin/agent-operations")
        assert listing.status_code == 200
        assert listing.json()["items"][0]["user_id"] == str(user_id)
        detail = client.get(f"/api/admin/agent-operations/{operation_id}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["timeline_status"] == "complete"
        assert [event["result"] for event in body["events"]] == ["started", "failed"]
        assert "示例" not in str(body)


def test_admin_trace_keeps_model_name_after_config_is_unavailable() -> None:
    app, _ = build_app()
    with TestClient(app) as client:
        register(client, "model-trace-admin@example.invalid")
        promote_admin(app, "model-trace-admin@example.invalid")
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == "model-trace-admin@example.invalid"))
            assert user is not None
            session = AgentSession(public_id=str(uuid4()), user_id=user.id, title="示例", status="active")
            db.add(session)
            db.flush()
            run = AgentRun(
                public_id=str(uuid4()), session_id=session.id,
                idempotency_key=uuid4().hex, status="succeeded",
                model_config_id=999, model_config_version=2,
                model_name="openrouter/example/model-1",
                started_at=datetime.now(UTC),
            )
            db.add(run)
            db.commit()
            operation_id = run.public_id

        listing = client.get("/api/admin/agent-operations")
        assert listing.status_code == 200
        assert listing.json()["items"][0]["model_name"] == "openrouter/example/model-1"
        detail = client.get(f"/api/admin/agent-operations/{operation_id}")
        assert detail.status_code == 200
        assert detail.json()["model_name"] == "openrouter/example/model-1"
