from datetime import datetime, timedelta, timezone
from decimal import Decimal

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import httpx
import pytest
from sqlalchemy import select

from linkresume.core.config import Settings
from linkresume.main import create_app
from linkresume.modules.identity.models import User
from linkresume.modules.llm import admin_routes as llm_admin_routes
from linkresume.modules.llm.gateway import (
    GatewayError,
    GatewayResult,
    GatewayStreamEvent,
    GatewayUsage,
)
from linkresume.modules.llm.models import (
    LLMCallLog,
    LLMCapabilityBinding,
    LLMModelConfig,
    LLMModelValidation,
    LLMProvider,
    LLMProviderModel,
)
from linkresume.modules.llm.pi_probe import PiProbeCoordinator
from linkresume.modules.llm.provider_catalog import (
    CATALOG_INVALID,
    ProviderCatalogEntry,
    ProviderCatalogError,
)
from tests.fakes import FakeRedis

GATEWAY_BASE_URL = "https://gateway.example.invalid/v1"
CATALOG_URL = "https://catalog.example.invalid/api/v1/models"


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class FakeGateway:
    def __init__(self) -> None:
        self.results: dict[str, GatewayResult | GatewayError] = {}
        self.calls: list[dict[str, object]] = []

    async def complete(self, *, model, messages, api_base, api_key):
        self.calls.append(
            {
                "model": model,
                "messages": messages,
                "apiBase": api_base,
                "apiKey": api_key,
            }
        )
        result = self.results.get(
            model,
            GatewayResult(content="OK", usage=GatewayUsage(10, 2)),
        )
        if isinstance(result, GatewayError):
            raise result
        return result

    async def start_stream(self, *, model, messages, api_base, api_key):
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

    async def unavailable_pi(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("fixture unavailable", request=request)

    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        llm_gateway=gateway,
        pi_probe_coordinator=PiProbeCoordinator(
            settings,
            transport=httpx.MockTransport(unavailable_pi),
        ),
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


def create_provider(
    client: TestClient,
    *,
    name: str = "虚构聚合网关",
    api_key: str | None = "fictional-key",
) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": name,
        "baseUrl": GATEWAY_BASE_URL,
        "modelCatalogUrl": CATALOG_URL,
    }
    if api_key is not None:
        payload["apiKey"] = api_key
    response = client.post("/api/admin/llm/providers", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["provider"]


def fake_catalog(monkeypatch, entries: list[ProviderCatalogEntry]) -> None:
    async def loader(**_kwargs):
        return tuple(entries)

    monkeypatch.setattr(
        llm_admin_routes, "fetch_provider_catalog", loader
    )


def fake_catalog_failure(monkeypatch, code: str) -> None:
    async def loader(**_kwargs):
        raise ProviderCatalogError(code)

    monkeypatch.setattr(
        llm_admin_routes, "fetch_provider_catalog", loader
    )


def entry(
    model_id: str,
    *,
    input_price: Decimal | None = Decimal("1"),
    output_price: Decimal | None = Decimal("2"),
    context_length: int | None = 200_000,
) -> ProviderCatalogEntry:
    return ProviderCatalogEntry(
        model_id=model_id,
        display_name=model_id,
        context_length=context_length,
        max_output=32_768,
        input_modalities="text",
        supports_reasoning=False,
        input_price_per_million=input_price,
        output_price_per_million=output_price,
        cache_read_price_per_million=None,
        cache_write_price_per_million=None,
    )


def create_candidate(
    client: TestClient,
    provider_id: str,
    *,
    model: str = "z-ai/glm-4.6",
) -> dict[str, object]:
    response = client.post(
        "/api/admin/llm/models",
        json={"providerId": provider_id, "model": model},
    )
    assert response.status_code == 201, response.text
    return response.json()["model"]


def provision(client: TestClient, monkeypatch, *, model="z-ai/glm-4.6"):
    """Create one synced provider and one model under it."""
    provider = create_provider(client)
    fake_catalog(monkeypatch, [entry(model)])
    synced = client.post(
        f"/api/admin/llm/providers/{provider['id']}/catalog:sync"
    )
    assert synced.status_code == 200, synced.text
    return provider, create_candidate(client, str(provider["id"]), model=model)


def test_management_api_requires_database_admin() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        for method, path, payload in (
            ("get", "/api/admin/llm/providers", None),
            ("post", "/api/admin/llm/providers", {"name": "x"}),
            ("get", "/api/admin/llm/capabilities", None),
            ("get", "/api/admin/llm/capabilities/chat", None),
            ("get", "/api/admin/llm/calls", None),
        ):
            request = getattr(client, method)
            response = request(path) if payload is None else request(path, json=payload)
            assert response.status_code == 401, (method, path)

        register(client)
        # A signed-in non-admin is rejected as forbidden, not unauthenticated.
        assert client.get("/api/admin/llm/providers").status_code == 403

        set_admin(app, "admin@example.invalid", True)
        for method, path in (
            ("get", "/api/admin/llm/providers"),
            ("get", "/api/admin/llm/capabilities"),
            ("get", "/api/admin/llm/capabilities/chat"),
            ("get", "/api/admin/llm/calls"),
        ):
            response = getattr(client, method)(path)
            assert response.status_code == 200, (method, path)

        # The pre-0088 catalog endpoints are gone, not silently aliased.
        assert client.get("/api/admin/llm/catalog").status_code == 404
        assert client.get("/api/admin/llm/catalog/chat").status_code == 404


def test_provider_crud_never_returns_the_credential(monkeypatch) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)

        created = create_provider(client, name="虚构网关 A")
        assert created["keyConfigured"] is True
        assert created["priceSyncStatus"] == "unknown"
        assert created["priceSyncError"] is None
        assert created["priceSyncedAt"] is None
        assert created["modelCount"] == 0
        assert "fictional-key" not in client.get(
            "/api/admin/llm/providers"
        ).text

        duplicate = client.post(
            "/api/admin/llm/providers",
            json={
                "name": "虚构网关 A",
                "baseUrl": GATEWAY_BASE_URL,
                "modelCatalogUrl": CATALOG_URL,
                "apiKey": "another-key",
            },
        )
        assert duplicate.status_code == 409
        assert duplicate.json() == {"error": "LLM_PROVIDER_NAME_TAKEN"}

        # Omitting apiKey keeps the stored credential; sending one replaces it.
        patched = client.patch(
            f"/api/admin/llm/providers/{created['id']}",
            json={"name": "虚构网关 B", "baseVersion": created["version"]},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["provider"]["name"] == "虚构网关 B"
        assert patched.json()["provider"]["keyConfigured"] is True
        assert patched.json()["provider"]["version"] == 2
        assert patched.json()["affectedCapabilities"] == []

        stale = client.patch(
            f"/api/admin/llm/providers/{created['id']}",
            json={"name": "虚构网关 C", "baseVersion": created["version"]},
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "LLM_PROVIDER_CHANGED"}

        deleted = client.delete(f"/api/admin/llm/providers/{created['id']}")
        assert deleted.status_code == 204
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMProvider)) is None


