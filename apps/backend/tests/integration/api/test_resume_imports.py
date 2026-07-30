import json
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.application.resumes.service import create_resume_with_initial_version
from linkcv.core.config import Settings
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_extraction import DraftBasics, ResumeExtractionDraft
from linkcv.main import create_app
from linkcv.modules.resumes.models import Resume, ResumeVersion, StorageCleanupJob
from linkcv.services.resume_import_idempotency import import_fingerprint
from linkcv.services.storage_cleanup_service import process_storage_cleanup_jobs
from tests.fakes import FakeRedis


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.fail_upload = False
        self.fail_delete = False

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data
        if self.fail_upload:
            raise RuntimeError("storage unavailable")

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


class FakeDocumentConverter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def convert(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
    ) -> DocumentMarkdownResult:
        del content_type, content, operation_id, deadline_monotonic
        extension = filename.rsplit(".", 1)[-1]
        self.calls.append(extension)
        return DocumentMarkdownResult(
            markdown="# 张三\n\n## 专业技能\nPython",
            source_file_name=filename,
            source_format=extension,
            parser="fake",
            parser_version="1",
            warnings=(
                ["docx_embedded_images_omitted"] if extension == "docx" else []
            ),
        )


class FailingDocumentConverter:
    async def convert(self, **_kwargs):
        raise DocumentConversionFailure(502, "DOCUMENT_CONVERSION_FAILED")


class FakeStructuringClient:
    def __init__(self) -> None:
        self.calls = 0

    async def extract(self, *, user_id, section_ir, timeout_seconds):
        del user_id, timeout_seconds
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

    async def extract(self, *, user_id, section_ir, timeout_seconds):
        result = await super().extract(
            user_id=user_id,
            section_ir=section_ir,
            timeout_seconds=timeout_seconds,
        )
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


class ImportFailingRedis(FakeRedis):
    def resume_import_acquire(self, *_args):
        raise OSError("redis unavailable")


class LeaseLosingRedis(FakeRedis):
    def resume_import_renew(self, *_args):
        return 0


def build_app(
    *,
    document_converter=None,
    structuring_client=None,
    redis=None,
    max_file_bytes=10 * 1024 * 1024,
    max_structuring_bytes=128 * 1024,
    requests_per_minute=3,
):
    storage = FakeStorage()
    runtime_redis = redis or FakeRedis()
    converter = document_converter or FakeDocumentConverter()
    app = create_app(
        Settings(
            database_url="sqlite+pysqlite:///:memory:",
            jwt_secret="resume-import-test-secret-with-32-bytes",
            resume_import_max_bytes=max_file_bytes,
            resume_structuring_max_bytes=max_structuring_bytes,
            resume_import_requests_per_minute=requests_per_minute,
        ),
        storage=storage,
        redis=runtime_redis,
        document_converter=converter,
        structuring_client=structuring_client,
        create_schema=True,
    )
    return app, storage, runtime_redis, converter


def register(client: TestClient, email: str = "importer@example.com") -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def import_file(
    client: TestClient,
    *,
    filename: str,
    content: bytes,
    content_type: str,
    key: str | None = None,
    title: str | None = None,
):
    data = {"title": title} if title is not None else None
    return client.post(
        "/api/resumes/import",
        files={"file": (filename, content, content_type)},
        data=data,
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def docx_bytes() -> bytes:
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", "<document />")
    return output.getvalue()


def test_markdown_import_creates_resume_and_initial_version() -> None:
    converter = FakeDocumentConverter()
    app, storage, _redis, _ = build_app(
        document_converter=converter,
        structuring_client=FakeStructuringClient(),
    )
    markdown = "# 张三\n\n## 专业技能\nPython"

    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.md",
            content=markdown.encode(),
            content_type="text/markdown",
            title="导入简历",
        )

        assert response.status_code == 201
        body = response.json()
        assert body["resume"]["source_type"] == "import"
        assert body["resume"]["data"]["basics"]["name"] == "张三"
        assert body["import"]["source_file_format"] == "md"
        assert converter.calls == ["md"]
        assert len(storage.objects) == 1
        with app.state.session_factory() as session:
            resume = session.scalar(select(Resume))
            versions = session.scalars(select(ResumeVersion)).all()
            assert resume is not None
            assert resume.extracted_markdown == markdown
            assert len(versions) == 1


