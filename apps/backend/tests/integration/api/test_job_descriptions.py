from __future__ import annotations

import base64
import hashlib
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.job_descriptions.models import JobDescription
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


def build_app():
    return create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="integration-test-secret-with-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )


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


def test_manual_crud_search_lifecycle_and_hard_delete_release_source() -> None:
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

        archived = client.post(
            f"/api/job-descriptions/{job['id']}/archive",
            json={"base_lock_version": 2},
        )
        assert archived.status_code == 200
        archived_job = archived.json()["job_description"]
        assert archived_job["archived_at"] is not None
        assert archived_job["lock_version"] == 3
        assert client.get("/api/job-descriptions").json()["items"] == []
        assert client.get("/api/job-descriptions?scope=archived").json()["items"][
            0
        ]["id"] == job["id"]

        restored = client.post(
            f"/api/job-descriptions/{job['id']}/restore",
            json={"base_lock_version": 3},
        )
        assert restored.status_code == 200
        assert restored.json()["job_description"]["lock_version"] == 4

        active_delete = client.delete(f"/api/job-descriptions/{job['id']}")
        assert active_delete.status_code == 409
        assert active_delete.json() == {"error": "JD_DELETE_REQUIRES_ARCHIVE"}
        assert client.get(f"/api/job-descriptions/{job['id']}").status_code == 200

        rearchived = client.post(
            f"/api/job-descriptions/{job['id']}/archive",
            json={"base_lock_version": 4},
        )
        assert rearchived.status_code == 200
        assert rearchived.json()["job_description"]["lock_version"] == 5

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
        assert len(client.get("/api/job-descriptions?scope=all").json()["items"]) == 1


def test_archived_duplicate_can_restore_old_content_or_update_and_restore() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        original = create_job(
            client,
            description="旧正文",
            source_type="external_import",
            source_url="https://www.zhipin.com/job_detail/archive42.html",
            notes="继续观察",
        )
        client.post(
            f"/api/job-descriptions/{original['id']}/archive",
            json={"base_lock_version": 1},
        )
        incoming = payload(
            description="新正文",
            source_type="external_import",
            source_url="https://m.zhipin.com/job_detail/archive42.html?from=new",
        )

        duplicate = client.post("/api/job-descriptions", json=incoming)
        assert duplicate.status_code == 409
        assert duplicate.json()["duplicate"]["allowed_actions"] == [
            "restore",
            "update",
            "cancel",
        ]

        incoming["duplicate_resolution"] = {
            "action": "restore",
            "job_description_id": original["id"],
            "base_lock_version": 2,
        }
        restored = client.post("/api/job-descriptions", json=incoming)
        assert restored.status_code == 200
        restored_job = restored.json()["job_description"]
        assert restored_job["description"] == "旧正文"
        assert restored_job["notes"] == "继续观察"
        assert restored_job["archived_at"] is None
        assert restored_job["lock_version"] == 3

        client.post(
            f"/api/job-descriptions/{original['id']}/archive",
            json={"base_lock_version": 3},
        )
        incoming["duplicate_resolution"] = {
            "action": "update",
            "job_description_id": original["id"],
            "base_lock_version": 4,
        }
        updated = client.post("/api/job-descriptions", json=incoming)
        assert updated.status_code == 200
        assert updated.json()["job_description"]["description"] == "新正文"
        assert updated.json()["job_description"]["notes"] == "继续观察"
        assert updated.json()["job_description"]["archived_at"] is None


def test_validation_is_atomic_and_source_fields_are_immutable() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        invalid_payloads = [
            payload(job_title="  "),
            payload(company_name=""),
            payload(description=""),
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
        assert anonymous.get("/api/job-descriptions/1").status_code == 401
        assert anonymous.put(
            "/api/job-descriptions/1",
            json={"notes": "x", "base_lock_version": 1},
        ).status_code == 401
        assert anonymous.post(
            "/api/job-descriptions/1/archive", json={"base_lock_version": 1}
        ).status_code == 401
        assert anonymous.post(
            "/api/job-descriptions/1/restore", json={"base_lock_version": 1}
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
            (
                "post",
                f"/api/job-descriptions/{owned['id']}/archive",
                {"base_lock_version": 1},
            ),
            (
                "post",
                f"/api/job-descriptions/{owned['id']}/restore",
                {"base_lock_version": 1},
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

        first_page = client.get("/api/job-descriptions?scope=all&limit=2").json()
        second_page = client.get(
            "/api/job-descriptions",
            params={"scope": "all", "limit": 2, "cursor": first_page["next_cursor"]},
        ).json()
        combined = [item["id"] for item in first_page["items"] + second_page["items"]]
        assert len(combined) == 3
        assert len(set(combined)) == 3
        assert second_page["next_cursor"] is None

        invalid_cursor = client.get(
            "/api/job-descriptions",
            params={"scope": "archived", "cursor": first_page["next_cursor"]},
        )
        assert invalid_cursor.status_code == 400
        assert invalid_cursor.json() == {"error": "INVALID_JOB_QUERY"}

        encoded_cursor = first_page["next_cursor"]
        assert encoded_cursor is not None
        tampered_cursor = f"{encoded_cursor[:4]}%{encoded_cursor[4:]}"
        invalid_encoding = client.get(
            "/api/job-descriptions",
            params={"scope": "all", "cursor": tampered_cursor},
        )
        assert invalid_encoding.status_code == 400
        assert invalid_encoding.json() == {"error": "INVALID_JOB_QUERY"}

        naive_cursor = base64.urlsafe_b64encode(
            json.dumps(
                {
                    "updated_at": "2026-07-29T12:00:00",
                    "id": first["id"],
                    "scope": "all",
                    "keyword_hash": hashlib.sha256(b"").hexdigest(),
                }
            ).encode("utf-8")
        ).decode("ascii").rstrip("=")
        invalid_timezone = client.get(
            "/api/job-descriptions",
            params={"scope": "all", "cursor": naive_cursor},
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
            lambda _db, _job_id, _user_id: "not_found",
        )

        response = client.delete(f"/api/job-descriptions/{job['id']}")

        assert response.status_code == 404
        assert response.json() == {"error": "JD_NOT_FOUND"}
