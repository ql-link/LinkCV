from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_extraction import DraftBasics, ResumeExtractionDraft
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.resumes.models import Resume, ResumeTemplate, ResumeVersion
from tests.fakes import FakeRedis


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.fail_upload = False

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data
        if self.fail_upload:
            raise RuntimeError("storage unavailable")

    def delete(self, object_name: str) -> None:
        self.deleted.append(object_name)
        self.objects.pop(object_name, None)

    def delete_prefix(self, prefix: str) -> None:
        for object_name in list(self.objects):
            if object_name.startswith(prefix):
                self.objects.pop(object_name)


class FakeDocumentConverter:
    def __init__(self) -> None:
        self.calls = 0

    async def convert(self, *, filename: str, **_kwargs) -> DocumentMarkdownResult:
        self.calls += 1
        return DocumentMarkdownResult(
            markdown="# 张三\n\n## 专业技能\nPython",
            source_file_name=filename,
            source_format=filename.rsplit(".", 1)[-1],
            parser="fake",
            parser_version="1",
            warnings=[],
        )


class FailingDocumentConverter:
    async def convert(self, **_kwargs):
        raise DocumentConversionFailure(502, "DOCUMENT_CONVERSION_FAILED")


class FakeStructuringClient:
    async def extract(self, **_kwargs):
        return ResumeExtractionDraft(
            basics=DraftBasics(name="张三", headline="后端工程师")
        )


def build_app(*, document_converter=None):
    storage = FakeStorage()
    converter = document_converter or FakeDocumentConverter()
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="resume-import-test-secret-with-32-bytes",
            resume_import_requests_per_minute=60,
        ),
        storage=storage,
        redis=FakeRedis(),
        document_converter=converter,
        structuring_client=FakeStructuringClient(),
        create_schema=True,
    )
    with app.state.session_factory() as db:
        style = default_resume_style().model_copy(
            update={"template_key": "modern-two-column-cn", "accent_color": "#315C6B"}
        )
        template = ResumeTemplate(
            key="modern-two-column-cn",
            name="现代双栏",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=style.model_dump(mode="json"),
            is_active=1,
        )
        db.add(template)
        db.commit()
        app.state.test_template_id = str(template.id)
    return app, storage, converter


def register(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": "importer@example.invalid", "password": "password-123"},
    )
    assert response.status_code == 201


def import_file(
    client: TestClient,
    app,
    *,
    key: str | None = None,
    template_id: str | None = None,
    filename: str = "resume.md",
    content: bytes = b"# Zhang San",
    content_type: str = "text/markdown",
):
    return client.post(
        "/api/resumes/import",
        files={"file": (filename, content, content_type)},
        data={
            "template_id": (
                app.state.test_template_id if template_id is None else template_id
            )
        },
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def test_sync_import_immediately_creates_resume_with_selected_template_style() -> None:
    app, storage, converter = build_app()
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 201
    body = response.json()
    assert body["resume"]["source_type"] == "import"
    assert body["resume"]["template_id"] == app.state.test_template_id
    assert body["resume"]["data"]["basics"]["name"] == "张三"
    assert body["resume"]["style"]["template_key"] == "modern-two-column-cn"
    assert body["resume"]["style"]["accent_color"] == "#315C6B"
    assert body["import"]["source_file_name"] == "resume.md"
    assert body["import"]["source_file_format"] == "md"
    assert converter.calls == 1
    assert len(storage.objects) == 1

    with app.state.session_factory() as db:
        resume = db.get(Resume, int(body["resume"]["id"]))
        assert resume is not None
        assert resume.source_filename == "resume.md"
        assert resume.source_object_key in storage.objects
        assert resume.extracted_markdown.startswith("# 张三")
        versions = db.scalars(
            select(ResumeVersion).where(ResumeVersion.resume_id == resume.id)
        ).all()
        assert len(versions) == 1


@pytest.mark.parametrize(
    "template_id",
    ["0", "+1", "01", " 1", "1 ", "1.0", "18446744073709551616"],
)
def test_import_rejects_noncanonical_template_ids_without_side_effects(
    template_id: str,
) -> None:
    app, storage, converter = build_app()
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app, template_id=template_id)

    assert response.status_code == 422
    assert response.json() == {"error": "TEMPLATE_INACTIVE"}
    assert storage.objects == {}
    assert converter.calls == 0


def test_import_rejects_template_disabled_before_submission() -> None:
    app, storage, converter = build_app()
    with TestClient(app) as client:
        register(client)
        with app.state.session_factory() as db:
            template = db.get(ResumeTemplate, int(app.state.test_template_id))
            assert template is not None
            template.is_active = 0
            db.commit()
        response = import_file(client, app)

    assert response.status_code == 422
    assert response.json() == {"error": "TEMPLATE_INACTIVE"}
    assert storage.objects == {}
    assert converter.calls == 0


def test_import_requires_canonical_idempotency_key_without_side_effects() -> None:
    app, storage, converter = build_app()
    with TestClient(app) as client:
        register(client)
        missing = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
            data={"template_id": app.state.test_template_id},
        )
        uppercase = import_file(client, app, key=str(uuid4()).upper())

    assert missing.status_code == uppercase.status_code == 400
    assert missing.json() == uppercase.json() == {"error": "INVALID_IDEMPOTENCY_KEY"}
    assert storage.objects == {}
    assert converter.calls == 0


def test_same_key_replays_formal_resume_and_changed_template_conflicts() -> None:
    app, storage, converter = build_app()
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        first = import_file(client, app, key=key)
        replay = import_file(client, app, key=key)

        with app.state.session_factory() as db:
            second = ResumeTemplate(
                key="classic-cn",
                name="经典单栏",
                data_json=default_resume_document().model_dump(mode="json"),
                style_json=default_resume_style().model_dump(mode="json"),
                is_active=1,
            )
            db.add(second)
            db.commit()
            second_id = str(second.id)
        conflict = import_file(client, app, key=key, template_id=second_id)

    assert first.status_code == replay.status_code == 201
    assert first.json()["resume"]["id"] == replay.json()["resume"]["id"]
    assert conflict.status_code == 409
    assert conflict.json() == {"error": "IDEMPOTENCY_KEY_REUSED"}
    assert converter.calls == 1
    assert len(storage.objects) == 1
    with app.state.session_factory() as db:
        assert len(db.scalars(select(Resume)).all()) == 1


def test_sync_import_failure_cleans_source_and_creates_no_resume() -> None:
    app, storage, _converter = build_app(
        document_converter=FailingDocumentConverter()
    )
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 502
    assert response.json() == {"error": "DOCUMENT_CONVERSION_FAILED"}
    assert storage.objects == {}
    assert len(storage.deleted) == 1
    with app.state.session_factory() as db:
        assert db.scalar(select(Resume.id)) is None


def test_unauthenticated_import_is_rejected() -> None:
    app, storage, converter = build_app()
    with TestClient(app) as client:
        response = import_file(client, app)

    assert response.status_code == 401
    assert storage.objects == {}
    assert converter.calls == 0
