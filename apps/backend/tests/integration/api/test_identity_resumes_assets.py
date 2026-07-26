import base64
from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.resumes.models import ResumeVersion


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

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data

    def get(self, object_name: str) -> FakeObjectResponse:
        return FakeObjectResponse(self.objects[object_name])


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
        assert isinstance(response.json()["user"]["id"], int)
        assert "Max-Age=604800" in response.headers["set-cookie"]

        assert client.get("/api/auth/me").json()["email"] == "user@example.com"

        created = client.post(
            "/api/resumes",
            json={
                "title": "测试简历",
                "markdown": "# 张三",
                "settings": {"theme": "modern"},
                "splitRatio": 0.45,
                "previewScale": 0.9,
            },
        )
        assert created.status_code == 201
        resume = created.json()["resume"]
        assert resume["title"] == "测试简历"
        assert resume["settings"]["theme"] == "modern"
        assert resume["settings"]["showSource"] is False
        assert resume["splitRatio"] == 0.45
        assert resume["sourceType"] == "blank"
        assert resume["lockVersion"] == 1
        assert "createdAt" in resume

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
                "markdown": "# 张三\n\n新内容",
                "lockVersion": resume["lockVersion"],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["resume"]["title"] == "更新后的简历"
        assert updated.json()["resume"]["splitRatio"] == 0.45
        assert updated.json()["resume"]["lockVersion"] == 2

        conflict = client.put(
            f"/api/resumes/{resume_id}",
            json={"title": "过期写入", "lockVersion": 1},
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_EDIT_CONFLICT"}
        assert client.get(f"/api/resumes/{resume_id}").json()["resume"][
            "title"
        ] == "更新后的简历"

        assert client.delete(f"/api/resumes/{resume_id}").json() == {"deleted": True}
        assert client.get(f"/api/resumes/{resume_id}").status_code == 404

        assert client.post("/api/auth/logout").json() == {"detail": "Logged out"}
        assert client.get("/api/resumes").json() == {"detail": "Not authenticated"}


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
