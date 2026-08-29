from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.application.resumes.service import (
    close_stale_resume_imports,
    persist_resume_with_initial_version,
    resume_slot_count,
)
from linkcv.core.config import Settings
from linkcv.core.mq import MQPublishError
from linkcv.domain.document_conversion import DocumentMarkdownResult
from linkcv.domain.resume import CanonicalResumeDocument, ResumePresentation
from linkcv.domain.resume import SparseResumeAnnotations
from linkcv.main import create_app
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import (
    RESUME_IMPORT_SOURCE_TYPE,
    DocumentParseTask,
    Resume,
    ResumeTemplate,
)
from tests.fakes import FakeRedis
from tests.canonical_resume_fixtures import (
    canonical_resume_payload,
    canonical_template_payload,
)


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


class FakePublisher:
    def __init__(self) -> None:
        self.messages = []
        self.fail = False

    async def publish(self, message) -> None:
        if self.fail:
            raise MQPublishError("broker unavailable")
        self.messages.append(message)

    async def close(self) -> None:
        pass


class FakeDocumentConverter:
    def __init__(self) -> None:
        self.calls = 0

    async def convert(self, *, filename: str, **_kwargs) -> DocumentMarkdownResult:
        self.calls += 1
        return DocumentMarkdownResult(
            markdown="# 张三",
            source_file_name=filename,
            source_format=filename.rsplit(".", 1)[-1],
            parser="fake",
            parser_version="1",
            warnings=[],
        )


class FakeStructuringClient:
    async def extract_sparse(self, *, source_graph, **_kwargs):
        return SparseResumeAnnotations(
            schema_version="sparse-resume-annotations.v1",
            source_graph_sha256=source_graph.graph_sha256(),
            annotations=[],
        )


def build_app():
    storage = FakeStorage()
    converter = FakeDocumentConverter()
    publisher = FakePublisher()
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
        mq_publisher=publisher,
        create_schema=True,
    )
    with app.state.session_factory() as db:
        template_data, template_style = canonical_template_payload(key="modern-two-column-cn")
        template = ResumeTemplate(
            key="modern-two-column-cn",
            name="现代双栏",
            data_json=template_data,
            style_json=template_style,
            is_active=1,
        )
        db.add(template)
        db.commit()
        app.state.test_template_id = str(template.id)
    return app, storage, converter, publisher


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


def test_import_accepts_upload_without_running_parser_or_creating_resume() -> None:
    app, storage, converter, publisher = build_app()
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 202
    summary = response.json()["import"]
    assert summary["source_filename"] == "resume.md"
    assert summary["upload_status"] == "succeeded"
    assert summary["parse_status"] == "processing"
    assert summary["result_resume_id"] is None
    assert converter.calls == 0
    assert len(storage.objects) == 1
    object_name = next(iter(storage.objects))
    assert object_name.startswith("users/1/resume-imports/")
    assert object_name.endswith("/source/resume.md")
    assert len(publisher.messages) == 1
    assert publisher.messages[0].payload.import_id == summary["id"]
    with app.state.session_factory() as db:
        assert db.scalar(select(Resume.id)) is None
        record = db.get(DocumentParseTask, int(summary["id"]))
        template = db.get(ResumeTemplate, int(summary["selected_template_id"]))
        assert record is not None
        assert template is not None
        assert record.selected_template_style_json == template.style_json
        frozen = record.selected_template_style_json
        changed_style = dict(template.style_json)
        assert isinstance(changed_style["tokens"], dict)
        changed_style["tokens"] = {
            **changed_style["tokens"],
            "accent_color": "#123456",
        }
        template.style_json = changed_style
        db.commit()
        db.refresh(record)
        assert record.selected_template_style_json == frozen


def test_active_import_shares_the_ten_slot_limit_with_normal_creation() -> None:
    app, _storage, _converter, _publisher = build_app()
    with TestClient(app) as client:
        register(client)
        for number in range(9):
            created = client.post(
                "/api/resumes",
                json={
                    "title": f"resume-{number}",
                    "template_id": app.state.test_template_id,
                },
            )
            assert created.status_code == 201

        accepted = import_file(client, app)
        rejected = client.post(
            "/api/resumes",
            json={
                "title": "resume-10",
                "template_id": app.state.test_template_id,
            },
        )

    assert accepted.status_code == 202
    assert rejected.status_code == 409
    assert rejected.json() == {"error": "RESUME_LIMIT_REACHED"}