def test_catalog_sync_stores_models_and_reports_failures(monkeypatch) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        provider = create_provider(client)

        fake_catalog_failure(monkeypatch, CATALOG_INVALID)
        failed = client.post(
            f"/api/admin/llm/providers/{provider['id']}/catalog:sync"
        )
        assert failed.status_code == 502
        assert failed.json() == {"error": CATALOG_INVALID}
        listed = client.get("/api/admin/llm/providers").json()["providers"][0]
        assert listed["priceSyncStatus"] == "failed"
        assert listed["priceSyncError"] == CATALOG_INVALID
        assert listed["modelCount"] == 0

        fake_catalog(
            monkeypatch,
            [entry("z-ai/glm-4.6"), entry("moonshotai/kimi-k2")],
        )
        synced = client.post(
            f"/api/admin/llm/providers/{provider['id']}/catalog:sync"
        )
        assert synced.status_code == 200, synced.text
        assert synced.json()["modelCount"] == 2
        assert synced.json()["syncedAt"].endswith("Z") or "+" in synced.json()[
            "syncedAt"
        ]
        listed = client.get("/api/admin/llm/providers").json()["providers"][0]
        assert listed["priceSyncStatus"] == "succeeded"
        assert listed["priceSyncError"] is None
        assert listed["priceSyncedAt"] is not None
        assert listed["modelCount"] == 2

        models = client.get(
            f"/api/admin/llm/providers/{provider['id']}/models"
        ).json()
        assert [item["modelId"] for item in models["models"]] == [
            "moonshotai/kimi-k2",
            "z-ai/glm-4.6",
        ]
        assert models["models"][0]["inputPricePerMillion"] == "1.00000000"
        assert models["models"][0]["contextLength"] == 200_000

        filtered = client.get(
            f"/api/admin/llm/providers/{provider['id']}/models",
            params={"query": "kimi"},
        ).json()
        assert [item["modelId"] for item in filtered["models"]] == [
            "moonshotai/kimi-k2"
        ]

        missing = client.post("/api/admin/llm/providers/999999/catalog:sync")
        assert missing.status_code == 404
        assert missing.json() == {"error": "LLM_PROVIDER_NOT_FOUND"}


