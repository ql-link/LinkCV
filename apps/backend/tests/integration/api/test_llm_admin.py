import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.llm.gateway import (
    GatewayError,
    GatewayResult,
    GatewayStreamEvent,
    GatewayUsage,
)
from linkcv.modules.llm.models import LLMCallLog, LLMCapabilityBinding, LLMModelConfig
from linkcv.modules.llm.schemas import ChatMessage
from linkcv.modules.llm.service import LLMError
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class FakeGateway:
    def __init__(self) -> None:
        self.results: dict[str, GatewayResult | GatewayError] = {}
        self.calls: list[dict[str, object]] = []

    async def complete(
        self,
        *,
        model,
        messages,
        api_base,
        api_key,
        response_format=None,
        disable_thinking=False,
    ):
        self.calls.append(
            {
                "model": model,
                "messages": messages,
                "apiBase": api_base,
                "apiKey": api_key,
                "responseFormat": response_format,
                "disableThinking": disable_thinking,
            }
        )
        result = self.results.get(
            model,
            GatewayResult(
                content="OK",
                usage=GatewayUsage(10, 2),
                input_price_per_million=Decimal("1"),
                output_price_per_million=Decimal("2"),
            ),
        )
        if isinstance(result, GatewayError):
            raise result
        return result

    async def start_stream(
        self,
        *,
        model,
        messages,
        api_base,
        api_key,
    ):
        del model, messages, api_base, api_key

        async def events():
            yield GatewayStreamEvent(type="done", usage=GatewayUsage(1, 1))

        return events()


def build_app(*, with_cipher: bool = True):
    raw_key = (
        f"test:{Fernet.generate_key().decode('ascii')}" if with_cipher else None
    )
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
        llm_credential_encryption_keys=raw_key,
    )
    gateway = FakeGateway()
    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        llm_gateway=gateway,
        create_schema=True,
    )
    return app, gateway


def register(client: TestClient, email: str = "admin@example.invalid") -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def set_admin(app, email: str, value: bool) -> int:
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        user.is_admin = value
        db.commit()
        return user.id


def create_candidate(
    client: TestClient,
    *,
    adapter: str = "deepseek",
    model: str = "deepseek-v4-flash",
    api_key: str | None = "fictional-key",
) -> dict[str, object]:
    payload: dict[str, object] = {"adapter": adapter, "model": model}
    if api_key is not None:
        payload["apiKey"] = api_key
    response = client.post("/api/admin/llm/models", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["model"]


def test_management_api_requires_database_admin() -> None:
    app, _gateway = build_app()
    protected = (
        ("get", "/api/admin/llm/capabilities/chat", None),
        ("get", "/api/admin/llm/catalog/chat", None),
        ("post", "/api/admin/llm/models", {"adapter": "deepseek", "model": "x"}),
        ("post", "/api/admin/llm/models/1/activate", None),
        ("get", "/api/admin/llm/calls", None),
    )
    with TestClient(app) as client:
        for method, path, payload in protected:
            response = (
                getattr(client, method)(path, json=payload)
                if payload is not None
                else getattr(client, method)(path)
            )
            assert response.status_code == 401
            assert response.json() == {"error": "UNAUTHORIZED"}

        register(client)
        for method, path, payload in protected:
            response = (
                getattr(client, method)(path, json=payload)
                if payload is not None
                else getattr(client, method)(path)
            )
            assert response.status_code == 403
        set_admin(app, "admin@example.invalid", True)
        assert client.get("/api/admin/llm/capabilities/chat").json() == {
            "capability": "chat",
            "activeModelId": None,
            "activeModel": None,
            "models": [],
        }


def test_catalog_and_candidate_contract_separate_adapter_from_model() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)

        catalog = client.get("/api/admin/llm/catalog/chat")
        assert catalog.status_code == 200
        adapters = {item["code"]: item for item in catalog.json()["adapters"]}
        assert adapters["deepseek"]["requiresApiKey"] is True
        assert all(isinstance(model, str) for model in adapters["deepseek"]["models"])
        assert adapters["dashscope"]["label"] == "阿里云百炼（千问）"
        assert adapters["dashscope"]["requiresApiKey"] is True

        qwen = create_candidate(
            client,
            adapter="dashscope",
            model="qwen-plus",
        )
        assert qwen["adapter"] == "dashscope"
        assert qwen["model"] == "qwen-plus"

        model = create_candidate(client)
        assert model["adapter"] == "deepseek"
        assert model["model"] == "deepseek-v4-flash"
        assert model["active"] is False
        assert model["keyConfigured"] is True
        assert "apiKey" not in model
        assert {"enabled", "priority", "inputPricePerMillion", "outputPricePerMillion"}.isdisjoint(model)

        with app.state.session_factory() as db:
            stored = db.get(LLMModelConfig, int(model["id"]))
            assert stored is not None
            assert stored.model_name == "deepseek/deepseek-v4-flash"
            assert stored.adapter == "deepseek"
            assert stored.model_call_name == "deepseek-v4-flash"
            stored_qwen = db.get(LLMModelConfig, int(qwen["id"]))
            assert stored_qwen is not None
            assert stored_qwen.model_name == "dashscope/qwen-plus"


