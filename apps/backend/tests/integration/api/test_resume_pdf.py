from fastapi.testclient import TestClient

from linkcv.core.config import Settings
from linkcv.main import create_app
from linkcv.modules.resumes.models import ResumeTemplate
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import canonical_template_payload


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


class FakeRenderer:
    def __init__(self) -> None:
        self.payloads: list[dict] = []

    def render(self, payload: dict) -> bytes:
        self.payloads.append(payload)
        return b"%PDF-1.3\nfixture"


def build_app():
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="web-pdf-test-secret-with-32-bytes",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        create_schema=True,
    )
    app.state.resume_pdf_renderer = FakeRenderer()
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


def test_web_pdf_requires_current_lock_version_and_owned_resume() -> None:
    app = build_app()
    with TestClient(app) as owner:
        assert owner.post(
            "/api/auth/register",
            json={"email": "pdf-owner@example.test", "password": "password-123"},
        ).status_code == 201
        created = owner.post(
            "/api/resumes",
            json={"title": "我的中文简历", "template_id": app.state.test_template_id},
        ).json()["resume"]

        response = owner.get(
            f"/api/resumes/{created['id']}/pdf",
            params={"lock_version": created["lock_version"]},
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["cache-control"] == "private, no-store"
        assert response.headers["x-linkcv-pdf-lock-version"] == str(
            created["lock_version"]
        )
        assert response.headers["content-disposition"].startswith(
            'attachment; filename="resume.pdf"; filename*=UTF-8\'\''
        )
        assert "%E6%88%91%E7%9A%84%E4%B8%AD%E6%96%87%E7%AE%80%E5%8E%86.pdf" in (
            response.headers["content-disposition"]
        )
        assert app.state.resume_pdf_renderer.payloads[-1]["protocol_version"] == 1

        stale = owner.get(
            f"/api/resumes/{created['id']}/pdf",
            params={"lock_version": created["lock_version"] + 1},
        )
        assert stale.status_code == 409
        assert stale.json() == {"error": "RESUME_PDF_SNAPSHOT_STALE"}
        assert len(app.state.resume_pdf_renderer.payloads) == 1

    with TestClient(app) as stranger:
        assert stranger.post(
            "/api/auth/register",
            json={
                "email": "pdf-stranger@example.test",
                "password": "password-123",
            },
        ).status_code == 201
        denied = stranger.get(
            f"/api/resumes/{created['id']}/pdf",
            params={"lock_version": created["lock_version"]},
        )
        assert denied.status_code == 404
        assert denied.json() == {"error": "RESUME_NOT_FOUND"}
