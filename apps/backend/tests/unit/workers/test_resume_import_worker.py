import asyncio
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from linkcv.core.config import Settings
from linkcv.domain.resume import (
    CanonicalResumeDocument,
    SourceGraph,
    SparseResumeAnnotations,
)
from linkcv.domain.resume.models import SparseAnnotation
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.domain.resume_style import default_resume_style, default_template_manifest
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeTemplate,
)
from linkcv.services.resume_import_service import (
    ParsedImportResult,
    ResumeImportService,
)
from linkcv.workers.resume_import_worker import (
    FAILURE_REASON_BY_CODE,
    ResumeImportProcessor,
    WorkerDependencyUnavailable,
    WorkerTaskRetryable,
)
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import (
    canonical_resume_payload,
    canonical_template_payload,
)


def empty_source_graph() -> SourceGraph:
    return SourceGraph(
        schema_version="source-graph.v1",
        source_document_sha256="0" * 64,
        leaves=[],
    )


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_read = False
        self.fail_upload = False
        self.fail_upload_after_write = False
        self.fail_delete = False
        self.deleted: list[str] = []
        self.uploaded: list[str] = []

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
        self.uploaded.append(object_name)
        if self.fail_upload_after_write:
            raise OSError("storage unavailable after write")

    def delete(self, object_name: str) -> None:
        if self.fail_delete:
            raise OSError("storage unavailable")
        self.deleted.append(object_name)
        self.objects.pop(object_name, None)


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
    async def extract_sparse(self, *, source_graph, **_kwargs) -> SparseResumeAnnotations:
        return SparseResumeAnnotations(
            schema_version="sparse-resume-annotations.v1",
            source_graph_sha256=source_graph.graph_sha256(),
            annotations=[],
        )


class InvalidFinalStructuringClient:
    async def extract_sparse(self, *, source_graph, **_kwargs) -> SparseResumeAnnotations:
        return SparseResumeAnnotations(
            schema_version="sparse-resume-annotations.v1",
            source_graph_sha256=source_graph.graph_sha256(),
            annotations=[
                SparseAnnotation(
                    source_id="src_ffffffffffffffff",
                    role="body",
                    semantic_kind="custom",
                    entry_anchor_source_id=None,
                    field_key=None,
                    normalized_value=None,
                    confidence=1,
                )
            ],
        )


class InvalidParsedImportService:
    async def parse_resume(self, **_kwargs) -> ParsedImportResult:
        return ParsedImportResult(
            document=None,
            extracted_markdown="# 张三",
            source_file_format="md",
            warnings=[],
            source_graph=empty_source_graph(),
        )


class RecordingImportService:
    def __init__(
        self,
        *,
        session_factory=None,
        template_id: int | None = None,
        mutate_template: bool = False,
    ) -> None:
        self._session_factory = session_factory
        self._template_id = template_id
        self._mutate_template = mutate_template
        self.calls: list[dict] = []

    async def parse_resume(self, **kwargs) -> ParsedImportResult:
        self.calls.append(kwargs)
        if self._mutate_template:
            assert self._session_factory is not None
            assert self._template_id is not None
            with self._session_factory() as db:
                template = db.get(ResumeTemplate, self._template_id)
                assert template is not None
                style = dict(template.style_json)
                style["accent_color"] = "#123456"
                template.style_json = style
                db.commit()
        data, _ = canonical_resume_payload()
        return ParsedImportResult(
            document=CanonicalResumeDocument.model_validate(data),
            extracted_markdown="# 张三",
            source_file_format="md",
            warnings=[],
            source_graph=empty_source_graph(),
        )


def build_processor(
    *,
    converter=None,
    structuring_client=None,
    renderer_key: str = "flow",
    template_key: str = "classic-cn",
):
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
        legacy_style = default_resume_style().model_copy(
            update={
                "accent_color": "#315C6B",
                "template_key": template_key,
                "manifest": default_template_manifest(renderer_key=renderer_key),
            }
        )
        template_data, template_style = canonical_template_payload(
            key=template_key,
            style=legacy_style,
        )
        template = ResumeTemplate(
            key="worker-template",
            name="Worker 模板",
            data_json=template_data,
            style_json=template_style,
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
            selected_template_id=template.id,
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
            f"users/{record.user_id}/resume-imports/task/artifacts/converted.md"
        )
        assert storage.objects[record.converted_object_name].startswith(b"# ")
        assert len(resumes) == 1
        assert resumes[0].parse_task_id == record.id
        assert resumes[0].title == "我的简历"
        assert resumes[0].data_json["identity"]["name"]["value"] == "张三"
        assert (
            resumes[0].style_json["template_snapshot"]["tokens"]["accent_color"]
            == "#315C6B"
        )