@pytest.mark.parametrize(
    "template_id",
    ["0", "+1", "01", " 1", "1 ", "1.0", "18446744073709551616"],
)
def test_import_rejects_noncanonical_template_ids_without_side_effects(
    template_id: str,
) -> None:
    app, storage, converter, publisher = build_app()
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app, template_id=template_id)

    assert response.status_code == 422
    assert response.json() == {"error": "TEMPLATE_INACTIVE"}
    assert storage.objects == {}
    assert converter.calls == 0
    assert publisher.messages == []


def test_same_key_replays_same_active_import_and_changed_input_conflicts() -> None:
    app, storage, _converter, publisher = build_app()
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        first = import_file(client, app, key=key)
        replay = import_file(client, app, key=key)
        conflict = import_file(client, app, key=key, content=b"# changed")

    assert first.status_code == replay.status_code == 202
    assert first.json()["import"]["id"] == replay.json()["import"]["id"]
    assert conflict.status_code == 409
    assert conflict.json() == {"error": "IDEMPOTENCY_KEY_REUSED"}
    assert len(storage.objects) == 1
    assert len(publisher.messages) == 1


def test_same_key_replays_original_import_after_template_is_disabled() -> None:
    app, storage, _converter, publisher = build_app()
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        first = import_file(client, app, key=key)
        with app.state.session_factory() as db:
            template = db.get(ResumeTemplate, int(app.state.test_template_id))
            assert template is not None
            template.is_active = 0
            db.commit()

        replay = import_file(client, app, key=key)

    assert first.status_code == replay.status_code == 202
    assert replay.json()["import"]["id"] == first.json()["import"]["id"]
    assert len(storage.objects) == 1
    assert len(publisher.messages) == 1


def test_upload_failure_is_compensated_and_persisted_for_user_cleanup() -> None:
    app, storage, _converter, publisher = build_app()
    storage.fail_upload = True
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 502
    assert response.json()["error"] == "RESUME_SOURCE_UPLOAD_FAILED"
    assert response.json()["import"]["upload_status"] == "failed"
    assert storage.objects == {}
    assert len(storage.deleted) == 1
    assert publisher.messages == []
    with app.state.session_factory() as db:
        record = db.scalar(select(DocumentParseTask))
        assert record is not None
        assert record.upload_status == "failed"


def test_broker_failure_marks_parse_failed_and_exposes_task_summary() -> None:
    app, storage, _converter, publisher = build_app()
    publisher.fail = True
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 503
    assert response.json()["error"] == "RESUME_IMPORT_QUEUE_UNAVAILABLE"
    assert response.json()["import"]["upload_status"] == "succeeded"
    assert response.json()["import"]["parse_status"] == "failed"
    assert len(storage.objects) == 1


def test_publisher_initialization_failure_marks_task_service_unavailable() -> None:
    app, storage, _converter, _publisher = build_app()
    app.state.mq_publisher = None

    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 503
    assert response.json()["error"] == "RESUME_IMPORT_QUEUE_UNAVAILABLE"
    assert response.json()["import"]["upload_status"] == "succeeded"
    assert response.json()["import"]["parse_status"] == "failed"
    assert len(storage.objects) == 1
    with app.state.session_factory() as db:
        record = db.scalar(select(DocumentParseTask))
        assert record is not None
        assert record.failure_reason == "service_unavailable"


def test_publisher_initialization_failure_does_not_overwrite_worker_success(
    monkeypatch,
) -> None:
    app, _storage, _converter, _publisher = build_app()

    def deliver_before_initialization(_settings) -> None:
        with app.state.session_factory() as db:
            record = db.scalar(select(DocumentParseTask))
            template = db.get(ResumeTemplate, int(app.state.test_template_id))
            assert record is not None
            assert template is not None
            data, style = canonical_resume_payload(key=template.key)
            resume = persist_resume_with_initial_version(
                CreateResumeCommand(
                    user_id=record.user_id,
                    title="delivered-during-init",
                    data=CanonicalResumeDocument.model_validate(data),
                    style=ResumePresentation.model_validate(style),
                    source_type="import",
                    template_id=template.id,
                ),
                db,
            )
            resume.parse_task_id = record.id
            record.parse_status = "succeeded"
            record.parse_duration_ms = 1
            db.commit()
        raise RuntimeError("publisher initialization failed after delivery")

    monkeypatch.setattr(
        "linkcv.modules.resumes.import_routes.build_mq_publisher",
        deliver_before_initialization,
    )
    app.state.mq_publisher = None

    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 200
    assert response.json()["import"]["parse_status"] == "succeeded"
    assert response.json()["import"]["result_resume_id"] is not None
    with app.state.session_factory() as db:
        record = db.scalar(select(DocumentParseTask))
        assert record is not None
        assert record.parse_status == "succeeded"


