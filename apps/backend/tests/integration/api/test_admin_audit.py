"""Admin write operations produce business audit events with stable targets."""

from __future__ import annotations

import re
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import update

from linkresume.core.config import Settings
from linkresume.main import create_app
from linkresume.modules.identity.models import User
from linkresume.modules.llm.gateway import GatewayResult, GatewayUsage
from linkresume.modules.observability.audit import AUDIT_ACTIONS
from tests.fakes import FakeRedis
from tests.plugin_release_fakes import FakePluginStorage, build_plugin_zip


class CapturingEmitter:
    def __init__(self) -> None:
        self.audit_events: list[dict[str, object]] = []

    def system(self, level: str, message: str, **fields: object) -> bool:
        return True

    def audit(self, **fields: object) -> tuple[bool, str]:
        event_id = uuid4().hex
        self.audit_events.append({"event_id": event_id, **fields})
        return True, event_id

    def emit(self, **fields: object) -> tuple[bool, dict[str, object]]:
        return True, {"event_id": uuid4().hex, **fields}


class FakeGateway:
    async def complete(self, **kwargs):
        return GatewayResult(content="OK", usage=GatewayUsage(10, 2))


def build_app():
    emitter = CapturingEmitter()
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="admin-audit-test-secret-with-32-bytes",
            llm_credential_encryption_keys=f"test:{Fernet.generate_key().decode('ascii')}",
        ),
        storage=FakePluginStorage(),
        redis=FakeRedis(),
        llm_gateway=FakeGateway(),
        event_emitter=emitter,
        create_schema=True,
    )
    return app, emitter


def admin_client(app) -> TestClient:
    client = TestClient(app)
    client.__enter__()
    response = client.post(
        "/api/auth/register",
        json={"email": "admin@example.test", "password": "password-123"},
    )
    assert response.status_code == 201
    with app.state.session_factory() as db:
        db.execute(
            update(User).where(User.id == int(response.json()["user"]["id"])).values(is_admin=True)
        )
        db.commit()
    return client


def admin_events(emitter: CapturingEmitter) -> list[tuple[str, str, str | None, str]]:
    return [
        (event["action"], event["target_type"], event["target_id"], event["result"])
        for event in emitter.audit_events
        if str(event["action"]).startswith("admin.")
    ]


def test_every_registered_audit_route_exists() -> None:
    # Guards against the registry drifting after a route is renamed or removed:
    # the middleware only audits requests whose matched route is in the registry.
    app, emitter = build_app()
    with TestClient(app) as client:
        for method, template in AUDIT_ACTIONS:
            path = re.sub(r"\{[^}]+\}", "1", template)
            client.request(method, path)
    audited = {(event["http_method"], event["http_route"]) for event in emitter.audit_events}
    assert sorted(set(AUDIT_ACTIONS) - audited) == []


def test_llm_configuration_writes_are_audited() -> None:
    app, emitter = build_app()
    client = admin_client(app)
    connection = client.post(
        "/api/admin/llm/connections",
        json={"providerCode": "aihubmix", "name": "主连接", "apiKey": "fictional-key",
              "settings": {}, "enabled": True},
    ).json()["connection"]["id"]
    client.patch(f"/api/admin/llm/connections/{connection}", json={"name": "备用连接", "baseVersion": 1})
    model = client.post("/api/admin/llm/models", json={"displayName": "示例模型"}).json()["model"]["id"]
    client.patch(f"/api/admin/llm/models/{model}", json={"displayName": "示例模型 2"})
    route = client.post(
        "/api/admin/llm/routes",
        json={"modelId": int(model), "connectionId": int(connection), "targetKind": "model",
              "invokeTarget": "vendor/model"},
    ).json()["route"]["id"]
    client.patch(f"/api/admin/llm/routes/{route}", json={"identifierKind": "pinned"})
    path = f"/api/admin/llm/use-cases/job_text_extraction/routes/{route}"
    client.put(path, json={"useCase": "job_text_extraction", "routeId": int(route),
                           "protocolCode": "openai_chat", "priority": 100})
    assert client.patch(path, json={"enabled": True}).status_code == 422
    assert client.post(f"{path}/probe").status_code == 200
    client.patch(path, json={"priority": 50})
    assert client.delete(path).status_code == 204

    binding = f"job_text_extraction:{route}"
    assert admin_events(emitter) == [
        ("admin.llm_connection_create", "llm_connection", connection, "succeeded"),
        ("admin.llm_connection_update", "llm_connection", connection, "succeeded"),
        ("admin.llm_model_create", "llm_model", model, "succeeded"),
        ("admin.llm_model_update", "llm_model", model, "succeeded"),
        ("admin.llm_route_create", "llm_route", route, "succeeded"),
        ("admin.llm_route_update", "llm_route", route, "succeeded"),
        ("admin.llm_binding_upsert", "llm_binding", binding, "succeeded"),
        ("admin.llm_binding_update", "llm_binding", binding, "failed"),
        ("admin.llm_binding_probe", "llm_binding", binding, "succeeded"),
        ("admin.llm_binding_update", "llm_binding", binding, "succeeded"),
        ("admin.llm_binding_delete", "llm_binding", binding, "succeeded"),
    ]


def test_plugin_release_writes_are_audited_with_version() -> None:
    app, emitter = build_app()
    client = admin_client(app)
    published = client.post(
        "/api/admin/plugin-releases",
        files={"file": ("plugin.zip", build_plugin_zip(), "application/zip")},
    )
    assert published.status_code == 201
    version = published.json()["release"]["version"]
    assert client.delete("/api/admin/plugin-releases/current").status_code == 200
    assert client.post("/api/admin/plugin-releases/current/publish").status_code == 200
    assert client.delete("/api/admin/plugin-releases/current/package").status_code == 200
    assert client.delete("/api/admin/plugin-releases/current").status_code == 404

    assert admin_events(emitter) == [
        ("admin.plugin_release_publish", "plugin_release", version, "succeeded"),
        ("admin.plugin_release_unpublish", "plugin_release", version, "succeeded"),
        ("admin.plugin_release_reactivate", "plugin_release", version, "succeeded"),
        ("admin.plugin_release_delete", "plugin_release", version, "succeeded"),
        ("admin.plugin_release_unpublish", "plugin_release", None, "failed"),
    ]
