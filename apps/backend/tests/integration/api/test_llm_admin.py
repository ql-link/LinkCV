import asyncio
from collections.abc import AsyncIterator, Sequence
from datetime import datetime
from decimal import Decimal

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
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
from linkcv.modules.llm.models import LLMCallLog, LLMModelConfig
from linkcv.modules.llm.schemas import ChatMessage
from linkcv.modules.llm.service import LLMError


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class FakeGateway:
    def __init__(self) -> None:
        self.failure: GatewayError | None = None
        self.api_keys: list[str | None] = []
        self.input_price_per_million: Decimal | None = Decimal("1")
        self.output_price_per_million: Decimal | None = Decimal("2")

    async def complete(self, *, model, messages, api_base, api_key):
        del model, messages, api_base
        self.api_keys.append(api_key)
        if self.failure is not None:
            raise self.failure
        return GatewayResult(
            content="OK",
            usage=GatewayUsage(10, 2),
            input_price_per_million=self.input_price_per_million,
            output_price_per_million=self.output_price_per_million,
        )

    async def start_stream(
        self, *, model, messages, api_base, api_key
    ) -> AsyncIterator[GatewayStreamEvent]:
        del model, messages, api_base, api_key

        async def events():
            yield GatewayStreamEvent(
                type="done",
                usage=GatewayUsage(1, 1),
                input_price_per_million=Decimal("1"),
                output_price_per_million=Decimal("1"),
            )

        return events()


