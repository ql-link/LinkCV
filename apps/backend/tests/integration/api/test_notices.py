from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass

    def delete(self, _object_name: str) -> None:
        pass

    def delete_prefix(self, _prefix: str) -> None:
        pass


def build_app():
    return create_app(
        Settings(
            app_environment="test",
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="notices-test-secret-32-bytes-padding",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )


def register(client: TestClient, email: str) -> int:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201
    return int(response.json()["user"]["id"])


def set_admin(app, user_id: int) -> None:
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.id == user_id))
        assert user is not None
        user.is_admin = True
        db.commit()


def login(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 200


def publish(client: TestClient, title: str, content: str = "- 新功能"):
    return client.post("/api/admin/notices", json={"title": title, "content": content})


def test_notices_require_login() -> None:
    app = build_app()
    with TestClient(app) as client:
        response = client.get("/api/notices")
        assert response.status_code == 401
        response = client.post("/api/notices/mark-read")
        assert response.status_code == 401


def test_publish_list_unread_and_mark_read_flow() -> None:
    app = build_app()
    with TestClient(app) as client:
        user_id = register(client, "reader@example.test")
        assert user_id > 0

        empty = client.get("/api/notices").json()
        assert empty == {"items": [], "unread_count": 0}

        set_admin(app, user_id)
        created = publish(client, "v1.1 上线", "## 新功能\n\n- 更新通知中心")
        assert created.status_code == 200
        notice_id = created.json()["notice"]["id"]
        assert notice_id == "1"
        assert created.json()["notice"]["revoked_at"] is None

        listed = client.get("/api/notices").json()
        assert listed["unread_count"] == 1
        assert listed["items"][0]["id"] == notice_id
        assert listed["items"][0]["title"] == "v1.1 上线"
        assert "新功能" in listed["items"][0]["content"]

        marked = client.post("/api/notices/mark-read")
        assert marked.status_code == 200
        assert marked.json() == {"ok": True, "unread_count": 0}

        again = client.get("/api/notices").json()
        assert again["unread_count"] == 0
        assert len(again["items"]) == 1


def test_new_notice_after_mark_read_counts_unread_again() -> None:
    app = build_app()
    with TestClient(app) as client:
        user_id = register(client, "reader2@example.test")
        set_admin(app, user_id)
        publish(client, "第一条")
        assert client.post("/api/notices/mark-read").json()["unread_count"] == 0

        publish(client, "第二条", "- 修复若干问题")
        listed = client.get("/api/notices").json()
        assert listed["unread_count"] == 1
        assert listed["items"][0]["title"] == "第二条"
        assert listed["items"][1]["title"] == "第一条"


def test_revoke_removes_from_user_view_and_restore_recovers() -> None:
    app = build_app()
    with TestClient(app) as client:
        user_id = register(client, "reader3@example.test")
        set_admin(app, user_id)
        notice_id = publish(client, "将下架").json()["notice"]["id"]
        assert isinstance(notice_id, str)
        assert client.get("/api/notices").json()["unread_count"] == 1
        client.post("/api/notices/mark-read")

        revoked = client.post(f"/api/admin/notices/{notice_id}/revoke")
        assert revoked.status_code == 200
        assert revoked.json()["notice"]["revoked_at"] is not None
        listed = client.get("/api/notices").json()
        assert listed == {"items": [], "unread_count": 0}

        # 幂等：重复下架不报错。
        assert client.post(f"/api/admin/notices/{notice_id}/revoke").status_code == 200

        restored = client.post(f"/api/admin/notices/{notice_id}/restore")
        assert restored.status_code == 200
        assert restored.json()["notice"]["revoked_at"] is None
        listed = client.get("/api/notices").json()
        assert len(listed["items"]) == 1
        # 已读用户重新上架不重新计未读（时间点式已读语义）。
        assert listed["unread_count"] == 0

        assert client.post(f"/api/admin/notices/{notice_id}/restore").status_code == 200


def test_admin_endpoints_reject_normal_user() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, "normal@example.test")
        assert client.get("/api/admin/notices").status_code == 403
        assert publish(client, "无权发布").status_code == 403
        assert client.post("/api/admin/notices/1/revoke").status_code == 403


def test_admin_list_contains_revoked_and_validation() -> None:
    app = build_app()
    with TestClient(app) as client:
        user_id = register(client, "admin@example.test")
        set_admin(app, user_id)
        first = publish(client, "第一条", "内容").json()["notice"]["id"]
        second = publish(client, "第二条", "内容").json()["notice"]["id"]
        client.post(f"/api/admin/notices/{first}/revoke")

        items = client.get("/api/admin/notices").json()["items"]
        assert [item["id"] for item in items] == [second, first]
        assert items[1]["revoked_at"] is not None

        assert client.post("/api/admin/notices/999999/revoke").status_code == 404

        assert client.post(
            "/api/admin/notices", json={"title": "   ", "content": "内容"}
        ).status_code == 400
        assert client.post(
            "/api/admin/notices", json={"title": "t" * 129, "content": "内容"}
        ).status_code == 400
        assert client.post(
            "/api/admin/notices", json={"title": "标题", "content": ""}
        ).status_code == 400