def test_model_must_come_from_the_synced_catalog(monkeypatch) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        provider = create_provider(client)
        fake_catalog(monkeypatch, [entry("z-ai/glm-4.6")])
        client.post(f"/api/admin/llm/providers/{provider['id']}/catalog:sync")

        unknown = client.post(
            "/api/admin/llm/models",
            json={"providerId": provider["id"], "model": "fictional/model"},
        )
        assert unknown.status_code == 400
        assert unknown.json() == {"error": "LLM_PROVIDER_MODEL_UNKNOWN"}

        model = create_candidate(client, str(provider["id"]))
        assert model["provider"] == {
            "id": provider["id"],
            "name": "虚构聚合网关",
        }
        assert model["model"] == "z-ai/glm-4.6"
        assert model["keyConfigured"] is True

        duplicate = client.post(
            "/api/admin/llm/models",
            json={"providerId": provider["id"], "model": "z-ai/glm-4.6"},
        )
        assert duplicate.status_code == 409
        assert duplicate.json() == {"error": "LLM_MODEL_ALREADY_EXISTS"}

        unknown_provider = client.post(
            "/api/admin/llm/models",
            json={"providerId": "999999", "model": "z-ai/glm-4.6"},
        )
        assert unknown_provider.status_code == 404
        assert unknown_provider.json() == {"error": "LLM_PROVIDER_NOT_FOUND"}


@pytest.mark.parametrize(
    "payload",
    [
        {"model": "z-ai/glm-4.6"},
        {"providerId": "1"},
        {"providerId": "1", "model": "   "},
        {"providerId": "1", "model": "x" * 129},
        # Fields the 0088 contract removed must stay rejected, not ignored.
        {"providerId": "1", "model": "x", "adapter": "deepseek"},
        {"providerId": "1", "model": "x", "apiBase": "https://x.invalid/v1"},
        {"providerId": "1", "model": "x", "apiKey": "secret"},
        {"providerId": "1", "model": "x", "priority": 1},
        {"providerId": "1", "model": "x", "enabled": True},
        {"providerId": "1", "model": "x", "inputPricePerMillion": "1"},
    ],
)
def test_invalid_or_legacy_candidate_fields_are_rejected(payload) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        response = client.post("/api/admin/llm/models", json=payload)
        assert response.status_code == 400, (payload, response.text)
        assert response.json() == {"error": "INVALID_LLM_MODEL_CONFIG"}
        assert client.get("/api/admin/llm/capabilities/chat").json()["models"] == []


def test_provider_delete_is_blocked_while_models_reference_it(monkeypatch) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        provider, model = provision(client, monkeypatch)

        blocked = client.delete(f"/api/admin/llm/providers/{provider['id']}")
        assert blocked.status_code == 409
        assert blocked.json() == {"error": "LLM_PROVIDER_IN_USE"}
        with app.state.session_factory() as db:
            assert db.get(LLMProvider, int(provider["id"])) is not None
            assert db.get(LLMModelConfig, int(model["id"])) is not None

        assert client.delete(f"/api/admin/llm/models/{model['id']}").status_code == 204
        assert client.delete(f"/api/admin/llm/providers/{provider['id']}").status_code == 204
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMProviderModel)) is None


