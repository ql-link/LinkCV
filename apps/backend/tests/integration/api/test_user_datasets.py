from collections.abc import Iterator
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
import pypdfium2 as pdfium
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.mq import MQPublishError
from linkcv.core.storage import StreamUploadResult
from linkcv.main import create_app
from linkcv.modules.datasets.models import UserDataset
from linkcv.modules.identity.models import User
from linkcv.modules.resumes.models import DocumentParseTask
from tests.fakes import FakeRedis


class FakeObjectResponse:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def stream(self, _size: int) -> Iterator[bytes]:
        yield self.data

    def close(self) -> None:
        pass

    def release_conn(self) -> None:
        pass


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_cleanup = False

    def ensure_bucket(self) -> None:
        pass

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.objects[object_name] = data

    def upload_stream(
        self,
        object_name: str,
        stream,
        _content_type: str,
        *,
        max_bytes: int,
    ) -> StreamUploadResult:
        content = stream.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise ValueError("too large")
        self.objects[object_name] = content
        from hashlib import sha256

        return StreamUploadResult(
            file_size=len(content),
            sha256=sha256(content).hexdigest(),
        )

    def get(self, object_name: str) -> FakeObjectResponse:
        return FakeObjectResponse(self.objects[object_name])

    def stat(self, object_name: str) -> None:
        if object_name not in self.objects:
            raise KeyError(object_name)

    def delete(self, object_name: str) -> None:
        if self.fail_cleanup:
            raise RuntimeError("storage unavailable")
        self.objects.pop(object_name, None)

    def delete_prefix(self, prefix: str) -> None:
        if self.fail_cleanup:
            raise RuntimeError("storage unavailable")
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


def build_test_app(max_bytes: int | None = None, **setting_overrides):
    if max_bytes is not None:
        setting_overrides["dataset_upload_max_bytes"] = max_bytes
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
        **setting_overrides,
    )
    publisher = FakePublisher()
    app = create_app(
        settings,
        storage=FakeStorage(),
        redis=FakeRedis(),
        mq_publisher=publisher,
        create_schema=True,
    )
    app.state.test_publisher = publisher
    return app


def register(client: TestClient, email: str = "dataset-user@example.com") -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "password-123"},
    )
    assert response.status_code == 201


def upload_file(
    client: TestClient,
    *,
    filename: str = "notes.md",
    content: bytes = b"# Zhang San",
    content_type: str = "text/markdown",
    idempotency_key: str | None = None,
    data: dict | None = None,
):
    return client.post(
        "/api/datasets",
        files={"file": (filename, content, content_type)},
        data=data,
        headers={"Idempotency-Key": idempotency_key or str(uuid4())},
    )


def valid_pdf() -> bytes:
    document = pdfium.PdfDocument.new()
    document.new_page(595, 842)
    output = BytesIO()
    document.save(output)
    document.close()
    return output.getvalue()


def mark_dataset_succeeded(app, dataset_id: int, markdown: bytes = b"# Parsed") -> None:
    with app.state.session_factory() as session:
        dataset = session.get(UserDataset, dataset_id)
        assert dataset is not None
        task = session.get(DocumentParseTask, dataset.parse_task_id)
        assert task is not None
        task.parse_attempt_count = max(1, task.parse_attempt_count)
        converted_object_name = (
            f"users/1/datasets/converted/{task.id}-{task.parse_attempt_count}.md"
        )
        task.upload_status = "succeeded"
        task.upload_duration_ms = 1
        task.parse_status = "succeeded"
        task.parse_duration_ms = 1
        task.converted_object_name = converted_object_name
        session.commit()
    app.state.storage.objects[converted_object_name] = markdown


def mark_dataset_failed(
    app,
    dataset_id: int,
    failure_reason: str = "content_invalid",
) -> None:
    with app.state.session_factory() as session:
        dataset = session.get(UserDataset, dataset_id)
        assert dataset is not None
        task = session.get(DocumentParseTask, dataset.parse_task_id)
        assert task is not None
        task.upload_status = "succeeded"
        task.upload_duration_ms = 1
        task.parse_status = "failed"
        task.parse_duration_ms = 1
        task.failure_reason = failure_reason
        session.commit()


