import base64

from fastapi.testclient import TestClient
from sqlalchemy import select

from drawoffer.core.config import Settings
from drawoffer.core.security import verify_password
from drawoffer.integrations.wechat_client import WechatApiError
from drawoffer.main import create_app
from drawoffer.modules.identity.models import User, UserProfile
from drawoffer.modules.resumes.models import ResumeTemplate
from tests.canonical_resume_fixtures import canonical_template_payload
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
        template_data, template_style = canonical_template_payload(key="blank-cn")
        template = ResumeTemplate(
            key="blank-cn",
            name="空白简历",
            data_json=template_data,
            style_json=template_style,
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
        assert body["user"]["avatar_url"] == "/api/auth/default-avatar"
        assert "avatar_object_key" not in body["user"]
        assert body["resume_count"] == 2
        assert "profile" not in body
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
        assert updated.json()["avatar_url"] == "/api/auth/default-avatar"

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








def _register_account(client: TestClient, email: str = "profile@example.com") -> None:
    client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )


def _valid_profile_payload(base_lock_version: int = 1) -> dict:
    return {
        "base_lock_version": base_lock_version,
        "candidate_cities": ["北京", "上海"],
        "salary_min": 20000,
        "salary_max": 30000,
        "salary_currency": "CNY",
        "salary_period": "month",
        "employment_types": ["full_time"],
        "school": "某大学",
        "school_tier": ["project_985"],
        "major": "计算机",
        "education_level": "bachelor",
        "years_experience": 3,
        "candidate_status": "experienced",
        "graduation_year": None,
        "languages": ["英语 CET-6"],
        "skills": ["React", "Python"],
        "certifications": [],
        "honors": [],
        "campus_experiences": [],
    }


def test_user_profile_get_returns_empty_when_not_created() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        response = client.get("/api/account/user-profile")
        assert response.status_code == 200
        body = response.json()
        assert body["lock_version"] == 1
        assert body["candidate_cities"] == []
        assert body["employment_types"] == []
        assert body["candidate_status"] is None
        assert body["graduation_year"] is None
        assert body["skills"] == []
        assert body["created_at"] is None
        assert body["updated_at"] is None

        # Unauthenticated requests are rejected.
        with TestClient(app) as stranger:
            assert stranger.get("/api/account/user-profile").status_code == 401


def test_user_profile_put_and_get_roundtrip() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        put_response = client.put(
            "/api/account/user-profile", json=_valid_profile_payload()
        )
        assert put_response.status_code == 200
        saved = put_response.json()
        assert saved["lock_version"] == 1
        assert saved["candidate_cities"] == ["北京", "上海"]
        assert saved["employment_types"] == ["full_time"]
        assert "professional_directions" not in saved
        assert saved["skills"] == ["React", "Python"]
        assert saved["school_tier"] == ["project_985"]
        assert saved["created_at"] is not None
        assert saved["updated_at"] is not None

        get_response = client.get("/api/account/user-profile")
        assert get_response.status_code == 200
        assert get_response.json() == saved


def test_user_profile_reads_redundant_legacy_education_tag_without_changing_storage() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        assert client.put("/api/account/user-profile", json=_valid_profile_payload()).status_code == 200
        with app.state.session_factory() as session:
            row = session.scalar(select(UserProfile))
            row.school_tier = ["本科", "project_985"]
            session.commit()
            expected_created_at = row.create_time.isoformat().replace("+00:00", "Z")
            expected_updated_at = row.update_time.isoformat().replace("+00:00", "Z")

        response = client.get("/api/account/user-profile")
        assert response.status_code == 200
        assert response.json()["education_level"] == "bachelor"
        assert response.json()["school_tier"] == ["project_985"]
        assert response.json()["lock_version"] == 1
        assert response.json()["created_at"].removesuffix("Z") == expected_created_at.removesuffix("Z")
        assert response.json()["updated_at"].removesuffix("Z") == expected_updated_at.removesuffix("Z")
        with app.state.session_factory() as session:
            row = session.scalar(select(UserProfile))
            assert row.school_tier == ["本科", "project_985"]
            assert row.lock_version == 1

        conflict = client.put("/api/account/user-profile", json=_valid_profile_payload(base_lock_version=2))
        assert conflict.status_code == 409
        assert conflict.json()["profile"]["school_tier"] == ["project_985"]


def test_account_profile_does_not_include_profile_field() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        empty = client.get("/api/account/profile").json()
        assert "profile" not in empty

        client.put("/api/account/user-profile", json=_valid_profile_payload())
        loaded = client.get("/api/account/profile").json()
        assert "profile" not in loaded
        # Existing account fields are unchanged.
        assert loaded["user"]["email"] == "profile@example.com"
        assert loaded["resume_count"] == 0


