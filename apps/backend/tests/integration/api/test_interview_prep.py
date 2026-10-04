from __future__ import annotations

import json
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.llm.gateway import GatewayResult, GatewayUsage
from linkresume.modules.llm.models import (
    LLMModel,
    LLMModelRoute,
    LLMProviderConnection,
    LLMUseCaseRoute,
)
from linkresume.modules.llm.resolver import INTERVIEW_PREP, validation_fingerprint
from tests.fakes import FakeRedis
from tests.integration.api.test_interviews import (
    FakeStorage,
    create_application,
    create_job,
    register,
    session_payload,
)

USAGE = GatewayUsage(input_tokens=10, output_tokens=5)


def suggestion(index: int, **overrides: object) -> dict[str, object]:
    return {
        "title": f"准备事项{index}",
        "category": "technical",
        "reason": f"岗位要求第{index}条",
        **overrides,
    }


class PrepGateway:
    def __init__(self) -> None:
        self.calls = 0
        self.user_messages: list[str] = []
        self.replies: list[str] = []

    def push(self, items: list[dict[str, object]]) -> None:
        self.replies.append(json.dumps({"items": items}, ensure_ascii=False))

    async def complete(self, *, model, messages, api_base, api_key, protocol_code="openai_chat") -> GatewayResult:
        del model, api_base, api_key
        self.calls += 1
        self.user_messages.append(
            "\n".join(m.content for m in messages if m.role == "user" and isinstance(m.content, str))
        )
        content = self.replies.pop(0) if self.replies else "not json"
        return GatewayResult(content=content, usage=USAGE)


@pytest.fixture
def database_url(tmp_path) -> str:
    # The generation runs on worker threads, so use per-thread file connections.
    return f"sqlite+pysqlite:///{tmp_path / f'prep-{uuid4().hex}.db'}"


def build_app(database_url: str, gateway: PrepGateway, *, configure: bool = True):
    app = create_app(
        Settings(
            database_url=database_url,
            jwt_secret="integration-test-secret-with-32-bytes",
            llm_credential_encryption_keys=f"test:{Fernet.generate_key().decode('ascii')}",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        llm_gateway=gateway,
        create_schema=True,
    )
    if configure:
        with app.state.session_factory() as db:
            connection = LLMProviderConnection(
                provider_code="aihubmix",
                name="测试",
                credential_ciphertext=app.state.llm_service.encrypt_credential(
                    json.dumps({"api_key": "fictional-key"})
                ),
                settings_json={},
                enabled=True,
                runtime_config_version=1,
            )
            db.add(connection)
            db.flush()
            model = LLMModel(display_name="prep-model")
            db.add(model)
            db.flush()
            route = LLMModelRoute(
                model_id=model.id,
                connection_id=connection.id,
                target_kind="model",
                invoke_target="prep-model",
                origin="manual",
                enabled=True,
                target_available=True,
            )
            db.add(route)
            db.flush()
            binding = LLMUseCaseRoute(
                use_case=INTERVIEW_PREP,
                route_id=route.id,
                protocol_code="openai_chat",
                priority=100,
                enabled=True,
                validated_at=utc_now(),
            )
            db.add(binding)
            db.flush()
            binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
            db.commit()
    return app


def create_session(client: TestClient) -> dict[str, object]:
    application = create_application(client, create_job(client, "虚构科技"))
    response = client.post(
        f"/api/job-applications/{application['id']}/interview-sessions",
        json=session_payload(str(uuid4())),
    )
    assert response.status_code == 201, response.text
    return response.json()["session"]


def generate(client: TestClient, session_id: str):
    return client.post(f"/api/interview-sessions/{session_id}/prep-items:generate")


def test_generate_stores_items_once_and_reports_progress(database_url) -> None:
    gateway = PrepGateway()
    gateway.push([suggestion(index) for index in range(1, 6)])
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "prep@example.com")
        session = create_session(client)
        assert session["prep_items"] == []
        assert session["prep_generated_at"] is None
        assert session["prep_total"] == 0

        response = generate(client, session["id"])
        assert response.status_code == 200, response.text
        body = response.json()["session"]
        assert [item["title"] for item in body["prep_items"]] == [f"准备事项{i}" for i in range(1, 6)]
        assert all(item["id"] and item["done"] is False for item in body["prep_items"])
        assert body["prep_generated_at"] is not None
        assert (body["prep_total"], body["prep_done"]) == (5, 0)
        assert body["lock_version"] == session["lock_version"] + 1
        prompt = gateway.user_messages[0]
        assert "虚构科技" in prompt and "后端开发工程师" in prompt and "一面" in prompt
        assert "没有关联简历" in prompt

        listed = client.get("/api/interview-sessions").json()["items"]
        assert (listed[0]["prep_total"], listed[0]["prep_done"]) == (5, 0)

        again = generate(client, session["id"])
        assert again.status_code == 409
        assert again.json()["error"] == "INTERVIEW_PREP_ALREADY_GENERATED"
        assert gateway.calls == 1


