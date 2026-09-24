import json

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from linkresume.core.config import Settings
from linkresume.main import create_app
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import ResumeTemplate
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import canonical_template_payload


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
    data, style = canonical_template_payload(key=key)
    return json.dumps(
        {
            "key": key,
            "name": "作品集模板",
            "description": "测试模板包",
            "data": data,
            "style": style,
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
        assert client.put(
            "/api/admin/resume-templates/1/classification",
            json={"style_categories": ["现代"], "use_cases": ["社招"], "style_review_status": "classified"},
        ).status_code == 403
        assert client.put(
            "/api/admin/resume-templates/1/sort-order",
            json={"sort_order": 0},
        ).status_code == 403


def test_admin_sort_order_controls_user_and_admin_lists() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, app, admin=True)
        ids = []
        for position, key in enumerate(("first-cn", "second-cn", "third-cn"), start=1):
            imported = client.post(
                "/api/admin/resume-templates/import",
                files={"file": ("template.json", package(key), "application/json")},
            ).json()["template"]
            assert imported["sort_order"] == position * 10
            ids.append(imported["id"])
            assert client.put(
                f"/api/admin/resume-templates/{imported['id']}/status",
                json={"active": True},
            ).status_code == 200

        def ordered_ids(path: str) -> list[str]:
            return [item["id"] for item in client.get(path).json()["templates"]]

        assert ordered_ids("/api/resume-templates") == ids
        for value in (-1, 1000001, "1", 1.5):
            assert client.put(
                f"/api/admin/resume-templates/{ids[2]}/sort-order",
                json={"sort_order": value},
            ).status_code == 422
        assert client.put(
            "/api/admin/resume-templates/999999/sort-order",
            json={"sort_order": 0},
        ).status_code == 404
        assert ordered_ids("/api/resume-templates") == ids

        moved = client.put(
            f"/api/admin/resume-templates/{ids[2]}/sort-order",
            json={"sort_order": 0},
        )
        assert moved.status_code == 200
        assert moved.json()["template"]["sort_order"] == 0
        assert ordered_ids("/api/admin/resume-templates") == [ids[2], ids[0], ids[1]]
        assert ordered_ids("/api/resume-templates") == [ids[2], ids[0], ids[1]]

        assert client.put(
            f"/api/admin/resume-templates/{ids[0]}/sort-order",
            json={"sort_order": 0},
        ).status_code == 200
        assert ordered_ids("/api/resume-templates") == [ids[0], ids[2], ids[1]]


def test_admin_classification_is_persisted_and_visible_to_users() -> None:
    app = build_app()
    with TestClient(app) as client:
        register(client, app, admin=True)
        imported = client.post(
            "/api/admin/resume-templates/import",
            files={"file": ("template.json", package(), "application/json")},
        ).json()["template"]
        template_id = imported["id"]
        assert imported["style_categories"] == []
        assert imported["use_cases"] == []
        assert imported["style_review_status"] == "pending"

        invalid = client.put(
            f"/api/admin/resume-templates/{template_id}/classification",
            json={"style_categories": ["现代", "现代"], "use_cases": ["社招"], "style_review_status": "classified"},
        )
        assert invalid.status_code == 422
        mismatched = client.put(
            f"/api/admin/resume-templates/{template_id}/classification",
            json={"style_categories": [], "use_cases": ["社招"], "style_review_status": "classified"},
        )
        assert mismatched.status_code == 422
        assert client.put(
            "/api/admin/resume-templates/999999/classification",
            json={"style_categories": [], "use_cases": [], "style_review_status": "pending"},
        ).status_code == 404

        saved = client.put(
            f"/api/admin/resume-templates/{template_id}/classification",
            json={"style_categories": ["现代", "创意"], "use_cases": ["实习", "校招"], "style_review_status": "classified"},
        )
        assert saved.status_code == 200
        assert saved.json()["template"]["style_categories"] == ["现代", "创意"]
        assert client.get("/api/admin/resume-templates").json()["templates"][0]["use_cases"] == ["实习", "校招"]

        client.put(f"/api/admin/resume-templates/{template_id}/status", json={"active": True})
        user_template = client.get("/api/resume-templates").json()["templates"][0]
        assert user_template["style_categories"] == ["现代", "创意"]
        assert user_template["use_cases"] == ["实习", "校招"]

        unsure = client.put(
            f"/api/admin/resume-templates/{template_id}/classification",
            json={"style_categories": [], "use_cases": ["校招"], "style_review_status": "unsure"},
        )
        assert unsure.status_code == 200
        assert unsure.json()["template"]["style_review_status"] == "unsure"
        assert client.get(f"/api/resume-templates/{template_id}").json()["template"]["style_categories"] == []


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
        missing_fallback_payload = json.loads(package("missing-fallback-cn"))
        missing_fallback_payload["style"]["slots"] = []
        missing_fallback = client.post(
            "/api/admin/resume-templates/import",
            files={
                "file": (
                    "missing-fallback.json",
                    json.dumps(missing_fallback_payload).encode(),
                    "application/json",
                )
            },
        )

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": "TEMPLATE_KEY_CONFLICT"}
    assert unsafe.status_code == html_unsafe.status_code == css_unsafe.status_code == oversized.status_code == missing_fallback.status_code == 400
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count(ResumeTemplate.id))) == 1