def test_upload_and_list_own_datasets() -> None:
    app = build_test_app()
    storage = app.state.storage
    with TestClient(app) as client:
        register(client)
        first = upload_file(client, filename="notes.md", content=b"# Zhang San")
        assert first.status_code == 202
        payload = first.json()
        assert payload["id"].isdecimal()
        assert payload["file_name"] == "notes.md"
        assert payload["file_format"] == "md"
        assert payload["file_size"] == len(b"# Zhang San")
        assert payload["upload_status"] == "succeeded"
        assert payload["parse_status"] == "queued"
        assert payload["failure_reason"] is None
        assert "sha256" not in payload
        assert "object_name" not in payload
        assert "created_at" in payload

        second = upload_file(
            client,
            filename="resume.pdf",
            content=valid_pdf(),
            content_type="application/pdf",
        )
        assert second.status_code == 202

        listed = client.get("/api/datasets")
        assert listed.status_code == 200
        assert listed.json()["limits"] == {
            "max_file_bytes": app.state.settings.dataset_upload_max_bytes,
            "max_files_per_batch": 10,
            "allowed_extensions": [".pdf", ".docx", ".md", ".txt"],
        }
        records = listed.json()["datasets"]
        assert [item["file_name"] for item in records] == ["resume.pdf", "notes.md"]

        with app.state.session_factory() as session:
            rows = session.scalars(select(UserDataset)).all()
            assert len(rows) == 2
            assert all(row.user_id == 1 for row in rows)
            tasks = session.scalars(select(DocumentParseTask)).all()
            assert len(tasks) == 2
            assert all(task.source_type == "dataset" for task in tasks)
            assert all(task.upload_status == "succeeded" for task in tasks)
            assert all(task.parse_status == "queued" for task in tasks)
            assert {row.parse_task_id for row in rows} == {task.id for task in tasks}
            object_names = [row.object_name for row in rows]

        assert len(app.state.test_publisher.messages) == 2

        assert len(storage.objects) == 2
        for object_name in object_names:
            assert object_name in storage.objects
            assert object_name.startswith("users/1/datasets/")


def test_upload_requires_canonical_idempotency_key() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        missing = client.post(
            "/api/datasets",
            files={"file": ("notes.md", b"# Zhang San", "text/markdown")},
        )
        invalid = upload_file(client, idempotency_key="not-a-uuid")

    assert missing.status_code == 400
    assert missing.json() == {"error": "INVALID_IDEMPOTENCY_KEY"}
    assert invalid.status_code == 400
    assert invalid.json() == {"error": "INVALID_IDEMPOTENCY_KEY"}


def test_upload_replay_returns_same_dataset_without_duplicate_side_effects() -> None:
    app = build_test_app()
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        first = upload_file(client, idempotency_key=key)
        replay = upload_file(client, idempotency_key=key)

    assert first.status_code == replay.status_code == 202
    assert first.json()["id"] == replay.json()["id"]
    with app.state.session_factory() as session:
        assert len(session.scalars(select(UserDataset)).all()) == 1
        assert len(session.scalars(select(DocumentParseTask)).all()) == 1
    assert len(app.state.storage.objects) == 1
    assert len(app.state.test_publisher.messages) == 1


def test_upload_replay_returns_200_for_terminal_success() -> None:
    app = build_test_app()
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        first = upload_file(client, idempotency_key=key)
        dataset_id = int(first.json()["id"])
        mark_dataset_succeeded(app, dataset_id)
        replay = upload_file(client, idempotency_key=key)

    assert replay.status_code == 200
    assert replay.json()["id"] == str(dataset_id)
    assert replay.json()["parse_status"] == "succeeded"
    assert len(app.state.test_publisher.messages) == 1


def test_upload_rejects_reused_key_for_different_file() -> None:
    app = build_test_app()
    key = str(uuid4())
    with TestClient(app) as client:
        register(client)
        assert upload_file(client, content=b"first", idempotency_key=key).status_code == 202
        conflict = upload_file(client, content=b"second", idempotency_key=key)

    assert conflict.status_code == 409
    assert conflict.json() == {"error": "IDEMPOTENCY_KEY_REUSED"}
    with app.state.session_factory() as session:
        assert len(session.scalars(select(UserDataset)).all()) == 1


