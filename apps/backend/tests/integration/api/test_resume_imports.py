from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.rag import RagMarkdownResult, RagMetadata
from linkcv.domain.resume_extraction import DraftBasics, ResumeExtractionDraft
from linkcv.integrations.rag_client import RagServiceError
from linkcv.main import create_app
from linkcv.modules.resumes.models import Resume, ResumeVersion


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data

    def delete(self, object_name: str) -> None:
        self.deleted.append(object_name)
        self.objects.pop(object_name, None)


class FakeRag:
    def __init__(self) -> None:
        self.calls = 0

    async def convert(self, *, filename: str, content_type: str, content: bytes):
        del content_type, content
        self.calls += 1
        return RagMarkdownResult(
            markdown="# 张三\n\n## 专业技能\nPython",
            metadata=RagMetadata(
                source_file_name=filename,
                source_format=filename.rsplit(".", 1)[-1],
                converter_version="fake-rag/1",
            ),
            warnings=["fixture_warning"],
        )


class FailingRag:
    async def convert(self, *, filename: str, content_type: str, content: bytes):
        del filename, content_type, content
        raise RagServiceError("failed")


class FakeStructuringClient:
    async def extract(self, section_ir):
        assert section_ir.sections
        return ResumeExtractionDraft(
            basics=DraftBasics(name="张三", headline="后端工程师")
        )


def build_app(*, rag_converter, structuring_client=None, max_file_bytes=10 * 1024 * 1024):
    storage = FakeStorage()
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="resume-import-test-secret-with-32-bytes",
            resume_import_max_bytes=max_file_bytes,
        ),
        storage=storage,
        rag_converter=rag_converter,
        structuring_client=structuring_client,
        create_schema=True,
    )
    return app, storage


def register(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": "importer@example.com", "password": "password-123"},
    )
    assert response.status_code == 201


def docx_bytes() -> bytes:
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", "<document />")
    return output.getvalue()


def test_markdown_import_bypasses_rag_and_creates_initial_version() -> None:
    rag = FakeRag()
    app, storage = build_app(
        rag_converter=rag,
        structuring_client=FakeStructuringClient(),
    )
    markdown = "# 张三\n\n## 专业技能\nPython"

    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", markdown.encode(), "text/markdown")},
            data={"title": "导入简历"},
        )

        assert response.status_code == 201
        body = response.json()
        assert body["resume"]["source_type"] == "import"
        assert body["resume"]["data"]["basics"]["name"] == "张三"
        assert body["import"]["source_file_format"] == "md"
        assert rag.calls == 0
        assert len(storage.objects) == 1

        with app.state.session_factory() as session:
            resume = session.scalar(select(Resume))
            versions = session.scalars(select(ResumeVersion)).all()
            assert resume is not None
            assert resume.extracted_markdown == markdown
            assert len(versions) == 1
            assert versions[0].reason == "initial"


def test_docx_import_uses_rag_adapter() -> None:
    rag = FakeRag()
    app, _storage = build_app(
        rag_converter=rag,
        structuring_client=FakeStructuringClient(),
    )
    content = docx_bytes()

    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={
                "file": (
                    "resume.docx",
                    content,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )

        assert response.status_code == 201
        assert response.json()["import"]["warnings"] == ["fixture_warning"]
        assert rag.calls == 1


def test_text_pdf_import_uses_rag_adapter() -> None:
    rag = FakeRag()
    app, _storage = build_app(
        rag_converter=rag,
        structuring_client=FakeStructuringClient(),
    )

    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={"file": ("resume.pdf", b"%PDF-1.7 fixture", "application/pdf")},
        )

        assert response.status_code == 201
        assert response.json()["import"]["source_file_format"] == "pdf"
        assert rag.calls == 1


def test_rag_failure_deletes_uploaded_object_without_database_rows() -> None:
    app, storage = build_app(
        rag_converter=FailingRag(),
        structuring_client=FakeStructuringClient(),
    )

    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={
                "file": (
                    "resume.docx",
                    docx_bytes(),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )

        assert response.status_code == 502
        assert response.json() == {"error": "RAG_SERVICE_FAILED"}
        assert storage.objects == {}
        assert len(storage.deleted) == 1
        with app.state.session_factory() as session:
            assert session.scalar(select(Resume)) is None


def test_missing_structuring_model_is_explicit_and_compensated() -> None:
    app, storage = build_app(rag_converter=FakeRag())

    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
        )

        assert response.status_code == 503
        assert response.json() == {"error": "STRUCTURING_MODEL_UNAVAILABLE"}
        assert storage.objects == {}


def test_invalid_file_is_rejected_before_storage() -> None:
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=FakeStructuringClient(),
    )

    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={"file": ("resume.pdf", b"not-a-pdf", "application/pdf")},
        )

        assert response.status_code == 415
        assert response.json() == {"error": "UNSUPPORTED_IMPORT_FORMAT"}
        assert storage.objects == {}


@pytest.mark.parametrize(
    ("filename", "content", "content_type", "status", "code"),
    [
        ("resume.md", b"", "text/markdown", 400, "EMPTY_IMPORT_FILE"),
        ("resume.txt", b"plain", "text/plain", 415, "UNSUPPORTED_IMPORT_FORMAT"),
        ("resume.pdf", b"%PDF-1.7", "text/plain", 415, "UNSUPPORTED_IMPORT_FORMAT"),
    ],
)
def test_invalid_import_boundaries_do_not_reach_storage(
    filename: str,
    content: bytes,
    content_type: str,
    status: int,
    code: str,
) -> None:
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=FakeStructuringClient(),
    )
    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={"file": (filename, content, content_type)},
        )

        assert response.status_code == status
        assert response.json() == {"error": code}
        assert storage.objects == {}


def test_oversized_import_is_rejected_before_storage() -> None:
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=FakeStructuringClient(),
        max_file_bytes=8,
    )
    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# too large", "text/markdown")},
        )

        assert response.status_code == 413
        assert response.json() == {"error": "IMPORT_FILE_TOO_LARGE"}
        assert storage.objects == {}


def test_import_requires_authentication() -> None:
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=FakeStructuringClient(),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
        )

        assert response.status_code == 401
        assert response.json() == {"error": "UNAUTHORIZED"}
        assert storage.objects == {}
