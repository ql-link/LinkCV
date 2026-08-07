from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.observability.loki import LokiUnavailableError
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass

    def delete(self, _object_name: str) -> None:
        pass

    def delete_prefix(self, _prefix: str) -> None:
        pass


class CapturingEmitter:
    def __init__(self) -> None:
        self.system_events: list[dict[str, object]] = []
        self.audit_events: list[dict[str, object]] = []
        self.raise_audit = False

    def system(self, level: str, message: str, **fields: object) -> bool:
        self.system_events.append({"level": level, "message": message, **fields})
        return True

    def audit(self, **fields: object) -> tuple[bool, str]:
        if self.raise_audit:
            raise OSError("audit sink unavailable")
        event_id = uuid4().hex
        self.audit_events.append({"event_id": event_id, **fields})
        return True, event_id

    def emit(self, **fields: object) -> tuple[bool, dict[str, object]]:
        event = {"event_id": uuid4().hex, **fields}
        self.system_events.append(event)
        return True, event


class FakeLoki:
    def __init__(self) -> None:
        self.log_queries: list[dict[str, object]] = []
        self.summary_queries: list[dict[str, object]] = []
        self.unavailable = False

    def close(self) -> None:
        pass

    def query_logs(self, **query: object) -> dict[str, object]:
        self.log_queries.append(query)
        if self.unavailable:
            raise LokiUnavailableError("unavailable")
        log_type = str(query["log_type"])
        now_ns = str(int(datetime.now(UTC).timestamp() * 1_000_000_000))
        return {
            "items": [
                {
                    "timestamp_ns": now_ns,
                    "timestamp": "2026-08-07T00:00:00Z",
                    "event_id": uuid4().hex,
                    "event_version": 1,
                    "log_type": log_type,
                    "level": "INFO",
                    "service": "linkcv",
                    "environment": "test",
                    "source": "backend",
                    "logger": "linkcv.test",
                    "message": "test event",
                }
            ],
            "next_cursor": None,
            "partial": False,
            "dropped_malformed": 0,
        }

    def query_summary(self, **query: object) -> dict[str, object]:
        self.summary_queries.append(query)
        return {
            "system": {"total": 3, "warnings": 1, "errors": 1},
            "audit": {"total": 2, "succeeded": 1, "failed": 1},
        }


def build_app():
    emitter = CapturingEmitter()
    loki = FakeLoki()
    app = create_app(
        Settings(
            app_environment="test",
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="observability-test-secret-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        event_emitter=emitter,
        loki_client=loki,
        create_schema=True,
    )
    return app, emitter, loki


def register(client: TestClient, email: str = "observer@example.test") -> int:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201
    return int(response.json()["user"]["id"])


def set_admin(app, user_id: int) -> None:
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.id == user_id))
        assert user is not None
        user.is_admin = True
        db.commit()


def test_request_id_and_business_audit_are_recorded_once() -> None:
    app, emitter, _loki = build_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/register",
            headers={"X-Request-ID": "client_request_42"},
            json={"email": "audit@example.test", "password": "password-123"},
        )
        assert response.status_code == 201
        assert response.headers["X-Request-ID"] == "client_request_42"
        assert response.headers["X-Audit-Recorded"] == "true"

        register_audits = [
            event for event in emitter.audit_events if event["action"] == "auth.register"
        ]
        assert len(register_audits) == 1
        assert register_audits[0]["result"] == "succeeded"
        assert register_audits[0]["actor_type"] == "user"
        assert register_audits[0]["target_id"] is not None

        before = len(emitter.audit_events)
        assert client.get("/api/resumes").status_code == 200
        assert len(emitter.audit_events) == before

        created = client.post("/api/resumes", json={})
        resume_id = created.json()["resume"]["id"]
        failed = client.put(
            f"/api/resumes/{resume_id}",
            json={"title": "冲突保存", "base_lock_version": 999},
        )
        assert failed.status_code == 409
        assert failed.headers["X-Audit-Recorded"] == "true"
        update_audit = emitter.audit_events[-1]
        assert update_audit["action"] == "resume.update"
        assert update_audit["result"] == "failed"
        assert update_audit["error_code"] == "RESUME_EDIT_CONFLICT"


def test_client_error_and_pdf_export_audit_require_auth_and_owned_resume() -> None:
    app, emitter, _loki = build_app()
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/observability/client-events",
                json={
                    "event_type": "render_error",
                    "error_name": "Error",
                    "message": "render failed",
                },
            ).status_code
            == 401
        )
        user_id = register(client)
        created = client.post("/api/resumes", json={})
        resume_id = created.json()["resume"]["id"]

        logged = client.post(
            "/api/observability/client-events",
            json={
                "event_type": "api_5xx",
                "error_name": "ApiRequestError",
                "message": "upstream failed",
                "request_id": "original_request_9",
            },
        )
        assert logged.status_code == 202
        assert any(
            event.get("source") == "web"
            and event.get("request_id") == "original_request_9"
            and event.get("actor_user_id") == user_id
            for event in emitter.system_events
        )

        exported = client.post(
            "/api/audit/events",
            json={
                "action": "resume.pdf_export",
                "target_type": "resume",
                "target_id": str(resume_id),
                "result": "succeeded",
            },
        )
        assert exported.status_code == 202
        assert emitter.audit_events[-1]["action"] == "resume.pdf_export"
        assert emitter.audit_events[-1]["target_id"] == str(resume_id)

        missing = client.post(
            "/api/audit/events",
            json={
                "action": "resume.pdf_export",
                "target_type": "resume",
                "target_id": "999999",
                "result": "failed",
                "error_code": "PDF_EXPORT_FAILED",
            },
        )
        assert missing.status_code == 404


def test_audit_sink_failure_does_not_replace_business_response() -> None:
    app, emitter, _loki = build_app()
    emitter.raise_audit = True
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/register",
            json={"email": "sink-failure@example.test", "password": "password-123"},
        )

        assert response.status_code == 201
        assert response.json()["user"]["id"] == "1"
        assert response.headers["X-Audit-Recorded"] == "false"


def test_admin_log_queries_are_bounded_and_forward_only_allowlisted_filters() -> None:
    app, _emitter, loki = build_app()
    with TestClient(app) as client:
        user_id = register(client)
        query_count = len(loki.log_queries)
        assert client.get("/api/admin/logs/system").status_code == 403
        assert len(loki.log_queries) == query_count
        set_admin(app, user_id)

        end = datetime.now(UTC)
        start = end - timedelta(hours=2)
        response = client.get(
            "/api/admin/logs/system",
            params={
                "from": start.isoformat(),
                "to": end.isoformat(),
                "level": "ERROR",
                "dependency": "linkparse",
                "requestId": "request_1",
            },
        )
        assert response.status_code == 200
        assert response.json()["items"][0]["logType"] == "system"
        assert loki.log_queries[-1]["filters"] == {
            "level": "ERROR",
            "dependency": "linkparse",
            "request_id": "request_1",
        }

        too_wide = client.get(
            "/api/admin/logs/audit",
            params={
                "from": (end - timedelta(days=8)).isoformat(),
                "to": end.isoformat(),
            },
        )
        assert too_wide.status_code == 400
        assert too_wide.json() == {"error": "INVALID_AUDIT_LOG_QUERY"}

        summary = client.get("/api/admin/logs/summary")
        assert summary.status_code == 200
        assert summary.json()["system"]["errors"] == 1

        loki.unavailable = True
        unavailable = client.get("/api/admin/logs/system")
        assert unavailable.status_code == 503
        assert unavailable.json() == {"error": "LOG_QUERY_UNAVAILABLE"}
