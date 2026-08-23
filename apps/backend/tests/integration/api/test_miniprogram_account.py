import base64

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.identity.session_service import MINIPROGRAM_CHANNEL, issue_session
from tests.fakes import FakeRedis


class FakeAvatarStorage:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.deleted: list[str] = []

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, content_type: str) -> None:
        self.objects[object_name] = (data, content_type)

    def get(self, object_name: str):
        class FakeResponse:
            def __init__(self, payload: bytes) -> None:
                self.payload = payload

            def stream(self, chunk_size: int):
                yield self.payload

            def close(self) -> None:
                pass

            def release_conn(self) -> None:
                pass

        if object_name not in self.objects:
            raise KeyError(object_name)
        return FakeResponse(self.objects[object_name][0])

    def delete(self, object_name: str) -> None:
        self.objects.pop(object_name, None)
        self.deleted.append(object_name)


PNG_DATA_URL = (
    "data:image/png;base64,"
    + base64.b64encode(b"\x89PNG\r\n\x1a\navatar-bytes").decode("ascii")
)


def build_app():
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="mini-account-test-secret-with-32-bytes",
        ),
        storage=FakeAvatarStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    return app


def mini_headers(app, email: str) -> dict[str, str]:
    with app.state.session_factory() as session:
        user = session.scalar(select(User).where(User.email == email))
        assert user is not None
        credentials = issue_session(
            user,
            app.state.settings,
            app.state.redis,
            channel=MINIPROGRAM_CHANNEL,
        )
    return {"Authorization": f"Bearer {credentials.access_token}"}


def register_user(web_client: TestClient, email: str) -> None:
    response = web_client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201
    # 注册响应会种下 Web Cookie；小程序 Bearer 请求不能与 Web Cookie 共存。
    web_client.cookies.clear()


def test_profile_returns_nickname_and_avatar_url() -> None:
    app = build_app()
    with TestClient(app) as web_client:
        register_user(web_client, "owner@example.test")
        headers = mini_headers(app, "owner@example.test")

        profile = web_client.get("/api/miniprogram/account/profile", headers=headers)
        assert profile.status_code == 200
        body = profile.json()
        assert body["nickname"].startswith("用户")
        assert body["avatar_url"] is None


def test_update_nickname_validates_and_persists() -> None:
    app = build_app()
    with TestClient(app) as web_client:
        register_user(web_client, "owner@example.test")
        headers = mini_headers(app, "owner@example.test")

        updated = web_client.patch(
            "/api/miniprogram/account/profile",
            headers=headers,
            json={"nickname": "  张三的昵称  "},
        )
        assert updated.status_code == 200
        assert updated.json()["nickname"] == "张三的昵称"

        invalid = web_client.patch(
            "/api/miniprogram/account/profile",
            headers=headers,
            json={"nickname": "   "},
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"] == "INVALID_NICKNAME"

        too_long = web_client.patch(
            "/api/miniprogram/account/profile",
            headers=headers,
            json={"nickname": "长" * 51},
        )
        assert too_long.status_code == 400
        assert too_long.json()["error"] == "INVALID_NICKNAME"


def test_avatar_upload_and_read_use_miniprogram_only_url() -> None:
    app = build_app()
    with TestClient(app) as web_client:
        register_user(web_client, "owner@example.test")
        headers = mini_headers(app, "owner@example.test")

        uploaded = web_client.put(
            "/api/miniprogram/account/avatar",
            headers=headers,
            json={"dataUrl": PNG_DATA_URL, "fileName": "avatar"},
        )
        assert uploaded.status_code == 200
        assert uploaded.json()["url"] == "/api/miniprogram/account/avatar"

        profile = web_client.get("/api/miniprogram/account/profile", headers=headers)
        assert profile.json()["avatar_url"] == "/api/miniprogram/account/avatar"

        binary = web_client.get("/api/miniprogram/account/avatar", headers=headers)
        assert binary.status_code == 200
        assert binary.content == b"\x89PNG\r\n\x1a\navatar-bytes"
        assert binary.headers["content-type"].startswith("image/")


def test_avatar_read_without_avatar_returns_404() -> None:
    app = build_app()
    with TestClient(app) as web_client:
        register_user(web_client, "owner@example.test")
        headers = mini_headers(app, "owner@example.test")

        missing = web_client.get("/api/miniprogram/account/avatar", headers=headers)
        assert missing.status_code == 404
        assert missing.json()["error"] == "ASSET_NOT_FOUND"


def test_web_cookie_cannot_access_miniprogram_account() -> None:
    app = build_app()
    with TestClient(app) as web_client:
        register_user(web_client, "owner@example.test")
        login = web_client.post(
            "/api/auth/login",
            json={"email": "owner@example.test", "password": "password-123"},
        )
        assert login.status_code == 200
        cookies = login.cookies

        profile = web_client.get(
            "/api/miniprogram/account/profile", cookies=cookies
        )
        assert profile.status_code == 401

        anonymous = web_client.get("/api/miniprogram/account/profile")
        assert anonymous.status_code == 401