def test_failed_upload_replay_requires_a_new_idempotency_key() -> None:
    app = build_test_app()
    key = str(uuid4())
    storage = app.state.storage
    original_upload_stream = storage.upload_stream

    def fail_upload(*_args, **_kwargs):
        raise RuntimeError("minio unavailable")

    storage.upload_stream = fail_upload
    with TestClient(app) as client:
        register(client)
        failed = upload_file(client, idempotency_key=key)
        storage.upload_stream = original_upload_stream
        replay = upload_file(client, idempotency_key=key)
        retried = upload_file(client, idempotency_key=str(uuid4()))

    assert failed.status_code == 502
    assert replay.status_code == 409
    assert replay.json() == {"error": "DATASET_UPLOAD_PREVIOUSLY_FAILED"}
    assert retried.status_code == 202


def test_upload_enforces_server_count_and_total_byte_capacity() -> None:
    count_app = build_test_app(dataset_max_count_per_user=1)
    with TestClient(count_app) as client:
        register(client)
        assert upload_file(client).status_code == 202
        count_conflict = upload_file(client, filename="other.md")
    assert count_conflict.status_code == 409
    assert count_conflict.json() == {"error": "DATASET_COUNT_LIMIT_REACHED"}

    bytes_app = build_test_app(
        max_bytes=4,
        dataset_max_total_bytes_per_user=6,
    )
    with TestClient(bytes_app) as client:
        register(client)
        assert upload_file(client, content=b"1234").status_code == 202
        bytes_conflict = upload_file(client, filename="other.md", content=b"123")
    assert bytes_conflict.status_code == 409
    assert bytes_conflict.json() == {"error": "DATASET_STORAGE_LIMIT_REACHED"}


def test_upload_enforces_server_request_rate() -> None:
    app = build_test_app(dataset_upload_requests_per_minute=1)
    with TestClient(app) as client:
        register(client)
        assert upload_file(client).status_code == 202
        limited = upload_file(client, filename="other.md")

    assert limited.status_code == 429
    assert limited.json() == {"error": "DATASET_UPLOAD_RATE_LIMITED"}
    assert limited.headers["Retry-After"] == "60"


def test_upload_rejects_unsupported_format() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        response = upload_file(
            client,
            filename="malware.exe",
            content=b"MZ",
            content_type="application/octet-stream",
        )
    assert response.status_code == 400
    assert response.json() == {"error": "UNSUPPORTED_DATASET_FILE"}


def test_upload_rejects_oversize_file() -> None:
    app = build_test_app(max_bytes=4)
    with TestClient(app) as client:
        register(client)
        response = upload_file(client, content=b"too large content")
    assert response.status_code == 413
    assert response.json() == {"error": "DATASET_FILE_TOO_LARGE"}


def test_upload_requires_auth() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        response = upload_file(client)
        listed = client.get("/api/datasets")
    assert response.status_code == 401
    assert listed.status_code == 401


def test_list_only_returns_own_datasets() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client, email="alice@example.com")
        upload_file(client, filename="alice.md")

        register(client, email="bob@example.com")
        upload_file(client, filename="bob.md")

        listed = client.get("/api/datasets")
        assert listed.status_code == 200
        records = listed.json()["datasets"]
        assert [item["file_name"] for item in records] == ["bob.md"]
        with app.state.session_factory() as session:
            bob = session.scalar(select(User).where(User.email == "bob@example.com"))
            assert bob is not None
            alice = session.scalar(
                select(User).where(User.email == "alice@example.com")
            )
            assert alice is not None
            rows = session.scalars(select(UserDataset)).all()
            by_name = {row.file_name: row.user_id for row in rows}
            assert by_name == {"alice.md": alice.id, "bob.md": bob.id}


