import base64
from collections.abc import Iterator

from fastapi.testclient import TestClient

from linkcv.core.config import Settings
from linkcv.core.sessions import InMemorySessionStore
from linkcv.main import create_app


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

    def delete(self, object_name: str) -> None:
        self.objects.pop(object_name, None)


def build_test_app():
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
    )
    return create_app(
        settings,
        storage=FakeStorage(),
        session_store=InMemorySessionStore(),
        create_schema=True,
    )


def test_register_login_refresh_logout_and_profile() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/register",
            json={"email": "USER@example.com", "password": "password-123"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["user"]["email"] == "user@example.com"
        assert body["user"]["nickname"].startswith("用户")
        assert body["user"]["isAdmin"] is False
        assert "Max-Age=1800" in response.headers["set-cookie"]
        assert "Max-Age=604800" in response.headers["set-cookie"]

        me = client.get("/api/auth/me").json()["user"]
        assert me["email"] == "user@example.com"

        updated_nick = client.patch(
            "/api/users/me", json={"nickname": "张三"}
        ).json()
        assert updated_nick["nickname"] == "张三"

        avatar_payload = base64.b64encode(b"png-bytes").decode("ascii")
        avatar = client.put(
            "/api/users/me/avatar",
            json={
                "fileName": "avatar.png",
                "dataUrl": f"data:image/png;base64,{avatar_payload}",
            },
        )
        assert avatar.status_code == 200
        avatar_url = avatar.json()["avatarUrl"]
        assert avatar_url.startswith("/api/assets/users/")
        assert "avatars/" in avatar_url

        me_after = client.get("/api/auth/me").json()["user"]
        assert me_after["avatarUrl"] == avatar_url

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
        resume_id = created.json()["resume"]["id"]
        assert client.get("/api/resumes").json()["resumes"][0]["id"] == resume_id
        assert client.delete(f"/api/resumes/{resume_id}").json() == {"deleted": True}

        logout = client.post("/api/auth/logout")
        assert logout.json() == {"ok": True}
        # 双 Cookie 已清除,且会话已撤销。
        assert client.get("/api/auth/me").json()["user"] is None
        assert client.get("/api/resumes").json() == {"error": "UNAUTHORIZED"}


def test_logout_is_idempotent_without_cookies() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        assert client.post("/api/auth/logout").json() == {"ok": True}


def test_login_validates_credentials_and_status() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "user@example.com", "password": "password-123"},
        )

        bad = client.post(
            "/api/auth/login",
            json={"email": "user@example.com", "password": "wrong-password"},
        )
        assert bad.status_code == 401
        assert bad.json() == {"error": "INVALID_CREDENTIALS"}

        good = client.post(
            "/api/auth/login",
            json={"email": "USER@example.com", "password": "password-123"},
        )
        assert good.status_code == 200
        assert good.json()["user"]["email"] == "user@example.com"


def test_refresh_restores_session_after_access_cookie_removed() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "ref@example.com", "password": "password-123"},
        )
        refresh_cookie = client.cookies.get("resume_refresh")
        assert refresh_cookie
        assert client.cookies.pop("resume_session", None) is not None

        me = client.get("/api/auth/me")
        assert me.json()["user"] is not None
        assert me.json()["user"]["email"] == "ref@example.com"
        # 续期后应再次下发 access Cookie。
        assert "Max-Age=1800" in me.headers["set-cookie"]
        # 轮换后旧 refresh Cookie 失效:用旧串再次请求不可续期。
        client.cookies.set("resume_refresh", refresh_cookie)
        client.cookies.pop("resume_session", None)
        bypass = client.get("/api/auth/me")
        assert bypass.json()["user"] is None


def test_assets_and_avatars_are_private_to_the_current_user() -> None:
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

        # 重新登录会建立新会话,旧 refresh 已撤销/logout 不影响新会话。
        login = owner.post(
            "/api/auth/login",
            json={"email": "owner@example.com", "password": "password-123"},
        )
        assert login.status_code == 200
