import base64
from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import ResumeVersion


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


class FakeRedis:
    """In-memory Redis stand-in mirroring the subset used by sessions."""

    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.sets: dict[str, set[str]] = {}
        self.ttls: dict[str, float | None] = {}

    def hset(
        self,
        name: str,
        key: str | None = None,
        value: str | None = None,
        mapping: dict[str, str] | None = None,
    ) -> int:
        data = self.hashes.setdefault(name, {})
        merged: dict[str, str] = dict(mapping or {})
        if key is not None:
            merged[key] = "" if value is None else str(value)
        count = 0
        for field, val in merged.items():
            if field not in data:
                count += 1
            data[field] = str(val)
        return count

    def hget(self, name: str, key: str) -> str | None:
        return self.hashes.get(name, {}).get(key)

    def hgetall(self, name: str) -> dict[str, str]:
        return dict(self.hashes.get(name, {}))

    def exists(self, name: str) -> int:
        return int(
            name in self.strings or name in self.hashes or name in self.sets
        )

    def delete(self, *names: str) -> int:
        removed = 0
        for name in names:
            removed += int(
                self.strings.pop(name, None) is not None
                or self.hashes.pop(name, None) is not None
                or self.sets.pop(name, None) is not None
            )
            self.ttls.pop(name, None)
        return removed

    def expire(self, name: str, ttl: float) -> int:
        if name in self.strings or name in self.hashes or name in self.sets:
            self.ttls[name] = ttl
            return 1
        return 0

    def sadd(self, name: str, *values: str) -> int:
        target = self.sets.setdefault(name, set())
        before = len(target)
        target.update(values)
        return len(target) - before

    def srem(self, name: str, *values: str) -> int:
        target = self.sets.get(name, set())
        removed = 0
        for value in values:
            if value in target:
                target.remove(value)
                removed += 1
        if not target:
            self.sets.pop(name, None)
        return removed

    def smembers(self, name: str) -> set[str]:
        return set(self.sets.get(name, set()))

    def ping(self, **_kwargs) -> bool:
        return True

    def close(self, **_kwargs) -> None:
        pass


def build_test_app():
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
    )
    return create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )


def test_authentication_and_resume_crud() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/auth/register",
            json={"email": "USER@example.com", "password": "password-123"},
        )
        assert response.status_code == 201
        assert response.json()["user"]["email"] == "user@example.com"
        assert response.json()["user"]["id"].isdecimal()
        with app.state.session_factory() as session:
            registered_user = session.scalar(
                select(User).where(User.email == "user@example.com")
            )
            assert registered_user is not None
            assert registered_user.nickname.startswith("用户")
        set_cookie = response.headers["set-cookie"]
        # Short access cookie plus a 7-day refresh cookie.
        assert "resume_access=" in set_cookie and "Max-Age=900" in set_cookie
        assert "resume_refresh=" in set_cookie and "Max-Age=604800" in set_cookie

        assert client.get("/api/auth/me").json()["user"]["email"] == "user@example.com"

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
        resume = created.json()["resume"]
        assert resume["title"] == "测试简历"
        assert resume["settings"]["theme"] == "modern"
        assert resume["settings"]["showSource"] is False
        assert resume["splitRatio"] == 0.45
        assert resume["sourceType"] == "blank"
        assert resume["lockVersion"] == 1
        assert "createdAt" in resume

        resume_id = resume["id"]
        with app.state.session_factory() as session:
            initial_version = session.scalar(
                select(ResumeVersion).where(ResumeVersion.resume_id == int(resume_id))
            )
            assert initial_version is not None
            assert initial_version.version_no == 1
            assert initial_version.reason == "initial"
        listed = client.get("/api/resumes").json()["resumes"]
        assert [item["id"] for item in listed] == [resume_id]

        updated = client.put(
            f"/api/resumes/{resume_id}",
            json={
                "title": "更新后的简历",
                "markdown": "# 张三\n\n新内容",
                "lockVersion": resume["lockVersion"],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["resume"]["title"] == "更新后的简历"
        assert updated.json()["resume"]["splitRatio"] == 0.45
        assert updated.json()["resume"]["lockVersion"] == 2

        conflict = client.put(
            f"/api/resumes/{resume_id}",
            json={"title": "过期写入", "lockVersion": 1},
        )
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "RESUME_EDIT_CONFLICT"}
        assert client.get(f"/api/resumes/{resume_id}").json()["resume"][
            "title"
        ] == "更新后的简历"

        assert client.delete(f"/api/resumes/{resume_id}").json() == {"deleted": True}
        assert client.get(f"/api/resumes/{resume_id}").status_code == 404

        assert client.post("/api/auth/logout").json() == {"ok": True}
        assert client.get("/api/resumes").json() == {"error": "UNAUTHORIZED"}


def test_assets_are_private_to_the_current_user() -> None:
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


def test_refresh_rotates_secret_and_reuse_revokes_session() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register = client.post(
            "/api/auth/register",
            json={"email": "rotator@example.com", "password": "password-123"},
        )
        assert register.status_code == 201
        first_refresh = client.cookies.get("resume_refresh")
        assert first_refresh

        # Refresh issues a new access token and rotates the refresh secret.
        refreshed = client.post("/api/auth/refresh")
        assert refreshed.status_code == 200
        assert refreshed.json()["user"]["email"] == "rotator@example.com"
        second_refresh = client.cookies.get("resume_refresh")
        assert second_refresh and second_refresh != first_refresh

    # Reusing the rotated-out refresh token must fail and revoke the session.
    with TestClient(app) as attacker:
        attacker.cookies.set(
            "resume_refresh", first_refresh, domain="localhost", path="/api/auth"
        )
        assert attacker.post("/api/auth/refresh").status_code == 401

    # The whole session is now revoked, so the live token is also invalid.
    with TestClient(app) as client2:
        client2.cookies.set(
            "resume_refresh", second_refresh, domain="localhost", path="/api/auth"
        )
        assert client2.post("/api/auth/refresh").status_code == 401


def test_disabled_account_blocks_access() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        client.post(
            "/api/auth/register",
            json={"email": "disabled@example.com", "password": "password-123"},
        )
        with app.state.session_factory() as session:
            row = session.query(User).filter_by(email="disabled@example.com").one()
            row.status = 0
            session.commit()
        # Disabling the user (without deleting the Redis key) still rejects access.
        assert client.get("/api/resumes").json() == {"error": "UNAUTHORIZED"}
