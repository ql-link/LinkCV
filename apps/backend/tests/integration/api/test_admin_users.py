from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.core.security import hash_password
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


def build_app():
    redis = FakeRedis()
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
    )
    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=redis,
        create_schema=True,
    )
    return app, redis


def register(client: TestClient, email: str) -> dict[str, object]:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201
    return response.json()["user"]


def promote_admin(app, email: str) -> None:
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        user.is_admin = True
        user.nickname = "系统管理员"
        db.commit()


def create_user(app, *, email: str, nickname: str) -> int:
    with app.state.session_factory() as db:
        user = User(
            email=email,
            password_hash=hash_password("password-123"),
            nickname=nickname,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id


def test_admin_user_search_requires_admin_and_matches_supported_fields() -> None:
    app, _redis = build_app()
    with TestClient(app) as client:
        assert client.get("/api/auth/admin/users").status_code == 401

        register(client, "admin@example.invalid")
        assert client.get("/api/auth/admin/users").status_code == 403
        promote_admin(app, "admin@example.invalid")

        target_id = create_user(
            app,
            email="search-target@example.invalid",
            nickname="搜索目标",
        )
        for query in (str(target_id), "search-target", "搜索目标"):
            response = client.get(
                "/api/auth/admin/users",
                params={"q": query},
            )
            assert response.status_code == 200
            assert [item["id"] for item in response.json()["items"]] == [
                str(target_id)
            ]

        filtered = client.get(
            "/api/auth/admin/users",
            params={"status": "enabled", "role": "admin"},
        )
        assert filtered.status_code == 200
        assert [item["email"] for item in filtered.json()["items"]] == [
            "admin@example.invalid"
        ]


def test_admin_can_disable_user_revoke_sessions_and_write_audit_log() -> None:
    app, _redis = build_app()
    with TestClient(app) as admin_client, TestClient(app) as target_client:
        admin = register(admin_client, "admin@example.invalid")
        promote_admin(app, "admin@example.invalid")
        target = register(target_client, "target@example.invalid")

        self_disable = admin_client.patch(
            f"/api/auth/admin/users/{admin['id']}/status",
            json={"action": "disable"},
        )
        assert self_disable.status_code == 422
        assert self_disable.json() == {"error": "CANNOT_SELF_DISABLE"}

        disabled = admin_client.patch(
            f"/api/auth/admin/users/{target['id']}/status",
            json={"action": "disable"},
        )
        assert disabled.status_code == 200
        assert disabled.json()["revoked_sessions"] == 1
        assert disabled.json()["user"]["status"] == 0
        assert target_client.get("/api/auth/me").json() == {"user": None}

        with app.state.session_factory() as db:
            target_user = db.get(User, int(target["id"]))
            assert target_user is not None
            assert target_user.status == 0