def test_failed_generation_does_not_use_up_the_single_attempt(database_url) -> None:
    gateway = PrepGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "prep-retry@example.com")
        session = create_session(client)

        failed = generate(client, session["id"])
        assert failed.status_code == 502
        assert failed.json()["error"] == "LLM_RESPONSE_INVALID"
        assert gateway.calls == 2  # one retry on an invalid structure
        detail = client.get(f"/api/interview-sessions/{session['id']}").json()["session"]
        assert detail["prep_generated_at"] is None and detail["prep_items"] == []

        gateway.push([suggestion(1)])
        retried = generate(client, session["id"])
        assert retried.status_code == 200, retried.text
        assert retried.json()["session"]["prep_total"] == 1


def test_generation_requires_configured_model(database_url) -> None:
    gateway = PrepGateway()
    app = build_app(database_url, gateway, configure=False)
    with TestClient(app) as client:
        register(client, "prep-unconfigured@example.com")
        session = create_session(client)
        response = generate(client, session["id"])
        assert response.status_code == 503
        assert response.json()["error"] == "LLM_MODEL_NOT_CONFIGURED"
        assert gateway.calls == 0


def test_generation_is_owner_only_and_blocked_after_the_interview_ends(database_url) -> None:
    gateway = PrepGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "prep-owner@example.com")
        register(other, "prep-other@example.com")
        session = create_session(owner)

        assert generate(other, session["id"]).status_code == 404

        cancelled = owner.post(
            f"/api/interview-sessions/{session['id']}/cancel",
            json={"base_lock_version": session["lock_version"]},
        )
        assert cancelled.status_code == 200, cancelled.text
        blocked = generate(owner, session["id"])
        assert blocked.status_code == 409
        assert blocked.json()["error"] == "INTERVIEW_INVALID_TRANSITION"
        assert gateway.calls == 0


def test_generated_items_are_deduplicated_and_capped(database_url) -> None:
    gateway = PrepGateway()
    items = [suggestion(index) for index in range(1, 11)]
    items.insert(1, suggestion(1, title=" 准备事项1 "))
    items.append(suggestion(99, title="长" * 120))
    gateway.push(items)
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "prep-cap@example.com")
        session = create_session(client)
        body = generate(client, session["id"]).json()["session"]
        titles = [item["title"] for item in body["prep_items"]]
        assert len(titles) == 8
        assert len(set(titles)) == 8


def test_manual_edits_validate_and_keep_the_single_generation_spent(database_url) -> None:
    gateway = PrepGateway()
    gateway.push([suggestion(1), suggestion(2)])
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "prep-edit@example.com")
        session = create_session(client)
        url = f"/api/interview-sessions/{session['id']}"

        added = client.put(
            url,
            json={
                "prep_items": [
                    {"title": "  准备事项1  ", "category": "intro"},
                    {"id": "same", "title": "手写事项"},
                    {"id": "same", "title": "重复 id"},
                ],
                "base_lock_version": session["lock_version"],
            },
        )
        assert added.status_code == 200, added.text
        items = added.json()["session"]["prep_items"]
        assert [item["title"] for item in items] == ["准备事项1", "手写事项", "重复 id"]
        assert len({item["id"] for item in items}) == 3
        assert added.json()["session"]["prep_generated_at"] is None

        too_many = client.put(
            url,
            json={
                "prep_items": [{"title": f"事项{i}"} for i in range(13)],
                "base_lock_version": added.json()["session"]["lock_version"],
            },
        )
        assert too_many.status_code == 400
        blank = client.put(
            url,
            json={
                "prep_items": [{"title": "   "}],
                "base_lock_version": added.json()["session"]["lock_version"],
            },
        )
        assert blank.status_code == 400

        merged = generate(client, session["id"])
        assert merged.status_code == 200, merged.text
        merged_session = merged.json()["session"]
        # The user's duplicate title is kept once; only the new AI item is appended.
        assert [item["title"] for item in merged_session["prep_items"]] == [
            "准备事项1",
            "手写事项",
            "重复 id",
            "准备事项2",
        ]

        cleared = client.put(
            url,
            json={
                "prep_items": [],
                "base_lock_version": merged_session["lock_version"],
            },
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["session"]["prep_items"] == []
        assert cleared.json()["session"]["prep_generated_at"] is not None
        assert generate(client, session["id"]).status_code == 409

        stale = client.put(
            url,
            json={"prep_items": [], "base_lock_version": session["lock_version"]},
        )
        assert stale.status_code == 409
        assert stale.json()["error"] == "INTERVIEW_EDIT_CONFLICT"