def test_read_parsed_dataset_content() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client, filename="notes.md")
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_succeeded(app, dataset_id, "# 解析结果\n\n张三".encode())

        response = client.get(f"/api/datasets/{dataset_id}/content")

    assert response.status_code == 200
    assert response.json() == {
        "id": str(dataset_id),
        "file_name": "notes.md",
        "file_format": "md",
        "markdown": "# 解析结果\n\n张三",
    }


def test_read_dataset_content_requires_successful_parse() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)

        response = client.get(f"/api/datasets/{uploaded.json()['id']}/content")

    assert response.status_code == 409
    assert response.json() == {"error": "DATASET_CONTENT_UNAVAILABLE"}


def test_read_dataset_content_requires_converted_object_for_success_state() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            task = session.get(DocumentParseTask, dataset.parse_task_id)
            assert task is not None
            task.parse_status = "succeeded"
            task.parse_duration_ms = 1
            task.converted_object_name = None
            session.commit()

        response = client.get(f"/api/datasets/{dataset_id}/content")

    assert response.status_code == 409
    assert response.json() == {"error": "DATASET_CONTENT_UNAVAILABLE"}


def test_read_dataset_content_hides_other_users_records() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client, email="alice@example.com")
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_succeeded(app, dataset_id)
        register(client, email="bob@example.com")

        response = client.get(f"/api/datasets/{dataset_id}/content")

    assert response.status_code == 404
    assert response.json() == {"error": "DATASET_NOT_FOUND"}


def test_read_dataset_content_reports_storage_failure() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_succeeded(app, dataset_id)
        app.state.storage.objects.clear()

        response = client.get(f"/api/datasets/{dataset_id}/content")

    assert response.status_code == 502
    assert response.json() == {"error": "DATASET_CONTENT_READ_FAILED"}


def test_read_dataset_content_rejects_object_outside_user_prefix() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_succeeded(app, dataset_id)
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            task = session.get(DocumentParseTask, dataset.parse_task_id)
            assert task is not None
            task.converted_object_name = "users/2/datasets/converted/private.md"
            session.commit()
        app.state.storage.objects["users/2/datasets/converted/private.md"] = b"private"

        response = client.get(f"/api/datasets/{dataset_id}/content")

    assert response.status_code == 502
    assert response.json() == {"error": "DATASET_CONTENT_READ_FAILED"}


def test_upload_storage_failure_keeps_hidden_failed_reservation() -> None:
    app = build_test_app()
    storage = app.state.storage

    def boom(*_args, **_kwargs):
        raise RuntimeError("minio unavailable")

    storage.upload_stream = boom
    with TestClient(app) as client:
        register(client)
        response = upload_file(client)
        assert response.status_code == 502
        assert response.json() == {"error": "DATASET_STORAGE_UNAVAILABLE"}
        listed = client.get("/api/datasets")
        assert listed.json()["datasets"] == []
        with app.state.session_factory() as session:
            dataset = session.scalar(select(UserDataset))
            assert dataset is not None
            task = session.get(DocumentParseTask, dataset.parse_task_id)
            assert task is not None
            assert task.upload_status == "failed"
            assert task.parse_status is None


def test_queue_failure_keeps_task_queued_and_returns_202() -> None:
    app = build_test_app()
    app.state.test_publisher.fail = True
    with TestClient(app) as client:
        register(client)
        response = upload_file(client)
        assert response.status_code == 202
        assert response.json()["parse_status"] == "queued"
        with app.state.session_factory() as session:
            task = session.scalar(select(DocumentParseTask))
            assert task is not None
            assert task.upload_status == "succeeded"
            assert task.parse_status == "queued"
            assert task.failure_reason is None
            assert task.last_dispatched_at is None


def test_queue_failure_keeps_source_object_and_visible_queued_record() -> None:
    app = build_test_app()
    app.state.test_publisher.fail = True
    with TestClient(app) as client:
        register(client)
        response = upload_file(client)
        assert response.status_code == 202
        listed = client.get("/api/datasets")
        assert listed.status_code == 200
        assert listed.json()["datasets"][0]["parse_status"] == "queued"
        assert listed.json()["datasets"][0]["failure_reason"] is None

        with app.state.session_factory() as session:
            dataset = session.scalar(select(UserDataset))
            assert dataset is not None
            task = session.get(DocumentParseTask, dataset.parse_task_id)
            assert task is not None
            assert task.parse_status == "queued"
            source_object = dataset.object_name
        assert source_object in app.state.storage.objects


