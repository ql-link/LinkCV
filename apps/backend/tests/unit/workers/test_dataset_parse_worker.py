import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from linkcv.core.config import Settings
from linkcv.core.database import utc_now
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkcv.workers.dataset_parse_worker import DatasetParseProcessor
from linkcv.workers.resume_import_worker import WorkerTaskRetryable
from tests.fakes import FakeRedis


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_read = False
        self.fail_upload = False
        self.fail_delete = False

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

    def delete(self, object_name: str) -> None:
        if self.fail_delete:
            raise OSError("storage unavailable")
        self.objects.pop(object_name, None)


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


def build_processor(*, converter=None):
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
            upload_status="succeeded",
            upload_duration_ms=5,
            parse_status="queued",
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
            f"users/{task.user_id}/datasets/converted/{task.id}-1.md"
        )
        assert storage.objects[task.converted_object_name] == "# 张三".encode()
    assert converter.require_pdf_layout_calls == [False]


def test_dataset_worker_claims_queued_task_before_conversion() -> None:
    app, _storage, processor, task_id = build_processor()

    asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.upload_status == "succeeded"
        assert task.upload_duration_ms is not None
        assert task.parse_status == "succeeded"
        assert task.parse_attempt_count == 1


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
        if reason in {"service_unavailable", "timeout"}:
            assert task.parse_status == "queued"
            assert task.failure_reason is None
        else:
            assert task.parse_status == "failed"
            assert task.failure_reason == reason


def test_converted_storage_failure_is_retryable_parse_failure() -> None:
    app, storage, processor, task_id = build_processor()
    storage.fail_upload = True

    asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "queued"
        assert task.failure_reason is None
        assert task.converted_object_name is None


def test_source_storage_failure_remains_retryable() -> None:
    app, storage, processor, task_id = build_processor()
    storage.fail_read = True

    with pytest.raises(WorkerTaskRetryable):
        asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "queued"
        assert task.parse_attempt_count == 1


def test_duplicate_message_after_claim_is_idempotent() -> None:
    app, _storage, processor, task_id = build_processor()
    asyncio.run(processor.process(parse_task_id=task_id))
    asyncio.run(processor.process(parse_task_id=task_id))

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "succeeded"
        assert task.parse_attempt_count == 1


def test_retry_exhaustion_records_internal_error() -> None:
    app, _storage, processor, task_id = build_processor()

    processor.mark_retry_exhausted(task_id)

    with app.state.session_factory() as db:
        task = db.scalar(select(DocumentParseTask))
        assert task is not None
        assert task.parse_status == "queued"
        assert task.failure_reason is None


def test_stale_processing_is_requeued_with_same_attempt_version() -> None:
    app, _storage, processor, task_id = build_processor()
    claim = processor._claim_queued_task(task_id)
    assert claim is not None
    assert claim.attempt == 1

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        task.updated_at = utc_now() - timedelta(
            seconds=processor._settings.dataset_parse_stale_seconds + 1
        )
        db.commit()

    assert processor.recover_stale_processing() == 1

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "queued"
        assert task.parse_attempt_count == 1
        assert task.failure_reason is None


def test_stale_processing_at_max_attempts_is_terminal_failure() -> None:
    app, _storage, processor, task_id = build_processor()

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        task.parse_status = "processing"
        task.parse_attempt_count = processor._settings.dataset_parse_max_attempts
        task.updated_at = utc_now() - timedelta(
            seconds=processor._settings.dataset_parse_stale_seconds + 1
        )
        db.commit()

    assert processor.recover_stale_processing() == 1

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "failed"
        assert task.failure_reason == "timeout"
        assert task.parse_duration_ms is not None


def test_queued_dispatch_records_timestamp_only_after_confirmation() -> None:
    _app, _storage, processor, task_id = build_processor()
    publish = AsyncMock(return_value=True)

    assert asyncio.run(processor.recover_once(publish=publish)) == 1
    publish.assert_awaited_once_with(task_id)

    # A recently confirmed task is not repeatedly published in the next cycle.
    assert asyncio.run(processor.recover_once(publish=publish)) == 0
    publish.assert_awaited_once_with(task_id)


