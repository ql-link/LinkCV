import base64

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.core.security import verify_password
from linkcv.integrations.wechat_client import WechatApiError
from linkcv.main import create_app
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import ResumeTemplate
from tests.fakes import FakeRedis
from tests.integration.api.test_identity_resumes_assets import FakeStorage


def build_test_app():
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="account-test-secret-with-32-bytes",
        wechat_appid=None,
        wechat_secret=None,
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


class FakeWechatClient:
    def __init__(self, openids: dict[str, str] | None = None, fail: bool = False) -> None:
        self.openids = openids or {}
        self.fail = fail

    def code_to_openid(self, code: str) -> str:
        if self.fail:
            raise WechatApiError("WECHAT_SERVICE_UNAVAILABLE")
        return self.openids.get(code, f"openid-{code}")

    def mini_program_qrcode(self, scene: str) -> bytes:
        if self.fail:
            raise WechatApiError("WECHAT_QRCODE_FAILED")
        return b"\x89PNG-" + scene.encode("ascii")


def build_wechat_test_app() -> tuple[object, FakeWechatClient]:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="account-test-secret-with-32-bytes",
        wechat_appid="wx-test-appid",
        wechat_secret="wechat-test-secret",
        wechat_qr_page="pages/bind/bind",
    )
    wechat = FakeWechatClient()
    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        wechat_client=wechat,
        create_schema=True,
    )
    return app, wechat


def _avatar_data_url(payload: bytes = b"avatar-bytes") -> str:
    return f"data:image/png;base64,{base64.b64encode(payload).decode('ascii')}"


def test_profile_query_returns_stats_and_recent_resumes() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "profile@example.com", "password": "password-123"},
        )
        client.post(
            "/api/resumes",
            json={"title": "简历一", "template_id": app.state.test_template_id},
        )
        client.post(
            "/api/resumes",
            json={"title": "简历二", "template_id": app.state.test_template_id},
        )

        response = client.get("/api/account/profile")
        assert response.status_code == 200
        body = response.json()
        assert body["user"]["email"] == "profile@example.com"
        assert body["user"]["id"].isdecimal()
        assert body["user"]["nickname"].startswith("用户")
        assert body["user"]["avatar_url"] is None
        assert "avatar_object_key" not in body["user"]
        assert body["resume_count"] == 2
        titles = [item["title"] for item in body["recent_resumes"]]
        assert titles == ["简历二", "简历一"]
        assert all("updated_at" in item for item in body["recent_resumes"])

        # Unauthenticated requests are rejected.
        with TestClient(app) as stranger:
            assert stranger.get("/api/account/profile").status_code == 401


def test_nickname_update_validates_and_persists() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "rename@example.com", "password": "password-123"},
        )
        updated = client.patch(
            "/api/account/profile", json={"nickname": "  新昵称  "}
        )
        assert updated.status_code == 200
        assert updated.json()["nickname"] == "新昵称"
        assert updated.json()["avatar_url"] is None

        blank = client.patch("/api/account/profile", json={"nickname": "   "})
        assert blank.status_code == 400
        assert blank.json() == {"error": "INVALID_NICKNAME"}

        too_long = client.patch(
            "/api/account/profile", json={"nickname": "长" * 51}
        )
        assert too_long.status_code == 400
        assert too_long.json() == {"error": "INVALID_NICKNAME"}

        with app.state.session_factory() as session:
            row = session.scalar(select(User).where(User.email == "rename@example.com"))
            assert row is not None
            assert row.nickname == "新昵称"


