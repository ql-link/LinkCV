from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.mq import MQPublishError
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

    def get(self, object_name: str) -> FakeObjectResponse:
        return FakeObjectResponse(self.objects[object_name])

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


def build_test_app(max_bytes: int | None = None):
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="integration-test-secret-with-32-bytes",
    )
    if max_bytes is not None:
        settings.dataset_upload_max_bytes = max_bytes
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
):
    return client.post(
        "/api/datasets",
        files={"file": (filename, content, content_type)},
    )


def mark_dataset_succeeded(app, dataset_id: int, markdown: bytes = b"# Parsed") -> None:
    converted_object_name = f"users/1/datasets/converted/{dataset_id}.md"
    with app.state.session_factory() as session:
        dataset = session.get(UserDataset, dataset_id)
        assert dataset is not None
        task = session.get(DocumentParseTask, dataset.parse_task_id)
        assert task is not None
        task.upload_status = "succeeded"
        task.upload_duration_ms = 1
        task.parse_status = "succeeded"
        task.parse_duration_ms = 1
        task.converted_object_name = converted_object_name
        session.commit()
    app.state.storage.objects[converted_object_name] = markdown


def test_upload_and_list_own_datasets() -> None:
    app = build_test_app()
    storage = app.state.storage
    with TestClient(app) as client:
        register(client)
        first = upload_file(client, filename="notes.md", content=b"# Zhang San")
        assert first.status_code == 201
        payload = first.json()
        assert payload["id"].isdecimal()
        assert payload["file_name"] == "notes.md"
        assert payload["file_format"] == "md"
        assert payload["file_size"] == len(b"# Zhang San")
        assert payload["upload_status"] == "uploading"
        assert payload["parse_status"] is None
        assert payload["failure_reason"] is None
        assert "sha256" not in payload
        assert "object_name" not in payload
        assert "created_at" in payload

        second = upload_file(
            client,
            filename="resume.pdf",
            content=b"%PDF-1.7 sample",
            content_type="application/pdf",
        )
        assert second.status_code == 201

        listed = client.get("/api/datasets")
        assert listed.status_code == 200
        records = listed.json()["datasets"]
        assert [item["file_name"] for item in records] == ["resume.pdf", "notes.md"]

        with app.state.session_factory() as session:
            rows = session.scalars(select(UserDataset)).all()
            assert len(rows) == 2
            assert all(row.user_id == 1 for row in rows)
            tasks = session.scalars(select(DocumentParseTask)).all()
            assert len(tasks) == 2
            assert all(task.source_type == "dataset" for task in tasks)
            assert all(task.upload_status == "uploading" for task in tasks)
            assert all(task.parse_status is None for task in tasks)
            assert {row.parse_task_id for row in rows} == {task.id for task in tasks}
            object_names = [row.object_name for row in rows]

        assert len(app.state.test_publisher.messages) == 2

        assert len(storage.objects) == 2
        for object_name in object_names:
            assert object_name in storage.objects
            assert object_name.startswith("users/1/datasets/")


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
    assert response.json() == {"error": "UNSUPPORTED_DATASET_FORMAT"}


def test_upload_rejects_oversize_file() -> None:
    app = build_test_app(max_bytes=4)
    with TestClient(app) as client:
        register(client)
        response = upload_file(client, content=b"too large content")
    assert response.status_code == 413
    assert response.json() == {"error": "DATASET_TOO_LARGE"}


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


def test_upload_storage_failure_does_not_write_record() -> None:
    app = build_test_app()
    storage = app.state.storage

    def boom(*_args, **_kwargs):
        raise RuntimeError("minio unavailable")

    storage.upload = boom
    with TestClient(app) as client:
        register(client)
        response = upload_file(client)
        assert response.status_code == 502
        assert response.json() == {"error": "DATASET_UPLOAD_FAILED"}
        with app.state.session_factory() as session:
            assert session.scalar(select(UserDataset)) is None


def test_queue_failure_marks_task_failed_and_returns_502() -> None:
    app = build_test_app()
    app.state.test_publisher.fail = True
    with TestClient(app) as client:
        register(client)
        response = upload_file(client)
        assert response.status_code == 502
        assert response.json() == {"error": "DATASET_QUEUE_UNAVAILABLE"}
        with app.state.session_factory() as session:
            task = session.scalar(select(DocumentParseTask))
            assert task is not None
            assert task.upload_status == "failed"
            assert task.parse_status is None


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
        assert response.status_code == 201
        assert response.json()["file_name"] == "escape.md"