@pytest.mark.parametrize(
    "payload",
    [
        {"model": "missing-adapter"},
        {"adapter": "deepseek"},
        {"adapter": "unknown", "model": "x"},
        {"adapter": "deepseek", "model": "deepseek/deepseek-chat"},
        {"adapter": "deepseek", "model": "x", "apiBase": "ftp://invalid"},
        {"adapter": "deepseek", "model": "x", "priority": 1},
        {"adapter": "deepseek", "model": "x", "enabled": True},
        {"adapter": "deepseek", "model": "x", "inputPricePerMillion": "1"},
    ],
)
def test_invalid_or_legacy_candidate_fields_are_rejected(payload) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        response = client.post("/api/admin/llm/models", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_LLM_MODEL_CONFIG"}
        assert client.get("/api/admin/llm/capabilities/chat").json()["models"] == []


def test_key_patch_retains_replaces_and_clears_without_ever_reading_plaintext() -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        model = create_candidate(client, api_key="old-fictional-key")
        model_id = model["id"]

        retained = client.patch(
            f"/api/admin/llm/models/{model_id}",
            json={"model": "retained-model"},
        )
        assert retained.status_code == 200
        assert retained.json()["model"]["keyConfigured"] is True
        assert client.post(f"/api/admin/llm/models/{model_id}/test").status_code == 200
        assert gateway.calls[-1]["apiKey"] == "old-fictional-key"

        replaced = client.patch(
            f"/api/admin/llm/models/{model_id}",
            json={"apiKey": "new-fictional-key"},
        )
        assert replaced.status_code == 200
        assert client.post(f"/api/admin/llm/models/{model_id}/test").status_code == 200
        assert gateway.calls[-1]["apiKey"] == "new-fictional-key"

        cleared = client.patch(
            f"/api/admin/llm/models/{model_id}",
            json={"apiKey": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["model"]["keyConfigured"] is False
        failed = client.post(f"/api/admin/llm/models/{model_id}/test")
        assert failed.status_code == 503
        assert failed.json()["error"] == "LLM_CREDENTIALS_UNAVAILABLE"
        rendered = str(client.get("/api/admin/llm/capabilities/chat").json())
        assert "old-fictional-key" not in rendered
        assert "new-fictional-key" not in rendered


def test_test_is_standalone_and_activate_switches_only_after_success() -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        first = create_candidate(client, model="first")
        second = create_candidate(client, model="second")

        first_activation = client.post(f"/api/admin/llm/models/{first['id']}/activate")
        assert first_activation.status_code == 200
        standalone = client.post(f"/api/admin/llm/models/{second['id']}/test")
        assert standalone.status_code == 200
        state = client.get("/api/admin/llm/capabilities/chat").json()
        assert state["activeModelId"] == first["id"]
        assert state["activeModel"]["model"] == "first"

        switched = client.post(f"/api/admin/llm/models/{second['id']}/activate")
        assert switched.status_code == 200
        assert switched.json()["activeModel"]["id"] == second["id"]
        assert switched.json()["callId"].startswith("llmcall_")
        state = client.get("/api/admin/llm/capabilities/chat").json()
        assert [model["active"] for model in state["models"]] == [False, True]
        assert [call["model"] for call in gateway.calls] == [
            "deepseek/first",
            "deepseek/second",
            "deepseek/second",
        ]


def test_failed_activation_and_failed_current_edit_preserve_previous_snapshot() -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        current = create_candidate(client, model="current", api_key="current-key")
        target = create_candidate(client, model="target", api_key="target-key")
        assert client.post(f"/api/admin/llm/models/{current['id']}/activate").status_code == 200

        gateway.results["deepseek/target"] = GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=False,
        )
        failed_activation = client.post(
            f"/api/admin/llm/models/{target['id']}/activate"
        )
        assert failed_activation.status_code == 502
        assert failed_activation.json()["error"] == "LLM_CONNECTION_FAILED"
        assert failed_activation.json()["callId"].startswith("llmcall_")
        assert client.get("/api/admin/llm/capabilities/chat").json()["activeModelId"] == current["id"]

        gateway.results["deepseek/broken-edit"] = GatewayError(
            code="LLM_REQUEST_REJECTED",
            may_have_reached_provider=False,
        )
        failed_edit = client.patch(
            f"/api/admin/llm/models/{current['id']}",
            json={"model": "broken-edit", "apiKey": "bad-new-key"},
        )
        assert failed_edit.status_code == 502
        state = client.get("/api/admin/llm/capabilities/chat").json()
        assert state["activeModel"]["model"] == "current"
        gateway.results.pop("deepseek/current", None)
        assert client.post(f"/api/admin/llm/models/{current['id']}/test").status_code == 200
        assert gateway.calls[-1]["apiKey"] == "current-key"


def test_chat_without_binding_never_uses_saved_candidates() -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        user_id = set_admin(app, "admin@example.invalid", True)
        create_candidate(client, model="candidate")

        with pytest.raises(LLMError) as captured:
            asyncio.run(
                app.state.llm_service.chat(
                    user_id,
                    [ChatMessage(role="user", content="没有当前模型")],
                    source="fictional_module",
                )
            )
        assert captured.value.code == "LLM_CHAT_NOT_CONFIGURED"
        assert gateway.calls == []


def test_log_query_combines_filters_summarizes_and_never_returns_bodies() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        user_id = set_admin(app, "admin@example.invalid", True)
        model = create_candidate(client, model="logged")
        model_id = int(model["id"])
        now = datetime.now(timezone.utc)
        with app.state.session_factory() as db:
            db.add_all(
                [
                    LLMCallLog(
                        call_id="llmcall_match",
                        capability="chat",
                        source="connection_test",
                        user_id=user_id,
                        model_config_id=model_id,
                        model_name="deepseek/logged",
                        adapter="deepseek",
                        model_call_name="logged",
                        status="succeeded",
                        metering_status="complete",
                        input_tokens=10,
                        output_tokens=2,
                        input_price_per_million=Decimal("1"),
                        output_price_per_million=Decimal("2"),
                        estimated_cost=Decimal("0.000014"),
                        latency_ms=7,
                        created_at=now,
                    ),
                    LLMCallLog(
                        call_id="llmcall_other",
                        capability="chat",
                        source="connection_test",
                        user_id=user_id,
                        model_config_id=model_id,
                        model_name="deepseek/logged",
                        adapter="deepseek",
                        model_call_name="logged",
                        status="failed",
                        metering_status="unknown",
                        latency_ms=9,
                        error_code="LLM_UNAVAILABLE",
                        created_at=now - timedelta(seconds=1),
                    ),
                ]
            )
            db.commit()

        response = client.get(
            "/api/admin/llm/calls",
            params={
                "source": "connection_test",
                "status": "succeeded",
                "modelConfigId": model["id"],
                "userId": str(user_id),
                "callId": "llmcall_match",
                "from": (now - timedelta(minutes=1)).isoformat(),
                "to": (now + timedelta(minutes=1)).isoformat(),
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert [call["callId"] for call in payload["calls"]] == ["llmcall_match"]
        assert payload["summary"]["callCount"] == 1
        assert payload["summary"]["inputTokens"] == 10
        call = payload["calls"][0]
        assert call["capability"] == "chat"
        assert call["adapter"] == "deepseek"
        assert call["model"] == "logged"
        assert {"messages", "prompt", "response", "apiKey"}.isdisjoint(call)


def test_missing_cipher_fails_key_write_without_persisting_secret() -> None:
    app, _gateway = build_app(with_cipher=False)
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        response = client.post(
            "/api/admin/llm/models",
            json={"adapter": "deepseek", "model": "x", "apiKey": "secret"},
        )
        assert response.status_code == 503
        assert response.json() == {"error": "LLM_CREDENTIALS_UNAVAILABLE"}
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMModelConfig)) is None
            binding = db.get(LLMCapabilityBinding, "chat")
            assert binding is not None and binding.model_config_id is None
