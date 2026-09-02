import base64

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.core.security import hash_password
from linkcv.integrations.wechat_client import WechatClient
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.identity.session_service import (
    MINIPROGRAM_CHANNEL,
    WEB_CHANNEL,
    issue_session,
)
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


def test_retired_public_identity_routes_are_absent_outside_test_scaffolding() -> None:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
    )
    # Exercise the production gate without weakening Settings' real-production
    # secret validation for this isolated in-memory test.
    settings.app_environment = "production"
    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=False,
    )
    with TestClient(app) as client:
        assert client.get("/api/auth/capabilities").json() == {
            "password_login_enabled": False
        }
        assert client.post(
            "/api/auth/register",
            json={"email": "removed@example.test", "password": "password-123"},
        ).status_code == 404
        assert client.post(
            "/api/auth/login",
            json={"email": "removed@example.test", "password": "password-123"},
        ).status_code == 404
        assert client.post("/api/account/wechat/bind-request").status_code == 404
        paths = client.get("/api/openapi.json").json()["paths"]
        assert "/api/auth/register" not in paths
        assert "/api/auth/login" not in paths
        assert "/api/account/wechat/bind-request" not in paths


def test_local_and_development_allow_password_login_and_registration() -> None:
    for app_environment in ("local", "development"):
        settings = Settings(
            app_environment=app_environment,
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="integration-test-secret-with-32-bytes",
        )
        app = create_app(
            settings,
            storage=FakeStorage(),
            redis=FakeRedis(),
            create_schema=True,
        )
        app.state.legacy_identity_test_routes = False
        with app.state.session_factory() as session:
            session.add(
                User(
                    email="developer@example.test",
                    password_hash=hash_password("password-123"),
                    nickname="开发用户",
                )
            )
            session.commit()

        with TestClient(app) as client:
            assert client.get("/api/auth/capabilities").json() == {
                "password_login_enabled": True
            }
            login = client.post(
                "/api/auth/login",
                json={"email": "developer@example.test", "password": "password-123"},
            )
            assert login.status_code == 200
            assert login.json()["user"]["email"] == "developer@example.test"
            registration = client.post(
                "/api/auth/register",
                json={"email": "new@example.test", "password": "password-123"},
            )
            assert registration.status_code == 201, registration.text
            assert registration.json()["user"]["email"] == "new@example.test"
            assert client.get("/api/auth/me").json()["user"]["email"] == "new@example.test"


def create_qrcode(client: TestClient) -> tuple[str, str, str]:
    response = client.post("/api/auth/wechat/qrcode")
    assert response.status_code == 200, response.text
    payload = response.json()
    return payload["scene"], payload["poll_token"], payload["qr_base64"]


def confirm_and_poll(
    client: TestClient,
    scene: str,
    poll_token: str,
    code: str = "js-code-1",
) -> dict:
    """模拟小程序 confirm 后，Web 端轮询 status 命中 success（发放 Cookie）。"""
    response = client.post(
        "/api/auth/wechat/confirm",
        data={"scene": scene, "code": code, "privacy_accepted": "true"},
    )
    assert response.status_code == 200, response.text
    status = client.get(
        "/api/auth/wechat/status",
        params={"scene": scene, "poll_token": poll_token},
    ).json()
    assert status["status"] == "success", status
    return status


def test_wechat_login_flow_creates_account_and_issues_session() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, poll_token, qr = create_qrcode(client)
        assert base64.b64decode(qr) == b"\xff\xd8\xff\xe0fixture-qr"

        assert client.get("/api/auth/wechat/status", params={"scene": scene}).json()[
            "status"
        ] == "pending"

        status = confirm_and_poll(client, scene, poll_token)
        assert status["user"]["email"] is None
        assert status["user"]["nickname"].startswith("微信用户")

        me = client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["user"] is not None

        # 成功终态保留到 TTL，响应丢失后 Web 可以重试领取会话。
        assert client.get(
            "/api/auth/wechat/status", params={"scene": scene}
        ).json()["status"] == "success"


def test_wechat_login_reuses_existing_openid_account() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, poll_token, _ = create_qrcode(client)
        confirm_and_poll(client, scene, poll_token)
        first = client.get("/api/auth/me").json()["user"]

        scene2, poll_token2, _ = create_qrcode(client)
        confirm_and_poll(client, scene2, poll_token2)
        second = client.get("/api/auth/me").json()["user"]
        assert second["id"] == first["id"]

        with app.state.session_factory() as db:
            users = db.scalars(select(User)).all()
            assert len(users) == 1


