from types import SimpleNamespace

from fastapi.testclient import TestClient

from linkresume.modules.browser_extension.schemas import FieldDecision
from linkresume.modules.llm.service import LLMError
from tests.integration.api.test_interviews import build_app, create_resume, register


def test_extension_resumes_are_private_minimal_and_read_only():
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as other:
        assert owner.get("/api/browser-extension/resumes").status_code == 401
        register(owner, "owner@example.test")
        resume = create_resume(owner, app)
        register(other, "other@example.test")
        assert other.get(f"/api/resumes/{resume['id']}/autofill-profile").status_code == 404
        assert other.get("/api/browser-extension/resumes").json()["resumes"] == []
        listing = owner.get("/api/browser-extension/resumes").json()
        assert set(listing["resumes"][0]) == {"id", "title", "lock_version", "updated_at"}
        snapshot = owner.get(f"/api/resumes/{resume['id']}/autofill-profile").json()
        assert snapshot["user_id"] == listing["user_id"] and snapshot["resume_id"] == resume["id"]
        assert snapshot["version"] == 1 and "style" not in snapshot and "data" not in snapshot
        assert owner.get(f"/api/resumes/{resume['id']}").json()["resume"]["lock_version"] == resume["lock_version"]


def test_decisions_require_login_bound_metadata_and_rate_budget():
    app = build_app()
    calls = []
    async def decide(user_id, messages, **kwargs):
        calls.append((user_id, messages, kwargs))
        return SimpleNamespace(value=FieldDecision(choice="education.school", prob=0.95, ranked=[("education.school", 0.95)]))
    app.state.llm_service.structured_chat = decide
    payload = {"version": 1, "field": {"uid": "one", "kind": "input:text", "label": "毕业院校"}}
    with TestClient(app) as client:
        assert client.post("/api/browser-extension/autofill/decisions", json=payload).status_code == 401
        register(client, "decision@example.test")
        invalid = {**payload, "field": {**payload["field"], "value": "private"}}
        assert client.post("/api/browser-extension/autofill/decisions", json=invalid).status_code == 422
        response = client.post("/api/browser-extension/autofill/decisions", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["choice"] == "education.school"
        assert calls[0][2]["use_case"] == "browser_autofill"
        key = f"browser-autofill:decisions:{calls[0][0]}"
        app.state.redis.strings[key] = "240"
        assert client.post("/api/browser-extension/autofill/decisions", json=payload).status_code == 429
        assert len(calls) == 1


def test_missing_model_has_actionable_error():
    app = build_app()
    async def unavailable(*args, **kwargs):
        raise LLMError("LLM_MODEL_NOT_CONFIGURED")
    app.state.llm_service.structured_chat = unavailable
    with TestClient(app) as client:
        register(client, "unconfigured@example.test")
        response = client.post("/api/browser-extension/autofill/decisions", json={"version": 1, "field": {"uid": "one", "kind": "input"}})
        assert response.status_code == 503 and response.json()["error"] == "LLM_MODEL_NOT_CONFIGURED"
