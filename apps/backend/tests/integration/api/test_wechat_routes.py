import base64

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from tests.fakes import FakeRedis


class FakeObjectResponse:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def stream(self, _size: int) -> bytes:
        return self.data

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

    def delete_prefix(self, prefix: str) -> None:
        for object_name in list(self.objects):
            if object_name.startswith(prefix):
                self.objects.pop(object_name)


def wxacode_handler(openid: str = "openid-fixture"):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "token-1", "expires_in": 7200})
        if request.url.path == "/wxa/getwxacodeunlimit":
            return httpx.Response(
                200,
                headers={"content-type": "image/jpeg"},
                content=b"\xff\xd8\xff\xe0fixture-qr",
            )
        if request.url.path == "/sns/jscode2session":
            return httpx.Response(
                200, json={"openid": openid, "session_key": "sk-fixture"}
            )
        raise AssertionError(f"unexpected upstream path {request.url.path}")

    return handler


def build_test_app(openid: str = "openid-fixture"):
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
    from linkcv.integrations.wechat_client import WeChatClient

    app.state.wechat_client = WeChatClient(
        appid="wx-fixture-appid",
        appsecret="fixture-secret",
        login_page="pages/login/index",
        redis_client=app.state.redis,
        transport=httpx.MockTransport(wxacode_handler(openid)),
    )
    return app


def create_qrcode(client: TestClient, mode: str = "login") -> tuple[str, str]:
    response = client.post("/api/auth/wechat/qrcode", json={"mode": mode})
    assert response.status_code == 200, response.text
    payload = response.json()
    return payload["scene"], payload["qr_base64"]


def confirm_and_poll(client: TestClient, scene: str, **kwargs) -> dict:
    """模拟小程序 confirm 后，Web 端轮询 status 命中 success（发放 Cookie）。"""
    data = {"scene": scene, "code": kwargs.pop("code", "js-code-1"), "mode": "login"}
    data.update({key: value for key, value in kwargs.items() if key != "files"})
    files = kwargs.get("files")
    response = client.post("/api/auth/wechat/confirm", data=data, files=files)
    assert response.status_code == 200, response.text
    status = client.get("/api/auth/wechat/status", params={"scene": scene}).json()
    assert status["status"] == "success", status
    return status


def test_wechat_login_flow_creates_account_and_issues_session() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, qr = create_qrcode(client)
        assert base64.b64decode(qr) == b"\xff\xd8\xff\xe0fixture-qr"

        assert client.get("/api/auth/wechat/status", params={"scene": scene}).json()[
            "status"
        ] == "pending"

        status = confirm_and_poll(client, scene)
        assert status["user"]["email"] is None
        assert status["user"]["nickname"].startswith("微信用户")

        me = client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["user"] is not None

        # scene 已消费，再次查询返回 expired。
        assert client.get(
            "/api/auth/wechat/status", params={"scene": scene}
        ).json()["status"] == "expired"


def test_wechat_login_reuses_existing_openid_account() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _ = create_qrcode(client)
        confirm_and_poll(client, scene)
        first = client.get("/api/auth/me").json()["user"]

        scene2, _ = create_qrcode(client)
        confirm_and_poll(client, scene2)
        second = client.get("/api/auth/me").json()["user"]
        assert second["id"] == first["id"]

        with app.state.session_factory() as db:
            users = db.scalars(select(User)).all()
            assert len(users) == 1


def test_wechat_confirm_is_replay_resistant() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _ = create_qrcode(client)
        data = {"scene": scene, "code": "js-code-1", "mode": "login"}
        assert client.post("/api/auth/wechat/confirm", data=data).status_code == 200
        second = client.post("/api/auth/wechat/confirm", data=data)
        assert second.status_code == 409
        assert second.json()["error"] == "SCENE_REUSED"


def test_wechat_confirm_unknown_scene_is_expired() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": "sc-missing-scene-0000001", "code": "js-code-1", "mode": "login"},
        )
        assert response.status_code == 410
        assert response.json()["error"] == "SCENE_EXPIRED"


def test_wechat_bind_requires_login() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post("/api/auth/wechat/qrcode", json={"mode": "bind"})
        assert response.status_code == 401
        assert response.json()["error"] == "UNAUTHORIZED"


def test_wechat_bind_conflict_rejects_existing_openid() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        # 第一个账号用 openid-fixture 登录。
        scene, _ = create_qrcode(client, mode="login")
        confirm_and_poll(client, scene)

        # 第二个账号尝试绑定同一 openid。
        register = client.post(
            "/api/auth/register",
            json={"email": "second@example.invalid", "password": "password-1234"},
        )
        assert register.status_code == 201
        scene_bind, _ = create_qrcode(client, mode="bind")
        conflict = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene_bind, "code": "js-code-1", "mode": "bind"},
        )
        assert conflict.status_code == 409
        assert conflict.json()["error"] == "WECHAT_BIND_CONFLICT"


def test_wechat_bind_binds_openid_to_current_account() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "owner@example.invalid", "password": "password-1234"},
        )
        assert register.status_code == 201
        scene, _ = create_qrcode(client, mode="bind")
        ok = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene, "code": "js-code-1", "mode": "bind"},
        )
        assert ok.status_code == 200

        # bind 模式 status 不发 Cookie（不发新会话），当前账号仍有效。
        status = client.get("/api/auth/wechat/status", params={"scene": scene}).json()
        assert status["status"] == "success"
        me = client.get("/api/auth/me").json()["user"]
        assert me["email"] == "owner@example.invalid"


def test_wechat_confirm_stores_avatar_on_account_creation() -> None:
    app = build_test_app()
    storage = app.state.storage
    with TestClient(app) as client:
        scene, _ = create_qrcode(client)
        files = {
            "avatar": (
                "wechat-avatar.png",
                b"\x89PNG\r\n\x1a\nfixture-avatar",
                "image/png",
            )
        }
        status = confirm_and_poll(
            client,
            scene,
            nickname="微信昵称",
            files=files,
        )
        assert status["user"]["nickname"] == "微信昵称"
        assert status["user"]["avatar_url"] is not None
        assert any("avatar" in key for key in storage.objects)


def test_wechat_qrcode_is_rate_limited_per_ip() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        for _index in range(10):
            response = client.post("/api/auth/wechat/qrcode", json={"mode": "login"})
            assert response.status_code == 200, response.text
        limited = client.post("/api/auth/wechat/qrcode", json={"mode": "login"})
        assert limited.status_code == 429
        assert limited.json()["error"] == "WECHAT_RATE_LIMITED"


def test_wechat_confirm_rejects_avatar_wrong_type() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _ = create_qrcode(client)
        files = {"avatar": ("wechat-avatar.txt", b"not an image", "text/plain")}
        response = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene, "code": "js-code-1", "mode": "login"},
            files=files,
        )
        assert response.status_code == 400
        assert response.json()["error"] == "INVALID_AVATAR"
