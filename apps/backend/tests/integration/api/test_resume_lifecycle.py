from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.resumes.models import ResumeTemplate, ResumeVersion
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass

    def delete(self, _object_name: str) -> None:
        pass

    def delete_prefix(self, _prefix: str) -> None:
        pass


def build_app(version_limit: int = 10):
    return create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="resume-lifecycle-test-secret-32-bytes",
            resume_version_limit=version_limit,
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )


def register(client: TestClient, email: str = "owner@example.com") -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def test_blank_create_update_versions_and_restore() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        created = client.post("/api/resumes", json={})
        assert created.status_code == 201
        resume = created.json()["resume"]
        assert resume["data"]["schema_version"] == "1.0"
        assert resume["style"]["schema_version"] == "1.0"
        assert resume["lock_version"] == 1
        resume_id = resume["id"]

        with app.state.session_factory() as session:
            initial = session.scalar(
                select(ResumeVersion).where(ResumeVersion.resume_id == int(resume_id))
            )
            assert initial is not None
            assert (initial.version_no, initial.reason) == (1, "initial")

        first_data = resume["data"]
        first_data["basics"]["headline"] = "第一次保存"
        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={"data": first_data, "base_lock_version": 1},
        )
        assert updated.status_code == 200
        assert updated.json()["resume"]["lock_version"] == 2

        conflict = client.put(
            f"/api/resumes/{resume_id}",
            json={"title": "过期写入", "base_lock_version": 1},
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_EDIT_CONFLICT"}

        versions_before_manual = client.get(
            f"/api/resumes/{resume_id}/versions"
        ).json()["versions"]
        assert [(item["version_no"], item["reason"]) for item in versions_before_manual] == [
            (1, "initial")
        ]

        invalid = client.put(
            f"/api/resumes/{resume_id}",
            json={
                "data": {**first_data, "schema_version": "99.0"},
                "base_lock_version": 2,
            },
        )
        assert invalid.status_code == 400
        assert invalid.json() == {"error": "INVALID_RESUME_DOCUMENT"}

        manual = client.post(f"/api/resumes/{resume_id}/versions")
        assert manual.status_code == 201
        assert manual.json()["version"]["reason"] == "manual"
        assert manual.json()["version"]["version_no"] == 2

        second_data = updated.json()["resume"]["data"]
        second_data["basics"]["headline"] = "尚未保存版本的草稿"
        saved = client.put(
            f"/api/resumes/{resume_id}",
            json={"data": second_data, "base_lock_version": 2},
        )
        assert saved.status_code == 200

        restored = client.post(f"/api/resumes/{resume_id}/versions/1/restore")
        assert restored.status_code == 200
        restored_resume = restored.json()["resume"]
        assert restored_resume["data"]["basics"]["headline"] == "后端开发工程师"
        assert restored_resume["lock_version"] == 4

        versions = client.get(f"/api/resumes/{resume_id}/versions").json()["versions"]
        assert [(item["version_no"], item["reason"]) for item in versions] == [
            (4, "restore"),
            (3, "before_restore"),
            (2, "manual"),
            (1, "initial"),
        ]


def test_template_creation_copies_snapshot_and_filters_inactive_templates() -> None:
    app = build_app()
    with app.state.session_factory() as session:
        active = ResumeTemplate(
            key="classic-cn",
            name="经典中文",
            description="示例模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style().model_dump(mode="json"),
            is_active=1,
        )
        inactive = ResumeTemplate(
            key="inactive",
            name="已停用",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style().model_dump(mode="json"),
            is_active=0,
        )
        session.add_all([active, inactive])
        session.commit()
        active_id = str(active.id)
        inactive_id = str(inactive.id)

    with TestClient(app) as client:
        listed = client.get("/api/resume-templates")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["templates"]] == [active_id]

        register(client)
        created = client.post(
            "/api/resumes",
            json={"title": "模板简历", "template_id": active_id},
        )
        assert created.status_code == 201
        assert created.json()["resume"]["source_type"] == "template"
        assert created.json()["resume"]["template_id"] == active_id

        rejected = client.post("/api/resumes", json={"template_id": inactive_id})
        assert rejected.status_code == 422
        assert rejected.json() == {"error": "TEMPLATE_INACTIVE"}


def test_resume_limit_rejects_eleventh_and_delete_releases_slot() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume_ids = []
        for index in range(10):
            created = client.post("/api/resumes", json={"title": f"简历 {index + 1}"})
            assert created.status_code == 201
            resume_ids.append(created.json()["resume"]["id"])

        rejected = client.post("/api/resumes", json={"title": "第十一份"})
        assert rejected.status_code == 409
        assert rejected.json() == {"error": "RESUME_LIMIT_REACHED"}
        assert len(client.get("/api/resumes").json()["resumes"]) == 10

        assert client.delete(f"/api/resumes/{resume_ids[0]}").status_code == 200
        replacement = client.post("/api/resumes", json={"title": "替补简历"})
        assert replacement.status_code == 201
        assert len(client.get("/api/resumes").json()["resumes"]) == 10


