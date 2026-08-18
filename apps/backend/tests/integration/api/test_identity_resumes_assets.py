import base64
from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeTemplate,
    ResumeVersion,
)
from tests.fakes import FakeRedis


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
    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    with app.state.session_factory() as session:
        template = ResumeTemplate(
            key="blank-cn",
            name="空白简历",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style().model_dump(mode="json"),
            is_active=1,
        )
        session.add(template)
        session.commit()
        app.state.test_template_id = str(template.id)
    return app


def resume_payload(app, title: str = "测试简历") -> dict[str, str]:
    return {"title": title, "template_id": app.state.test_template_id}


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
        with app.state.session_factory() as session:
            registered_user = session.scalar(
                select(User).where(User.email == "user@example.com")
            )
            assert registered_user is not None
            assert registered_user.nickname.startswith("用户")
        set_cookie = response.headers["set-cookie"]
        # Short access cookie plus a 7-day refresh cookie.
        assert "resume_access=" in set_cookie and "Max-Age=900" in set_cookie
        assert "resume_refresh=" in set_cookie and "Max-Age=604800" in set_cookie

        assert client.get("/api/auth/me").json()["user"]["email"] == "user@example.com"

        created = client.post(
            "/api/resumes",
            json=resume_payload(app),
        )
        assert created.status_code == 201
        resume = created.json()["resume"]
        assert resume["title"] == "测试简历"
        assert resume["data"]["schema_version"] == "1.0"
        assert resume["style"]["template_key"] == "classic-cn"
        assert resume["source_type"] == "template"
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
        resume = owner.post("/api/resumes", json=resume_payload(app)).json()["resume"]
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


def test_resume_delete_keeps_database_record_when_storage_cleanup_fails() -> None:
    app = build_test_app()
    storage = app.state.storage

    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "cleanup@example.com", "password": "password-123"},
        )
        assert register.status_code == 201
        resume_id = client.post("/api/resumes", json=resume_payload(app)).json()["resume"]["id"]
        object_key = f"users/1/resumes/{resume_id}/image.png"
        storage.objects[object_key] = b"private-resume-image"
        storage.fail_cleanup = True

        deleted = client.delete(f"/api/resumes/{resume_id}")

        assert deleted.status_code == 502
        assert deleted.json() == {"error": "ASSET_DELETE_FAILED"}
        with app.state.session_factory() as session:
            assert session.scalar(
                select(Resume).where(Resume.id == int(resume_id))
            ) is not None
            assert session.scalar(
                select(ResumeVersion).where(ResumeVersion.resume_id == int(resume_id))
            ) is not None
        assert storage.objects == {object_key: b"private-resume-image"}

        storage.fail_cleanup = False
        assert client.delete(f"/api/resumes/{resume_id}").json() == {"deleted": True}
        with app.state.session_factory() as session:
            assert session.scalar(
                select(Resume).where(Resume.id == int(resume_id))
            ) is None
        assert storage.objects == {}


def test_resume_delete_cleans_parse_task_source_and_converted_markdown() -> None:
    app = build_test_app()
    storage = app.state.storage

    with TestClient(app) as client:
        assert client.post(
            "/api/auth/register",
            json={"email": "import-cleanup@example.com", "password": "password-123"},
        ).status_code == 201
        resume_id = int(
            client.post("/api/resumes", json=resume_payload(app)).json()["resume"]["id"]
        )
        with app.state.session_factory() as session:
            user_id = session.scalar(select(User.id))
            resume = session.get(Resume, resume_id)
            assert user_id is not None
            assert resume is not None
            task = DocumentParseTask(
                source_type=RESUME_IMPORT_SOURCE_TYPE,
                user_id=user_id,
                file_name="resume.md",
                file_format="md",
                object_name=f"users/{user_id}/resume-imports/task/source.md",
                converted_object_name=(
                    f"users/{user_id}/resume-imports/task/converted.md"
                ),
                upload_status="succeeded",
                upload_duration_ms=1,
                parse_status="succeeded",
                parse_duration_ms=1,
            )
            session.add(task)
            session.flush()
            resume.parse_task_id = task.id
            session.commit()
            task_id = task.id
            storage.objects[task.object_name] = b"# source"
            storage.objects[task.converted_object_name] = b"# converted"

        deleted = client.delete(f"/api/resumes/{resume_id}")

        assert deleted.status_code == 200
        with app.state.session_factory() as session:
            assert session.get(DocumentParseTask, task_id) is None
            assert session.get(Resume, resume_id) is None
        assert storage.objects == {}


def test_refresh_rotates_secret_and_reuse_revokes_session() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "rotator@example.com", "password": "password-123"},
        )
        assert register.status_code == 201
        first_refresh = client.cookies.get("resume_refresh")
        assert first_refresh

        # Refresh issues a new access token and rotates the refresh secret.
        refreshed = client.post("/api/auth/refresh")
        assert refreshed.status_code == 200
        assert refreshed.json()["user"]["email"] == "rotator@example.com"
        second_refresh = client.cookies.get("resume_refresh")
        assert second_refresh and second_refresh != first_refresh

    # Reusing the rotated-out refresh token must fail and revoke the session.
    with TestClient(app) as attacker:
        attacker.cookies.set(
            "resume_refresh", first_refresh, domain="localhost", path="/api/auth"
        )
        assert attacker.post("/api/auth/refresh").status_code == 401

    # The whole session is now revoked, so the live token is also invalid.
    with TestClient(app) as client2:
        client2.cookies.set(
            "resume_refresh", second_refresh, domain="localhost", path="/api/auth"
        )
        assert client2.post("/api/auth/refresh").status_code == 401


def test_disabled_account_blocks_access() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "disabled@example.com", "password": "password-123"},
        )
        with app.state.session_factory() as session:
            row = session.query(User).filter_by(email="disabled@example.com").one()
            row.status = 0
            session.commit()
        # Disabling the user (without deleting the Redis key) still rejects access.
        assert client.get("/api/resumes").json() == {"error": "UNAUTHORIZED"}