def test_rename_dataset_only_changes_display_filename() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client, filename="notes.md")
        dataset_id = int(uploaded.json()["id"])
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            task = session.get(DocumentParseTask, dataset.parse_task_id)
            assert task is not None
            object_name = dataset.object_name
            task_file_name = task.file_name

        response = client.patch(
            f"/api/datasets/{dataset_id}",
            json={"name": "岗位要求"},
        )

    assert response.status_code == 200
    assert response.json()["file_name"] == "岗位要求.md"
    with app.state.session_factory() as session:
        dataset = session.get(UserDataset, dataset_id)
        assert dataset is not None
        task = session.get(DocumentParseTask, dataset.parse_task_id)
        assert task is not None
        assert dataset.file_name == "岗位要求.md"
        assert task.file_name == task_file_name == "notes.md"
        assert dataset.object_name == object_name
    assert object_name in app.state.storage.objects


def test_rename_dataset_rejects_invalid_name_and_hides_foreign_record() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client, email="alice@example.com")
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        assert client.patch(
            f"/api/datasets/{dataset_id}",
            json={"name": "   "},
        ).json() == {"error": "INVALID_DATASET_NAME"}
        assert client.patch(
            f"/api/datasets/{dataset_id}",
            json={"name": "bad\nname"},
        ).json() == {"error": "INVALID_DATASET_NAME"}

        register(client, email="bob@example.com")
        foreign = client.patch(
            f"/api/datasets/{dataset_id}",
            json={"name": "不可见"},
        )

    assert foreign.status_code == 404
    assert foreign.json() == {"error": "DATASET_NOT_FOUND"}
    with app.state.session_factory() as session:
        dataset = session.get(UserDataset, dataset_id)
        assert dataset is not None
        assert dataset.file_name == "notes.md"


def test_retry_failed_dataset_reuses_source_and_enters_queue() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_failed(app, dataset_id)
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            source_object = dataset.object_name

        app.state.test_publisher.messages.clear()
        retried = client.post(f"/api/datasets/{dataset_id}/retry")

    assert retried.status_code == 202
    payload = retried.json()
    assert payload["id"] == str(dataset_id)
    assert payload["upload_status"] == "succeeded"
    assert payload["parse_status"] == "queued"
    assert source_object in app.state.storage.objects
    assert len(app.state.test_publisher.messages) == 1


def test_retry_dataset_rejects_processing_and_successful_tasks() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        conflict = client.post(f"/api/datasets/{dataset_id}/retry")
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "DATASET_NOT_RETRYABLE"}

        mark_dataset_succeeded(app, dataset_id)
        terminal = client.post(f"/api/datasets/{dataset_id}/retry")

    assert terminal.status_code == 409
    assert terminal.json() == {"error": "DATASET_NOT_RETRYABLE"}


def test_retry_dataset_source_missing_does_not_enter_queue() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_failed(app, dataset_id)
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            source_object = dataset.object_name
        app.state.storage.objects.pop(source_object)
        retry = client.post(f"/api/datasets/{dataset_id}/retry")

    assert retry.status_code == 502
    assert retry.json() == {"error": "DATASET_SOURCE_UNAVAILABLE"}
    with app.state.session_factory() as session:
        task = session.scalar(select(DocumentParseTask))
        assert task is not None
        assert task.parse_status == "failed"
        assert task.failure_reason == "content_invalid"


def test_retry_queue_failure_returns_202_and_keeps_queued_state() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_failed(app, dataset_id)
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
        app.state.test_publisher.fail = True
        retry = client.post(f"/api/datasets/{dataset_id}/retry")

    assert retry.status_code == 202
    assert retry.json()["parse_status"] == "queued"
    with app.state.session_factory() as session:
        task = session.scalar(select(DocumentParseTask))
        assert task is not None
        assert task.upload_status == "succeeded"
        assert task.parse_status == "queued"
        assert task.failure_reason is None