def test_avatar_upload_replace_and_delete() -> None:
    app = build_test_app()
    storage = app.state.storage
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "avatar@example.com", "password": "password-123"},
        )
        first = client.put(
            "/api/account/avatar",
            json={"fileName": "avatar.png", "dataUrl": _avatar_data_url(b"first")},
        )
        assert first.status_code == 200
        first_url = first.json()["url"]
        assert client.get(first_url).content == b"first"
        with app.state.session_factory() as session:
            row = session.scalar(select(User).where(User.email == "avatar@example.com"))
            assert row is not None
            assert row.avatar_object_key is not None
            user_id = str(row.id)
            first_object_key = row.avatar_object_key
        assert first_object_key.startswith(f"users/{user_id}/assets/avatar/")
        assert first_object_key in storage.objects

        # Replacing the avatar removes the previous object and stores the new one.
        second = client.put(
            "/api/account/avatar",
            json={"fileName": "new.png", "dataUrl": _avatar_data_url(b"second")},
        )
        assert second.status_code == 200
        second_url = second.json()["url"]
        assert second_url != first_url
        assert client.get(second_url).content == b"second"
        assert first_object_key not in storage.objects
        assert len(storage.objects) == 1

        # The profile now exposes the new avatar URL.
        profile = client.get("/api/account/profile").json()["user"]
        assert profile["avatar_url"] == second_url
        # The auth me endpoint also exposes the avatar URL for the sidebar.
        me = client.get("/api/auth/me").json()["user"]
        assert me["avatar_url"] == second_url

        # Deleting the avatar clears the URL and the object.
        deleted = client.delete("/api/account/avatar")
        assert deleted.json() == {"ok": True}
        assert client.get("/api/account/profile").json()["user"]["avatar_url"] is None
        assert storage.objects == {}

        # Invalid payloads are rejected before any upload.
        invalid = client.put(
            "/api/account/avatar", json={"fileName": "bad", "dataUrl": "not-a-data-url"}
        )
        assert invalid.status_code == 400
        assert invalid.json() == {"error": "INVALID_IMAGE"}


def test_avatar_upload_rejects_oversized_images() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "oversize@example.com", "password": "password-123"},
        )
        oversized = client.put(
            "/api/account/avatar",
            json={"fileName": "huge.png", "dataUrl": "data:image/png;base64," + "A" * (14 * 1024 * 1024)},
        )
        assert oversized.status_code == 413
        assert oversized.json() == {"error": "IMAGE_TOO_LARGE"}


def test_change_password_revokes_all_sessions_and_blocks_old_password() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "secret@example.com", "password": "password-123"},
        )
        wrong_current = client.post(
            "/api/account/change-password",
            json={
                "current_password": "wrong-password",
                "new_password": "new-password-456",
                "confirm_password": "new-password-456",
            },
        )
        assert wrong_current.status_code == 400
        assert wrong_current.json() == {"error": "INVALID_CURRENT_PASSWORD"}

        weak = client.post(
            "/api/account/change-password",
            json={
                "current_password": "password-123",
                "new_password": "short",
                "confirm_password": "short",
            },
        )
        assert weak.status_code == 400
        assert weak.json() == {"error": "WEAK_PASSWORD"}

        mismatch = client.post(
            "/api/account/change-password",
            json={
                "current_password": "password-123",
                "new_password": "new-password-456",
                "confirm_password": "different-789",
            },
        )
        assert mismatch.status_code == 400
        assert mismatch.json() == {"error": "PASSWORD_MISMATCH"}

        unchanged = client.post(
            "/api/account/change-password",
            json={
                "current_password": "password-123",
                "new_password": "password-123",
                "confirm_password": "password-123",
            },
        )
        assert unchanged.status_code == 400
        assert unchanged.json() == {"error": "PASSWORD_UNCHANGED"}

        changed = client.post(
            "/api/account/change-password",
            json={
                "current_password": "password-123",
                "new_password": "new-password-456",
                "confirm_password": "new-password-456",
            },
        )
        assert changed.status_code == 200
        assert changed.json()["ok"] is True
        # Both auth cookies are cleared (deletion markers carry Max-Age=0).
        assert "Max-Age=0" in changed.headers.get("set-cookie", "")

        # The current session is revoked and the old credentials are rejected.
        assert client.get("/api/account/profile").json() == {"error": "UNAUTHORIZED"}
        old_login = client.post(
            "/api/auth/login",
            json={"email": "secret@example.com", "password": "password-123"},
        )
        assert old_login.status_code == 401

        with app.state.session_factory() as session:
            row = session.scalar(select(User).where(User.email == "secret@example.com"))
            assert row is not None
            assert verify_password("new-password-456", row.password_hash)

        # A fresh session with the new password works.
        new_login = client.post(
            "/api/auth/login",
            json={"email": "secret@example.com", "password": "new-password-456"},
        )
        assert new_login.status_code == 200
        assert client.get("/api/account/profile").status_code == 200


def test_account_routes_reject_unauthenticated_users() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        assert client.get("/api/account/profile").status_code == 401
        assert client.patch("/api/account/profile", json={"nickname": "x"}).status_code == 401
        assert client.put("/api/account/avatar", json={"fileName": "a.png", "dataUrl": "x"}).status_code == 401
        assert client.delete("/api/account/avatar").status_code == 401
        assert (
            client.post(
                "/api/account/change-password",
                json={
                    "current_password": "a",
                    "new_password": "b",
                    "confirm_password": "b",
                },
            ).status_code
            == 401
        )


