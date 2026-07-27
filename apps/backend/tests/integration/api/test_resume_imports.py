from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.application.resumes.service import create_resume_with_initial_version
from linkcv.core.config import Settings
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.rag import RagMarkdownResult, RagMetadata
from linkcv.domain.resume_extraction import DraftBasics, ResumeExtractionDraft
from linkcv.integrations.rag_client import RagServiceError
from linkcv.main import create_app
from linkcv.modules.resumes.models import Resume, ResumeVersion, StorageCleanupJob
from linkcv.services.storage_cleanup_service import process_storage_cleanup_jobs


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.fail_delete = False

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data

    def delete(self, object_name: str) -> None:
        if self.fail_delete:
            raise RuntimeError("storage unavailable")
        self.deleted.append(object_name)
        self.objects.pop(object_name, None)

    def delete_prefix(self, prefix: str) -> None:
        if self.fail_delete:
            raise RuntimeError("storage unavailable")
        for object_name in list(self.objects):
            if object_name.startswith(prefix):
                self.objects.pop(object_name)


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
    def __init__(self) -> None:
        self.calls = 0

    async def extract(self, section_ir):
        self.calls += 1
        assert section_ir.sections
        return ResumeExtractionDraft(
            basics=DraftBasics(name="张三", headline="后端工程师")
        )


class CapacityFillingStructuringClient(FakeStructuringClient):
    def __init__(self, session_factory, user_id: int) -> None:
        super().__init__()
        self._session_factory = session_factory
        self._user_id = user_id

    async def extract(self, section_ir):
        result = await super().extract(section_ir)
        with self._session_factory() as db:
            create_resume_with_initial_version(
                CreateResumeCommand(
                    user_id=self._user_id,
                    title="并发创建的第十份",
                    data=default_resume_document(),
                    source_type="blank",
                ),
                db,
            )
        return result


def build_app(
    *,
    rag_converter,
    structuring_client=None,
    max_file_bytes=10 * 1024 * 1024,
    max_structuring_bytes=128 * 1024,
    requests_per_minute=3,
):
    storage = FakeStorage()
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="resume-import-test-secret-with-32-bytes",
            resume_import_max_bytes=max_file_bytes,
            resume_structuring_max_bytes=max_structuring_bytes,
            resume_import_requests_per_minute=requests_per_minute,
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


def test_failed_import_cleanup_is_persisted_and_retried() -> None:
    app, storage = build_app(
        rag_converter=FailingRag(),
        structuring_client=FakeStructuringClient(),
    )
    storage.fail_delete = True

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
        with app.state.session_factory() as session:
            job = session.scalar(select(StorageCleanupJob))
            assert job is not None
            assert job.operation == "object"
            assert job.attempts == 0

        storage.fail_delete = False
        with app.state.session_factory() as session:
            assert process_storage_cleanup_jobs(session, storage) == 1
            assert session.scalar(select(StorageCleanupJob)) is None
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


def test_oversized_structuring_input_is_rejected_before_model_call() -> None:
    structuring_client = FakeStructuringClient()
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=structuring_client,
        max_structuring_bytes=16,
    )
    with TestClient(app) as client:
        register(client)
        response = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San\n\nPython", "text/markdown")},
        )

        assert response.status_code == 413
        assert response.json() == {"error": "STRUCTURING_INPUT_TOO_LARGE"}
        assert structuring_client.calls == 0
        assert storage.objects == {}


def test_import_frequency_limit_rejects_before_storage_and_model() -> None:
    structuring_client = FakeStructuringClient()
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=structuring_client,
        requests_per_minute=1,
    )
    with TestClient(app) as client:
        register(client)
        first = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
        )
        second = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
        )

        assert first.status_code == 201
        assert second.status_code == 429
        assert second.json() == {"error": "IMPORT_RATE_LIMITED"}
        assert structuring_client.calls == 1
        assert len(storage.objects) == 1


def test_import_at_resume_limit_is_rejected_and_uploaded_object_is_deleted() -> None:
    structuring_client = FakeStructuringClient()
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=structuring_client,
    )
    with TestClient(app) as client:
        register(client)
        for index in range(10):
            response = client.post("/api/resumes", json={"title": f"简历 {index + 1}"})
            assert response.status_code == 201

        rejected = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
        )

        assert rejected.status_code == 409
        assert rejected.json() == {"error": "RESUME_LIMIT_REACHED"}
        assert structuring_client.calls == 0
        assert storage.objects == {}
        assert storage.deleted == []
        with app.state.session_factory() as session:
            assert len(session.scalars(select(Resume)).all()) == 10


def test_import_race_at_resume_limit_is_rejected_and_uploaded_object_is_deleted() -> None:
    app, storage = build_app(
        rag_converter=FakeRag(),
        structuring_client=FakeStructuringClient(),
    )
    with TestClient(app) as client:
        register(client)
        for index in range(9):
            response = client.post("/api/resumes", json={"title": f"简历 {index + 1}"})
            assert response.status_code == 201

        with app.state.session_factory() as session:
            user_id = session.scalar(select(Resume.user_id).limit(1))
        assert user_id is not None
        structuring_client = CapacityFillingStructuringClient(
            app.state.session_factory,
            user_id,
        )
        app.state.structuring_client = structuring_client

        rejected = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
        )

        assert rejected.status_code == 409
        assert rejected.json() == {"error": "RESUME_LIMIT_REACHED"}
        assert structuring_client.calls == 1
        assert storage.objects == {}
        assert len(storage.deleted) == 1
        with app.state.session_factory() as session:
            assert len(session.scalars(select(Resume)).all()) == 10


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