def test_publish_confirm_failure_does_not_overwrite_worker_success() -> None:
    app, _storage, _converter, _publisher = build_app()

    class DeliveredBeforeTimeoutPublisher:
        async def publish(self, message) -> None:
            with app.state.session_factory() as db:
                record = db.get(DocumentParseTask, int(message.payload.import_id))
                template = db.get(ResumeTemplate, int(message.payload.template_id))
                assert record is not None
                assert template is not None
                data, style = canonical_resume_payload(key=template.key)
                resume = persist_resume_with_initial_version(
                    CreateResumeCommand(
                        user_id=record.user_id,
                        title="delivered-resume",
                        data=CanonicalResumeDocument.model_validate(data),
                        style=ResumePresentation.model_validate(style),
                        source_type="import",
                        template_id=template.id,
                    ),
                    db,
                )
                resume.parse_task_id = record.id
                record.parse_status = "succeeded"
                record.parse_duration_ms = 1
                db.commit()
            raise MQPublishError("confirm timed out after delivery")

        async def close(self) -> None:
            pass

    app.state.mq_publisher = DeliveredBeforeTimeoutPublisher()
    with TestClient(app) as client:
        register(client)
        response = import_file(client, app)

    assert response.status_code == 200
    assert response.json()["import"]["parse_status"] == "succeeded"
    assert response.json()["import"]["result_resume_id"] is not None
    with app.state.session_factory() as db:
        record = db.scalar(select(DocumentParseTask))
        assert record is not None
        assert record.parse_status == "succeeded"


def test_overview_lists_active_import_and_failed_import_can_be_deleted() -> None:
    app, storage, _converter, publisher = build_app()
    with TestClient(app) as client:
        register(client)
        active = import_file(client, app)
        publisher.fail = True
        failed = import_file(client, app)
        failed_id = int(failed.json()["import"]["id"])
        converted_object_name = f"users/1/resume-imports/{failed_id}/converted.md"
        with app.state.session_factory() as db:
            record = db.get(DocumentParseTask, failed_id)
            assert record is not None
            record.converted_object_name = converted_object_name
            db.commit()
        storage.objects[converted_object_name] = b"# converted"
        overview = client.get("/api/resume-overview")
        deleted = client.delete(f"/api/resume-imports/{failed_id}")

    assert active.status_code == 202
    assert failed.status_code == 503
    assert overview.status_code == 200
    assert [item["id"] for item in overview.json()["active_imports"]] == [
        active.json()["import"]["id"]
    ]
    assert [item["id"] for item in overview.json()["failed_imports"]] == [
        failed.json()["import"]["id"]
    ]
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert converted_object_name in storage.deleted
    assert len(storage.objects) == 1


def test_failed_import_delete_derives_legacy_orphan_without_reference() -> None:
    app, storage, _converter, publisher = build_app()
    publisher.fail = True

    with TestClient(app) as client:
        register(client)
        failed = import_file(client, app)
        assert failed.status_code == 503
        failed_id = int(failed.json()["import"]["id"])
        with app.state.session_factory() as db:
            record = db.get(DocumentParseTask, failed_id)
            assert record is not None
            operation_id = record.object_name.split("/")[3]
            record.converted_object_name = None
            db.commit()
        legacy_converted = (
            f"users/1/resume-imports/{operation_id}/converted.md"
        )
        storage.objects[legacy_converted] = b"# converted"

        deleted = client.delete(f"/api/resume-imports/{failed_id}")

    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert storage.objects == {}


def test_get_resume_import_returns_only_the_owned_task_summary() -> None:
    app, _storage, _converter, _publisher = build_app()
    with TestClient(app) as client:
        register(client)
        accepted = import_file(client, app)
        import_id = accepted.json()["import"]["id"]

        status = client.get(f"/api/resume-imports/{import_id}")
        invalid = client.get("/api/resume-imports/+1")

        client.post("/api/auth/logout")
        second_user = client.post(
            "/api/auth/register",
            json={
                "email": "other-importer@example.invalid",
                "password": "password-123",
            },
        )
        hidden = client.get(f"/api/resume-imports/{import_id}")

    assert status.status_code == 200
    assert status.json() == accepted.json()
    assert invalid.status_code == 404
    assert invalid.json() == {"error": "RESUME_IMPORT_NOT_FOUND"}
    assert second_user.status_code == 201
    assert hidden.status_code == 404
    assert hidden.json() == {"error": "RESUME_IMPORT_NOT_FOUND"}