def test_wechat_confirm_requires_privacy_acceptance_before_registration() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _, _ = create_qrcode(client)

        response = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene, "code": "js-code-1"},
        )

        assert response.status_code == 400
        assert response.json() == {"error": "PRIVACY_AGREEMENT_REQUIRED"}
        assert client.get(
            "/api/auth/wechat/status", params={"scene": scene}
        ).json()["status"] == "pending"
        with app.state.session_factory() as db:
            assert db.scalars(select(User)).all() == []


def test_wechat_confirm_is_idempotent_after_success() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _, _ = create_qrcode(client)
        data = {
            "scene": scene,
            "code": "js-code-1",
            "privacy_accepted": "true",
        }
        assert client.post("/api/auth/wechat/confirm", data=data).status_code == 200
        second = client.post("/api/auth/wechat/confirm", data=data)
        assert second.status_code == 200
        assert second.json() == {"ok": True}


def test_wechat_confirm_reclaims_stale_processing_scene() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _, _ = create_qrcode(client)
        app.state.redis.hset(
            f"wechat:login:{scene}",
            mapping={
                "state": "processing",
                "claim_id": "abandoned-claim",
                "claimed_at": "0",
            },
        )

        response = client.post(
            "/api/auth/wechat/confirm",
            data={
                "scene": scene,
                "code": "js-code-1",
                "privacy_accepted": "true",
            },
        )

        assert response.status_code == 200, response.text
        assert client.get(
            "/api/auth/wechat/status", params={"scene": scene}
        ).json()["status"] == "success"


def test_wechat_confirm_rejects_active_processing_scene() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _, _ = create_qrcode(client)
        app.state.redis.hset(
            f"wechat:login:{scene}",
            mapping={
                "state": "processing",
                "claim_id": "active-claim",
                "claimed_at": "9999999999",
            },
        )

        response = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene, "code": "js-code-1"},
        )

        assert response.status_code == 409
        assert response.json() == {"error": "SCENE_IN_PROGRESS"}


def test_wechat_cancel_is_terminal_and_idempotent() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, _, _ = create_qrcode(client)
        first = client.post("/api/auth/wechat/cancel", data={"scene": scene})
        assert first.status_code == 200
        assert first.json() == {"ok": True, "status": "cancelled"}
        assert client.post(
            "/api/auth/wechat/cancel", data={"scene": scene}
        ).json() == {"ok": True, "status": "cancelled"}
        assert client.get(
            "/api/auth/wechat/status", params={"scene": scene}
        ).json()["status"] == "cancelled"
        rejected = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene, "code": "js-code-1"},
        )
        assert rejected.status_code == 409
        assert rejected.json() == {"error": "SCENE_CANCELLED"}


def test_repeated_success_poll_replaces_previous_scene_session() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, poll_token, _ = create_qrcode(client)
        assert client.post(
            "/api/auth/wechat/confirm",
            data={
                "scene": scene,
                "code": "js-code-1",
                "privacy_accepted": "true",
            },
        ).status_code == 200
        assert client.get(
            "/api/auth/wechat/status",
            params={"scene": scene, "poll_token": poll_token},
        ).json()["status"] == "success"
        first_sid = app.state.redis.hget(f"wechat:login:{scene}", "web_sid")
        assert first_sid

        inspection = client.get(
            "/api/auth/wechat/status", params={"scene": scene}
        ).json()
        assert inspection == {"status": "success", "user": None}
        assert app.state.redis.hget(f"wechat:login:{scene}", "web_sid") == first_sid
        assert client.get("/api/auth/me").json()["user"] is not None

        assert client.get(
            "/api/auth/wechat/status",
            params={"scene": scene, "poll_token": poll_token},
        ).json()["status"] == "success"
        second_sid = app.state.redis.hget(f"wechat:login:{scene}", "web_sid")
        assert second_sid and second_sid != first_sid
        assert not app.state.redis.exists(f"auth:session:{first_sid}")
        assert app.state.redis.exists(f"auth:session:{second_sid}")