@pytest.mark.parametrize(
    ("filename", "content", "content_type", "warning"),
    [
        (
            "resume.docx",
            docx_bytes(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "docx_embedded_images_omitted",
        ),
        ("resume.pdf", b"%PDF-1.7 fixture", "application/pdf", None),
    ],
)
def test_docx_and_pdf_use_document_converter(
    filename: str,
    content: bytes,
    content_type: str,
    warning: str | None,
) -> None:
    converter = FakeDocumentConverter()
    app, _storage, _redis, _ = build_app(
        document_converter=converter,
        structuring_client=FakeStructuringClient(),
    )
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename=filename,
            content=content,
            content_type=content_type,
        )
    assert response.status_code == 201
    assert converter.calls == [filename.rsplit(".", 1)[-1]]
    if warning:
        assert warning in response.json()["import"]["warnings"]


def test_conversion_failure_compensates_storage() -> None:
    app, storage, _redis, _ = build_app(
        document_converter=FailingDocumentConverter(),
        structuring_client=FakeStructuringClient(),
    )
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.pdf",
            content=b"%PDF-1.7 fixture",
            content_type="application/pdf",
        )
    assert response.status_code == 502
    assert response.json() == {"error": "DOCUMENT_CONVERSION_FAILED"}
    assert storage.objects == {}
    assert len(storage.deleted) == 1


def test_storage_failure_stops_downstream_and_compensates_partial_write() -> None:
    structuring = FakeStructuringClient()
    app, storage, _redis, converter = build_app(structuring_client=structuring)
    storage.fail_upload = True
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert response.status_code == 502
    assert response.json() == {"error": "IMPORT_STORAGE_FAILED"}
    assert storage.objects == {}
    assert converter.calls == []
    assert structuring.calls == 0


def test_missing_structuring_model_is_explicit_and_compensated() -> None:
    app, storage, _redis, _ = build_app(structuring_client=None)
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert response.status_code == 503
    assert response.json() == {"error": "STRUCTURING_MODEL_UNAVAILABLE"}
    assert storage.objects == {}


def test_failed_cleanup_is_persisted_and_retried() -> None:
    app, storage, _redis, _ = build_app(
        document_converter=FailingDocumentConverter(),
        structuring_client=FakeStructuringClient(),
    )
    storage.fail_delete = True
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.pdf",
            content=b"%PDF-1.7 fixture",
            content_type="application/pdf",
        )
        assert response.status_code == 502
        with app.state.session_factory() as session:
            assert session.scalar(select(StorageCleanupJob)) is not None
        storage.fail_delete = False
        with app.state.session_factory() as session:
            assert process_storage_cleanup_jobs(session, storage) == 1
    assert storage.objects == {}


@pytest.mark.parametrize(
    ("filename", "content", "content_type", "status", "code"),
    [
        ("resume.md", b"", "text/markdown", 400, "EMPTY_IMPORT_FILE"),
        ("resume.txt", b"plain", "text/plain", 415, "UNSUPPORTED_IMPORT_FORMAT"),
        ("resume.pdf", b"not-a-pdf", "application/pdf", 415, "UNSUPPORTED_IMPORT_FORMAT"),
        ("resume.pdf", b"%PDF-1.7", "text/plain", 415, "UNSUPPORTED_IMPORT_FORMAT"),
        (
            "resume.docx",
            bytes.fromhex("D0CF11E0A1B11AE1")
            + "EncryptedPackage".encode("utf-16le")
            + "EncryptionInfo".encode("utf-16le"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            422,
            "IMPORT_CONTENT_INVALID",
        ),
    ],
)
def test_invalid_files_have_no_side_effects(
    filename: str,
    content: bytes,
    content_type: str,
    status: int,
    code: str,
) -> None:
    structuring = FakeStructuringClient()
    app, storage, redis, converter = build_app(structuring_client=structuring)
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename=filename,
            content=content,
            content_type=content_type,
        )
    assert response.status_code == status
    assert response.json() == {"error": code}
    assert storage.objects == {}
    assert converter.calls == []
    assert structuring.calls == 0
    assert not any(key.startswith("resume-import:") for key in redis.strings)