def test_get_resume_import_closes_a_stale_processing_task() -> None:
    app, _storage, _converter, _publisher = build_app()
    with TestClient(app) as client:
        register(client)
        accepted = import_file(client, app)
        import_id = int(accepted.json()["import"]["id"])
        with app.state.session_factory() as db:
            record = db.get(DocumentParseTask, import_id)
            assert record is not None
            record.updated_at = datetime.now(timezone.utc) - timedelta(minutes=5)
            db.commit()

        status = client.get(f"/api/resume-imports/{import_id}")

    assert status.status_code == 200
    assert status.json()["import"]["parse_status"] == "failed"
    assert status.json()["import"]["parse_duration_ms"] is not None


def test_overview_closes_stale_processing_import_with_sqlite_datetime() -> None:
    app, _storage, _converter, _publisher = build_app()
    with TestClient(app) as client:
        register(client)
        accepted = import_file(client, app)
        import_id = int(accepted.json()["import"]["id"])
        with app.state.session_factory() as db:
            record = db.get(DocumentParseTask, import_id)
            assert record is not None
            record.updated_at = datetime.now(timezone.utc) - timedelta(minutes=5)
            db.commit()

        overview = client.get("/api/resume-overview")

    assert overview.status_code == 200
    assert overview.json()["active_imports"] == []
    failed = overview.json()["failed_imports"]
    assert [item["id"] for item in failed] == [str(import_id)]
    assert failed[0]["parse_status"] == "failed"
    assert failed[0]["parse_duration_ms"] is not None


def test_import_replay_closes_stale_task_before_idempotency_response() -> None:
    app, _storage, _converter, _publisher = build_app()
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        accepted = import_file(client, app, key=key)
        import_id = int(accepted.json()["import"]["id"])
        with app.state.session_factory() as db:
            record = db.get(DocumentParseTask, import_id)
            assert record is not None
            record.updated_at = datetime.now(timezone.utc) - timedelta(minutes=5)
            db.commit()

        replay = import_file(client, app, key=key)

    assert replay.status_code == 409
    assert replay.json()["error"] == "IMPORT_PREVIOUSLY_FAILED"
    assert replay.json()["import"]["id"] == str(import_id)
    assert replay.json()["import"]["parse_status"] == "failed"


def test_failed_import_cursor_can_load_the_next_page() -> None:
    app, _storage, _converter, _publisher = build_app()
    with TestClient(app) as client:
        register(client)
        with app.state.session_factory() as db:
            user_id = db.scalar(select(User.id))
            assert user_id is not None
            for number in range(3):
                db.add(
                    DocumentParseTask(
                        source_type=RESUME_IMPORT_SOURCE_TYPE,
                        user_id=user_id,
                        file_name=f"failed-{number}.md",
                        file_format="md",
                        object_name=f"users/{user_id}/imports/{number}.md",
                        upload_status="failed",
                        upload_duration_ms=number,
                    )
                )
            db.commit()

        first = client.get("/api/resume-overview?failed_limit=2")
        cursor = first.json()["next_failed_cursor"]
        second = client.get(
            "/api/resume-overview",
            params={"failed_limit": 2, "failed_cursor": cursor},
        )

    assert first.status_code == 200
    assert cursor is not None
    assert len(first.json()["failed_imports"]) == 2
    assert second.status_code == 200
    assert len(second.json()["failed_imports"]) == 1
    first_ids = {item["id"] for item in first.json()["failed_imports"]}
    second_ids = {item["id"] for item in second.json()["failed_imports"]}
    assert first_ids.isdisjoint(second_ids)


def test_resume_capacity_and_stale_cleanup_ignore_other_task_types() -> None:
    app, _storage, _converter, _publisher = build_app()
    with TestClient(app) as client:
        register(client)
        with app.state.session_factory() as db:
            user_id = db.scalar(select(User.id))
            assert user_id is not None
            db.execute(text("PRAGMA ignore_check_constraints = ON"))
            other_task = DocumentParseTask(
                source_type="future_consumer",
                user_id=user_id,
                file_name="notes.md",
                file_format="md",
                object_name=f"users/{user_id}/future/notes.md",
                upload_status="uploading",
                updated_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            )
            db.add(other_task)
            db.commit()

            assert resume_slot_count(db, user_id) == 0
            close_stale_resume_imports(
                db,
                user_id=user_id,
                upload_stale_seconds=60,
                parse_stale_seconds=60,
            )
            db.refresh(other_task)
            assert other_task.upload_status == "uploading"


def test_unauthenticated_import_is_rejected() -> None:
    app, storage, converter, publisher = build_app()
    with TestClient(app) as client:
        response = import_file(client, app)

    assert response.status_code == 401
    assert storage.objects == {}
    assert converter.calls == 0
    assert publisher.messages == []