def test_miniprogram_session_rotates_and_rejects_web_carrier() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        login = client.post(
            "/api/auth/wechat/miniprogram/login",
            json={"code": "js-code-1", "privacy_accepted": True},
        )
        assert login.status_code == 200, login.text
        body = login.json()
        assert body["user"]["email"] is None
        assert body["expires_in"] == 900
        first_refresh = body["refresh_token"]

        me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {body['access_token']}"},
        )
        assert me.json() == {"user": None}
        assert client.get(
            "/api/miniprogram/resumes",
            headers={"Authorization": f"Bearer {body['access_token']}"},
        ).status_code == 200

        refreshed = client.post(
            "/api/auth/wechat/miniprogram/refresh",
            json={"refresh_token": first_refresh},
        )
        assert refreshed.status_code == 200
        second_refresh = refreshed.json()["refresh_token"]
        assert second_refresh != first_refresh

        reused = client.post(
            "/api/auth/wechat/miniprogram/refresh",
            json={"refresh_token": first_refresh},
        )
        assert reused.status_code == 401
        assert client.post(
            "/api/auth/wechat/miniprogram/refresh",
            json={"refresh_token": second_refresh},
        ).status_code == 401


def test_miniprogram_login_requires_privacy_acceptance_before_registration() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/wechat/miniprogram/login",
            json={"code": "js-code-1"},
        )

        assert response.status_code == 400
        assert response.json() == {"error": "PRIVACY_AGREEMENT_REQUIRED"}
        with app.state.session_factory() as db:
            assert db.scalars(select(User)).all() == []


def test_miniprogram_account_status_does_not_create_unknown_account() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/wechat/miniprogram/account-status",
            json={"code": "js-code-status"},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"registered": False}
        with app.state.session_factory() as db:
            assert db.scalars(select(User)).all() == []


def test_miniprogram_account_status_finds_existing_account() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        created = client.post(
            "/api/auth/wechat/miniprogram/login",
            json={"code": "js-code-1", "privacy_accepted": True},
        )
        assert created.status_code == 200, created.text

        response = client.post(
            "/api/auth/wechat/miniprogram/account-status",
            json={"code": "js-code-status"},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {"registered": True}
        with app.state.session_factory() as db:
            assert len(db.scalars(select(User)).all()) == 1


def test_existing_miniprogram_account_does_not_require_registration_flag() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        created = client.post(
            "/api/auth/wechat/miniprogram/login",
            json={"code": "js-code-1", "privacy_accepted": True},
        )
        assert created.status_code == 200, created.text

        reused = client.post(
            "/api/auth/wechat/miniprogram/login",
            json={"code": "js-code-2"},
        )

        assert reused.status_code == 200, reused.text
        assert reused.json()["user"]["id"] == created.json()["user"]["id"]
        with app.state.session_factory() as db:
            assert len(db.scalars(select(User)).all()) == 1


def test_miniprogram_logout_revokes_session_with_expired_access_independent() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        body = client.post(
            "/api/auth/wechat/miniprogram/login",
            json={"code": "js-code-1", "privacy_accepted": True},
        ).json()
        assert client.post(
            "/api/auth/wechat/miniprogram/logout",
            json={"refresh_token": body["refresh_token"]},
        ).json() == {"ok": True}
        assert client.post(
            "/api/auth/wechat/miniprogram/refresh",
            json={"refresh_token": body["refresh_token"]},
        ).status_code == 401


def test_admin_account_uses_both_wechat_channels() -> None:
    app = build_test_app(openid="admin-openid")
    with app.state.session_factory() as db:
        admin = User(
            email="admin@example.test",
            password_hash=hash_password("admin-password-123"),
            nickname="管理员",
            status=1,
            is_admin=1,
            wechat_openid="admin-openid",
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        historical_mini = issue_session(
            admin,
            app.state.settings,
            app.state.redis,
            channel=MINIPROGRAM_CHANNEL,
        )

    with TestClient(app) as client:
        mini = client.post(
            "/api/auth/wechat/miniprogram/login", json={"code": "js-code-1"}
        )
        assert mini.status_code == 200, mini.text
        mini_body = mini.json()
        assert mini_body["user"]["is_admin"] is True
        assert client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {mini_body['access_token']}"},
        ).json() == {"user": None}
        assert client.get(
            "/api/miniprogram/resumes",
            headers={"Authorization": f"Bearer {mini_body['access_token']}"},
        ).json() == {"resumes": []}

        historical_business = client.get(
            "/api/miniprogram/resumes",
            headers={"Authorization": f"Bearer {historical_mini.access_token}"},
        )
        assert historical_business.status_code == 200, historical_business.text
        historical_refresh = client.post(
            "/api/auth/wechat/miniprogram/refresh",
            json={"refresh_token": historical_mini.refresh_token},
        )
        assert historical_refresh.status_code == 200, historical_refresh.text
        assert historical_refresh.json()["user"]["is_admin"] is True
        assert client.post(
            "/api/auth/wechat/miniprogram/refresh",
            json={"refresh_token": historical_mini.refresh_token},
        ).status_code == 401

        scene, poll_token, _ = create_qrcode(client)
        confirm = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene, "code": "js-code-1", "privacy_accepted": "true"},
        )
        assert confirm.status_code == 200, confirm.text
        assert confirm.json() == {"ok": True}

        status = client.get(
            "/api/auth/wechat/status",
            params={"scene": scene, "poll_token": poll_token},
        )
        assert status.status_code == 200, status.text
        assert status.json()["status"] == "success"
        assert status.json()["user"]["is_admin"] is True

        web_sid = app.state.redis.hget(f"wechat:login:{scene}", "web_sid")
        assert web_sid
        assert app.state.redis.hget(f"auth:session:{web_sid}", "channel") == WEB_CHANNEL
        assert client.get("/api/auth/me").json()["user"]["is_admin"] is True