def build_app(*, with_key: bool = True):
    raw_key = (
        f"test:{Fernet.generate_key().decode('ascii')}" if with_key else None
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


def set_admin(app, email: str, value: bool) -> None:
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        user.is_admin = value
        db.commit()


def test_management_api_requires_database_admin_and_same_cookie_updates() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        requests = (
            ("get", "/api/admin/llm/models", None),
            ("post", "/api/admin/llm/models", {"model": "fictional"}),
            ("post", "/api/admin/llm/models/1/test", None),
            ("get", "/api/admin/llm/calls", None),
        )
        for method, path, payload in requests:
            response = (
                getattr(client, method)(path, json=payload)
                if payload is not None
                else getattr(client, method)(path)
            )
            assert response.status_code == 401
            assert response.json() == {"error": "UNAUTHORIZED"}
        register(client)
        for method, path, payload in requests:
            response = (
                getattr(client, method)(path, json=payload)
                if payload is not None
                else getattr(client, method)(path)
            )
            assert response.status_code == 403
            assert response.json() == {"error": "FORBIDDEN"}

        set_admin(app, "admin@example.invalid", True)
        assert client.get("/api/admin/llm/models").json() == {"models": []}
        set_admin(app, "admin@example.invalid", False)
        assert client.get("/api/admin/llm/models").status_code == 403


def test_disabling_model_preserves_history_and_removes_it_from_candidates() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        model = client.post(
            "/api/admin/llm/models",
            json={"model": "disable-model", "enabled": True},
        ).json()["model"]
        config_id = model["id"]
        assert isinstance(config_id, str)
        assert client.post(f"/api/admin/llm/models/{config_id}/test").status_code == 200

        disabled = client.patch(
            f"/api/admin/llm/models/{config_id}",
            json={"enabled": False},
        )
        assert disabled.status_code == 200
        assert disabled.json()["model"]["enabled"] is False
        assert client.delete(f"/api/admin/llm/models/{config_id}").status_code == 405

        with app.state.session_factory() as db:
            user = db.scalar(
                select(User).where(User.email == "admin@example.invalid")
            )
            assert user is not None
            user_id = user.id
        try:
            asyncio.run(
                app.state.llm_service.chat(
                    user_id,
                    [ChatMessage(role="user", content="停用后不应调用")],
                )
            )
        except LLMError as error:
            assert error.code == "NO_AVAILABLE_LLM_MODEL"
        else:
            raise AssertionError("disabled model unexpectedly participated")

        calls = client.get(
            "/api/admin/llm/calls",
            params={"modelConfigId": config_id},
        ).json()["calls"]
        assert len(calls) == 1
        assert calls[0]["status"] == "succeeded"


def test_price_update_changes_new_calls_without_recalculating_history() -> None:
    app, gateway = build_app()
    gateway.input_price_per_million = None
    gateway.output_price_per_million = None
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        config_id = client.post(
            "/api/admin/llm/models",
            json={
                "model": "priced-model",
                "inputPricePerMillion": "1",
                "outputPricePerMillion": "2",
            },
        ).json()["model"]["id"]
        assert client.post(f"/api/admin/llm/models/{config_id}/test").status_code == 200
        old_call = client.get(
            "/api/admin/llm/calls", params={"modelConfigId": config_id}
        ).json()["calls"][0]

        assert client.patch(
            f"/api/admin/llm/models/{config_id}",
            json={
                "inputPricePerMillion": "3",
                "outputPricePerMillion": "4",
            },
        ).status_code == 200
        assert client.post(f"/api/admin/llm/models/{config_id}/test").status_code == 200
        calls = client.get(
            "/api/admin/llm/calls", params={"modelConfigId": config_id}
        ).json()["calls"]

        assert calls[0]["inputPricePerMillion"] == "3.00000000"
        assert calls[0]["outputPricePerMillion"] == "4.00000000"
        assert calls[1]["callId"] == old_call["callId"]
        assert calls[1]["inputPricePerMillion"] == "1.00000000"
        assert calls[1]["outputPricePerMillion"] == "2.00000000"


def test_admin_can_create_patch_test_and_query_without_reading_key() -> None:
    app, gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        created = client.post(
            "/api/admin/llm/models",
            json={
                "model": "openai/fictional-model",
                "apiBase": "https://models.example.invalid/v1",
                "apiKey": "first-fictional-key",
                "enabled": True,
                "priority": 10,
                "inputPricePerMillion": "1.5",
                "outputPricePerMillion": "2",
            },
        )
        assert created.status_code == 201
        model = created.json()["model"]
        assert model["keyConfigured"] is True
        assert "apiKey" not in model
        assert "encryptedApiKey" not in model
        config_id = model["id"]

        with app.state.session_factory() as db:
            config = db.get(LLMModelConfig, int(config_id))
            assert config.encrypted_api_key != "first-fictional-key"
            original_envelope = config.encrypted_api_key

        patched = client.patch(
            f"/api/admin/llm/models/{config_id}",
            json={"priority": 20},
        )
        assert patched.status_code == 200
        with app.state.session_factory() as db:
            assert (
                db.get(LLMModelConfig, int(config_id)).encrypted_api_key
                == original_envelope
            )

        tested = client.post(f"/api/admin/llm/models/{config_id}/test")
        assert tested.status_code == 200
        assert tested.json()["ok"] is True
        assert gateway.api_keys == ["first-fictional-key"]

        replaced = client.patch(
            f"/api/admin/llm/models/{config_id}",
            json={"apiKey": "second-fictional-key"},
        )
        assert replaced.status_code == 200
        assert replaced.json()["model"]["keyConfigured"] is True
        assert client.post(f"/api/admin/llm/models/{config_id}/test").status_code == 200
        assert gateway.api_keys == ["first-fictional-key", "second-fictional-key"]

        cleared = client.patch(
            f"/api/admin/llm/models/{config_id}",
            json={"apiKey": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["model"]["keyConfigured"] is False
        assert client.post(f"/api/admin/llm/models/{config_id}/test").status_code == 200
        assert gateway.api_keys == [
            "first-fictional-key",
            "second-fictional-key",
            None,
        ]

        calls = client.get("/api/admin/llm/calls", params={"modelConfigId": config_id})
        assert calls.status_code == 200
        payload = calls.json()
        assert len(payload["calls"]) == 3
        assert payload["calls"][0]["status"] == "succeeded"
        assert payload["calls"][0]["model"] == "openai/fictional-model"
        assert payload["calls"][0]["modelConfigId"] == config_id
        assert isinstance(payload["calls"][0]["userId"], str)
        assert payload["summary"]["callCount"] == 3
        combined = client.get(
            "/api/admin/llm/calls",
            params={
                "userId": payload["calls"][0]["userId"],
                "modelConfigId": config_id,
                "from": "2020-01-01T00:00:00Z",
                "to": "2030-01-01T00:00:00Z",
            },
        )
        assert combined.status_code == 200
        assert len(combined.json()["calls"]) == 3
        serialized = calls.text
        assert "first-fictional-key" not in serialized
        assert "second-fictional-key" not in serialized
        assert "Reply with OK" not in serialized


def test_invalid_config_returns_stable_400_without_overwrite() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        created = client.post(
            "/api/admin/llm/models",
            json={"model": "valid-model", "priority": 10},
        ).json()["model"]
        config_id = created["id"]

        for invalid in (
            {"model": " "},
            {"model": None},
            {"apiBase": "not-a-url"},
            {"priority": -1},
            {"priority": None},
            {"enabled": None},
            {"inputPricePerMillion": -1},
            {"outputPricePerMillion": -1},
        ):
            response = client.patch(
                f"/api/admin/llm/models/{config_id}", json=invalid
            )
            assert response.status_code == 400
            assert response.json() == {"error": "INVALID_LLM_MODEL_CONFIG"}

        assert client.get("/api/admin/llm/models").json()["models"][0][
            "priority"
        ] == 10


def test_call_log_cursor_handles_mysql_style_naive_datetimes() -> None:
    app, _gateway = build_app()
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        with app.state.session_factory() as db:
            user = db.scalar(
                select(User).where(User.email == "admin@example.invalid")
            )
            assert user is not None
            for index in range(3):
                db.add(
                    LLMCallLog(
                        call_id=f"llmcall_{index:032d}",
                        user_id=user.id,
                        model_name="fictional-model",
                        status="succeeded",
                        metering_status="complete",
                        input_tokens=index + 1,
                        output_tokens=index + 2,
                        input_price_per_million=Decimal("1"),
                        output_price_per_million=Decimal("2"),
                        estimated_cost=Decimal("0.000005"),
                        created_at=datetime(2026, 7, 26, 12, 0, 0),
                    )
                )
            db.commit()

        first = client.get("/api/admin/llm/calls", params={"limit": 1})
        assert first.status_code == 200
        first_payload = first.json()
        assert first_payload["summary"]["callCount"] == 3
        assert first_payload["nextCursor"] is not None
        assert first_payload["calls"][0]["createdAt"].endswith("Z")

        second = client.get(
            "/api/admin/llm/calls",
            params={"limit": 1, "cursor": first_payload["nextCursor"]},
        )
        assert second.status_code == 200
        second_payload = second.json()
        assert second_payload["summary"]["callCount"] == 3
        assert second_payload["calls"][0]["callId"] != first_payload["calls"][0][
            "callId"
        ]


def test_missing_credential_key_rejects_plaintext_and_failure_is_redacted() -> None:
    app, _gateway = build_app(with_key=False)
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        response = client.post(
            "/api/admin/llm/models",
            json={"model": "model", "apiKey": "must-never-leak"},
        )
        assert response.status_code == 503
        assert response.json() == {"error": "LLM_CREDENTIALS_UNAVAILABLE"}
        assert "must-never-leak" not in response.text
        with app.state.session_factory() as db:
            assert db.scalar(select(LLMModelConfig)) is None


def test_connection_failure_is_stable_and_does_not_change_config() -> None:
    app, gateway = build_app()
    gateway.failure = GatewayError(
        switchable=True, may_have_reached_provider=False
    )
    with TestClient(app) as client:
        register(client)
        set_admin(app, "admin@example.invalid", True)
        config_id = client.post(
            "/api/admin/llm/models",
            json={
                "model": "failing-model",
                "apiKey": "sensitive-key",
                "enabled": True,
                "priority": 7,
            },
        ).json()["model"]["id"]

        response = client.post(f"/api/admin/llm/models/{config_id}/test")
        assert response.status_code == 502
        assert response.json() == {"error": "LLM_CONNECTION_FAILED"}
        assert "sensitive-key" not in response.text
        current = client.get("/api/admin/llm/models").json()["models"][0]
        assert current["enabled"] is True
        assert current["priority"] == 7


def test_openapi_exposes_only_admin_llm_routes() -> None:
    app, _gateway = build_app()
    paths = app.openapi()["paths"]

    assert "/api/admin/llm/models" in paths
    assert "/api/admin/llm/calls" in paths
    assert not any("/chat" in path or "/stream" in path for path in paths)
