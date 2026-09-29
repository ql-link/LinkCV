import json

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.identity.models import User
from linkresume.modules.llm.gateway import GatewayResult, GatewayUsage
from linkresume.modules.llm.models import (
    LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute,
)
from linkresume.modules.llm.resolver import JOB_TEXT_EXTRACTION, resolve, validation_fingerprint
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


class FakeSpeechGateway:
    def __init__(self):
        self.calls = []

    async def recognize(self, target, audio, *, hotwords, language):
        self.calls.append(("recognize", target.ws_url, target.model, target.workspace_id))
        async for _ in audio:
            pass
        if False:  # pragma: no cover - makes this an async generator
            yield None

    async def synthesize(self, target, text, *, voice):
        self.calls.append(("synthesize", target.ws_url, target.model, text))
        return b"ID3"


def test_speech_use_cases_bind_only_speech_protocols_and_probe_through_speech_gateway():
    settings = Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret="integration-test-secret-with-32-bytes", llm_credential_encryption_keys=f"test:{Fernet.generate_key().decode('ascii')}")
    speech = FakeSpeechGateway()
    app = create_app(settings, storage=FakeStorage(), redis=FakeRedis(), llm_gateway=FakeGateway(), speech_gateway=speech, create_schema=True)
    with TestClient(app) as client:
        register_admin(app, client)
        catalog = client.get("/api/admin/llm/catalog").json()
        assert {"speech_to_text", "text_to_speech", "transcript_correction"} <= set(catalog["useCases"])
        aliyun = next(item for item in catalog["providers"] if item["code"] == "aliyun")
        assert {"aliyun_asr_realtime", "aliyun_tts_realtime"} <= set(aliyun["protocols"])
        connection = client.post("/api/admin/llm/connections", json={"providerCode": "aliyun", "name": "百炼", "apiKey": "fictional-key", "settings": {"region": "cn-beijing", "workspace_id": "ws-demo"}, "enabled": True})
        assert connection.status_code == 201, connection.text
        connection_id = int(connection.json()["connection"]["id"])
        routes = {}
        for target in ("fun-asr-realtime", "cosyvoice-v3-flash"):
            model = client.post("/api/admin/llm/models", json={"displayName": target}).json()["model"]["id"]
            route = client.post("/api/admin/llm/routes", json={"modelId": int(model), "connectionId": connection_id, "targetKind": "model", "invokeTarget": target})
            assert route.status_code == 201, route.text
            routes[target] = int(route.json()["route"]["id"])
        stt = routes["fun-asr-realtime"]
        tts = routes["cosyvoice-v3-flash"]

        wrong = client.put(f"/api/admin/llm/use-cases/speech_to_text/routes/{stt}", json={"useCase": "speech_to_text", "routeId": stt, "protocolCode": "openai_chat", "priority": 100})
        assert wrong.status_code == 422 and wrong.json()["error"] == "LLM_ROUTE_INVALID"
        misuse = client.put(f"/api/admin/llm/use-cases/mock_interview/routes/{stt}", json={"useCase": "mock_interview", "routeId": stt, "protocolCode": "aliyun_asr_realtime", "priority": 100})
        assert misuse.status_code == 422

        for use_case, route_id, protocol in (("speech_to_text", stt, "aliyun_asr_realtime"), ("text_to_speech", tts, "aliyun_tts_realtime")):
            path = f"/api/admin/llm/use-cases/{use_case}/routes/{route_id}"
            assert client.put(path, json={"useCase": use_case, "routeId": route_id, "protocolCode": protocol, "priority": 100}).status_code == 200
            probe = client.post(f"{path}/probe")
            assert probe.status_code == 200, probe.text
            assert client.patch(path, json={"enabled": True}).status_code == 200
        assert speech.calls[0] == ("recognize", "wss://dashscope.aliyuncs.com/api-ws/v1/inference/", "fun-asr-realtime", "ws-demo")
        assert speech.calls[1][0:3] == ("synthesize", "wss://dashscope.aliyuncs.com/api-ws/v1/inference/", "cosyvoice-v3-flash")
    with app.state.session_factory() as db:
        logs = db.scalars(select(LLMCallLog).where(LLMCallLog.source == "capability_probe")).all()
        assert {log.use_case for log in logs} == {"speech_to_text", "text_to_speech"}
        assert all(log.status == "succeeded" for log in logs)


def test_model_user_selectable_is_admin_editable_and_ignored_by_system_use_cases():
    app, gateway = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        created = client.post("/api/admin/llm/models", json={"displayName": "示例模型"})
        assert created.json()["model"]["userSelectable"] is True
        hidden = client.post("/api/admin/llm/models", json={"displayName": "隐藏模型", "userSelectable": False})
        assert hidden.json()["model"]["userSelectable"] is False
        model_id = created.json()["model"]["id"]
        toggled = client.patch(f"/api/admin/llm/models/{model_id}", json={"userSelectable": False})
        assert toggled.status_code == 200 and toggled.json()["model"]["userSelectable"] is False
        # Editing another field leaves the flag untouched.
        renamed = client.patch(f"/api/admin/llm/models/{model_id}", json={"displayName": "示例模型 2"})
        assert renamed.json()["model"]["userSelectable"] is False
        assert client.patch(f"/api/admin/llm/models/{model_id}", json={"userSelectable": None}).json()["model"]["userSelectable"] is False

    # System capabilities keep resolving hidden models; only conversation is filtered.
    with app.state.session_factory() as db:
        connection = LLMProviderConnection(provider_code="aihubmix", name="系统连接", credential_ciphertext=app.state.llm_service.encrypt_credential(json.dumps({"api_key": "fictional-key"})), settings_json={}, enabled=True, runtime_config_version=1)
        model = db.get(LLMModel, int(model_id))
        db.add(connection); db.flush()
        route = LLMModelRoute(model_id=model.id, connection_id=connection.id, target_kind="model", invoke_target="vendor/model", origin="manual", enabled=True, target_available=True)
        db.add(route); db.flush()
        binding = LLMUseCaseRoute(use_case=JOB_TEXT_EXTRACTION, route_id=route.id, protocol_code="openai_chat", priority=1, enabled=True, validated_at=utc_now())
        db.add(binding); db.flush()
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()
        assert resolve(db, JOB_TEXT_EXTRACTION).model_id == model.id
