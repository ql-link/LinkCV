import asyncio

import pytest
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
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import Resume, ResumeImport, ResumeTemplate
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

    def ensure_bucket(self) -> None:
        pass

    def get(self, object_name: str) -> bytes:
        if self.fail_read:
            raise OSError("storage unavailable")
        return self.objects[object_name]


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


def build_processor(*, converter=None):
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
        structuring_client=FakeStructuringClient(),
        create_schema=True,
    )
    service = ResumeImportService(
        document_converter=converter or FakeConverter(),
        structuring_client=FakeStructuringClient(),
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
            style_json=default_resume_style().model_copy(
                update={"accent_color": "#315C6B"}
            ).model_dump(mode="json"),
            is_active=1,
        )
        db.add_all([user, template])
        db.flush()
        record = ResumeImport(
            user_id=user.id,
            source_filename="我的简历.md",
            source_file_format="md",
            source_object_key=f"users/{user.id}/resume-imports/task/resume.md",
            upload_status="succeeded",
            upload_duration_ms=5,
            parse_status="processing",
        )
        db.add(record)
        db.commit()
        storage.objects[record.source_object_key] = b"# Zhang San"
        return app, storage, processor, record.id, template.id


def test_worker_creates_one_resume_and_repeated_delivery_is_idempotent() -> None:
    app, _storage, processor, import_id, template_id = build_processor()

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))
    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(ResumeImport, import_id)
        resumes = db.scalars(select(Resume)).all()
        assert record is not None
        assert record.parse_status == "succeeded"
        assert record.result_resume_id == resumes[0].id
        assert len(resumes) == 1
        assert resumes[0].title == "我的简历"
        assert resumes[0].data_json["basics"]["name"] == "张三"
        assert resumes[0].style_json["accent_color"] == "#315C6B"


def test_business_parse_failure_creates_no_resume_and_marks_failed() -> None:
    app, _storage, processor, import_id, template_id = build_processor(
        converter=FailingConverter()
    )

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(ResumeImport, import_id)
        assert record is not None
        assert record.parse_status == "failed"
        assert record.result_resume_id is None
        assert db.scalar(select(Resume.id)) is None


def test_storage_outage_keeps_task_processing_for_broker_redelivery() -> None:
    app, storage, processor, import_id, template_id = build_processor()
    storage.fail_read = True

    with pytest.raises(WorkerTaskRetryable):
        asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(ResumeImport, import_id)
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
        record = db.get(ResumeImport, import_id)
        assert record is not None
        assert record.parse_status == "processing"
        assert db.scalar(select(Resume.id)) is None