@pytest.mark.parametrize("is_admin", [0, 1])
def test_disabled_existing_wechat_account_cannot_use_login_channels(is_admin: int) -> None:
    app = build_test_app(openid="disabled-openid")
    with app.state.session_factory() as db:
        disabled = User(
            email="disabled@example.test",
            password_hash=hash_password("disabled-password-123"),
            nickname="停用用户",
            status=0,
            is_admin=is_admin,
            wechat_openid="disabled-openid",
        )
        db.add(disabled)
        db.commit()
        db.refresh(disabled)
        disabled_id = disabled.id
        historical_mini = issue_session(
            disabled,
            app.state.settings,
            app.state.redis,
            channel=MINIPROGRAM_CHANNEL,
        )

    with TestClient(app) as client:
        mini = client.post(
            "/api/auth/wechat/miniprogram/login", json={"code": "js-code-1"}
        )
        assert mini.status_code == 401
        assert mini.json() == {"error": "ACCOUNT_DISABLED"}
        assert client.get(
            "/api/miniprogram/resumes",
            headers={"Authorization": f"Bearer {historical_mini.access_token}"},
        ).status_code == 401
        assert client.post(
            "/api/auth/wechat/miniprogram/refresh",
            json={"refresh_token": historical_mini.refresh_token},
        ).status_code == 401

        scene, _, _ = create_qrcode(client)
        confirm = client.post(
            "/api/auth/wechat/confirm",
            data={"scene": scene, "code": "js-code-1"},
        )
        assert confirm.status_code == 401
        assert confirm.json() == {"error": "ACCOUNT_DISABLED"}
        assert client.get(
            "/api/auth/wechat/status", params={"scene": scene}
        ).json()["status"] == "cancelled"
        assert client.cookies.get(app.state.settings.access_cookie_name) is None
        assert client.cookies.get(app.state.settings.refresh_cookie_name) is None
        assert app.state.redis.hget(f"wechat:login:{scene}", "web_sid") is None
        assert app.state.redis.smembers(f"auth:user_sessions:{disabled_id}") == set()


def test_cookie_and_bearer_credentials_cannot_be_mixed() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        mini = client.post(
            "/api/auth/wechat/miniprogram/login",
            json={"code": "mini-code", "privacy_accepted": True},
        ).json()
        scene, poll_token, _ = create_qrcode(client)
        confirm_and_poll(client, scene, poll_token, "web-code")

        headers = {"Authorization": f"Bearer {mini['access_token']}"}
        assert client.get("/api/auth/me", headers=headers).json() == {"user": None}
        assert client.get("/api/resumes", headers=headers).status_code == 401


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


def test_wechat_qrcode_rate_limit_ignores_spoofed_forwarded_for() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        for index in range(10):
            response = client.post(
                "/api/auth/wechat/qrcode",
                headers={"x-forwarded-for": f"203.0.113.{index}"},
            )
            assert response.status_code == 200, response.text
        limited = client.post(
            "/api/auth/wechat/qrcode",
            headers={"x-forwarded-for": "198.51.100.10"},
        )
        assert limited.status_code == 429


def test_wechat_login_creates_user_without_email() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        scene, poll_token, _ = create_qrcode(client)
        confirm_and_poll(client, scene, poll_token)
        with app.state.session_factory() as db:
            user = db.scalars(select(User)).one()
            assert user.email is None
            assert user.password_hash is None
            assert user.wechat_openid == "openid-fixture"
