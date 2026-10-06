"""Product funnel events: write points, failure isolation and the admin funnel (LOCAL-20260929-GTM-PLAN)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from linkresume.modules.identity.models import User
from linkresume.modules.product_events import service as product_events
from linkresume.modules.product_events.models import ProductEvent
from linkresume.modules.product_events.service import build_event
from tests.integration.api.test_resume_pdf import build_app

FUNNEL = "/api/admin/insights/funnel"


def register(client: TestClient, email: str) -> int:
    response = client.post("/api/auth/register", json={"email": email, "password": "password-123"})
    assert response.status_code == 201
    return int(response.json()["user"]["id"])


def events(app, name: str | None = None) -> list[ProductEvent]:
    with app.state.session_factory() as db:
        query = select(ProductEvent).order_by(ProductEvent.id)
        if name:
            query = query.where(ProductEvent.event_name == name)
        return list(db.scalars(query))


def test_email_registration_and_template_resume_are_recorded() -> None:
    app = build_app()
    with TestClient(app) as client:
        user_id = register(client, "events-owner@example.test")
        assert client.post(
            "/api/resumes", json={"title": "测试简历", "template_id": app.state.test_template_id}
        ).status_code == 201
        # A failed registration (duplicate email) writes nothing.
        assert client.post(
            "/api/auth/register", json={"email": "events-owner@example.test", "password": "password-123"}
        ).status_code == 409

    recorded = events(app)
    assert [(e.event_name, e.user_id, e.dedupe_key) for e in recorded] == [
        ("user_registered", user_id, f"reg:{user_id}"),
        ("resume_created", user_id, f"resume:{recorded[1].properties_json['resume_id']}"),
    ]
    assert recorded[0].properties_json == {"method": "email"}
    assert recorded[1].properties_json["source"] == "template"


def test_pdf_export_records_every_success_and_survives_event_failure(monkeypatch) -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "events-pdf@example.test")
        resume = client.post(
            "/api/resumes", json={"title": "测试简历", "template_id": app.state.test_template_id}
        ).json()["resume"]
        url = f"/api/resumes/{resume['id']}/pdf"
        params = {"lock_version": resume["lock_version"]}
        assert client.get(url, params=params).status_code == 200
        assert client.get(url, params=params).status_code == 200
        # A stale export fails and records nothing.
        assert client.get(url, params={"lock_version": 99}).status_code == 409
        assert [e.properties_json["channel"] for e in events(app, "resume_pdf_exported")] == ["web", "web"]

        def broken(**_kwargs):
            raise RuntimeError("event store down")

        monkeypatch.setattr(product_events, "build_event", broken)
        response = client.get(url, params=params)
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")
    assert len(events(app, "resume_pdf_exported")) == 2


def test_confirm_rejects_unknown_entry() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "events-entry@example.test")
        response = client.post("/api/agent/proposals/unknown-proposal/confirm", json={"entry": "sidebar"})
        assert response.status_code == 422


def test_properties_are_whitelisted() -> None:
    with pytest.raises(ValueError, match="unexpected product event properties"):
        build_event(user_id=1, name="user_registered", dedupe_key="reg:1", properties={"email": "a@example.test"})


def seed_funnel(app, now: datetime) -> None:
    """Three users registered in the window, one before it."""
    with app.state.session_factory() as db:
        def user(email: str, created_at: datetime) -> int:
            row = User(email=email, password_hash="x", nickname="张三", create_time=created_at)
            db.add(row)
            db.flush()
            return row.id

        a = user("funnel-a@example.test", now - timedelta(days=2))
        b = user("funnel-b@example.test", now - timedelta(days=1))
        c = user("funnel-c@example.test", now - timedelta(hours=1))
        old = user("funnel-old@example.test", now - timedelta(days=60))

        def add(user_id, name, key, props, at):
            db.add(build_event(user_id=user_id, name=name, dedupe_key=key, properties=props, occurred_at=at))

        for uid, method in ((a, "wechat_qr"), (b, "wechat_qr"), (c, "email"), (old, "email")):
            add(uid, "user_registered", f"reg:{uid}", {"method": method}, now - timedelta(days=3))
        add(a, "resume_created", "resume:1", {"source": "template", "resume_id": 1}, now - timedelta(hours=40))
        add(a, "resume_created", "resume:2", {"source": "copy", "resume_id": 2}, now - timedelta(hours=30))
        # b only has a copy: it does not pass the "has a resume" step.
        add(b, "resume_created", "resume:3", {"source": "copy", "resume_id": 3}, now - timedelta(hours=20))
        add(c, "resume_created", "resume:4", {"source": "import", "resume_id": 4}, now - timedelta(minutes=50))
        add(a, "ai_customization_applied", "ai:1", {"mode": "rewrite", "entry": "editor", "resume_id": 1, "proposal_id": 1}, now - timedelta(hours=35))
        add(a, "ai_customization_applied", "ai:2", {"mode": "rewrite", "entry": "assistant", "resume_id": 1, "proposal_id": 2}, now - timedelta(hours=10))
        add(c, "ai_customization_applied", "ai:3", {"mode": "rewrite", "entry": "unknown", "resume_id": 4, "proposal_id": 3}, now - timedelta(minutes=40))
        add(a, "mock_interview_completed", "interview:1", {"answer_mode": "voice", "interview_id": 1}, now - timedelta(hours=5))
        add(a, "resume_pdf_exported", None, {"channel": "web", "resume_id": 1}, now - timedelta(hours=4))
        add(a, "resume_pdf_exported", None, {"channel": "web", "resume_id": 1}, now - timedelta(hours=3))
        # Events of a user outside the cohort never count.
        add(old, "resume_created", "resume:5", {"source": "template", "resume_id": 5}, now - timedelta(hours=2))
        db.commit()


def admin(app, client: TestClient) -> None:
    register(client, "funnel-admin@example.test")
    with app.state.session_factory() as db:
        db.execute(update(User).where(User.email == "funnel-admin@example.test").values(is_admin=True))
        db.commit()


def test_funnel_counts_cohort_steps_and_first_event_mix() -> None:
    app = build_app()
    now = datetime.now(UTC)
    seed_funnel(app, now)
    with TestClient(app) as client:
        admin(app, client)
        window = {"from": (now - timedelta(days=7)).isoformat(), "to": (now + timedelta(minutes=1)).isoformat()}
        response = client.get(FUNNEL, params=window)
    assert response.status_code == 200, response.text
    body = response.json()
    # The admin registered inside the window too, so the cohort is 4 users.
    assert body["steps"] == [
        {"key": "registered", "users": 4},
        {"key": "resume", "users": 2},
        {"key": "ai_customization", "users": 2},
        {"key": "mock_interview", "users": 1},
        {"key": "pdf_export", "users": 1},
    ]
    assert body["registrationsByMethod"] == {"wechat_qr": 2, "email": 2}
    assert body["aiCustomizationByEntry"] == {"editor": 1, "unknown": 1}
    assert body["resumeBySource"] == {"template": 1, "copy": 1, "import": 1}
    assert len(body["daily"]) == 7
    assert sum(day["registered"] for day in body["daily"]) == 4
    assert body["daily"][-1]["date"] == (now + timedelta(minutes=1)).astimezone(UTC).date().isoformat()


def test_funnel_requires_admin_and_a_valid_window() -> None:
    app = build_app()
    now = datetime.now(UTC)
    with TestClient(app) as client:
        register(client, "funnel-user@example.test")
        assert client.get(FUNNEL).status_code == 403
    with TestClient(app) as client:
        admin(app, client)
        assert client.get(FUNNEL).status_code == 200
        too_long = {"from": (now - timedelta(days=40)).isoformat(), "to": now.isoformat()}
        reversed_ = {"from": now.isoformat(), "to": (now - timedelta(days=1)).isoformat()}
        for params in (too_long, reversed_):
            response = client.get(FUNNEL, params=params)
            assert response.status_code == 400
            assert response.json() == {"error": "INVALID_ADMIN_INSIGHTS_QUERY"}