def test_queued_dispatch_failure_keeps_task_eligible() -> None:
    app, _storage, processor, task_id = build_processor()
    publish = AsyncMock(return_value=False)

    assert asyncio.run(processor.recover_once(publish=publish)) == 0
    publish.assert_awaited_once_with(task_id)

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "queued"
        assert task.last_dispatched_at is None


def test_old_attempt_cannot_complete_after_recovery_claims_new_attempt() -> None:
    app, storage, processor, task_id = build_processor()
    first_claim = processor._claim_queued_task(task_id)
    assert first_claim is not None
    assert first_claim.attempt == 1

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        task.updated_at = utc_now() - timedelta(
            seconds=processor._settings.dataset_parse_stale_seconds + 1
        )
        db.commit()
    assert processor.recover_stale_processing() == 1

    second_claim = processor._claim_queued_task(task_id)
    assert second_claim is not None
    assert second_claim.attempt == 2

    assert (
        processor._persist_success(
            parse_task_id=task_id,
            user_id=second_claim.task.user_id,
            markdown="# old attempt",
            started=0,
            attempt=first_claim.attempt,
        )
        is False
    )

    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.parse_status == "processing"
        assert task.parse_attempt_count == second_claim.attempt
        assert task.converted_object_name is None
    # The stale attempt used an attempt-scoped key and cleaned it after losing
    # the conditional completion race, so it cannot overwrite the next result.
    stale_object = (
        f"users/{second_claim.task.user_id}/datasets/converted/"
        f"{task_id}-{first_claim.attempt}.md"
    )
    assert stale_object not in storage.objects


def test_stale_upload_reservation_is_failed_and_source_object_removed() -> None:
    app, storage, processor, task_id = build_processor()
    source_name = "users/1/datasets/source.txt"
    storage.objects[source_name] = b"orphan"
    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        task.object_name = source_name
        task.upload_status = "uploading"
        task.upload_duration_ms = None
        task.parse_status = None
        task.parse_duration_ms = None
        task.updated_at = utc_now() - timedelta(
            seconds=processor._settings.dataset_upload_reservation_ttl_seconds + 1
        )
        db.commit()

    assert asyncio.run(processor.cleanup_upload_reservations()) == 1
    assert source_name not in storage.objects
    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        assert task.upload_status == "failed"
        assert task.parse_status is None
        assert task.upload_duration_ms is not None


def test_failed_upload_reservation_is_removed_after_retention_window() -> None:
    app, storage, processor, task_id = build_processor()
    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        task.upload_status = "failed"
        task.upload_duration_ms = 1
        task.parse_status = None
        task.parse_duration_ms = None
        task.updated_at = utc_now() - timedelta(
            seconds=processor._settings.dataset_upload_reservation_ttl_seconds + 1
        )
        db.commit()

    assert processor.cleanup_failed_reservations() == 1
    assert not storage.objects
    with app.state.session_factory() as db:
        assert db.get(DocumentParseTask, task_id) is None


def test_failed_upload_reservation_is_retained_when_object_cleanup_fails() -> None:
    app, storage, processor, task_id = build_processor()
    with app.state.session_factory() as db:
        task = db.get(DocumentParseTask, task_id)
        assert task is not None
        task.upload_status = "failed"
        task.upload_duration_ms = 1
        task.parse_status = None
        task.parse_duration_ms = None
        task.updated_at = utc_now() - timedelta(
            seconds=processor._settings.dataset_upload_reservation_ttl_seconds + 1
        )
        db.commit()
    storage.fail_delete = True

    assert processor.cleanup_failed_reservations() == 0
    with app.state.session_factory() as db:
        assert db.get(DocumentParseTask, task_id) is not None
