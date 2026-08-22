import asyncio

import pytest
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_extraction import (
    DraftBasics,
    DraftNamedItem,
    ResumeExtractionDraft,
)
from linkcv.domain.resume_style import default_resume_style
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeTemplate,
)
from linkcv.services.resume_import_service import ResumeImportService
from linkcv.workers.resume_import_worker import (
    ResumeImportProcessor,
    WorkerDependencyUnavailable,
    WorkerTaskRetryable,
)
from tests.fakes import FakeRedis


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_read = False
        self.fail_upload = False

    def ensure_bucket(self) -> None:
        pass

    def get(self, object_name: str) -> bytes:
        if self.fail_read:
            raise OSError("storage unavailable")
        return self.objects[object_name]

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        if self.fail_upload:
            raise OSError("storage unavailable")
        self.objects[object_name] = data


class FakeConverter:
    async def convert(self, *, filename: str, **_kwargs) -> DocumentMarkdownResult:
        return DocumentMarkdownResult(
            markdown="# 张三\n\n## 专业技能\nPython",
            source_file_name=filename,
            source_format="md",
            parser="fake",
            parser_version="1",
            warnings=[],
        )


class FailingConverter:
    async def convert(self, **_kwargs):
        raise DocumentConversionFailure(422, "IMPORT_CONTENT_INVALID")


class FakeStructuringClient:
    async def extract(self, **_kwargs) -> ResumeExtractionDraft:
        return ResumeExtractionDraft(basics=DraftBasics(name="张三"))


class InvalidFinalStructuringClient:
    async def extract(self, **_kwargs) -> ResumeExtractionDraft:
        return ResumeExtractionDraft(
            basics=DraftBasics(name="张三"),
            languages=[DraftNamedItem(name="技" * 101)],
        )


def build_processor(*, converter=None, structuring_client=None):
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="resume-import-worker-test-secret-with-32-bytes",
    )
    storage = FakeStorage()
    redis = FakeRedis()
    app = create_app(
        settings,
        storage=storage,
        redis=redis,
        document_converter=converter or FakeConverter(),
        structuring_client=structuring_client or FakeStructuringClient(),
        create_schema=True,
    )
    service = ResumeImportService(
        document_converter=converter or FakeConverter(),
        structuring_client=structuring_client or FakeStructuringClient(),
        max_structuring_bytes=settings.resume_structuring_max_bytes,
        structuring_timeout_seconds=settings.resume_structuring_timeout_seconds,
    )
    processor = ResumeImportProcessor(
        session_factory=app.state.session_factory,
        storage=storage,
        redis=redis,
        import_service=service,
        settings=settings,
    )
    with app.state.session_factory() as db:
        user = User(
            email="worker@example.invalid",
            password_hash="fictional-hash",
            nickname="张三",
        )
        template = ResumeTemplate(
            key="worker-template",
            name="Worker 模板",
            data_json=default_resume_document().model_dump(mode="json"),
            style_json=default_resume_style()
            .model_copy(update={"accent_color": "#315C6B"})
            .model_dump(mode="json"),
            is_active=1,
        )
        db.add_all([user, template])
        db.flush()
        record = DocumentParseTask(
            source_type=RESUME_IMPORT_SOURCE_TYPE,
            user_id=user.id,
            file_name="我的简历.md",
            file_format="md",
            object_name=f"users/{user.id}/resume-imports/task/resume.md",
            upload_status="succeeded",
            upload_duration_ms=5,
            parse_status="processing",
        )
        db.add(record)
        db.commit()
        storage.objects[record.object_name] = b"# Zhang San"
        return app, storage, processor, record.id, template.id


def test_worker_creates_one_resume_and_repeated_delivery_is_idempotent() -> None:
    app, storage, processor, import_id, template_id = build_processor()

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))
    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        resumes = db.scalars(select(Resume)).all()
        assert record is not None
        assert record.parse_status == "succeeded"
        assert record.converted_object_name == (
            f"users/{record.user_id}/resume-imports/task/converted.md"
        )
        assert storage.objects[record.converted_object_name].startswith(b"# ")
        assert len(resumes) == 1
        assert resumes[0].parse_task_id == record.id
        assert resumes[0].title == "我的简历"
        assert resumes[0].data_json["basics"]["name"] == "张三"
        assert resumes[0].style_json["accent_color"] == "#315C6B"


def test_worker_logs_safe_stage_chain(caplog) -> None:
    app, _storage, processor, import_id, template_id = build_processor()

    with caplog.at_level("INFO"):
        asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    messages = [record.message for record in caplog.records]
    assert messages[0] == "resume import task started"
    assert "resume import stage completed" in messages
    assert messages[-1] == "resume import task completed"
    stages = {
        record.stage
        for record in caplog.records
        if hasattr(record, "stage")
    }
    assert {
        "task_load",
        "source_read",
        "document_conversion",
        "resume_structuring",
        "resume_normalization",
        "resume_persistence",
    }.issubset(stages)
    assert "我的简历.md" not in caplog.text
    assert "Zhang San" not in caplog.text


def test_worker_logs_safe_normalization_failure_metadata(caplog) -> None:
    app, _storage, processor, import_id, template_id = build_processor(
        structuring_client=InvalidFinalStructuringClient()
    )

    with caplog.at_level("INFO"):
        asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    failure = next(
        record
        for record in caplog.records
        if record.message == "resume import task failed"
    )
    assert failure.error_code == "RESUME_STRUCTURE_INVALID"
    assert failure.failure_stage == "resume_normalization"
    assert failure.exception_type == "ValidationError"
    assert failure.validation_model == "Language"
    assert failure.validation_paths == "name"
    assert failure.validation_types == "string_too_long"
    assert "技" * 101 not in caplog.text
    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "failed"
        assert record.failure_reason == "internal_error"


def test_converted_markdown_storage_failure_does_not_fail_import(caplog) -> None:
    app, storage, processor, import_id, template_id = build_processor()
    storage.fail_upload = True

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        resume = db.scalar(select(Resume))
        assert record is not None
        assert record.converted_object_name is None
        assert record.parse_status == "succeeded"
        assert resume is not None
        assert resume.parse_task_id == record.id
    assert "converted markdown persistence failed" in caplog.text


def test_business_parse_failure_creates_no_resume_and_marks_failed() -> None:
    app, _storage, processor, import_id, template_id = build_processor(
        converter=FailingConverter()
    )

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "failed"
        assert record.failure_reason == "content_invalid"
        assert record.converted_object_name is None
        assert db.scalar(select(Resume.id)) is None


def test_storage_outage_keeps_task_processing_for_broker_redelivery() -> None:
    app, storage, processor, import_id, template_id = build_processor()
    storage.fail_read = True

    with pytest.raises(WorkerTaskRetryable):
        asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "processing"
        assert db.scalar(select(Resume.id)) is None


def test_existing_worker_lock_keeps_message_pending_for_redelivery() -> None:
    app, _storage, processor, import_id, template_id = build_processor()
    app.state.redis.set(
        processor._lock_key(import_id),
        "another-worker",
        nx=True,
        ex=240,
    )

    with pytest.raises(WorkerDependencyUnavailable, match="already held"):
        asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "processing"
        assert db.scalar(select(Resume.id)) is None
