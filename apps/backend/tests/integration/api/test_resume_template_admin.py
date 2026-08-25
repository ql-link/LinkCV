import json

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from linkcv.core.config import Settings
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import ResumeTemplate
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


def build_app():
    return create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="template-admin-test-secret-with-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )


def register(client: TestClient, app, *, admin: bool) -> None:
    email = "admin@example.test" if admin else "user@example.test"
    assert client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    ).status_code == 201
    if admin:
        with app.state.session_factory() as db:
            user = db.scalar(select(User).where(User.email == email))
            assert user is not None
            user.is_admin = True
            db.commit()


def package(key: str = "portfolio-cn") -> bytes:
    style = default_resume_style().model_copy(update={"template_key": key})
    return json.dumps(
        {
            "key": key,
            "name": "作品集模板",
            "description": "测试模板包",
            "data": default_resume_document().model_dump(mode="json"),
            "style": style.model_dump(mode="json"),
        },
        ensure_ascii=False,
    ).encode("utf-8")


def test_template_admin_requires_admin() -> None:
    app = build_app()
    with TestClient(app) as client:
        assert client.get("/api/admin/resume-templates").status_code == 401
        register(client, app, admin=False)
        assert client.get("/api/admin/resume-templates").status_code == 403
        assert client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("template.json", package(), "application/json")},
        ).status_code == 403


def test_admin_imports_inactive_template_then_enables_it_idempotently() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, app, admin=True)
        imported = client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("template.json", package(), "application/json")},
        )
        assert imported.status_code == 201
        template = imported.json()["template"]
        assert template["active"] is False
        assert template["valid"] is True

        user_list = client.get("/api/resume-templates")
        assert user_list.status_code == 200
        assert user_list.json()["templates"] == []

        enabled = client.put(
            f"/api/admin/resume-templates/{template['id']}/status",
            json={"active": True},
        )
        repeated = client.put(
            f"/api/admin/resume-templates/{template['id']}/status",
            json={"active": True},
        )
        assert enabled.status_code == repeated.status_code == 200
        assert repeated.json()["template"]["active"] is True
        assert [item["id"] for item in client.get("/api/resume-templates").json()["templates"]] == [
            template["id"]
        ]


def test_invalid_oversized_and_duplicate_packages_never_overwrite() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, app, admin=True)
        first = client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("template.json", package(), "application/json")},
        )
        duplicate = client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("template.json", package(), "application/json")},
        )
        unsafe_payload = json.loads(package())
        unsafe_payload["description"] = "<script>alert(1)</script>"
        unsafe = client.post(
            "/api/admin/resume-templates/import",
            files={
                "file": (
                    "unsafe.json",
                    json.dumps(unsafe_payload).encode(),
                    "application/json",
                )
            },
        )
        html_payload = json.loads(package("html-template-cn"))
        html_payload["description"] = "<div>不允许的模板标记</div>"
        html_unsafe = client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("html.json", json.dumps(html_payload).encode(), "application/json")},
        )
        css_payload = json.loads(package("css-template-cn"))
        css_payload["description"] = ".resume { color: red; }"
        css_unsafe = client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("css.json", json.dumps(css_payload).encode(), "application/json")},
        )
        oversized = client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("large.json", b"x" * (512 * 1024 + 1), "application/json")},
        )
        missing_manifest_payload = json.loads(package("missing-manifest-cn"))
        del missing_manifest_payload["style"]["manifest"]
        missing_manifest = client.post(
            "/api/admin/resume-templates/import",
            files={
                "file": (
                    "missing-manifest.json",
                    json.dumps(missing_manifest_payload).encode(),
                    "application/json",
                )
            },
        )

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": "TEMPLATE_KEY_CONFLICT"}
    assert unsafe.status_code == html_unsafe.status_code == css_unsafe.status_code == oversized.status_code == missing_manifest.status_code == 400
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count(ResumeTemplate.id))) == 1
