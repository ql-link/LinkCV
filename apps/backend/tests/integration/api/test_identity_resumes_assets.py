import base64
from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.resumes.models import Resume, ResumeVersion, StorageCleanupJob
from linkcv.services.storage_cleanup_service import process_storage_cleanup_jobs


class FakeObjectResponse:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def stream(self, _size: int) -> Iterator[bytes]:
        yield self.data

    def close(self) -> None:
        pass

    def release_conn(self) -> None:
        pass


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_cleanup = False

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data

    def get(self, object_name: str) -> FakeObjectResponse:
        return FakeObjectResponse(self.objects[object_name])

    def delete(self, object_name: str) -> None:
        if self.fail_cleanup:
            raise RuntimeError("storage unavailable")
        self.objects.pop(object_name, None)

    def delete_prefix(self, prefix: str) -> None:
        if self.fail_cleanup:
            raise RuntimeError("storage unavailable")
        for object_name in list(self.objects):
            if object_name.startswith(prefix):
                self.objects.pop(object_name)


def build_test_app():
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
    )
    return create_app(settings, storage=FakeStorage(), create_schema=True)


def test_authentication_and_resume_crud() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/register",
            json={"email": "USER@example.com", "password": "password-123"},
        )
        assert response.status_code == 201
        assert response.json()["user"]["email"] == "user@example.com"
        assert response.json()["user"]["id"].isdecimal()
        assert "Max-Age=604800" in response.headers["set-cookie"]

        assert client.get("/api/auth/me").json()["user"]["email"] == "user@example.com"

        created = client.post(
            "/api/resumes",
            json={"title": "测试简历"},
        )
        assert created.status_code == 201
        resume = created.json()["resume"]
        assert resume["title"] == "测试简历"
        assert resume["data"]["schema_version"] == "1.0"
        assert resume["style"]["template_key"] == "classic-cn"
        assert resume["source_type"] == "blank"
        assert resume["lock_version"] == 1
        assert "created_at" in resume

        resume_id = resume["id"]
        with app.state.session_factory() as session:
            initial_version = session.scalar(
                select(ResumeVersion).where(ResumeVersion.resume_id == int(resume_id))
            )
            assert initial_version is not None
            assert initial_version.version_no == 1
            assert initial_version.reason == "initial"
        listed = client.get("/api/resumes").json()["resumes"]
        assert [item["id"] for item in listed] == [resume_id]

        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={
                "title": "更新后的简历",
                "base_lock_version": resume["lock_version"],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["resume"]["title"] == "更新后的简历"
        assert updated.json()["resume"]["lock_version"] == 2

        conflict = client.put(
            f"/api/resumes/{resume_id}",
            json={"title": "过期写入", "base_lock_version": 1},
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_EDIT_CONFLICT"}
        assert client.get(f"/api/resumes/{resume_id}").json()["resume"][
            "title"
        ] == "更新后的简历"

        assert client.delete(f"/api/resumes/{resume_id}").json() == {"deleted": True}
        assert client.get(f"/api/resumes/{resume_id}").status_code == 404

        assert client.post("/api/auth/logout").json() == {"ok": True}
        assert client.get("/api/resumes").json() == {"error": "UNAUTHORIZED"}


def test_assets_are_private_to_the_current_user() -> None:
    app = build_test_app()
    payload = base64.b64encode(b"png-bytes").decode("ascii")

    with TestClient(app) as owner:
        owner.post(
            "/api/auth/register",
            json={"email": "owner@example.com", "password": "password-123"},
        )
        uploaded = owner.post(
            "/api/assets",
            json={
                "fileName": "avatar.png",
                "dataUrl": f"data:image/png;base64,{payload}",
            },
        )
        assert uploaded.status_code == 201
        asset = uploaded.json()["asset"]
        assert owner.get(asset["url"]).content == b"png-bytes"

        with TestClient(app) as stranger:
            stranger.post(
                "/api/auth/register",
                json={"email": "stranger@example.com", "password": "password-123"},
            )
            assert stranger.get(asset["url"]).status_code == 403


def test_resume_assets_are_owned_and_preserved_while_history_references_them() -> None:
    app = build_test_app()
    payload = base64.b64encode(b"png-bytes").decode("ascii")

    with TestClient(app) as owner:
        owner.post(
            "/api/auth/register",
            json={"email": "resume-owner@example.com", "password": "password-123"},
        )
        resume = owner.post("/api/resumes", json={}).json()["resume"]
        resume_id = resume["id"]
        uploaded = owner.post(
            f"/api/resumes/{resume_id}/assets",
            json={
                "file_name": "avatar.png",
                "data_url": f"data:image/png;base64,{payload}",
            },
        )
        assert uploaded.status_code == 201
        asset = uploaded.json()["asset"]
        assert owner.get(asset["url"]).content == b"png-bytes"

        data = resume["data"]
        data["basics"]["photo"] = asset["url"]
        saved = owner.put(
            f"/api/resumes/{resume_id}",
            json={"data": data, "base_lock_version": 1},
        )
        assert saved.status_code == 200
        assert owner.post(f"/api/resumes/{resume_id}/versions").status_code == 201

        data["basics"]["photo"] = None
        saved_without_photo = owner.put(
            f"/api/resumes/{resume_id}",
            json={"data": data, "base_lock_version": 2},
        )
        assert saved_without_photo.status_code == 200
        assert owner.delete(asset["url"]).status_code == 409

        with TestClient(app) as stranger:
            stranger.post(
                "/api/auth/register",
                json={
                    "email": "resume-stranger@example.com",
                    "password": "password-123",
                },
            )
            assert stranger.get(asset["url"]).status_code == 404

        assert owner.delete(f"/api/resumes/{resume_id}").json() == {"deleted": True}
        assert app.state.storage.objects == {}


def test_resume_delete_persists_failed_storage_cleanup_for_retry() -> None:
    app = build_test_app()
    storage = app.state.storage

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "cleanup@example.com", "password": "password-123"},
        )
        assert register.status_code == 201
        resume_id = client.post("/api/resumes", json={}).json()["resume"]["id"]
        object_key = f"users/1/resumes/{resume_id}/image.png"
        storage.objects[object_key] = b"private-resume-image"
        storage.fail_cleanup = True

        deleted = client.delete(f"/api/resumes/{resume_id}")

        assert deleted.status_code == 200
        with app.state.session_factory() as session:
            assert session.scalar(select(Resume).where(Resume.id == int(resume_id))) is None
            job = session.scalar(select(StorageCleanupJob))
            assert job is not None
            assert job.operation == "prefix"
            assert job.attempts == 1

        storage.fail_cleanup = False
        with app.state.session_factory() as session:
            assert process_storage_cleanup_jobs(session, storage) == 1
            assert session.scalar(select(StorageCleanupJob)) is None
        assert storage.objects == {}