def test_delete_dataset_rejects_processing_and_cleans_failed_terminal_state() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        processing = upload_file(client)
        assert processing.status_code == 202
        with app.state.session_factory() as session:
            dataset = session.scalar(select(UserDataset))
            assert dataset is not None
            dataset_id = dataset.id
            task_id = dataset.parse_task_id
            task = session.get(DocumentParseTask, task_id)
            assert task is not None
            source_object = dataset.object_name
            task.parse_status = "processing"
            task.parse_duration_ms = None
            task.failure_reason = None
            session.commit()

        conflict = client.delete(f"/api/datasets/{dataset_id}")
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "DATASET_BUSY"}
        with app.state.session_factory() as session:
            task = session.get(DocumentParseTask, task_id)
            assert task is not None
            task.parse_status = "failed"
            task.parse_duration_ms = 1
            task.failure_reason = "service_unavailable"
            session.commit()
        deleted = client.delete(f"/api/datasets/{dataset_id}")
        repeated = client.delete(f"/api/datasets/{dataset_id}")

    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert source_object not in app.state.storage.objects
    with app.state.session_factory() as session:
        assert session.get(UserDataset, dataset_id) is None
        assert session.get(DocumentParseTask, task_id) is None
    assert repeated.status_code == 404


def test_delete_successful_dataset_cleans_source_and_converted_objects() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_succeeded(app, dataset_id)
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            task = session.get(DocumentParseTask, dataset.parse_task_id)
            assert task is not None
            task_id = task.id
            source_object = dataset.object_name
            converted_object = task.converted_object_name
        deleted = client.delete(f"/api/datasets/{dataset_id}")

    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert source_object not in app.state.storage.objects
    assert converted_object not in app.state.storage.objects
    with app.state.session_factory() as session:
        assert session.get(UserDataset, dataset_id) is None
        assert session.get(DocumentParseTask, task_id) is None


def test_delete_failed_dataset_cleans_unrecorded_converted_object() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        assert uploaded.status_code == 202
        dataset_id = int(uploaded.json()["id"])
        mark_dataset_failed(app, dataset_id)
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            task = session.get(DocumentParseTask, dataset.parse_task_id)
            assert task is not None
            assert task.converted_object_name is None
            converted_object = f"users/1/datasets/converted/{task.id}.md"
        app.state.storage.objects[converted_object] = b"partially persisted"

        deleted = client.delete(f"/api/datasets/{dataset_id}")

    assert deleted.status_code == 200
    assert converted_object not in app.state.storage.objects


def test_delete_storage_failure_keeps_dataset_and_task() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        uploaded = upload_file(client)
        dataset_id = int(uploaded.json()["id"])
        # Move the already queued task to a terminal failed state so deletion is allowed.
        with app.state.session_factory() as session:
            dataset = session.get(UserDataset, dataset_id)
            assert dataset is not None
            task_id = dataset.parse_task_id
        mark_dataset_failed(app, dataset_id)
        app.state.storage.fail_cleanup = True
        response = client.delete(f"/api/datasets/{dataset_id}")

    assert response.status_code == 502
    assert response.json() == {"error": "ASSET_DELETE_FAILED"}
    with app.state.session_factory() as session:
        assert session.get(UserDataset, dataset_id) is not None
        assert session.get(DocumentParseTask, task_id) is not None


def test_record_failure_cleans_uploaded_object(monkeypatch) -> None:
    app = build_test_app()
    storage = app.state.storage
    with TestClient(app) as client:
        register(client)

        def failing_commit(_self) -> None:
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(Session, "commit", failing_commit)
        response = upload_file(client)
        assert response.status_code == 500
        assert response.json() == {"error": "DATASET_RECORD_FAILED"}
        assert storage.objects == {}
        with app.state.session_factory() as session:
            assert session.scalar(select(UserDataset)) is None


def test_empty_file_is_rejected() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        response = upload_file(client, content=b"")
    assert response.status_code == 400
    assert response.json() == {"error": "EMPTY_DATASET_FILE"}


