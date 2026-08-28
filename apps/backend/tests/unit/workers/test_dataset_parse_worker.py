import asyncio

import pytest
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkcv.workers.dataset_parse_worker import DatasetParseProcessor
from linkcv.workers.resume_import_worker import (
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
        if self.fail_upload and object_name.endswith(".md"):
            raise OSError("storage unavailable")
        self.objects[object_name] = data


class FakeConverter:
    def __init__(self) -> None:
        self.require_pdf_layout_calls: list[bool] = []

    async def convert(
        self,
        *,
        filename: str,
        require_pdf_layout: bool = True,
        **_kwargs,
    ) -> DocumentMarkdownResult:
        self.require_pdf_layout_calls.append(require_pdf_layout)
        return DocumentMarkdownResult(
            markdown="# 张三",
            source_file_name=filename,
            source_format=filename.rsplit(".", 1)[-1],
            parser="fake",
            parser_version="1",
        )


class FailingConverter:
    def __init__(self, code: str, status_code: int = 422) -> None:
        self.code = code
        self.status_code = status_code

    async def convert(self, **_kwargs):
        raise DocumentConversionFailure(self.status_code, self.code)


def build_processor(*, converter=None, queued: bool = False):
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="dataset-worker-test-secret-with-32-bytes",
    )
    storage = FakeStorage()
    redis = FakeRedis()
    document_converter = converter or FakeConverter()
    app = create_app(
        settings,
        storage=storage,
        redis=redis,
        document_converter=document_converter,
        create_schema=True,
    )
    processor = DatasetParseProcessor(
        session_factory=app.state.session_factory,
        storage=storage,
        redis=redis,
        document_converter=document_converter,
        settings=settings,
    )
    with app.state.session_factory() as db:
        user = User(
            email="dataset-worker@example.invalid",
            password_hash="fictional-hash",
            nickname="张三",
        )
        db.add(user)
        db.flush()
        task = DocumentParseTask(
            source_type=DATASET_SOURCE_TYPE,
            user_id=user.id,
            file_name="资料.txt",
            file_format="txt",
            object_name=f"users/{user.id}/datasets/source.txt",
            upload_status="uploading" if queued else "succeeded",
            upload_duration_ms=None if queued else 5,
            parse_status=None if queued else "processing",
        )
        db.add(task)
        db.commit()
        storage.objects[task.object_name] = b"source"
        return app, storage, processor, task.id


def test_dataset_worker_persists_markdown_and_is_idempotent() -> None:
    converter = FakeConverter()
    app, storage, processor, task_id = build_processor(converter=converter)

    asyncio.run(processor.process(parse_task_id=task_id))
    asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "succeeded"
        assert task.failure_reason is None
        assert task.converted_object_name == (
            f"users/{task.user_id}/datasets/converted/{task.id}.md"
        )
        assert storage.objects[task.converted_object_name] == "# 张三".encode()
    assert converter.require_pdf_layout_calls == [False]


def test_dataset_worker_advances_queued_task_before_conversion() -> None:
    app, _storage, processor, task_id = build_processor(queued=True)

    asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.upload_status == "succeeded"
        assert task.upload_duration_ms is not None
        assert task.parse_status == "succeeded"


@pytest.mark.parametrize(
    ("code", "reason"),
    [
        ("UNSUPPORTED_IMPORT_FORMAT", "format_unsupported"),
        ("IMPORT_CONTENT_INVALID", "content_invalid"),
        ("IMPORT_FILE_TOO_LARGE", "size_exceeded"),
        ("DOCUMENT_CONVERSION_UNAVAILABLE", "service_unavailable"),
        ("IMPORT_DEADLINE_EXCEEDED", "timeout"),
    ],
)
def test_dataset_worker_maps_conversion_failures(code: str, reason: str) -> None:
    app, _storage, processor, task_id = build_processor(
        converter=FailingConverter(code)
    )

    asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "failed"
        assert task.failure_reason == reason


def test_converted_storage_failure_is_best_effort() -> None:
    app, storage, processor, task_id = build_processor()
    storage.fail_upload = True

    asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "succeeded"
        assert task.converted_object_name is None


def test_source_storage_failure_remains_retryable() -> None:
    app, storage, processor, task_id = build_processor()
    storage.fail_read = True

    with pytest.raises(WorkerTaskRetryable):
        asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "processing"


def test_existing_lock_keeps_message_pending() -> None:
    app, _storage, processor, task_id = build_processor()
    app.state.redis.set(
        processor._lock_key(task_id),
        "another-worker",
        nx=True,
        ex=240,
    )

    with pytest.raises(WorkerDependencyUnavailable, match="already held"):
        asyncio.run(processor.process(parse_task_id=task_id))


def test_retry_exhaustion_records_internal_error() -> None:
    app, _storage, processor, task_id = build_processor()

    processor.mark_retry_exhausted(task_id)

    with app.state.session_factory() as db:
        task = db.scalar(select(DocumentParseTask))
        assert task is not None
        assert task.parse_status == "failed"
        assert task.failure_reason == "internal_error"