def test_missing_or_noncanonical_idempotency_key_is_rejected() -> None:
    app, storage, _redis, converter = build_app(
        structuring_client=FakeStructuringClient()
    )
    with TestClient(app) as client:
        register(client)
        missing = client.post(
            "/api/resumes/import",
            files={"file": ("resume.md", b"# Zhang San", "text/markdown")},
        )
        uppercase = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
            key=str(uuid4()).upper(),
        )
    assert missing.status_code == 400
    assert uppercase.status_code == 400
    assert missing.json() == {"error": "INVALID_IDEMPOTENCY_KEY"}
    assert storage.objects == {}
    assert converter.calls == []


def test_oversized_inputs_stop_before_downstream_calls() -> None:
    structuring = FakeStructuringClient()
    app, storage, _redis, converter = build_app(
        structuring_client=structuring,
        max_file_bytes=8,
    )
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.md",
            content=b"# too large",
            content_type="text/markdown",
        )
    assert response.status_code == 413
    assert storage.objects == {}
    assert converter.calls == []
    assert structuring.calls == 0


def test_structuring_input_limit_compensates_before_model() -> None:
    structuring = FakeStructuringClient()
    app, storage, _redis, _ = build_app(
        structuring_client=structuring,
        max_structuring_bytes=16,
    )
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert response.status_code == 413
    assert response.json() == {"error": "STRUCTURING_INPUT_TOO_LARGE"}
    assert structuring.calls == 0
    assert storage.objects == {}


def test_frequency_limit_uses_distinct_idempotency_keys() -> None:
    structuring = FakeStructuringClient()
    app, storage, _redis, _ = build_app(
        structuring_client=structuring,
        requests_per_minute=1,
    )
    with TestClient(app) as client:
        register(client)
        first = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
        second = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert first.status_code == 201
    assert second.status_code == 429
    assert structuring.calls == 1
    assert len(storage.objects) == 1


def test_resume_limit_rejects_before_storage_and_model() -> None:
    structuring = FakeStructuringClient()
    app, storage, _redis, _ = build_app(structuring_client=structuring)
    with TestClient(app) as client:
        register(client)
        for index in range(10):
            assert client.post(
                "/api/resumes", json={"title": f"简历 {index + 1}"}
            ).status_code == 201
        rejected = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert rejected.status_code == 409
    assert rejected.json() == {"error": "RESUME_LIMIT_REACHED"}
    assert structuring.calls == 0
    assert storage.objects == {}


def test_resume_limit_race_compensates_uploaded_object() -> None:
    app, storage, _redis, _ = build_app(structuring_client=FakeStructuringClient())
    with TestClient(app) as client:
        register(client)
        for index in range(9):
            assert client.post(
                "/api/resumes", json={"title": f"简历 {index + 1}"}
            ).status_code == 201
        with app.state.session_factory() as session:
            user_id = session.scalar(select(Resume.user_id).limit(1))
        structuring = CapacityFillingStructuringClient(
            app.state.session_factory,
            user_id,
        )
        app.state.structuring_client = structuring
        rejected = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert rejected.status_code == 409
    assert storage.objects == {}
    assert len(storage.deleted) == 1


def test_database_create_failure_rolls_back_and_compensates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_create(*_args, **_kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        "linkcv.services.resume_import_service.create_resume_with_initial_version",
        fail_create,
    )
    app, storage, _redis, _ = build_app(
        structuring_client=FakeStructuringClient()
    )
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert response.status_code == 500
    assert response.json() == {"error": "IMPORT_CREATE_FAILED"}
    assert storage.objects == {}
    with app.state.session_factory() as session:
        assert session.scalar(select(Resume)) is None
        assert session.scalar(select(ResumeVersion)) is None


def test_successful_replay_returns_same_resume_without_downstream_calls() -> None:
    structuring = FakeStructuringClient()
    converter = FakeDocumentConverter()
    app, storage, _redis, _ = build_app(
        document_converter=converter,
        structuring_client=structuring,
    )
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        first = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
            key=key,
        )
        replay = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
            key=key,
        )
    assert first.status_code == replay.status_code == 201
    assert first.json()["resume"]["id"] == replay.json()["resume"]["id"]
    assert converter.calls == ["md"]
    assert structuring.calls == 1
    assert len(storage.objects) == 1


