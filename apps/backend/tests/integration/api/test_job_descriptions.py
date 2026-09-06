from __future__ import annotations

import base64
import hashlib
import json
from io import BytesIO
from decimal import Decimal

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from linkcv.application.job_descriptions.ai_import_service import draft_warnings
from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.job_descriptions.models import JobDescription
from linkcv.modules.job_descriptions.schemas import JobDescriptionDraft
from linkcv.modules.llm.gateway import GatewayResult, GatewayUsage
from linkcv.modules.llm.models import LLMCapabilityBinding, LLMModelConfig
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class DraftGateway:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def complete(self, *, model, messages, api_base, api_key, disable_thinking=False):
        self.calls.append({"model": model, "messages": messages, "api_key": api_key})
        content = (
            '{"job_title":"视觉工程师","company_name":"示例科技",'
            '"description":"负责视觉模型应用","skills":["Python"],'
            '"work_city":"上海"}'
            if model.endswith("vision-model")
            else '{"job_title":"平台工程师","company_name":"示例科技",'
            '"description":"负责内部平台建设","skills":["Go","Kubernetes"]}'
        )
        return GatewayResult(
            content=content,
            usage=GatewayUsage(20, 8),
            input_price_per_million=Decimal("1"),
            output_price_per_million=Decimal("2"),
        )

    async def start_stream(self, **_kwargs):
        raise AssertionError("draft parsing must not stream")


def build_app(*, llm_gateway=None, with_llm_key: bool = False):
    return create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="integration-test-secret-with-32-bytes",
            llm_credential_encryption_keys=(
                f"test:{Fernet.generate_key().decode('ascii')}"
                if with_llm_key
                else None
            ),
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        llm_gateway=llm_gateway,
        create_schema=True,
    )


def configure_draft_models(app) -> None:
    with app.state.session_factory() as db:
        chat = LLMModelConfig(
            adapter="deepseek",
            model_call_name="chat-model",
            model_name="deepseek/chat-model",
            encrypted_api_key=app.state.llm_service.encrypt_credential("fictional-chat-key"),
            enabled=True,
            priority=100,
            config_version=1,
        )
        vision = LLMModelConfig(
            adapter="deepseek",
            model_call_name="vision-model",
            model_name="deepseek/vision-model",
            encrypted_api_key=app.state.llm_service.encrypt_credential("fictional-vision-key"),
            enabled=True,
            priority=100,
            config_version=1,
        )
        db.add_all([chat, vision])
        db.flush()
        chat_binding = db.get(LLMCapabilityBinding, "chat")
        image_binding = db.get(LLMCapabilityBinding, "job_image_structuring")
        assert chat_binding is not None and image_binding is not None
        chat_binding.model_config_id = chat.id
        image_binding.model_config_id = vision.id
        db.commit()


def png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), (255, 255, 255)).save(output, format="PNG")
    return output.getvalue()


def test_draft_warnings_do_not_require_job_description() -> None:
    warnings = draft_warnings(
        JobDescriptionDraft(job_title="平台工程师", company_name="示例科技")
    )

    assert warnings == []


def register(client: TestClient, email: str = "zhangsan@example.test") -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def payload(**overrides: object) -> dict[str, object]:
    result: dict[str, object] = {
        "job_title": "Java 开发实习生",
        "company_name": "示例科技",
        "description": "## 岗位职责\n\n参与后端业务开发。",
        "skills": [" Java ", "", "MySQL", "Java"],
        "source_type": "manual",
    }
    result.update(overrides)
    return result


