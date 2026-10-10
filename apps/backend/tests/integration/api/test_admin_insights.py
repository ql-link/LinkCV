"""Admin insight endpoints aggregate existing records without writing anything."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from drawoffer.core.config import Settings
from drawoffer.main import create_app
from drawoffer.modules.agent.models import AgentOperation, AgentRun, AgentSession
from drawoffer.modules.identity.models import User
from drawoffer.modules.job_descriptions.models import JobDescription
from drawoffer.modules.llm.models import (
    LLMCallLog,
    LLMModel,
    LLMModelRoute,
    LLMProviderConnection,
    LLMUseCaseRoute,
)
from drawoffer.modules.llm.resolver import validation_fingerprint
from drawoffer.modules.resumes.models import Resume, ResumeTemplate
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import canonical_template_payload

ENDPOINTS = (
    "/api/admin/insights/overview",
    "/api/admin/insights/users",
    "/api/admin/insights/templates",
    "/api/admin/insights/job-imports",
    "/api/admin/insights/llm-usage",
    "/api/admin/insights/llm-health",
    "/api/admin/insights/agent",
    "/api/admin/insights/log-heatmap",
)


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class FakeLoki:
    def __init__(self) -> None:
        self.unavailable = False
        self.calls: list[dict[str, object]] = []
        self.response: dict[int, dict[str, int]] = {}

    def close(self) -> None:
        pass

    def query_level_buckets(self, **query):
        from drawoffer.modules.observability.loki import LokiUnavailableError

        self.calls.append(query)
        if self.unavailable:
            raise LokiUnavailableError("down")
        return self.response


def build_app(loki: FakeLoki | None = None):
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="admin-insights-test-secret-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        loki_client=loki,
        create_schema=True,
    )
    return app


def admin_client(app) -> TestClient:
    client = TestClient(app)
    client.__enter__()
    response = client.post(
        "/api/auth/register", json={"email": "admin@example.test", "password": "password-123"}
    )
    assert response.status_code == 201
    with app.state.session_factory() as db:
        db.execute(update(User).where(User.email == "admin@example.test").values(is_admin=True))
        db.commit()
    return client


def add_user(db, email: str, *, created_at: datetime, last_login_at=None, status=1) -> User:
    user = User(
        email=email, password_hash="x", nickname="张三", status=status,
        create_time=created_at, last_login_at=last_login_at,
    )
    db.add(user)
    db.flush()
    return user


class LLMFixture:
    def __init__(self, db, now: datetime) -> None:
        self.db = db
        self.now = now
        self.connection = LLMProviderConnection(
            provider_code="openrouter", name="Example Gateway", is_enabled=True,
            credential_ciphertext="ciphertext", runtime_config_version=1,
        )
        self.other = LLMProviderConnection(
            provider_code="deepseek", name="Direct", is_enabled=True,
            credential_ciphertext="ciphertext", runtime_config_version=1,
        )
        db.add_all([self.connection, self.other])
        db.flush()
        self.model = LLMModel(display_name="示例模型 A")
        self.model_b = LLMModel(display_name="示例模型 B")
        db.add_all([self.model, self.model_b])
        db.flush()
        self.route = self._route(self.model, self.connection, "example/a")
        self.route_b = self._route(self.model_b, self.other, "example/b")

    def _route(self, model, connection, target):
        route = LLMModelRoute(
            model_id=model.id, connection_id=connection.id, target_kind="model",
            invoke_target=target, origin="manual", is_enabled=True,
        )
        self.db.add(route)
        self.db.flush()
        return route

    def bind(self, route, connection, *, valid: bool, use_case="assistant_conversation"):
        self.priority = getattr(self, "priority", 0) + 1
        binding = LLMUseCaseRoute(
            use_case=use_case, route_id=route.id, protocol_code="openai_chat",
            priority=self.priority, is_enabled=True,
        )
        self.db.add(binding)
        self.db.flush()
        if valid:
            binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
            binding.validated_at = self.now
        self.db.flush()
        return binding

    def call(self, route, *, status="succeeded", ago=timedelta(minutes=5), latency=100,
             cost: str | None = "0.01", currency="USD", use_case="assistant_conversation",
             user_id=None):
        self.db.add(LLMCallLog(
            call_id=uuid4().hex, use_case=use_case, source="test", user_id=user_id,
            route_id=route.id, runtime_config_version=1, protocol_code="openai_chat",
            selection_source="default", status=status, latency_ms=latency,
            estimated_cost=Decimal(cost) if cost is not None else None,
            cost_currency=currency if cost is not None else None,
            create_time=self.now - ago,
            request_started_at=self.now - ago, time_basis="explicit_utc",
        ))


def test_every_endpoint_requires_an_administrator() -> None:
    app = build_app(FakeLoki())
    with TestClient(app) as anonymous:
        for path in ENDPOINTS:
            assert anonymous.get(path).status_code == 401, path
    user = TestClient(app)
    with user:
        user.post("/api/auth/register", json={"email": "u@example.test", "password": "password-123"})
        for path in ENDPOINTS:
            assert user.get(path).status_code == 403, path


def test_invalid_windows_are_rejected() -> None:
    admin = admin_client(build_app())
    now = datetime.now(UTC)
    for params in (
        {"from": (now - timedelta(days=40)).isoformat(), "to": now.isoformat()},
        {"from": now.isoformat(), "to": (now - timedelta(hours=1)).isoformat()},
        {"from": "2026-09-01T00:00:00", "to": "2026-09-02T00:00:00"},
    ):
        for path in ("/api/admin/insights/llm-usage", "/api/admin/insights/agent"):
            response = admin.get(path, params=params)
            assert response.status_code == 400, (path, params)
            assert response.json()["error"] == "INVALID_ADMIN_INSIGHTS_QUERY"


def test_user_stats_count_active_disabled_and_daily_signups() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        add_user(db, "a@example.test", created_at=now - timedelta(days=2), last_login_at=now)
        add_user(db, "b@example.test", created_at=now - timedelta(days=20), last_login_at=now,
                 status=0)
        add_user(db, "c@example.test", created_at=now - timedelta(days=30))
        db.commit()
    body = admin.get("/api/admin/insights/users").json()
    assert body["total"] == 4
    assert body["disabled"] == 1
    assert body["admins"] == 1
    assert body["newUsers7d"] == 2  # admin + a
    # Only "a" logged in within 7 days and is enabled; the disabled user never counts.
    assert body["activeUsers7d"] == 1
    assert len(body["daily"]) == 14
    assert sum(day["count"] for day in body["daily"]) == 2


def test_template_stats_count_usage_and_pending_review() -> None:
    app = build_app()
    admin = admin_client(app)
    with app.state.session_factory() as db:
        admin_id = db.scalar(select(User.id).where(User.email == "admin@example.test"))
        templates = []
        for key, review in (("alpha", "classified"), ("beta", "unsure"), ("gamma", "pending")):
            data, style = canonical_template_payload(key=key)
            row = ResumeTemplate(key=key, name=key, data_json=data, style_json=style,
                                 is_active=1, style_review_status=review)
            db.add(row)
            templates.append(row)
        db.flush()
        for index in range(3):
            db.add(Resume(user_id=admin_id, title=f"简历 {index}", template_id=templates[1].id,
                          data_json=templates[1].data_json, style_json={}, source_type="template"))
        db.commit()
    body = admin.get("/api/admin/insights/templates", params={"limit": 1}).json()
    assert body["pendingReview"] == 1
    assert body["top"] == [{"templateId": str(templates[1].id), "key": "beta", "name": "beta",
                            "resumeCount": 3}]
    assert body["usedToday"] == 3
    assert {item["key"] for item in body["usage"]} >= {"alpha", "beta", "gamma"}


def test_job_import_stats_only_count_external_imports() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        admin_id = db.scalar(select(User.id).where(User.email == "admin@example.test"))
        other = add_user(db, "importer@example.test", created_at=now)
        for index, (user_id, days, site) in enumerate(
            ((admin_id, 1, "zhipin"), (other.id, 3, "zhipin"), (admin_id, 20, "liepin"))
        ):
            db.add(JobDescription(
                user_id=user_id, company_name="示例公司", job_title=f"岗位 {index}",
                description="示例职责", skills=[],
                source_type="external_import", source_url=f"https://example.test/{index}",
                source_url_hash=uuid4().bytes + uuid4().bytes, source_site=site,
                imported_at=now - timedelta(days=days),
            ))
        db.add(JobDescription(user_id=admin_id, company_name="示例公司", job_title="手工",
                              description="示例职责", skills=[], source_type="manual"))
        db.commit()
    body = admin.get("/api/admin/insights/job-imports").json()
    assert body["imported7d"] == 2
    assert body["imported30d"] == 3
    assert body["users7d"] == 2
    assert body["sources"] == [{"site": "zhipin", "count": 2}, {"site": "liepin", "count": 1}]
    assert len(body["daily"]) == 30


def test_llm_usage_groups_rates_and_costs() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        f = LLMFixture(db, now)
        f.call(f.route, latency=100)
        f.call(f.route, latency=300)
        f.call(f.route, status="failed", latency=900, cost=None)
        f.call(f.route, status="pending", latency=None, cost=None)
        f.call(f.route_b, cost="1.5", currency="CNY", use_case="resume_structuring")
        f.call(f.route, ago=timedelta(hours=30))  # previous window
        db.commit()
        model_a = str(f.model.id)

    body = admin.get("/api/admin/insights/llm-usage").json()
    summary = body["summary"]
    assert summary["calls"] == 5
    assert summary["successRate"] == 0.75  # pending excluded from the denominator
    assert summary["costs"] == [
        {"currency": "CNY", "amount": "1.5000000000"},
        {"currency": "USD", "amount": "0.0200000000"},
    ]
    assert summary["unmeteredCallCount"] == 2
    assert body["previous"]["calls"] == 1

    groups = {group["key"]: group for group in body["groups"]}
    assert groups[model_a]["label"] == "示例模型 A"
    assert groups[model_a]["calls"] == 4
    assert groups[model_a]["p95Ms"] == 300

    by_use_case = admin.get("/api/admin/insights/llm-usage", params={"groupBy": "useCase"}).json()
    assert {g["key"] for g in by_use_case["groups"]} == {"assistant_conversation", "resume_structuring"}
    by_connection = admin.get(
        "/api/admin/insights/llm-usage", params={"groupBy": "connection"}
    ).json()
    assert {g["label"] for g in by_connection["groups"]} == {"Example Gateway", "Direct"}


def test_llm_health_counts_only_valid_bindings() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        f = LLMFixture(db, now)
        f.bind(f.route, f.connection, valid=True)
        f.bind(f.route_b, f.other, valid=False)
        f.call(f.route)
        f.call(f.route, status="failed")
        db.commit()
    body = admin.get("/api/admin/insights/llm-health").json()
    connections = {c["name"]: c for c in body["connections"]}
    assert connections["Example Gateway"]["validBindings"] == 1
    assert connections["Example Gateway"]["calls24h"] == 2
    assert connections["Example Gateway"]["successRate24h"] == 0.5
    assert connections["Direct"]["validBindings"] == 0
    assert connections["Direct"]["successRate24h"] is None
    assert {m["displayName"]: m["routeCount"] for m in body["models"]} == {
        "示例模型 A": 1, "示例模型 B": 1,
    }


def _agent_session(db) -> AgentSession:
    user_id = db.scalar(select(User.id).where(User.email == "admin@example.test"))
    session = AgentSession(public_id=str(uuid4()), user_id=user_id, title="示例", status="active")
    db.add(session)
    db.flush()
    return session


def _operation(db, session, *, ago, state="run_created", run_status=None, stage=None,
               code=None, duration=None, now=None):
    public_id = str(uuid4())
    created = now - ago
    db.add(AgentOperation(public_id=public_id, session_id=session.id, state=state,
                          failure_stage=stage, error_code=code, create_time=created))
    if run_status is not None:
        db.add(AgentRun(
            public_id=public_id, session_id=session.id, idempotency_key=uuid4().hex,
            status=run_status, error_code=code, started_at=created,
            completed_at=created + duration if duration else None, create_time=created,
        ))


def test_agent_stats_match_trace_status_and_rank_failures() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        session = _agent_session(db)
        _operation(db, session, ago=timedelta(hours=2), run_status="succeeded",
                   duration=timedelta(seconds=10), now=now)
        _operation(db, session, ago=timedelta(hours=3), run_status="failed",
                   stage="tool.execute", code="TOOL_TIMEOUT", duration=timedelta(seconds=20), now=now)
        _operation(db, session, ago=timedelta(hours=4), run_status="failed",
                   stage="tool.execute", code="TOOL_TIMEOUT", duration=timedelta(seconds=5), now=now)
        _operation(db, session, ago=timedelta(hours=5), state="failed", stage="preflight",
                   code="AGENT_CONTEXT_PREFLIGHT_FAILED", now=now)
        _operation(db, session, ago=timedelta(minutes=1), run_status="running", now=now)
        _operation(db, session, ago=timedelta(days=9), run_status="failed", now=now)
        db.commit()

    body = admin.get("/api/admin/insights/agent").json()
    assert body["operations"] == 5
    assert body["failed"] == 3
    assert body["failureRate"] == 0.6
    assert body["running"] == 1
    assert body["topFailureStage"] == "tool.execute"
    assert body["topErrorCode"] == "TOOL_TIMEOUT"
    assert body["p95Ms"] == 10000
    assert len(body["daily"]) == 7

    listing = admin.get("/api/admin/agent-operations", params={
        "from": body["from"], "to": body["to"],
    }).json()["items"]
    assert sum(1 for item in listing if item["status"] == "failed") == body["failed"]


def test_overview_metrics_trend_and_alerts() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)

    quiet = admin.get("/api/admin/insights/overview").json()
    assert quiet["alerts"] == []
    assert len(quiet["trend"]) == 14
    assert quiet["deltas"]["callsToday"] is None

    with app.state.session_factory() as db:
        f = LLMFixture(db, now)
        f.bind(f.route, f.connection, valid=False)
        for index in range(20):
            f.call(f.route, status="failed" if index < 2 else "succeeded",
                    ago=timedelta(minutes=10))
        session = _agent_session(db)
        for _ in range(3):
            _operation(db, session, ago=timedelta(minutes=10), run_status="failed",
                       stage="tool.execute", now=now)
        for _ in range(7):
            _operation(db, session, ago=timedelta(minutes=10), run_status="succeeded", now=now)
        data, style = canonical_template_payload(key="review-me")
        db.add(ResumeTemplate(key="review-me", name="待复核", data_json=data, style_json=style,
                              is_active=1, style_review_status="unsure"))
        db.commit()

    body = admin.get("/api/admin/insights/overview").json()
    assert [alert["type"] for alert in body["alerts"]] == [
        "llm_binding_invalid", "agent_failures", "llm_success_rate", "template_review",
    ]
    assert body["alerts"][0]["severity"] == "critical"
    assert body["metrics"]["callsToday"] >= 20 or now.hour == 0
    assert body["metrics"]["cost7d"]["costs"] == [{"currency": "USD", "amount": "0.2000000000"}]
    assert body["trend"][-1]["calls"] == 20 or now.hour == 0
    assert body["trend"][-1]["successRate"] == 0.9 or now.hour == 0


def test_alerts_stay_quiet_below_thresholds() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        f = LLMFixture(db, now)
        f.bind(f.route, f.connection, valid=True)
        for _ in range(19):  # below the minimum call count
            f.call(f.route, status="failed", ago=timedelta(minutes=5))
        session = _agent_session(db)
        for _ in range(2):  # below the minimum failure count
            _operation(db, session, ago=timedelta(minutes=5), run_status="failed", now=now)
        db.commit()
    assert admin.get("/api/admin/insights/overview").json()["alerts"] == []


def test_log_heatmap_returns_56_buckets_and_maps_loki_failure() -> None:
    loki = FakeLoki()
    app = build_app(loki)
    admin = admin_client(app)
    first = admin.get("/api/admin/insights/log-heatmap")
    assert first.status_code == 200
    buckets = first.json()["buckets"]
    assert len(buckets) == 56
    assert all(bucket["error"] == 0 and bucket["warn"] == 0 for bucket in buckets)

    last_end = int(datetime.fromisoformat(buckets[-1]["start"].replace("Z", "+00:00")).timestamp())
    last_end += 3 * 3600
    loki.response = {last_end: {"ERROR": 2, "CRITICAL": 1, "WARNING": 4}}
    body = admin.get("/api/admin/insights/log-heatmap").json()
    assert body["buckets"][-1] == {**body["buckets"][-1], "error": 3, "warn": 4}
    assert loki.calls[-1]["step_seconds"] == 10800

    loki.unavailable = True
    failed = admin.get("/api/admin/insights/log-heatmap")
    assert failed.status_code == 503
    assert failed.json()["error"] == "LOG_QUERY_UNAVAILABLE"
    assert admin.get("/api/admin/insights/users").status_code == 200


def test_llm_call_list_filters_and_summarizes() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        f = LLMFixture(db, now)
        f.call(f.route)
        f.call(f.route, status="failed", cost=None)
        f.call(f.route_b, use_case="resume_structuring")
        f.call(f.route, ago=timedelta(days=3))
        db.add(LLMCallLog(
            call_id=uuid4().hex, use_case="assistant_conversation", source="test",
            route_id=f.route.id, runtime_config_version=1, protocol_code="openai_chat",
            selection_source="default", status="failed", error_code="AUTH_FAILED",
            input_tokens=10, output_tokens=0, create_time=now - timedelta(minutes=1),
            request_started_at=now - timedelta(minutes=1), time_basis="explicit_utc",
        ))
        db.commit()

    everything = admin.get("/api/admin/llm/calls").json()
    assert everything["summary"]["callCount"] == 5

    failed = admin.get("/api/admin/llm/calls", params={"status": "failed"}).json()
    assert failed["summary"]["callCount"] == 2
    assert failed["summary"]["failed"] == 2
    assert {c["status"] for c in failed["calls"]} == {"failed"}

    coded = admin.get("/api/admin/llm/calls", params={"errorCode": "AUTH_FAILED"}).json()
    assert [c["errorCode"] for c in coded["calls"]] == ["AUTH_FAILED"]
    assert coded["summary"]["inputTokens"] == 10

    recent = admin.get("/api/admin/llm/calls", params={
        "useCase": "assistant_conversation",
        "from": (now - timedelta(hours=1)).isoformat(),
        "to": now.isoformat(),
    }).json()
    assert recent["summary"]["callCount"] == 3
    assert recent["summary"]["costs"] == [{"currency": "USD", "amount": "0.0100000000"}]

    page = admin.get("/api/admin/llm/calls", params={"status": "succeeded", "limit": 1}).json()
    assert len(page["calls"]) == 1 and page["nextCursor"]
    rest = admin.get("/api/admin/llm/calls", params={
        "status": "succeeded", "limit": 1, "cursor": page["nextCursor"],
    }).json()
    assert rest["calls"][0]["id"] != page["calls"][0]["id"]

    assert admin.get("/api/admin/llm/calls", params={"useCase": "nope"}).status_code == 422
    assert admin.get("/api/admin/llm/calls", params={"status": "nope"}).status_code in (400, 422)


def test_user_detail_and_legacy_stats_report_real_llm_usage() -> None:
    app = build_app()
    admin = admin_client(app)
    now = datetime.now(UTC)
    with app.state.session_factory() as db:
        target = add_user(db, "target@example.test", created_at=now)
        f = LLMFixture(db, now)
        f.call(f.route, user_id=target.id, cost="0.25")
        f.call(f.route, user_id=target.id, cost=None)
        f.call(f.route, cost="0.5")
        db.commit()
        target_id = target.id

    detail = admin.get(f"/api/auth/admin/users/{target_id}").json()
    assert detail["llm_call_count"] == 2
    assert {key: detail["llm_costs"][key] for key in ("costs", "unmeteredCallCount")} == {
        "costs": [{"currency": "USD", "amount": "0.2500000000"}],
        "unmeteredCallCount": 1,
    }
    stats = admin.get("/api/auth/admin/stats").json()
    assert stats["llm_calls_today"] == 3 or now.hour == 0
    assert stats["estimated_cost_month"] == "$0.75" or now.day == 1 and now.hour == 0