def test_path_in_filename_is_stripped() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        response = upload_file(client, filename="../notes/escape.md")
        assert response.status_code == 202
        assert response.json()["file_name"] == "escape.md"


def test_folder_crud_and_validation() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)

        # 1. Create folder
        res = client.post("/api/datasets/folders", json={"name": "Projects"})
        assert res.status_code == 201
        folder = res.json()
        assert folder["name"] == "Projects"
        assert folder["dataset_count"] == 0
        folder_id = folder["id"]

        # 2. Duplicate folder name -> 409
        dup = client.post("/api/datasets/folders", json={"name": "Projects"})
        assert dup.status_code == 409
        assert dup.json() == {"error": "FOLDER_NAME_DUPLICATE"}

        # 3. Invalid names -> 400
        for bad_name in ["", "   ", "a/b", "a\\b", "x" * 65]:
            bad = client.post("/api/datasets/folders", json={"name": bad_name})
            assert bad.status_code == 400
            assert bad.json() == {"error": "INVALID_FOLDER_NAME"}

        # 4. Rename folder
        renamed = client.patch(f"/api/datasets/folders/{folder_id}", json={"name": "Work Projects"})
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Work Projects"

        # 5. Rename to duplicate of another folder
        client.post("/api/datasets/folders", json={"name": "Other"})
        dup_rename = client.patch(f"/api/datasets/folders/{folder_id}", json={"name": "Other"})
        assert dup_rename.status_code == 409
        assert dup_rename.json() == {"error": "FOLDER_NAME_DUPLICATE"}

        # 6. Rename non-existent folder
        not_found = client.patch("/api/datasets/folders/99999", json={"name": "New Name"})
        assert not_found.status_code == 404
        assert not_found.json() == {"error": "FOLDER_NOT_FOUND"}

        # 7. Delete folder
        deleted = client.delete(f"/api/datasets/folders/{folder_id}")
        assert deleted.status_code == 200
        assert deleted.json()["deleted"] is True

        # 8. Delete non-existent folder
        not_found_del = client.delete("/api/datasets/folders/99999")
        assert not_found_del.status_code == 404


def test_folder_counts_and_deletion_safe_unlinking() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)

        # Create folder
        f_res = client.post("/api/datasets/folders", json={"name": "Certificates"})
        assert f_res.status_code == 201
        folder_id = f_res.json()["id"]

        # Upload 1 file into folder, 1 file without folder
        up1 = upload_file(client, filename="cert.pdf", content=valid_pdf(), content_type="application/pdf", data={"folder_id": folder_id})
        assert up1.status_code == 202
        file1_id = int(up1.json()["id"])
        assert up1.json()["folder_id"] == folder_id

        up2 = upload_file(client, filename="notes.md", content=b"# Notes")
        assert up2.status_code == 202
        file2_id = int(up2.json()["id"])
        assert up2.json()["folder_id"] is None

        # Mark both succeeded
        mark_dataset_succeeded(app, file1_id)
        mark_dataset_succeeded(app, file2_id)

        # Check list folders & counts
        list_f = client.get("/api/datasets/folders")
        assert list_f.status_code == 200
        data = list_f.json()
        assert data["total_count"] == 2
        assert data["uncategorized_count"] == 1
        assert len(data["folders"]) == 1
        assert data["folders"][0]["id"] == folder_id
        assert data["folders"][0]["dataset_count"] == 1

        # Check filtered lists
        in_folder = client.get(f"/api/datasets?folder_id={folder_id}")
        assert len(in_folder.json()["datasets"]) == 1
        assert in_folder.json()["datasets"][0]["id"] == str(file1_id)

        uncat = client.get("/api/datasets?folder_id=uncategorized")
        assert len(uncat.json()["datasets"]) == 1
        assert uncat.json()["datasets"][0]["id"] == str(file2_id)

        all_ds = client.get("/api/datasets")
        assert len(all_ds.json()["datasets"]) == 2

        # Delete folder -> file1 should be unlinked, not deleted!
        del_res = client.delete(f"/api/datasets/folders/{folder_id}")
        assert del_res.status_code == 200
        assert del_res.json()["affected_dataset_count"] == 1

        # Now folders list is empty, both files are uncategorized
        after_del = client.get("/api/datasets/folders")
        assert after_del.json()["total_count"] == 2
        assert after_del.json()["uncategorized_count"] == 2
        assert len(after_del.json()["folders"]) == 0

        # Verify dataset records still exist
        all_ds_after = client.get("/api/datasets")
        assert len(all_ds_after.json()["datasets"]) == 2
        for ds in all_ds_after.json()["datasets"]:
            assert ds["folder_id"] is None


