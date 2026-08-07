import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.plugin_releases.validator import MAX_UPLOAD_BYTES
from tests.fakes import FakeRedis
from tests.plugin_release_fakes import FakePluginStorage, build_plugin_zip


def build_app():
    storage = FakePluginStorage()
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="integration-test-secret-with-32-bytes",
            plugin_release_origin="http://127.0.0.1:5173",
        ),
        storage=storage,
        redis=FakeRedis(),
        create_schema=True,
    )
    return app, storage


def register(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def promote_admin(app, email: str) -> None:
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        user.is_admin = True
        db.commit()


def test_auth_permissions_publish_current_and_download() -> None:
    app, _storage = build_app()
    package = build_plugin_zip(origin="http://127.0.0.1:5173")
    with TestClient(app) as client:
        assert client.get("/api/plugin-releases/current").status_code == 401
        assert client.post(
            "/api/admin/plugin-releases",
            files={"file": ("plugin.zip", package, "application/zip")},
        ).status_code == 401

        register(client, "admin@example.invalid")
        assert client.get("/api/plugin-releases/current").json() == {
            "status": "unpublished",
            "release": None,
        }
        assert client.post(
            "/api/admin/plugin-releases",
            files={"file": ("plugin.zip", package, "application/zip")},
        ).status_code == 403

        promote_admin(app, "admin@example.invalid")
        published = client.post(
            "/api/admin/plugin-releases",
            files={"file": ("plugin.zip", package, "application/zip")},
        )
        assert published.status_code == 201, published.text
        release = published.json()["release"]
        assert release["version"] == "0.1.0"
        assert release["download_url"] == "/api/plugin-releases/0.1.0/download"
        assert "object_key" not in release

        current = client.get("/api/plugin-releases/current")
        assert current.status_code == 200
        assert current.json() == {"status": "available", "release": release}

        download = client.get(release["download_url"])
        assert download.status_code == 200
        assert download.content == package
        assert download.headers["content-type"] == "application/zip"
        assert download.headers["x-content-type-options"] == "nosniff"
        assert "attachment" in download.headers["content-disposition"]
        assert "minio" not in download.text.lower()


def test_publish_validation_conflict_and_stale_download_errors() -> None:
    app, _storage = build_app()
    with TestClient(app) as client:
        register(client, "admin@example.invalid")
        promote_admin(app, "admin@example.invalid")

        missing = client.post("/api/admin/plugin-releases")
        assert missing.status_code == 422
        assert missing.json() == {"error": "PLUGIN_RELEASE_INVALID_FILE"}

        too_large = client.post(
            "/api/admin/plugin-releases",
            files={
                "file": (
                    "plugin.zip",
                    b"x" * (MAX_UPLOAD_BYTES + 1),
                    "application/zip",
                )
            },
        )
        assert too_large.status_code == 413
        assert too_large.json() == {"error": "PLUGIN_RELEASE_TOO_LARGE"}

        invalid = client.post(
            "/api/admin/plugin-releases",
            files={"file": ("plugin.zip", b"not-a-zip", "application/zip")},
        )
        assert invalid.status_code == 422
        assert invalid.json() == {"error": "PLUGIN_RELEASE_INVALID_ARCHIVE"}

        package = build_plugin_zip(version="1.0.0")
        assert client.post(
            "/api/admin/plugin-releases",
            files={"file": ("plugin.zip", package, "application/zip")},
        ).status_code == 201
        conflict = client.post(
            "/api/admin/plugin-releases",
            files={
                "file": (
                    "plugin.zip",
                    build_plugin_zip(version="0.9.0"),
                    "application/zip",
                )
            },
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "PLUGIN_RELEASE_VERSION_CONFLICT"}

        stale = client.get("/api/plugin-releases/0.9.0/download")
        assert stale.status_code == 409
        assert stale.json() == {"error": "PLUGIN_RELEASE_VERSION_CHANGED"}


def test_current_reports_storage_unavailable_for_missing_release_object() -> None:
    app, storage = build_app()
    package = build_plugin_zip()
    with TestClient(app) as client:
        register(client, "admin@example.invalid")
        promote_admin(app, "admin@example.invalid")
        assert client.post(
            "/api/admin/plugin-releases",
            files={"file": ("plugin.zip", package, "application/zip")},
        ).status_code == 201

        current_pointer = storage.objects[
            "system/plugin-releases/development/current.json"
        ]
        release_key = json.loads(current_pointer)["object_key"]
        del storage.objects[release_key]

        current = client.get("/api/plugin-releases/current")
        assert current.status_code == 503
        assert current.json() == {"error": "PLUGIN_RELEASE_OBJECT_UNAVAILABLE"}
