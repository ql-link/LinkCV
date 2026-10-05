import json
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select
import pytest

from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.agent.models import AgentRun, AgentSession
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


@pytest.mark.parametrize("protocol", ["openai_chat", "openai_responses"])
def test_admin_only_route_configuration_and_probe(protocol):
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
        bind = client.put(path, json={"useCase": "job_text_extraction", "routeId": int(route_id), "protocolCode": protocol, "priority": 100})
        assert bind.status_code == 200, bind.text
        assert client.patch(path, json={"enabled": True}).status_code == 422
        probe = client.post(f"{path}/probe")
        assert probe.status_code == 200, probe.text
        assert gateway.calls[0]["model"] == "vendor/model"
        assert gateway.calls[0]["protocol_code"] == protocol
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
        call_id = calls.json()["calls"][0]["callId"]
        by_call = client.get("/api/admin/llm/calls", params={"callId": call_id}).json()
        assert [item["callId"] for item in by_call["calls"]] == [call_id]
        assert by_call["summary"]["callCount"] == 1
        assert client.get("/api/admin/llm/calls", params={"callId": "call_missing"}).json()["calls"] == []
        # Probes run without a user, so a user filter excludes them.
        assert client.get("/api/admin/llm/calls", params={"userId": 999999}).json()["calls"] == []
        assert client.get("/api/admin/llm/calls", params={"userId": 0}).status_code == 400
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


def test_aihubmix_speech_models_bind_probe_and_activate_using_controlled_http_targets():
    from linkresume.modules.speech.gateway import RecognitionEvent

    class CapturingSpeech:
        def __init__(self):
            self.targets = []
        async def recognize(self, target, audio, **kwargs):
            self.targets.append(target)
            async for _ in audio:
                pass
            yield RecognitionEvent("虚构测试语音", 0, True)
        async def synthesize(self, target, text, **kwargs):
            self.targets.append(target)
            return b"ID3"
    speech = CapturingSpeech()
    settings = Settings(database_url="sqlite+pysqlite:///:memory:", jwt_secret="integration-test-secret-with-32-bytes", llm_credential_encryption_keys=f"test:{Fernet.generate_key().decode('ascii')}")
    app = create_app(settings, storage=FakeStorage(), redis=FakeRedis(), llm_gateway=FakeGateway(), speech_gateway=speech, create_schema=True)
    with TestClient(app) as client:
        register_admin(app, client)
        catalog = client.get("/api/admin/llm/catalog").json()
        provider = next(item for item in catalog["providers"] if item["code"] == "aihubmix")
        assert {"openai_asr_file", "openai_tts"} <= set(provider["protocols"])
        assert provider["protocols"][0] == "openai_chat"
        connection = client.post("/api/admin/llm/connections", json={"providerCode": "aihubmix", "name": "测试连接", "apiKey": "fictional-key", "settings": {"endpoint": "alternate"}, "enabled": True})
        assert connection.status_code == 201
        assert "fictional-key" not in connection.text
        connection_id = int(connection.json()["connection"]["id"])
        cases = [
            ("speech_to_text", "whisper-large-v3", "openai_asr_file"),
            ("speech_to_text", "whisper-large-v3-turbo", "openai_asr_file"),
            ("text_to_speech", "qwen-audio-3.0-tts-flash", "openai_tts"),
            ("text_to_speech", "tts-1", "openai_tts"),
        ]
        for index, (use_case, model_name, protocol) in enumerate(cases):
            model_id = client.post("/api/admin/llm/models", json={"displayName": model_name}).json()["model"]["id"]
            route = client.post("/api/admin/llm/routes", json={"modelId": int(model_id), "connectionId": connection_id, "targetKind": "model", "invokeTarget": model_name})
            assert route.status_code == 201
            route_id = route.json()["route"]["id"]
            path = f"/api/admin/llm/use-cases/{use_case}/routes/{route_id}"
            bind = client.put(path, json={"useCase": use_case, "routeId": int(route_id), "protocolCode": protocol, "priority": 10 + index})
            assert bind.status_code == 200 and bind.json()["binding"]["effective"] is False
            wrong = client.put(f"/api/admin/llm/use-cases/mock_interview/routes/{route_id}", json={"useCase": "mock_interview", "routeId": int(route_id), "protocolCode": protocol, "priority": 100})
            assert wrong.status_code == 422
            assert client.post(f"{path}/probe").status_code == 200
            assert client.patch(f"/api/admin/llm/routes/{route_id}", json={"enabled": True}).status_code == 200
            enabled = client.patch(path, json={"enabled": True})
            assert enabled.status_code == 200 and enabled.json()["binding"]["effective"] is True
        assert [target.model for target in speech.targets] == [case[1] for case in cases]
        assert all(target.provider_code == "aihubmix" and target.ws_url == "" and target.api_base == "https://api.inferera.com/v1" for target in speech.targets)


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


