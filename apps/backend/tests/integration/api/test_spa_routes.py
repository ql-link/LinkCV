from fastapi.testclient import TestClient

from linkcv.core.config import Settings
from linkcv.main import create_app
from tests.fakes import FakeRedis


class FakeStorage:
    def ensure_bucket(self) -> None:
        pass


def test_spa_deep_links_fall_back_to_index_without_masking_api_404(tmp_path) -> None:
    (tmp_path / "index.html").write_text("<main>LinkCV</main>", encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log('LinkCV')", encoding="utf-8")
    (assets / "large.js").write_text("const value = 'LinkCV';\n" * 100, encoding="utf-8")
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
        web_dist_dir=tmp_path,
    )
    app = create_app(settings, storage=FakeStorage(), redis=FakeRedis())

    with TestClient(app) as client:
        assert client.get("/resumes/resume_123/edit").text == "<main>LinkCV</main>"
        assert client.get("/jobs/job_123/edit").text == "<main>LinkCV</main>"
        deep_link_response = client.get("/resumes/resume_123/edit")
        assert deep_link_response.headers["cache-control"] == "no-cache"

        asset_response = client.get("/assets/app.js")
        assert asset_response.text == "console.log('LinkCV')"
        assert asset_response.headers["cache-control"] == "public, max-age=31536000, immutable"

        compressed_response = client.get(
            "/assets/large.js",
            headers={"Accept-Encoding": "gzip"},
        )
        assert compressed_response.headers["content-encoding"] == "gzip"
        assert compressed_response.headers["vary"] == "Accept-Encoding"
        assert compressed_response.text == "const value = 'LinkCV';\n" * 100

        assert client.get("/assets/missing.js").status_code == 404

        api_response = client.get("/api/not-found")
        assert api_response.status_code == 404
        assert api_response.headers["content-type"].startswith("application/json")