def test_worker_logs_safe_stage_chain(caplog) -> None:
    app, _storage, processor, import_id, template_id = build_processor()

    with caplog.at_level("INFO"):
        asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    messages = [record.message for record in caplog.records]
    assert messages[0] == "resume import task started"
    assert "resume import stage completed" in messages
    assert messages[-1] == "resume import task completed"
    stages = {record.stage for record in caplog.records if hasattr(record, "stage")}
    assert {
        "task_load",
        "source_read",
        "document_conversion",
        "resume_structuring",
        "resume_composition",
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
    assert failure.failure_stage == "resume_composition"
    assert failure.exception_type == "CanonicalCompositionError"
    assert "<script>" not in caplog.text
    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "failed"
        assert record.failure_reason == "content_invalid"


def test_storage_failure_retries_when_required_source_graph_cannot_persist(caplog) -> None:
    app, storage, processor, import_id, template_id = build_processor()
    storage.fail_upload = True

    with pytest.raises(WorkerTaskRetryable):
        asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        resume = db.scalar(select(Resume))
        assert record is not None
        assert record.converted_object_name is None
        assert record.parse_status == "processing"
        assert resume is None
    assert "converted markdown persistence failed" in caplog.text


def test_converted_markdown_reference_failure_compensates_uploaded_object() -> None:
    app, storage, processor, import_id, _template_id = build_processor()
    storage.fail_upload_after_write = True

    asyncio.run(
        processor._persist_converted_markdown(
            import_id=import_id,
            user_id=1,
            operation_id="task",
            markdown="# 张三",
        )
    )

    object_name = "users/1/resume-imports/task/artifacts/converted.md"
    assert object_name not in storage.objects
    assert storage.deleted == [object_name]


def test_converted_markdown_failure_before_commit_compensates_uploaded_object() -> None:
    app, storage, processor, import_id, _template_id = build_processor()
    base_session_factory = processor._session_factory

    def failing_session_factory():
        db = base_session_factory()
        db.commit = Mock(side_effect=SQLAlchemyError("database unavailable"))
        return db

    processor._session_factory = failing_session_factory
    try:
        asyncio.run(
            processor._persist_converted_markdown(
                import_id=import_id,
                user_id=1,
                operation_id="task",
                markdown="# 张三",
            )
        )
    finally:
        processor._session_factory = base_session_factory

    object_name = "users/1/resume-imports/task/artifacts/converted.md"
    assert object_name not in storage.objects
    assert storage.deleted == [object_name]


def test_converted_markdown_commit_after_success_preserves_object() -> None:
    app, storage, processor, import_id, _template_id = build_processor()
    base_session_factory = processor._session_factory
    session_count = 0

    def uncertain_session_factory():
        nonlocal session_count
        session_count += 1
        db = base_session_factory()
        if session_count == 1:
            committed = db.commit

            def commit_then_disconnect() -> None:
                committed()
                raise SQLAlchemyError("connection lost after commit")

            db.commit = Mock(side_effect=commit_then_disconnect)
        return db

    processor._session_factory = uncertain_session_factory
    try:
        asyncio.run(
            processor._persist_converted_markdown(
                import_id=import_id,
                user_id=1,
                operation_id="task",
                markdown="# 张三",
            )
        )
    finally:
        processor._session_factory = base_session_factory

    object_name = "users/1/resume-imports/task/artifacts/converted.md"
    assert storage.objects[object_name] == "# 张三".encode()
    assert storage.deleted == []
    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.converted_object_name == object_name


def test_converted_markdown_commit_verification_failure_never_blind_deletes() -> None:
    _app, storage, processor, import_id, _template_id = build_processor()
    base_session_factory = processor._session_factory
    session_count = 0

    def unavailable_verification_session_factory():
        nonlocal session_count
        session_count += 1
        db = base_session_factory()
        if session_count == 1:
            db.commit = Mock(side_effect=SQLAlchemyError("commit outcome unknown"))
        else:
            db.scalar = Mock(side_effect=SQLAlchemyError("database unavailable"))
        return db

    processor._session_factory = unavailable_verification_session_factory
    try:
        with pytest.raises(WorkerTaskRetryable, match="outcome unavailable"):
            asyncio.run(
                processor._persist_converted_markdown(
                    import_id=import_id,
                    user_id=1,
                    operation_id="task",
                    markdown="# 张三",
                )
            )
    finally:
        processor._session_factory = base_session_factory

    object_name = "users/1/resume-imports/task/artifacts/converted.md"
    assert storage.objects[object_name] == "# 张三".encode()
    assert storage.deleted == []


def test_converted_markdown_compensation_failure_uses_bounded_retry() -> None:
    app, storage, processor, import_id, _template_id = build_processor()
    storage.fail_upload_after_write = True
    storage.fail_delete = True

    with pytest.raises(WorkerTaskRetryable, match="compensation failed"):
        asyncio.run(
            processor._persist_converted_markdown(
                import_id=import_id,
                user_id=1,
                operation_id="task",
                markdown="# 张三",
            )
        )

    object_name = "users/1/resume-imports/task/artifacts/converted.md"
    assert object_name in storage.objects
    storage.fail_delete = False
    processor.mark_retry_exhausted(import_id)
    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "failed"
        assert record.failure_reason == "internal_error"


@pytest.mark.parametrize("parse_status", ["missing", "succeeded", "failed"])
def test_converted_markdown_does_not_upload_without_owned_processing_task(
    parse_status: str,
) -> None:
    app, storage, processor, import_id, _template_id = build_processor()
    if parse_status != "missing":
        with app.state.session_factory() as db:
            record = db.get(DocumentParseTask, import_id)
            assert record is not None
            record.parse_status = parse_status
            if parse_status != "processing":
                record.parse_duration_ms = 1
            db.commit()

    asyncio.run(
        processor._persist_converted_markdown(
            import_id=import_id if parse_status != "missing" else import_id + 100,
            user_id=1,
            operation_id="task",
            markdown="# 张三",
        )
    )

    assert storage.uploaded == []
    assert storage.objects == {"users/1/resume-imports/task/resume.md": b"# Zhang San"}
    assert storage.deleted == []


@pytest.mark.parametrize("renderer_key", ["flow", "columns"])
def test_worker_keeps_template_projection_out_of_canonical_parser(
    renderer_key: str,
) -> None:
    app, _storage, processor, import_id, template_id = build_processor(
        renderer_key=renderer_key,
        template_key=f"worker-{renderer_key}",
    )
    service = RecordingImportService()
    processor._import_service = service

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    assert len(service.calls) == 1
    assert "template_key" not in service.calls[0]
    assert "renderer" not in service.calls[0]
    assert service.calls[0]["request_pdf_layout"] is True
    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "succeeded"


def test_template_change_during_parse_fails_closed_without_creating_resume() -> None:
    app, _storage, processor, import_id, template_id = build_processor()
    service = RecordingImportService(
        session_factory=app.state.session_factory,
        template_id=template_id,
        mutate_template=True,
    )
    processor._import_service = service

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "failed"
        assert record.failure_reason == "internal_error"
        assert db.scalar(select(Resume.id)) is None


def test_invalid_final_document_maps_to_content_invalid_without_resume() -> None:
    app, _storage, processor, import_id, template_id = build_processor()
    processor._import_service = InvalidParsedImportService()

    asyncio.run(processor.process(import_id=import_id, template_id=template_id))

    with app.state.session_factory() as db:
        record = db.get(DocumentParseTask, import_id)
        assert record is not None
        assert record.parse_status == "failed"
        assert record.failure_reason == "content_invalid"
        assert db.scalar(select(Resume.id)) is None


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


def test_structure_and_layout_failures_use_content_invalid_classification() -> None:
    assert FAILURE_REASON_BY_CODE["RESUME_STRUCTURE_INVALID"] == "content_invalid"
    assert FAILURE_REASON_BY_CODE["RESUME_LAYOUT_UNSUPPORTED"] == "content_invalid"


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