def test_other_user_cannot_access_resume_versions() -> None:
    app = build_app()
    with TestClient(app) as owner:
        register(owner, "owner@example.com")
        resume_id = owner.post("/api/resumes", json={}).json()["resume"]["id"]

    with TestClient(app) as stranger:
        register(stranger, "stranger@example.com")
        assert stranger.get(f"/api/resumes/{resume_id}").status_code == 404
        assert stranger.put(
            f"/api/resumes/{resume_id}",
            json={"title": "越权修改", "base_lock_version": 1},
        ).status_code == 404
        assert stranger.delete(f"/api/resumes/{resume_id}").status_code == 404
        assert stranger.get(f"/api/resumes/{resume_id}/versions").status_code == 404
        assert stranger.post(f"/api/resumes/{resume_id}/versions").status_code == 404
        assert stranger.delete(f"/api/resumes/{resume_id}/versions/1").status_code == 404
        assert (
            stranger.post(f"/api/resumes/{resume_id}/versions/1/restore").status_code
            == 404
        )


def test_version_limit_requires_user_to_delete_an_old_snapshot() -> None:
    app = build_app(version_limit=3)
    with TestClient(app) as client:
        register(client)
        resume_id = client.post("/api/resumes", json={}).json()["resume"]["id"]

        for _ in range(2):
            assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        rejected = client.post(f"/api/resumes/{resume_id}/versions")
        assert rejected.status_code == 409
        assert rejected.json() == {"error": "RESUME_VERSION_LIMIT_REACHED"}
        versions = client.get(f"/api/resumes/{resume_id}/versions").json()["versions"]
        assert [(item["version_no"], item["reason"]) for item in versions] == [
            (3, "manual"),
            (2, "manual"),
            (1, "initial"),
        ]

        deleted = client.delete(f"/api/resumes/{resume_id}/versions/1")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True}

        replacement = client.post(f"/api/resumes/{resume_id}/versions")
        assert replacement.status_code == 201
        assert replacement.json()["version"]["version_no"] == 4
        assert [
            item["version_no"]
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [4, 3, 2]


def test_latest_version_cannot_be_deleted() -> None:
    app = build_app(version_limit=3)
    with TestClient(app) as client:
        register(client)
        resume_id = client.post("/api/resumes", json={}).json()["resume"]["id"]
        assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        rejected = client.delete(f"/api/resumes/{resume_id}/versions/2")

        assert rejected.status_code == 409
        assert rejected.json() == {"error": "LATEST_RESUME_VERSION_REQUIRED"}
        assert [
            item["version_no"]
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [2, 1]


def test_restore_rejects_without_mutation_when_it_needs_too_many_version_slots() -> None:
    app = build_app(version_limit=3)
    with TestClient(app) as client:
        register(client)
        created = client.post("/api/resumes", json={}).json()["resume"]
        resume_id = created["id"]
        assert client.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        draft = created["data"]
        draft["basics"]["headline"] = "尚未建立版本的草稿"
        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={"data": draft, "base_lock_version": 1},
        )
        assert updated.status_code == 200

        rejected = client.post(f"/api/resumes/{resume_id}/versions/1/restore")

        assert rejected.status_code == 409
        assert rejected.json() == {"error": "RESUME_VERSION_LIMIT_REACHED"}
        current = client.get(f"/api/resumes/{resume_id}").json()["resume"]
        assert current["data"]["basics"]["headline"] == "尚未建立版本的草稿"
        assert current["lock_version"] == 2
        assert [
            item["version_no"]
            for item in client.get(f"/api/resumes/{resume_id}/versions").json()[
                "versions"
            ]
        ] == [2, 1]


def test_overlong_resume_id_is_rejected_without_integer_conversion() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        response = client.get(f"/api/resumes/{'9' * 5000}")

        assert response.status_code == 404
        assert response.json() == {"error": "RESUME_NOT_FOUND"}


def test_smart_one_page_is_persisted_and_restored_with_versions() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client)
        resume = client.post("/api/resumes", json={}).json()["resume"]
        resume_id = resume["id"]
        style = resume["style"]
        assert style["smart_one_page"] is False

        style["smart_one_page"] = True
        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={"style": style, "base_lock_version": 1},
        )
        assert updated.status_code == 200
        assert updated.json()["resume"]["style"]["smart_one_page"] is True
        version = client.post(f"/api/resumes/{resume_id}/versions")
        assert version.status_code == 201
        assert version.json()["version"]["version_no"] == 2

        style["smart_one_page"] = False
        assert client.put(
            f"/api/resumes/{resume_id}",
            json={"style": style, "base_lock_version": 2},
        ).status_code == 200
        restored = client.post(f"/api/resumes/{resume_id}/versions/2/restore")

        assert restored.status_code == 200
        assert restored.json()["resume"]["style"]["smart_one_page"] is True