def create_job(client: TestClient, **overrides: object) -> dict[str, object]:
    response = client.post("/api/job-descriptions", json=payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()["job_description"]


def test_parse_text_and_image_drafts_use_separate_models_without_creating_jobs() -> None:
    gateway = DraftGateway()
    app = build_app(llm_gateway=gateway, with_llm_key=True)
    configure_draft_models(app)
    with TestClient(app) as client:
        register(client)

        text_response = client.post(
            "/api/job-descriptions/parse-draft",
            files={"text": (None, "示例科技招聘平台工程师，负责内部平台建设")},
        )
        assert text_response.status_code == 200, text_response.text
        assert text_response.json()["draft"]["job_title"] == "平台工程师"
        assert text_response.json()["inputType"] == "text"
        assert text_response.json()["callId"].startswith("llmcall_")

        image_response = client.post(
            "/api/job-descriptions/parse-draft",
            files={"image": ("job.png", png_bytes(), "image/png")},
        )
        assert image_response.status_code == 200, image_response.text
        assert image_response.json()["draft"]["job_title"] == "视觉工程师"
        assert image_response.json()["inputType"] == "image"

        assert [call["model"] for call in gateway.calls] == [
            "deepseek/chat-model",
            "deepseek/vision-model",
        ]
        image_messages = gateway.calls[1]["messages"]
        assert isinstance(image_messages[-1].content, list)
        assert image_messages[-1].content[-1].image_url.url.startswith(
            "data:image/png;base64,"
        )
        with app.state.session_factory() as db:
            assert db.scalar(select(func.count()).select_from(JobDescription)) == 0


def test_parse_draft_validates_auth_mutual_exclusion_and_image_content() -> None:
    gateway = DraftGateway()
    app = build_app(llm_gateway=gateway, with_llm_key=True)
    configure_draft_models(app)
    with TestClient(app) as client:
        assert client.post(
            "/api/job-descriptions/parse-draft",
            files={"text": (None, "岗位文字")},
        ).status_code == 401
        register(client)

        both = client.post(
            "/api/job-descriptions/parse-draft",
            files={
                "text": (None, "岗位文字"),
                "image": ("job.png", png_bytes(), "image/png"),
            },
        )
        assert both.status_code == 400
        assert both.json() == {"error": "JD_IMPORT_INPUT_AMBIGUOUS"}

        invalid = client.post(
            "/api/job-descriptions/parse-draft",
            files={"image": ("fake.png", b"not-an-image", "image/png")},
        )
        assert invalid.status_code == 400
        assert invalid.json() == {"error": "JD_IMPORT_IMAGE_INVALID"}
        assert gateway.calls == []


def test_parse_image_without_bound_model_returns_retryable_error() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/job-descriptions/parse-draft",
            files={"image": ("job.png", png_bytes(), "image/png")},
        )
        assert response.status_code == 503
        assert response.json()["error"] == "JD_IMPORT_MODEL_NOT_CONFIGURED"
        assert response.json()["inputType"] == "image"
        assert response.json()["callId"].startswith("llmcall_")


def import_payload(**overrides: object) -> dict[str, object]:
    capture: dict[str, object] = {
        "job_title": "  Python  后端工程师 ",
        "company_name": "示例 科技",
        "description_text": "职位描述\n\n负责 API 开发。\n\n举报\n无关页尾",
        "skills": ["生日福利", "高温补贴", "Python", " FastAPI ", "Python", "全勤奖"],
        "salary_text": "15-25K·13薪",
        "experience_text": "5天/周 6个月",
        "education_text": "本科",
        "work_city": "上海",
        "company_tags": ["企业服务", "100-499人", "B轮"],
    }
    capture.update(overrides.pop("capture", {}))
    result: dict[str, object] = {
        "source_url": "https://www.zhipin.com/job_detail/import42.html?ka=detail",
        "capture": capture,
    }
    result.update(overrides)
    return result


def test_manual_create_allows_omitted_job_description() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        request_payload = payload(job_title="无描述岗位")
        request_payload.pop("description")

        response = client.post("/api/job-descriptions", json=request_payload)

        assert response.status_code == 201
        assert response.json()["job_description"]["description"] == ""