def _create_route(client, model_id, connection_id, target="vendor/model"):
    response = client.post("/api/admin/llm/routes", json={"modelId": int(model_id), "connectionId": int(connection_id), "targetKind": "model", "invokeTarget": target})
    assert response.status_code == 201, response.text
    return response.json()["route"]["id"]


def test_unused_route_model_and_connection_can_be_deleted():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        connection_id = client.post("/api/admin/llm/connections", json={"providerCode": "aihubmix", "name": "临时连接", "apiKey": "fictional-key", "settings": {}}).json()["connection"]["id"]
        model_id = client.post("/api/admin/llm/models", json={"displayName": "临时模型"}).json()["model"]["id"]
        other_model = client.post("/api/admin/llm/models", json={"displayName": "另一个模型"}).json()["model"]["id"]
        route_id = _create_route(client, model_id, connection_id)
        _create_route(client, model_id, connection_id, "vendor/model-2")
        kept_route = _create_route(client, other_model, connection_id, "vendor/other")

        assert client.delete(f"/api/admin/llm/routes/{route_id}").status_code == 204
        assert client.delete(f"/api/admin/llm/routes/{route_id}").status_code == 404
        # Deleting a model takes its remaining unused routes with it.
        assert client.delete(f"/api/admin/llm/models/{model_id}").status_code == 204
        assert client.delete(f"/api/admin/llm/models/{model_id}").status_code == 404
        routes = client.get("/api/admin/llm/routes").json()["routes"]
        assert [route["id"] for route in routes] == [kept_route]
        # Deleting a connection takes its routes but keeps logical models.
        assert client.delete(f"/api/admin/llm/connections/{connection_id}").status_code == 204
        assert client.get("/api/admin/llm/routes").json()["routes"] == []
        assert [model["id"] for model in client.get("/api/admin/llm/models").json()["models"]] == [other_model]
        assert client.delete("/api/admin/llm/connections/abc").status_code == 404


def test_referenced_llm_configuration_cannot_be_deleted():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        connection_id = client.post("/api/admin/llm/connections", json={"providerCode": "aihubmix", "name": "主连接", "apiKey": "fictional-key", "settings": {}}).json()["connection"]["id"]
        model_id = client.post("/api/admin/llm/models", json={"displayName": "示例模型"}).json()["model"]["id"]
        route_id = _create_route(client, model_id, connection_id)
        path = f"/api/admin/llm/use-cases/job_text_extraction/routes/{route_id}"
        assert client.put(path, json={"useCase": "job_text_extraction", "routeId": int(route_id), "protocolCode": "openai_chat", "priority": 100}).status_code == 200

        # A binding blocks deletion of the route, its model and its connection.
        for target, code in (("routes/" + route_id, "LLM_ROUTE_IN_USE"), ("models/" + model_id, "LLM_MODEL_IN_USE"), ("connections/" + connection_id, "LLM_CONNECTION_IN_USE")):
            response = client.delete(f"/api/admin/llm/{target}")
            assert response.status_code == 409 and response.json()["error"] == code, response.text

        # A probe writes a call log; once unbound, that history still blocks deletion.
        assert client.post(f"{path}/probe").status_code == 200
        assert client.delete(path).status_code == 204
        response = client.delete(f"/api/admin/llm/routes/{route_id}")
        assert response.status_code == 409 and response.json()["error"] == "LLM_ROUTE_IN_USE"
        assert len(client.get("/api/admin/llm/routes").json()["routes"]) == 1
        assert len(client.get("/api/admin/llm/connections").json()["connections"]) == 1


def test_agent_history_blocks_deleting_its_model_and_route():
    app, _ = build_app()
    with TestClient(app) as client:
        register_admin(app, client)
        connection_id = client.post("/api/admin/llm/connections", json={"providerCode": "aihubmix", "name": "主连接", "apiKey": "fictional-key", "settings": {}}).json()["connection"]["id"]
        selected = client.post("/api/admin/llm/models", json={"displayName": "会话所选模型"}).json()["model"]["id"]
        resolved = client.post("/api/admin/llm/models", json={"displayName": "运行所用模型"}).json()["model"]["id"]
        route_id = _create_route(client, resolved, connection_id)
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == "admin@example.invalid"))
            session = AgentSession(public_id=str(uuid4()), user_id=user.id, title="示例", status="active", selected_llm_model_id=int(selected))
            db.add(session); db.flush()
            db.add(AgentRun(public_id=str(uuid4()), session_id=session.id, idempotency_key=uuid4().hex, status="succeeded", resolved_llm_model_id=int(resolved), resolved_llm_route_id=int(route_id), started_at=utc_now()))
            db.commit()
        assert client.delete(f"/api/admin/llm/models/{selected}").json()["error"] == "LLM_MODEL_IN_USE"
        assert client.delete(f"/api/admin/llm/models/{resolved}").json()["error"] == "LLM_MODEL_IN_USE"
        assert client.delete(f"/api/admin/llm/routes/{route_id}").json()["error"] == "LLM_ROUTE_IN_USE"
        assert client.delete(f"/api/admin/llm/connections/{connection_id}").json()["error"] == "LLM_CONNECTION_IN_USE"