def test_model_patch_only_switches_the_catalog_entry(monkeypatch) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        provider = create_provider(client)
        fake_catalog(
            monkeypatch, [entry("z-ai/glm-4.6"), entry("z-ai/glm-4.5")]
        )
        client.post(f"/api/admin/llm/providers/{provider['id']}/catalog:sync")
        model = create_candidate(client, str(provider["id"]))

        unknown = client.patch(
            f"/api/admin/llm/models/{model['id']}",
            json={"model": "fictional/model", "baseConfigVersion": 1},
        )
        assert unknown.status_code == 400
        assert unknown.json() == {"error": "LLM_PROVIDER_MODEL_UNKNOWN"}

        patched = client.patch(
            f"/api/admin/llm/models/{model['id']}",
            json={"model": "z-ai/glm-4.5", "baseConfigVersion": 1},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["model"]["model"] == "z-ai/glm-4.5"

        stale = client.patch(
            f"/api/admin/llm/models/{model['id']}",
            json={"model": "z-ai/glm-4.6", "baseConfigVersion": 1},
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "LLM_MODEL_CONFIG_CHANGED"}


def test_capability_matrix_binds_resume_with_validation_evidence(
    monkeypatch,
) -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        admin_id = set_admin(app, "admin@example.invalid", True)
        provider, model = provision(client, monkeypatch, model="matrix-model")
        gateway.results["matrix-model"] = GatewayResult(
            content='{"ok":true}',
            usage=GatewayUsage(10, 2),
        )

        matrix = client.get("/api/admin/llm/capabilities")
        assert matrix.status_code == 200
        assert [item["capability"] for item in matrix.json()["capabilities"]] == [
            "chat",
            "resume_structuring",
            "pi_agent",
            "job_image_structuring",
        ]
        resume = next(
            item
            for item in matrix.json()["capabilities"]
            if item["capability"] == "resume_structuring"
        )
        assert resume["activeModelId"] is None
        assert resume["bindingVersion"] == 1
        assert resume["models"][0]["configVersion"] == 1
        assert resume["models"][0]["provider"] == {
            "id": provider["id"],
            "name": "虚构聚合网关",
        }
        assert "apiBase" not in resume["models"][0]
        assert "adapter" not in resume["models"][0]

        tested = client.post(
            f"/api/admin/llm/models/{model['id']}/tests",
            json={"capability": "resume_structuring", "baseConfigVersion": 1},
        )
        assert tested.status_code == 200, tested.text
        assert tested.json()["validationId"].isdigit()

        bound = client.put(
            "/api/admin/llm/capabilities/resume_structuring/binding",
            json={
                "modelConfigId": model["id"],
                "baseConfigVersion": 1,
                "baseBindingVersion": 1,
            },
        )
        assert bound.status_code == 200, bound.text
        body = bound.json()
        assert body["capability"] == "resume_structuring"
        assert body["activeModelId"] == model["id"]
        assert body["bindingVersion"] == 2
        assert body["validationId"].isdigit()
        assert body["callId"].startswith("llmcall_")
        # The provider connection is what the probe actually exercised.
        assert gateway.calls[-1]["model"] == "matrix-model"
        assert gateway.calls[-1]["apiBase"] == GATEWAY_BASE_URL
        assert gateway.calls[-1]["apiKey"] == "fictional-key"

        with app.state.session_factory() as db:
            evidence = db.scalar(
                select(LLMModelValidation).where(
                    LLMModelValidation.call_id == body["callId"]
                )
            )
            assert evidence is not None
            assert evidence.capability == "resume_structuring"
            assert evidence.created_by_user_id == admin_id

        in_use = client.delete(f"/api/admin/llm/models/{model['id']}")
        assert in_use.status_code == 409
        assert in_use.json() == {"error": "LLM_MODEL_IN_USE"}

        bound_provider = client.patch(
            f"/api/admin/llm/providers/{provider['id']}",
            json={"baseUrl": "https://moved.example.invalid/v2", "baseVersion": 1},
        )
        assert bound_provider.status_code == 200, bound_provider.text
        assert bound_provider.json()["affectedCapabilities"] == [
            {
                "capability": "resume_structuring",
                "modelConfigId": model["id"],
                "model": "matrix-model",
            }
        ]

        blocked = client.put(
            "/api/admin/llm/capabilities/pi_agent/binding",
            json={"modelConfigId": model["id"]},
        )
        assert blocked.status_code == 503
        assert blocked.json()["error"] == "LLM_PI_AGENT_UNAVAILABLE"
        assert blocked.json()["callId"].startswith("llmcall_")
        with app.state.session_factory() as db:
            failed_call = db.scalar(
                select(LLMCallLog).where(
                    LLMCallLog.call_id == blocked.json()["callId"]
                )
            )
            assert failed_call is not None
            assert failed_call.status == "failed"
            assert failed_call.error_code == "LLM_PI_AGENT_UNAVAILABLE"


def test_pi_capability_binding_accepts_successful_pi_probe_evidence(
    monkeypatch,
) -> None:
    app, _gateway = build_app()

    seen: dict[str, object] = {}

    class SuccessfulPiProbe:
        async def run_probe(self, config, api_key):
            seen["capability"] = config.capability
            seen["api_key"] = api_key
            seen["definition"] = config.definition.model_id
            return GatewayUsage(input_tokens=7, output_tokens=2)

    app.state.pi_probe_coordinator = SuccessfulPiProbe()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        _provider, model = provision(client, monkeypatch)

        response = client.put(
            "/api/admin/llm/capabilities/pi_agent/binding",
            json={
                "modelConfigId": model["id"],
                "baseConfigVersion": 1,
                "baseBindingVersion": 1,
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["capability"] == "pi_agent"
        assert body["activeModelId"] == model["id"]
        assert seen == {
            "capability": "pi_agent",
            "api_key": "fictional-key",
            "definition": "z-ai/glm-4.6",
        }
        with app.state.session_factory() as db:
            evidence = db.get(LLMModelValidation, int(body["validationId"]))
            assert evidence is not None
            assert evidence.status == "succeeded"


def test_job_image_capability_requires_real_image_probe_before_binding(
    monkeypatch,
) -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        _provider, model = provision(client, monkeypatch)

        gateway.results["z-ai/glm-4.6"] = GatewayResult(
            content='{"color":"blue"}',
            usage=GatewayUsage(10, 2),
        )
        rejected = client.put(
            "/api/admin/llm/capabilities/job_image_structuring/binding",
            json={"modelConfigId": model["id"]},
        )
        assert rejected.status_code == 502
        assert rejected.json()["error"] == "LLM_RESPONSE_INVALID"

        gateway.results["z-ai/glm-4.6"] = GatewayResult(
            content='{"color":"red"}',
            usage=GatewayUsage(10, 2),
        )
        accepted = client.put(
            "/api/admin/llm/capabilities/job_image_structuring/binding",
            json={"modelConfigId": model["id"]},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["activeModelId"] == model["id"]


def test_test_is_standalone_and_activate_switches_only_after_success(
    monkeypatch,
) -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        provider = create_provider(client)
        fake_catalog(
            monkeypatch, [entry("current"), entry("target"), entry("broken")]
        )
        client.post(f"/api/admin/llm/providers/{provider['id']}/catalog:sync")
        current = create_candidate(client, str(provider["id"]), model="current")
        target = create_candidate(client, str(provider["id"]), model="target")
        broken = create_candidate(client, str(provider["id"]), model="broken")
        gateway.results["current"] = GatewayResult("OK", GatewayUsage(10, 2))
        gateway.results["target"] = GatewayResult("OK", GatewayUsage(10, 2))
        gateway.results["broken"] = GatewayError(
            code="LLM_UNAVAILABLE", may_have_reached_provider=False
        )

        assert (
            client.post(
                f"/api/admin/llm/models/{current['id']}/activate"
            ).status_code
            == 200
        )

        standalone = client.post(f"/api/admin/llm/models/{target['id']}/test")
        assert standalone.status_code == 200
        with app.state.session_factory() as db:
            binding = db.get(LLMCapabilityBinding, "chat")
            assert binding is not None
            assert binding.model_config_id == int(current["id"])

        failed = client.post(f"/api/admin/llm/models/{broken['id']}/activate")
        assert failed.status_code == 502
        # The gateway classification survives the probe instead of collapsing
        # into a generic connection failure.
        assert failed.json()["error"] == "LLM_UNAVAILABLE"
        with app.state.session_factory() as db:
            binding = db.get(LLMCapabilityBinding, "chat")
            assert binding is not None
            assert binding.model_config_id == int(current["id"])

        switched = client.post(f"/api/admin/llm/models/{target['id']}/activate")
        assert switched.status_code == 200, switched.text
        assert switched.json()["activeModel"]["id"] == target["id"]
        assert switched.json()["activeModel"]["active"] is True
        with app.state.session_factory() as db:
            binding = db.get(LLMCapabilityBinding, "chat")
            assert binding is not None
            assert binding.model_config_id == int(target["id"])


def test_binding_the_same_model_twice_reports_a_conflict(monkeypatch) -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        _provider, model = provision(client, monkeypatch)
        gateway.results["z-ai/glm-4.6"] = GatewayResult(
            content='{"ok":true}', usage=GatewayUsage(10, 2)
        )

        first = client.put(
            "/api/admin/llm/capabilities/resume_structuring/binding",
            json={"modelConfigId": model["id"], "baseBindingVersion": 1},
        )
        assert first.status_code == 200, first.text
        stale = client.put(
            "/api/admin/llm/capabilities/resume_structuring/binding",
            json={"modelConfigId": model["id"], "baseBindingVersion": 1},
        )
        assert stale.status_code == 409
        assert stale.json()["error"] == "LLM_BINDING_CHANGED"


def test_chat_without_binding_never_uses_saved_models(monkeypatch) -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        provision(client, monkeypatch)

        capabilities = client.get("/api/admin/llm/capabilities/chat").json()
        assert capabilities["activeModelId"] is None
        assert len(capabilities["models"]) == 1
        assert gateway.calls == []


def test_log_query_combines_filters_summarizes_and_never_returns_bodies(
    monkeypatch,
) -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        admin_id = set_admin(app, "admin@example.invalid", True)
        _provider, model = provision(client, monkeypatch)
        now = datetime.now(timezone.utc)

        with app.state.session_factory() as db:
            db.add(
                LLMCallLog(
                    call_id="llmcall_fictional_ok",
                    capability="chat",
                    source="fictional_module",
                    user_id=admin_id,
                    model_config_id=int(model["id"]),
                    model_config_version=1,
                    model_name="matrix-model",
                    status="succeeded",
                    metering_status="complete",
                    input_tokens=10,
                    output_tokens=2,
                    input_price_per_million=Decimal("1"),
                    output_price_per_million=Decimal("2"),
                    estimated_cost=Decimal("0.0000140000"),
                    latency_ms=12,
                    created_at=now,
                )
            )
            db.add(
                LLMCallLog(
                    call_id="llmcall_fictional_failed",
                    capability="pi_agent",
                    source="fictional_module",
                    user_id=admin_id,
                    model_config_id=None,
                    model_name="fictional-model",
                    status="failed",
                    metering_status="unknown",
                    error_code="LLM_UNAVAILABLE",
                    created_at=now - timedelta(hours=1),
                )
            )
            db.commit()

        listing = client.get(
            "/api/admin/llm/calls",
            params={
                "source": "fictional_module",
                "userId": str(admin_id),
                "from": (now - timedelta(minutes=30)).isoformat(),
                "to": (now + timedelta(minutes=30)).isoformat(),
            },
        )
        assert listing.status_code == 200, listing.text
        body = listing.json()
        assert [call["callId"] for call in body["calls"]] == [
            "llmcall_fictional_ok"
        ]
        assert body["summary"]["callCount"] == 1
        assert body["summary"]["estimatedCostUsd"] == "0.0000140000"
        assert body["calls"][0]["model"] == "matrix-model"
        assert "messages" not in listing.text

        filtered = client.get(
            "/api/admin/llm/calls",
            params={"status": "failed", "modelConfigId": str(model["id"])},
        )
        assert filtered.json()["calls"] == []

        invalid = client.get("/api/admin/llm/calls", params={"cursor": "!!"})
        assert invalid.status_code == 400
        assert invalid.json() == {"error": "INVALID_LLM_CALL_QUERY"}


def test_missing_cipher_fails_provider_key_write_without_persisting_secret() -> None:
    app, _gateway = build_app(with_cipher=False)
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        response = client.post(
            "/api/admin/llm/providers",
            json={
                "name": "虚构无密钥网关",
                "baseUrl": GATEWAY_BASE_URL,
                "modelCatalogUrl": CATALOG_URL,
                "apiKey": "fictional-secret",
            },
        )
        assert response.status_code == 503
        assert response.json() == {"error": "LLM_CREDENTIALS_UNAVAILABLE"}
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMProvider)) is None


def test_provider_catalog_url_must_be_a_real_http_url() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        for catalog_url in ("ftp://invalid", "not-a-url", "", "   "):
            response = client.post(
                "/api/admin/llm/providers",
                json={
                    "name": "虚构网关",
                    "baseUrl": GATEWAY_BASE_URL,
                    "modelCatalogUrl": catalog_url,
                    "apiKey": "fictional-key",
                },
            )
            assert response.status_code == 400, (catalog_url, response.text)
            assert response.json() == {"error": "INVALID_LLM_MODEL_CONFIG"}
