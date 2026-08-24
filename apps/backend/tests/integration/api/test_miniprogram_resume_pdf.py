from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.identity.session_service import MINIPROGRAM_CHANNEL, issue_session
from linkcv.modules.resumes.models import ResumeTemplate
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class FakeRenderer:
    def __init__(self) -> None:
        self.payloads: list[dict] = []

    def render(self, payload: dict) -> bytes:
        self.payloads.append(payload)
        return b"%PDF-1.3\nfixture"


class FakePreviewRenderer:
    def __init__(self) -> None:
        self.pdf_inputs: list[bytes] = []

    def render(self, pdf: bytes) -> bytes:
        self.pdf_inputs.append(pdf)
        return b"\x89PNG\r\n\x1a\nfixture"


def build_app():
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="mini-pdf-test-secret-with-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    app.state.resume_pdf_renderer = FakeRenderer()
    app.state.resume_preview_renderer = FakePreviewRenderer()
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


def test_pdf_uses_latest_manual_version_and_rejects_stale_version_id() -> None:
    app = build_app()
    with TestClient(app) as web_client:
        assert web_client.post(
            "/api/auth/register",
            json={"email": "owner@example.test", "password": "password-123"},
        ).status_code == 201
        created = web_client.post(
            "/api/resumes",
            json={"title": "张三的简历", "template_id": app.state.test_template_id},
        ).json()["resume"]
        resume_id = created["id"]
        initial_name = created["data"]["basics"]["name"]

        listed_initial = web_client.get(f"/api/resumes/{resume_id}/versions").json()["versions"]
        initial_version_id = listed_initial[0]["id"]

        data = created["data"]
        data["basics"]["name"] = "手动保存版本"
        updated = web_client.put(
            f"/api/resumes/{resume_id}",
            json={"data": data, "base_lock_version": created["lock_version"]},
        ).json()["resume"]
        manual = web_client.post(f"/api/resumes/{resume_id}/versions", json={}).json()["version"]

        data = updated["data"]
        data["basics"]["name"] = "尚未手动保存的草稿"
        assert web_client.put(
            f"/api/resumes/{resume_id}",
            json={"data": data, "base_lock_version": updated["lock_version"]},
        ).status_code == 200

    headers = mini_headers(app, "owner@example.test")
    with TestClient(app) as mini_client:
        listed = mini_client.get("/api/miniprogram/resumes", headers=headers)
        assert listed.status_code == 200
        item = listed.json()["resumes"][0]
        assert item["pdf_version_id"] == manual["id"]
        assert item["preview"]["data"]["basics"]["name"] == "手动保存版本"
        assert item["preview"]["data"]["basics"]["name"] != initial_name

        metadata = mini_client.get(
            f"/api/miniprogram/resumes/{resume_id}", headers=headers
        ).json()["resume"]
        assert metadata["data"]["basics"]["name"] == "手动保存版本"

        downloaded = mini_client.get(
            f"/api/miniprogram/resumes/{resume_id}/pdf",
            params={"version_id": manual["id"]},
            headers=headers,
        )
        assert downloaded.status_code == 200
        assert downloaded.content.startswith(b"%PDF-")
        assert downloaded.headers["x-linkcv-pdf-version-id"] == manual["id"]
        assert downloaded.headers["cache-control"] == "private, no-store"
        assert app.state.resume_pdf_renderer.payloads[-1]["data"]["basics"]["name"] == "手动保存版本"
        assert app.state.resume_pdf_renderer.payloads[-1]["style"]["smart_one_page"] is True

        preview = mini_client.get(
            f"/api/miniprogram/resumes/{resume_id}/preview.png",
            params={"version_id": manual["id"]},
            headers=headers,
        )
        assert preview.status_code == 200
        assert preview.headers["content-type"] == "image/png"
        assert preview.content.startswith(b"\x89PNG\r\n\x1a\n")
        assert preview.headers["x-linkcv-preview-version-id"] == manual["id"]
        assert preview.headers["cache-control"] == "private, no-store"
        assert app.state.resume_preview_renderer.pdf_inputs[-1].startswith(b"%PDF-")

        stale = mini_client.get(
            f"/api/miniprogram/resumes/{resume_id}/pdf",
            params={"version_id": initial_version_id},
            headers=headers,
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "RESUME_VERSION_UNAVAILABLE"}
        stale_preview = mini_client.get(
            f"/api/miniprogram/resumes/{resume_id}/preview.png",
            params={"version_id": initial_version_id},
            headers=headers,
        )
        assert stale_preview.status_code == 409
        assert stale_preview.json() == {"error": "RESUME_VERSION_UNAVAILABLE"}


def test_pdf_falls_back_to_initial_version_and_enforces_ownership() -> None:
    app = build_app()
    with TestClient(app) as owner_client:
        owner_client.post(
            "/api/auth/register",
            json={"email": "owner@example.test", "password": "password-123"},
        )
        created = owner_client.post(
            "/api/resumes",
            json={"title": "初始简历", "template_id": app.state.test_template_id},
        ).json()["resume"]
    with TestClient(app) as stranger_client:
        stranger_client.post(
            "/api/auth/register",
            json={"email": "stranger@example.test", "password": "password-123"},
        )

    owner_headers = mini_headers(app, "owner@example.test")
    stranger_headers = mini_headers(app, "stranger@example.test")
    with TestClient(app) as client:
        metadata = client.get(
            f"/api/miniprogram/resumes/{created['id']}", headers=owner_headers
        )
        assert metadata.status_code == 200
        version_id = metadata.json()["resume"]["pdf_version_id"]
        assert client.get(
            f"/api/miniprogram/resumes/{created['id']}/pdf",
            params={"version_id": version_id},
            headers=owner_headers,
        ).status_code == 200
        assert client.get(
            f"/api/miniprogram/resumes/{created['id']}/pdf",
            params={"version_id": version_id},
            headers=stranger_headers,
        ).status_code == 404
        assert client.get(
            f"/api/miniprogram/resumes/{created['id']}/preview.png",
            params={"version_id": version_id},
            headers=owner_headers,
        ).status_code == 200
        assert client.get(
            f"/api/miniprogram/resumes/{created['id']}/preview.png",
            params={"version_id": version_id},
            headers=stranger_headers,
        ).status_code == 404
