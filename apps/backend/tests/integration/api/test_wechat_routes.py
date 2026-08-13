import base64

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.integrations.wechat_client import WechatClient
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from tests.fakes import FakeRedis
from tests.integration.api.test_identity_resumes_assets import FakeStorage


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
        wechat_appid="wx-fixture-appid",
        wechat_secret="fixture-secret",
    )
    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    app.state.wechat_client = WechatClient(
        appid="wx-fixture-appid",
        secret="fixture-secret",
        qr_page="pages/bind/bind",
        login_page="pages/login/index",
        transport=httpx.MockTransport(wxacode_handler(openid)),
    )
    return app


def create_qrcode(client: TestClient) -> tuple[str, str]:
    response = client.post("/api/auth/wechat/qrcode")
    assert response.status_code == 200, response.text
    payload = response.json()
    return payload["scene"], payload["qr_base64"]


def confirm_and_poll(client: TestClient, scene: str, code: str = "js-code-1") -> dict:
    """模拟小程序 confirm 后，Web 端轮询 status 命中 success（发放 Cookie）。"""
    response = client.post(
        "/api/auth/wechat/confirm",
        data={"scene": scene, "code": code},
    )
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
        data = {"scene": scene, "code": "js-code-1"}
        assert client.post("/api/auth/wechat/confirm", data=data).status_code == 200
        second = client.post("/api/auth/wechat/confirm", data=data)
        assert second.status_code == 409
        assert second.json()["error"] == "SCENE_REUSED"


def test_wechat_confirm_unknown_scene_is_expired() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": "sc-missing-scene-0000001", "code": "js-code-1"},
        )
        assert response.status_code == 410
        assert response.json()["error"] == "SCENE_EXPIRED"


def test_wechat_qrcode_is_rate_limited_per_ip() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        for _index in range(10):
            response = client.post("/api/auth/wechat/qrcode")
            assert response.status_code == 200, response.text
        limited = client.post("/api/auth/wechat/qrcode")
        assert limited.status_code == 429
        assert limited.json()["error"] == "WECHAT_RATE_LIMITED"


def test_wechat_login_creates_user_without_email() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _ = create_qrcode(client)
        confirm_and_poll(client, scene)
        with app.state.session_factory() as db:
            user = db.scalars(select(User)).one()
            assert user.email is None
            assert user.password_hash is None
            assert user.wechat_openid == "openid-fixture"