def test_user_profile_rejects_invalid_enums() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)

        for field, value in [
            ("employment_types", ["invalid"]),
            ("employment_types", ["part_time"]),
            ("employment_types", ["contract"]),
            ("employment_types", ["temporary"]),
            ("salary_period", "century"),
            ("candidate_status", "student"),
            ("education_level", "phd"),
            ("school_tier", ["本科"]),
            ("school_tier", ["unknown_tier"]),
        ]:
            payload = _valid_profile_payload()
            payload[field] = value
            response = client.put("/api/account/user-profile", json=payload)
            assert response.status_code == 400
            assert response.json() == {"error": "INVALID_USER_PROFILE"}


def test_user_profile_rejects_invalid_salary_and_context() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)

        # salary_max < salary_min
        payload = _valid_profile_payload()
        payload["salary_max"] = 10000
        response = client.put("/api/account/user-profile", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_USER_PROFILE"}

        # numeric salary requires currency and period
        payload = _valid_profile_payload()
        payload["salary_currency"] = None
        payload["salary_period"] = None
        response = client.put("/api/account/user-profile", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_USER_PROFILE"}


def test_user_profile_rejects_invalid_candidate_experience_context() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        cases = [
            {"candidate_status": "fresh_graduate", "graduation_year": None},
            {"candidate_status": "fresh_graduate", "graduation_year": 2026, "years_experience": 1},
            {"candidate_status": "experienced", "graduation_year": 2026},
            {"candidate_status": None, "graduation_year": 2026},
        ]
        for changes in cases:
            payload = _valid_profile_payload()
            payload.update(changes)
            response = client.put("/api/account/user-profile", json=payload)
            assert response.status_code == 400
            assert response.json() == {"error": "INVALID_USER_PROFILE"}

        fresh = _valid_profile_payload()
        fresh.update(
            {
                "candidate_status": "fresh_graduate",
                "graduation_year": 2026,
                "years_experience": 0,
            }
        )
        response = client.put("/api/account/user-profile", json=fresh)
        assert response.status_code == 200
        assert response.json()["candidate_status"] == "fresh_graduate"
        assert response.json()["graduation_year"] == 2026


def test_user_profile_rejects_negative_years_and_oversized_items() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)

        payload = _valid_profile_payload()
        payload["years_experience"] = -1
        response = client.put("/api/account/user-profile", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_USER_PROFILE"}

        payload = _valid_profile_payload()
        payload["skills"] = ["x" * 101]
        response = client.put("/api/account/user-profile", json=payload)
        assert response.status_code == 400
        assert response.json() == {"error": "INVALID_USER_PROFILE"}


def test_user_profile_rejects_removed_fields() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        for field, value in (
            ("work_mode", "remote"),
            ("professional_directions", ["前端工程师"]),
        ):
            payload = _valid_profile_payload()
            payload[field] = value
            response = client.put("/api/account/user-profile", json=payload)
            assert response.status_code == 400
            assert response.json() == {"error": "INVALID_USER_PROFILE"}


def test_user_profile_rejects_stale_lock_version() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        first = client.put(
            "/api/account/user-profile", json=_valid_profile_payload()
        )
        assert first.status_code == 200
        assert first.json()["lock_version"] == 1

        # Reuse the same base_lock_version after a successful update: the row
        # has advanced to lock_version 2, so the stale request must 409 and
        # return the latest profile for the client to refresh.
        second = client.put(
            "/api/account/user-profile",
            json=_valid_profile_payload(base_lock_version=1),
        )
        assert second.status_code == 200
        assert second.json()["lock_version"] == 2

        stale = client.put(
            "/api/account/user-profile",
            json=_valid_profile_payload(base_lock_version=1),
        )
        assert stale.status_code == 409
        assert stale.json()["error"] == "USER_PROFILE_VERSION_CONFLICT"
        assert stale.json()["profile"]["lock_version"] == 2






def test_ordinary_wechat_binding_routes_are_removed_in_both_environments():
    app = build_test_app()
    with TestClient(app) as client:
        _register_account(client)
        for environment in ["development", "production"]:
            app.state.settings = app.state.settings.model_copy(update={"app_environment": environment})
            assert client.post("/api/account/wechat/bind-request").status_code == 404
            assert client.post("/api/account/wechat/bind-confirm", json={"ticket": "fictional", "code": "fictional"}).status_code == 404
            assert client.get("/api/account/wechat/bind-status?ticket=fictional").status_code == 404
            assert client.post("/api/account/wechat/unbind").status_code == 404