def test_change_password_rejects_letters_only_password() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "strength@example.com", "password": "password-123"},
        )
        letters_only = client.post(
            "/api/account/change-password",
            json={
                "current_password": "password-123",
                "new_password": "onlyletters",
                "confirm_password": "onlyletters",
            },
        )
        assert letters_only.status_code == 400
        assert letters_only.json() == {"error": "WEAK_PASSWORD"}


def test_profile_reports_wechat_unavailable_without_config() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "nowx@example.com", "password": "password-123"},
        )
        profile = client.get("/api/account/profile").json()["user"]
        assert profile["wechat_status"] == "unavailable"
        assert profile["wechat_bound_at"] is None


def test_wechat_bind_full_flow() -> None:
    app, _wechat = build_wechat_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "bind@example.com", "password": "password-123"},
        )
        assert (
            client.get("/api/account/profile").json()["user"]["wechat_status"]
            == "unbound"
        )

        requested = client.post("/api/account/wechat/bind-request")
        assert requested.status_code == 200
        body = requested.json()
        ticket = body["ticket"]
        assert base64.b64decode(body["qrcode_data"]).startswith(b"\x89PNG-")
        assert client.get(f"/api/account/wechat/bind-status?ticket={ticket}").json() == {
            "status": "pending"
        }

        confirmed = client.post(
            "/api/account/wechat/bind-confirm",
            json={"ticket": ticket, "code": "code-a"},
        )
        assert confirmed.status_code == 200
        assert confirmed.json() == {"ok": True}
        assert client.get(f"/api/account/wechat/bind-status?ticket={ticket}").json() == {
            "status": "bound"
        }
        profile = client.get("/api/account/profile").json()["user"]
        assert profile["wechat_status"] == "bound"
        assert profile["wechat_bound_at"] is not None

        with app.state.session_factory() as session:
            row = session.scalar(select(User).where(User.email == "bind@example.com"))
            assert row is not None
            assert row.wechat_openid == "openid-code-a"

        # Already-bound users cannot request another binding.
        re_request = client.post("/api/account/wechat/bind-request")
        assert re_request.status_code == 400
        assert re_request.json() == {"error": "WECHAT_ALREADY_BOUND"}


def test_wechat_bind_rejects_unknown_ticket() -> None:
    app, _wechat = build_wechat_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "ticket@example.com", "password": "password-123"},
        )
        confirmed = client.post(
            "/api/account/wechat/bind-confirm",
            json={"ticket": "missing-ticket", "code": "code-a"},
        )
        assert confirmed.status_code == 400
        assert confirmed.json() == {"error": "BIND_TICKET_INVALID"}


def test_wechat_bind_conflicts_with_another_user() -> None:
    app, wechat = build_wechat_test_app()
    wechat.openids = {"code-shared": "openid-shared"}
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "first@example.com", "password": "password-123"},
        )
        first_ticket = client.post("/api/account/wechat/bind-request").json()["ticket"]
        assert (
            client.post(
                "/api/account/wechat/bind-confirm",
                json={"ticket": first_ticket, "code": "code-shared"},
            ).status_code
            == 200
        )

        # A second account tries to bind the same openid; it must be rejected.
        client.post(
            "/api/auth/register",
            json={"email": "second@example.com", "password": "password-123"},
        )
        second_ticket = client.post("/api/account/wechat/bind-request").json()["ticket"]
        conflict = client.post(
            "/api/account/wechat/bind-confirm",
            json={"ticket": second_ticket, "code": "code-shared"},
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "WECHAT_ALREADY_BOUND"}

        with app.state.session_factory() as session:
            second = session.scalar(select(User).where(User.email == "second@example.com"))
            assert second is not None
            assert second.wechat_openid is None
            first = session.scalar(select(User).where(User.email == "first@example.com"))
            assert first is not None
            assert first.wechat_openid == "openid-shared"


def test_wechat_bind_unavailable_without_config() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "wxoff@example.com", "password": "password-123"},
        )
        requested = client.post("/api/account/wechat/bind-request")
        assert requested.status_code == 503
        assert requested.json() == {"error": "WECHAT_SERVICE_UNAVAILABLE"}


def test_wechat_bind_surfaces_wechat_api_failure() -> None:
    app, wechat = build_wechat_test_app()
    wechat.fail = True
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "wxdown@example.com", "password": "password-123"},
        )
        requested = client.post("/api/account/wechat/bind-request")
        assert requested.status_code == 503
        assert requested.json() == {"error": "WECHAT_SERVICE_UNAVAILABLE"}