def test_manual_crud_search_and_direct_delete_release_source() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        job = create_job(
            client,
            salary_text="150-170 元/天",
            work_city="NanJing",
            notes="周末沟通",
            source_url="https://example.test/jobs/42?utm_source=test#apply",
        )

        assert job["id"].isdecimal()
        assert job["skills"] == ["Java", "MySQL"]
        assert job["lock_version"] == 1
        assert job["source_type"] == "manual"
        assert job["source_site"] == "web"
        assert job["source_url"] == "https://example.test/jobs/42"
        assert len(job["source_url_hash"]) == 64
        assert job["imported_at"] is None
        assert job["created_at"].endswith("Z")
        assert job["updated_at"].endswith("Z")
        assert "archived_at" not in job

        listed = client.get("/api/job-descriptions").json()
        assert [item["id"] for item in listed["items"]] == [job["id"]]
        assert client.get("/api/job-descriptions?keyword=mysql").json()["items"][0][
            "id"
        ] == job["id"]
        assert client.get("/api/job-descriptions?keyword=nanJING").json()["items"][
            0
        ]["id"] == job["id"]

        updated = client.put(
            f"/api/job-descriptions/{job['id']}",
            json={
                "job_title": "高级 Java 开发实习生",
                "salary_min": "150.00",
                "salary_max": "170.00",
                "salary_currency": "cny",
                "salary_period": "day",
                "base_lock_version": 1,
            },
        )
        assert updated.status_code == 200
        current = updated.json()["job_description"]
        assert current["job_title"] == "高级 Java 开发实习生"
        assert current["salary_min"] == "150.00"
        assert current["salary_currency"] == "CNY"
        assert current["lock_version"] == 2
        assert current["source_url"] == job["source_url"]

        stale = client.put(
            f"/api/job-descriptions/{job['id']}",
            json={"notes": "过期修改", "base_lock_version": 1},
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "JD_EDIT_CONFLICT"}

        assert client.post(
            f"/api/job-descriptions/{job['id']}/archive",
            json={"base_lock_version": 2},
        ).status_code == 404
        assert client.post(
            f"/api/job-descriptions/{job['id']}/restore",
            json={"base_lock_version": 2},
        ).status_code == 404

        deleted = client.delete(f"/api/job-descriptions/{job['id']}")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}
        assert client.get(f"/api/job-descriptions/{job['id']}").status_code == 404

        replacement = create_job(
            client,
            source_url="https://example.test/jobs/42?new_tracking=1",
        )
        assert replacement["id"] != job["id"]


def test_external_boss_duplicate_update_preserves_source_identity_and_notes() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        original = create_job(
            client,
            source_type="external_import",
            source_url="https://www.zhipin.com/job_detail/abc123.html?ka=search",
            notes="准备周末沟通",
        )
        assert original["source_site"] == "boss"
        assert original["source_job_id"] == "abc123"
        assert original["imported_at"].endswith("Z")

        duplicate_payload = payload(
            job_title="更新后的岗位",
            source_type="external_import",
            source_url="http://m.zhipin.com/job_detail/abc123.html#from-mobile",
            notes="上游不应覆盖此备注",
        )
        conflict = client.post("/api/job-descriptions", json=duplicate_payload)
        assert conflict.status_code == 409
        body = conflict.json()
        assert body["error"] == "JD_SOURCE_DUPLICATE"
        assert body["duplicate"]["existing"]["id"] == original["id"]
        assert body["duplicate"]["allowed_actions"] == ["update", "cancel"]
        assert client.get(f"/api/job-descriptions/{original['id']}").json()[
            "job_description"
        ]["job_title"] == "Java 开发实习生"

        duplicate_payload["duplicate_resolution"] = {
            "action": "update",
            "job_description_id": original["id"],
            "base_lock_version": 1,
        }
        resolved = client.post("/api/job-descriptions", json=duplicate_payload)
        assert resolved.status_code == 200
        updated = resolved.json()["job_description"]
        assert updated["id"] == original["id"]
        assert updated["job_title"] == "更新后的岗位"
        assert updated["notes"] == "准备周末沟通"
        assert updated["source_url"] == original["source_url"]
        assert updated["imported_at"] == original["imported_at"]
        assert updated["lock_version"] == 2
        assert len(client.get("/api/job-descriptions").json()["items"]) == 1


