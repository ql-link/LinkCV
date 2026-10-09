from datetime import datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select

from tests.integration.api.test_llm_admin import build_app, register_admin
from linkresume.modules.llm.models import LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection


def seed(app):
    with app.state.session_factory() as db:
        connection = LLMProviderConnection(provider_code="aihubmix", name="虚构接入")
        model = LLMModel(display_name="测试模型")
        db.add_all([connection, model]); db.flush()
        route = LLMModelRoute(connection_id=connection.id, model_id=model.id, target_kind="model", invoke_target="fixture", origin="manual",
            pricing_json={"currency": "USD", "input_per_million": "1", "output_per_million": "2"})
        db.add(route); db.flush()
        call = LLMCallLog(call_id="fixture-call", use_case="assistant_conversation", source="pi_agent", route_id=route.id,
            runtime_config_version=1, protocol_code="openai_chat", selection_source="default", status="succeeded",
            input_tokens=1000000, output_tokens=1000000, usage_json={"cacheRead": 0, "cacheWrite": 0},
            price_snapshot_json=route.pricing_json, request_started_at=datetime(2026, 10, 6, tzinfo=timezone.utc),
            time_basis="explicit_utc", upstream_request_id="fixture-request")
        db.add(call); db.commit()
        return connection.id


def test_preview_apply_idempotency_stale_and_reconcile_separate_amounts():
    app, _ = build_app()
    with TestClient(app) as client:
        assert client.post("/api/admin/llm/cost-backfills/preview", json={}).status_code == 401
        register_admin(app, client)
        connection_id = seed(app)
        body = {"connectionId": connection_id, "from": "2026-10-06T00:00:00Z", "to": "2026-10-07T00:00:00Z", "idempotencyKey": "fixture-preview"}
        response = client.post("/api/admin/llm/cost-backfills/preview", json=body)
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview["summary"]["applicable"] == 1
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMCallLog)).estimated_cost is None
        assert client.post("/api/admin/llm/cost-backfills/preview", json=body).json()["operationId"] == preview["operationId"]
        path = f'/api/admin/llm/cost-operations/{preview["operationId"]}/apply'
        assert client.post(path, json={"expectedDigest": "0" * 64}).status_code == 409
        applied = client.post(path, json={"expectedDigest": preview["digest"]})
        assert applied.status_code == 200, applied.text
        assert applied.json()["state"] == "completed"
        assert client.post(path, json={"expectedDigest": preview["digest"]}).status_code == 200
        csv = "recordId,requestId,amount,currency\nfixture-record,fixture-request,2.5,USD\n"
        statement = client.post("/api/admin/llm/cost-statements/preview", json={"connectionId": connection_id, "idempotencyKey": "statement", "csvContent": csv})
        assert statement.status_code == 200, statement.text
        data = statement.json()
        assert client.post(f'/api/admin/llm/cost-operations/{data["operationId"]}/apply', json={"expectedDigest": data["digest"]}).status_code == 200
        with app.state.session_factory() as db:
            call = db.scalar(select(LLMCallLog))
            assert call.estimated_cost == Decimal(3) and call.settled_cost == Decimal("2.5")
        totals = client.get("/api/admin/insights/llm-usage?from=2026-10-06T00:00:00Z&to=2026-10-07T00:00:00Z").json()["summary"]
        assert Decimal(totals["costs"][0]["amount"]) == 3
        assert Decimal(totals["accountedCosts"][0]["amount"]) == Decimal("2.5")
        duplicate = client.post("/api/admin/llm/cost-statements/preview", json={"connectionId": connection_id, "idempotencyKey": "statement2", "csvContent": csv})
        assert duplicate.json()["summary"]["reasons"] == {"already_reconciled": 1}


def test_stale_preview_never_overwrites_changed_call():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        connection_id = seed(app)
        preview = client.post("/api/admin/llm/cost-backfills/preview", json={"connectionId": connection_id,
            "from": "2026-10-06T00:00:00Z", "to": "2026-10-07T00:00:00Z", "idempotencyKey": "stale"}).json()
        with app.state.session_factory() as db:
            db.scalar(select(LLMCallLog)).output_tokens = 42
            db.commit()
        result = client.post(f'/api/admin/llm/cost-operations/{preview["operationId"]}/apply', json={"expectedDigest": preview["digest"]}).json()
        assert result["state"] == "partial_failed"
        assert result["items"][0]["reason"] == "call_changed_since_preview"
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMCallLog)).estimated_cost is None


def test_verified_legacy_time_can_be_applied_without_inventing_missing_usage():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        connection_id = seed(app)
        with app.state.session_factory() as db:
            call = db.scalar(select(LLMCallLog))
            call.request_started_at = None
            call.time_basis = None
            call.create_time = datetime(2026, 10, 6, 8)
            call.output_tokens = None
            db.commit()
        payload = {"connectionId": connection_id, "from": "2026-10-06T00:00:00Z", "to": "2026-10-07T00:00:00Z", "idempotencyKey": "legacy", "legacyTimezone": "Asia/Shanghai"}
        preview = client.post("/api/admin/llm/cost-backfills/preview", json=payload).json()
        assert preview["summary"]["applicable"] == 0 and preview["summary"]["remaining"] == 1
        client.post(f'/api/admin/llm/cost-operations/{preview["operationId"]}/apply', json={"expectedDigest": preview["digest"]})
        with app.state.session_factory() as db:
            call = db.scalar(select(LLMCallLog))
            assert call.create_time.hour == 8 and call.request_started_at.hour == 0
            assert call.estimated_cost is None and call.cost_reason == "usage_missing"


def test_verified_time_correction_preserves_existing_historical_amount():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        connection_id = seed(app)
        with app.state.session_factory() as db:
            call = db.scalar(select(LLMCallLog))
            call.request_started_at = None
            call.create_time = datetime(2026, 10, 6, 8)
            call.estimated_cost, call.cost_currency = Decimal("4.5"), "USD"
            db.commit()
        preview = client.post("/api/admin/llm/cost-backfills/preview", json={"connectionId": connection_id,
            "from": "2026-10-06T00:00:00Z", "to": "2026-10-07T00:00:00Z", "idempotencyKey": "known-time",
            "legacyTimezone": "Asia/Shanghai"}).json()
        assert preview["items"][0]["source"] == "verified_legacy_time"
        client.post(f'/api/admin/llm/cost-operations/{preview["operationId"]}/apply', json={"expectedDigest": preview["digest"]})
        with app.state.session_factory() as db:
            call = db.scalar(select(LLMCallLog))
            assert call.estimated_cost == Decimal("4.5") and call.request_started_at.hour == 0
            assert call.create_time.hour == 8


def test_statement_rejects_refunds_and_never_matches_similar_request_ids():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        connection_id = seed(app)
        for amount, status in (("-1", 422), ("NaN", 422), ("Infinity", 422)):
            response = client.post("/api/admin/llm/cost-statements/preview", json={"connectionId": connection_id,
                "idempotencyKey": "invalid", "csvContent": f"recordId,requestId,amount,currency\nr,fixture-request,{amount},USD\n"})
            assert response.status_code == status
        response = client.post("/api/admin/llm/cost-statements/preview", json={"connectionId": connection_id,
            "idempotencyKey": "mismatch", "csvContent": "recordId,requestId,amount,currency\nr,Fixture-request,1,USD\n"})
        assert response.json()["summary"]["reasons"] == {"request_not_found": 1}
