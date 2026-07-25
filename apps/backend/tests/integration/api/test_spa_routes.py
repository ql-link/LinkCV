from fastapi.testclient import TestClient

from linkcv.core.config import Settings
from linkcv.main import create_app


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


def test_spa_deep_links_fall_back_to_index_without_masking_api_404(tmp_path) -> None:
    (tmp_path / "index.html").write_text("<main>LinkCV</main>", encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log('LinkCV')", encoding="utf-8")
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
        web_dist_dir=tmp_path,
    )
    app = create_app(settings, storage=FakeStorage())

    with TestClient(app) as client:
        assert client.get("/resumes/resume_123/edit").text == "<main>LinkCV</main>"
        assert client.get("/assets/app.js").text == "console.log('LinkCV')"
        api_response = client.get("/api/not-found")
        assert api_response.status_code == 404
        assert api_response.headers["content-type"].startswith("application/json")