def test_browser_capture_import_is_cleaned_stored_and_uses_existing_duplicate_flow() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)

        response = client.post("/api/job-descriptions/import", json=import_payload())

        assert response.status_code == 201, response.text
        created = response.json()["job_description"]
        assert created["job_title"] == "Python 后端工程师"
        assert created["description"] == "负责 API 开发。"
        assert created["skills"] == ["Python", "FastAPI"]
        assert created["experience_requirement"] is None
        assert created["work_schedule"] == "5天/周 6个月"
        assert created["salary_min"] == "15000.00"
        assert created["salary_max"] == "25000.00"
        assert created["salary_period"] == "month"
        assert created["salary_months_per_year"] == 13
        assert created["company_industry"] == "企业服务"
        assert created["company_size"] == "100-499人"
        assert created["company_financing_stage"] == "B轮"
        assert created["source_site"] == "boss"
        assert created["source_job_id"] == "import42"
        assert created["source_url"] == (
            "https://www.zhipin.com/job_detail/import42.html"
        )

        conflict = client.post(
            "/api/job-descriptions/import",
            json=import_payload(capture={"job_title": "更新后的岗位"}),
        )
        assert conflict.status_code == 409
        duplicate = conflict.json()["duplicate"]
        assert duplicate["existing"]["id"] == created["id"]
        assert duplicate["allowed_actions"] == ["update", "cancel"]

        resolved_payload = import_payload(capture={"job_title": "更新后的岗位"})
        resolved_payload["duplicate_resolution"] = {
            "action": "update",
            "job_description_id": created["id"],
            "base_lock_version": created["lock_version"],
        }
        resolved = client.post(
            "/api/job-descriptions/import", json=resolved_payload
        )
        assert resolved.status_code == 200
        assert resolved.json()["job_description"]["job_title"] == "更新后的岗位"


def test_browser_capture_import_rejects_invalid_contract_without_writing() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        invalid_payloads = [
            import_payload(source_url="https://example.test/jobs/42"),
            import_payload(capture={"description_text": "  "}),
            import_payload(capture={"job_title": "x" * 201}),
            {"source_url": "https://www.zhipin.com/job_detail/abc.html", "capture": {}, "unexpected": True},
        ]

        for invalid in invalid_payloads:
            response = client.post("/api/job-descriptions/import", json=invalid)
            assert response.status_code == 400
            assert response.json() == {"error": "INVALID_JOB_IMPORT"}

        with app.state.session_factory() as session:
            assert session.scalar(select(func.count(JobDescription.id))) == 0


def test_validation_is_atomic_and_source_fields_are_immutable() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        invalid_payloads = [
            payload(job_title="  "),
            payload(company_name=""),
            payload(
                description="",
                source_type="external_import",
                source_url="https://example.test/jobs/no-description",
            ),
            payload(salary_min="10", salary_currency="CNY"),
            payload(salary_min="20", salary_max="10", salary_currency="CNY", salary_period="day"),
            payload(user_id="999"),
        ]
        for invalid in invalid_payloads:
            response = client.post("/api/job-descriptions", json=invalid)
            assert response.status_code == 400
            assert response.json() == {"error": "INVALID_JOB_DESCRIPTION"}

        missing_source = client.post(
            "/api/job-descriptions",
            json=payload(source_type="external_import"),
        )
        assert missing_source.status_code == 400
        assert missing_source.json() == {"error": "INVALID_JOB_SOURCE"}

        job = create_job(client)
        immutable = client.put(
            f"/api/job-descriptions/{job['id']}",
            json={
                "source_url": "https://example.test/jobs/other",
                "base_lock_version": 1,
            },
        )
        assert immutable.status_code == 400
        assert immutable.json() == {"error": "INVALID_JOB_DESCRIPTION"}
        assert client.get(f"/api/job-descriptions/{job['id']}").json()[
            "job_description"
        ]["lock_version"] == 1

        with app.state.session_factory() as session:
            assert session.scalar(select(func.count(JobDescription.id))) == 1