def test_idempotency_key_reuse_with_different_content_is_rejected() -> None:
    structuring = FakeStructuringClient()
    app, storage, _redis, converter = build_app(structuring_client=structuring)
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        assert import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
            key=key,
        ).status_code == 201
        conflict = import_file(
            client,
            filename="resume.md",
            content=b"# Li Si",
            content_type="text/markdown",
            key=key,
        )
    assert conflict.status_code == 409
    assert conflict.json() == {"error": "IDEMPOTENCY_KEY_REUSED"}
    assert converter.calls == ["md"]
    assert structuring.calls == 1
    assert len(storage.objects) == 1


def test_new_key_creates_a_new_resume_and_same_key_isolated_between_users() -> None:
    structuring = FakeStructuringClient()
    app, storage, _redis, converter = build_app(structuring_client=structuring)
    shared_key = str(uuid4())
    content = b"# Zhang San"
    with TestClient(app) as client:
        register(client)
        first = import_file(
            client,
            filename="resume.md",
            content=content,
            content_type="text/markdown",
            key=shared_key,
        )
        repeated_intent = import_file(
            client,
            filename="resume.md",
            content=content,
            content_type="text/markdown",
            key=str(uuid4()),
        )
        assert client.post("/api/auth/logout").status_code == 200
        register(client, "second-importer@example.com")
        second_user = import_file(
            client,
            filename="resume.md",
            content=content,
            content_type="text/markdown",
            key=shared_key,
        )

    resume_ids = {
        first.json()["resume"]["id"],
        repeated_intent.json()["resume"]["id"],
        second_user.json()["resume"]["id"],
    }
    assert (
        first.status_code
        == repeated_intent.status_code
        == second_user.status_code
        == 201
    )
    assert len(resume_ids) == 3
    assert converter.calls == ["md", "md", "md"]
    assert structuring.calls == 3
    assert len(storage.objects) == 3


def test_processing_replay_and_redis_failure_are_fail_closed() -> None:
    redis = FakeRedis()
    app, storage, _runtime_redis, converter = build_app(
        redis=redis,
        structuring_client=FakeStructuringClient(),
    )
    key = str(uuid4())
    content = b"# Zhang San"
    fingerprint = import_fingerprint(
        filename="resume.md",
        source_format="md",
        content_type="text/markdown",
        title=None,
        content=content,
    )
    redis.resume_import_acquire(
        app.state.import_idempotency.redis_key(1, key),
        fingerprint,
        "original-owner",
        180_000,
    )
    with TestClient(app) as client:
        register(client)
        processing = import_file(
            client,
            filename="resume.md",
            content=content,
            content_type="text/markdown",
            key=key,
        )
    assert processing.status_code == 409
    assert processing.json() == {"error": "IMPORT_ALREADY_PROCESSING"}
    assert storage.objects == {}
    assert converter.calls == []

    failing_app, failing_storage, _redis, failing_converter = build_app(
        redis=ImportFailingRedis(),
        structuring_client=FakeStructuringClient(),
    )
    with TestClient(failing_app) as client:
        register(client, "redis-failure@example.com")
        unavailable = import_file(
            client,
            filename="resume.md",
            content=content,
            content_type="text/markdown",
        )
    assert unavailable.status_code == 503
    assert unavailable.json() == {"error": "IMPORT_IDEMPOTENCY_UNAVAILABLE"}
    assert failing_storage.objects == {}
    assert failing_converter.calls == []


def test_lost_lease_before_create_is_fail_closed_and_compensated() -> None:
    app, storage, _redis, _ = build_app(
        redis=LeaseLosingRedis(),
        structuring_client=FakeStructuringClient(),
    )
    with TestClient(app) as client:
        register(client)
        response = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert response.status_code == 503
    assert response.json() == {"error": "IMPORT_IDEMPOTENCY_UNAVAILABLE"}
    assert storage.objects == {}
    with app.state.session_factory() as session:
        assert session.scalar(select(Resume)) is None


def test_import_requires_authentication() -> None:
    app, storage, _redis, converter = build_app(
        structuring_client=FakeStructuringClient()
    )
    with TestClient(app) as client:
        response = import_file(
            client,
            filename="resume.md",
            content=b"# Zhang San",
            content_type="text/markdown",
        )
    assert response.status_code == 401
    assert response.json() == {"error": "UNAUTHORIZED"}
    assert storage.objects == {}
    assert converter.calls == []