def test_move_single_and_batch_datasets() -> None:
    app = build_test_app()
    with TestClient(app) as client:
        register(client)

        f1 = client.post("/api/datasets/folders", json={"name": "Folder 1"}).json()
        f2 = client.post("/api/datasets/folders", json={"name": "Folder 2"}).json()

        up1 = upload_file(client, filename="f1.md", content=b"# F1")
        up2 = upload_file(client, filename="f2.md", content=b"# F2")
        d1_id = up1.json()["id"]
        d2_id = up2.json()["id"]

        # Move single dataset to Folder 1
        move_res = client.patch(f"/api/datasets/{d1_id}/folder", json={"folder_id": f1["id"]})
        assert move_res.status_code == 200
        assert move_res.json()["folder_id"] == f1["id"]

        # Move single dataset to None (uncategorized)
        unmove_res = client.patch(f"/api/datasets/{d1_id}/folder", json={"folder_id": None})
        assert unmove_res.status_code == 200
        assert unmove_res.json()["folder_id"] is None

        # Move with invalid folder ID -> 404 or 400
        invalid_f = client.patch(f"/api/datasets/{d1_id}/folder", json={"folder_id": "99999"})
        assert invalid_f.status_code == 404

        # Batch move d1 and d2 to Folder 2
        batch_res = client.post("/api/datasets/move-batch", json={"dataset_ids": [d1_id, d2_id], "folder_id": f2["id"]})
        assert batch_res.status_code == 200
        assert batch_res.json()["moved_count"] == 2

        # Check in Folder 2
        in_f2 = client.get(f"/api/datasets?folder_id={f2['id']}").json()
        assert len(in_f2["datasets"]) == 2

        # Batch move back to uncategorized
        batch_unmove = client.post("/api/datasets/move-batch", json={"dataset_ids": [d1_id, d2_id], "folder_id": None})
        assert batch_unmove.status_code == 200
        assert batch_unmove.json()["moved_count"] == 2

        # Check uncategorized
        uncat = client.get("/api/datasets?folder_id=uncategorized").json()
        assert len(uncat["datasets"]) == 2


def test_cross_user_folder_isolation() -> None:
    app = build_test_app()
    with TestClient(app) as client1:
        register(client1, email="user1@example.com")
        f1 = client1.post("/api/datasets/folders", json={"name": "User 1 Folder"}).json()
        up1 = upload_file(client1, filename="user1.md")
        d1_id = up1.json()["id"]

    with TestClient(app) as client2:
        register(client2, email="user2@example.com")
        # User 2 cannot see User 1's folder in list
        f_list = client2.get("/api/datasets/folders").json()
        assert len(f_list["folders"]) == 0

        # User 2 cannot rename User 1's folder
        rename_attempt = client2.patch(f"/api/datasets/folders/{f1['id']}", json={"name": "Hacked"})
        assert rename_attempt.status_code == 404

        # User 2 cannot delete User 1's folder
        del_attempt = client2.delete(f"/api/datasets/folders/{f1['id']}")
        assert del_attempt.status_code == 404

        # User 2 cannot move their own file into User 1's folder
        up2 = upload_file(client2, filename="user2.md")
        d2_id = up2.json()["id"]
        move_attempt = client2.patch(f"/api/datasets/{d2_id}/folder", json={"folder_id": f1["id"]})
        assert move_attempt.status_code == 404

        # User 2 cannot move User 1's dataset
        user1_move_attempt = client2.patch(f"/api/datasets/{d1_id}/folder", json={"folder_id": None})
        assert user1_move_attempt.status_code == 404