def test_authentication_ownership_and_user_scoped_uniqueness() -> None:
    app = build_app()
    with TestClient(app) as anonymous:
        assert anonymous.get("/api/job-descriptions").status_code == 401
        assert anonymous.post("/api/job-descriptions", json=payload()).status_code == 401
        assert anonymous.post(
            "/api/job-descriptions/import", json=import_payload()
        ).status_code == 401
        assert anonymous.get("/api/job-descriptions/1").status_code == 401
        assert anonymous.put(
            "/api/job-descriptions/1",
            json={"notes": "x", "base_lock_version": 1},
        ).status_code == 401
        assert anonymous.delete("/api/job-descriptions/1").status_code == 401

    with TestClient(app) as owner:
        register(owner, "owner@example.test")
        owned = create_job(
            owner,
            source_type="external_import",
            source_url="https://www.zhipin.com/job_detail/shared42.html",
        )

    with TestClient(app) as stranger:
        register(stranger, "stranger@example.test")
        for method, path, body in [
            ("get", f"/api/job-descriptions/{owned['id']}", None),
            (
                "put",
                f"/api/job-descriptions/{owned['id']}",
                {"notes": "越权", "base_lock_version": 1},
            ),
            ("delete", f"/api/job-descriptions/{owned['id']}", None),
        ]:
            response = getattr(stranger, method)(path, json=body) if body else getattr(stranger, method)(path)
            assert response.status_code == 404
            assert response.json() == {"error": "JD_NOT_FOUND"}

        other = create_job(
            stranger,
            source_type="external_import",
            source_url="https://m.zhipin.com/job_detail/shared42.html",
        )
        assert other["id"] != owned["id"]
        assert [item["id"] for item in stranger.get("/api/job-descriptions").json()["items"]] == [other["id"]]


def test_source_less_manual_jobs_are_not_content_deduplicated_and_pagination_is_stable() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        first = create_job(client)
        second = create_job(client)
        third = create_job(client, job_title="Python 开发")
        assert len({first["id"], second["id"], third["id"]}) == 3

        first_page = client.get("/api/job-descriptions?limit=2").json()
        second_page = client.get(
            "/api/job-descriptions",
            params={"limit": 2, "cursor": first_page["next_cursor"]},
        ).json()
        combined = [item["id"] for item in first_page["items"] + second_page["items"]]
        assert len(combined) == 3
        assert len(set(combined)) == 3
        assert second_page["next_cursor"] is None

        invalid_cursor = client.get(
            "/api/job-descriptions",
            params={"keyword": "different", "cursor": first_page["next_cursor"]},
        )
        assert invalid_cursor.status_code == 400
        assert invalid_cursor.json() == {"error": "INVALID_JOB_QUERY"}

        encoded_cursor = first_page["next_cursor"]
        assert encoded_cursor is not None
        tampered_cursor = f"{encoded_cursor[:4]}%{encoded_cursor[4:]}"
        invalid_encoding = client.get(
            "/api/job-descriptions",
            params={"cursor": tampered_cursor},
        )
        assert invalid_encoding.status_code == 400
        assert invalid_encoding.json() == {"error": "INVALID_JOB_QUERY"}

        naive_cursor = base64.urlsafe_b64encode(
            json.dumps(
                {
                    "updated_at": "2026-07-29T12:00:00",
                    "id": first["id"],
                    "keyword_hash": hashlib.sha256(b"").hexdigest(),
                }
            ).encode("utf-8")
        ).decode("ascii").rstrip("=")
        invalid_timezone = client.get(
            "/api/job-descriptions",
            params={"cursor": naive_cursor},
        )
        assert invalid_timezone.status_code == 400
        assert invalid_timezone.json() == {"error": "INVALID_JOB_QUERY"}


def test_delete_reports_not_found_if_target_disappears_during_atomic_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        job = create_job(client)
        monkeypatch.setattr(
            "linkcv.modules.job_descriptions.routes.hard_delete_owned_job",
            lambda _db, _job_id, _user_id: False,
        )

        response = client.delete(f"/api/job-descriptions/{job['id']}")

        assert response.status_code == 404
        assert response.json() == {"error": "JD_NOT_FOUND"}
