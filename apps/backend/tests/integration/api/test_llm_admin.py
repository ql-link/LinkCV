from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.core.config import Settings
from linkresume.main import create_app
from linkresume.modules.identity.models import User
from linkresume.modules.llm.gateway import GatewayResult, GatewayUsage
from linkresume.modules.llm.models import LLMCallLog, LLMProviderConnection
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self):
        pass


class FakeGateway:
    def __init__(self):
        self.calls = []

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        return GatewayResult(content="OK", usage=GatewayUsage(10, 2))


def build_app():
    settings = Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret="integration-test-secret-with-32-bytes", llm_credential_encryption_keys=f"test:{Fernet.generate_key().decode('ascii')}")
    gateway = FakeGateway()
    return create_app(settings, storage=FakeStorage(), redis=FakeRedis(), llm_gateway=gateway, create_schema=True), gateway


def register_admin(app, client):
    assert client.post("/api/auth/register", json={"email": "admin@example.invalid", "password": "password-123"}).status_code == 201
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == "admin@example.invalid"))
        user.is_admin = True
        db.commit()


def test_admin_only_route_configuration_and_probe():
    app, gateway = build_app()
    with TestClient(app) as client:
        assert client.get("/api/admin/llm/catalog").status_code == 401
        register_admin(app, client)
        catalog = client.get("/api/admin/llm/catalog")
        assert catalog.status_code == 200
        assert "assistant_conversation" in catalog.json()["useCases"]
        connection = client.post("/api/admin/llm/connections", json={"providerCode": "aihubmix", "name": "主连接", "apiKey": "fictional-key", "settings": {}, "enabled": True})
        assert connection.status_code == 201, connection.text
        connection_id = connection.json()["connection"]["id"]
        model = client.post("/api/admin/llm/models", json={"displayName": "示例模型"})
        assert model.status_code == 201, model.text
        model_id = model.json()["model"]["id"]
        route = client.post("/api/admin/llm/routes", json={"modelId": int(model_id), "connectionId": int(connection_id), "targetKind": "model", "invokeTarget": "vendor/model"})
        assert route.status_code == 201, route.text
        route_id = route.json()["route"]["id"]
        path = f"/api/admin/llm/use-cases/job_text_extraction/routes/{route_id}"
        bind = client.put(path, json={"useCase": "job_text_extraction", "routeId": int(route_id), "protocolCode": "openai_chat", "priority": 100})
        assert bind.status_code == 200, bind.text
        assert client.patch(path, json={"enabled": True}).status_code == 422
        probe = client.post(f"{path}/probe")
        assert probe.status_code == 200, probe.text
        assert gateway.calls[0]["model"] == "vendor/model"
        assert client.patch(f"/api/admin/llm/routes/{route_id}", json={"enabled": True}).status_code == 200
        enabled = client.patch(path, json={"enabled": True})
        assert enabled.status_code == 200 and enabled.json()["binding"]["effective"] is True
        reordered = client.patch(path, json={"priority": 50})
        assert reordered.status_code == 200
        assert reordered.json()["binding"]["priority"] == 50
        assert reordered.json()["binding"]["effective"] is True
        calls = client.get("/api/admin/llm/calls")
        assert calls.status_code == 200
        assert calls.json()["calls"][0]["source"] == "capability_probe"
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMCallLog)).route_id == int(route_id)


def test_connection_does_not_accept_arbitrary_url():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        response = client.post("/api/admin/llm/connections", json={"providerCode": "aihubmix", "name": "bad", "apiKey": "fictional", "settings": {"base_url": "http://127.0.0.1"}})
        assert response.status_code == 422


def test_switching_aihubmix_endpoint_invalidates_catalog_and_probe_version():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        response = client.post("/api/admin/llm/connections", json={
            "providerCode": "aihubmix", "name": "测试连接", "apiKey": "fictional-key",
            "settings": {}, "enabled": True,
        })
        assert response.status_code == 201
        connection_id = response.json()["connection"]["id"]
        with app.state.session_factory() as db:
            row = db.get(LLMProviderConnection, int(connection_id))
            row.catalog_state_json = {"etag": "old-endpoint"}
            row.catalog_synced_at = row.created_at
            db.commit()
        changed = client.patch(f"/api/admin/llm/connections/{connection_id}", json={
            "baseVersion": 1, "settings": {"endpoint": "alternate"},
        })
        assert changed.status_code == 200, changed.text
        assert changed.json()["connection"]["runtimeConfigVersion"] == 2
        assert changed.json()["connection"]["catalogSyncedAt"] is None
        with app.state.session_factory() as db:
            row = db.get(LLMProviderConnection, int(connection_id))
            assert row.settings_json == {"endpoint": "alternate"}
            assert row.catalog_state_json is None
