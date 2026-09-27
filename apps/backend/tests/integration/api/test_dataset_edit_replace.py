from time import monotonic
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.resumes.models import DocumentParseTask
from linkresume.workers.dataset_parse_worker import DatasetParseProcessor
from tests.integration.api.test_user_datasets import (
    build_test_app, register, upload_file, mark_dataset_succeeded,
)


def ready(client, app):
    result = upload_file(client)
    assert result.status_code == 202
    identifier = result.json()["id"]
    mark_dataset_succeeded(app, int(identifier), b"# Original")
    return identifier


def replace(client, identifier, key=None, revision="0", content=b"# Replacement"):
    return client.put(
        f"/api/datasets/{identifier}/file",
        files={"file": ("notes.md", content, "text/markdown")},
        data={"confirm_replace": "true"},
        headers={"If-Match": f'"dataset-{identifier}-{revision}"', "Idempotency-Key": key or str(uuid4())},
    )


def complete(app, identifier, text="# Replacement"):
    with app.state.session_factory() as db:
        dataset = db.get(UserDataset, int(identifier))
        task = db.get(DocumentParseTask, dataset.parse_task_id)
        task.parse_status = "processing"
        task.parse_duration_ms = None
        task.parse_attempt_count = 1
        task_id, user_id = task.id, task.user_id
        db.commit()
    processor = DatasetParseProcessor(
        session_factory=app.state.session_factory, storage=app.state.storage,
        redis=app.state.redis, document_converter=None, settings=app.state.settings,
    )
    assert processor._persist_success(parse_task_id=task_id, user_id=user_id, markdown=text, started=monotonic(), attempt=1)


def test_replacement_deletes_old_files_before_upload_and_keeps_identity(monkeypatch):
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        collision = upload_file(client)
        assert collision.status_code == 409
        assert collision.json()["candidates"][0]["id"] == identifier
        assert collision.json()["suggested_name"] == "notes (1).md"
        before = client.get(f"/api/datasets/{identifier}").json()
        old_keys = set(app.state.storage.objects)
        upload = app.state.storage.upload_stream
        def upload_after_delete(*args, **kwargs):
            assert not old_keys.intersection(app.state.storage.objects)
            return upload(*args, **kwargs)
        monkeypatch.setattr(app.state.storage, "upload_stream", upload_after_delete)
        key = str(uuid4())
        result = replace(client, identifier, key)
        assert result.status_code == 202, result.text
        assert result.json()["id"] == identifier
        assert result.json()["folder_id"] == before["folder_id"]
        assert result.json()["parse_status"] == "queued"
        assert "replacement" not in result.json()
        assert client.get(f"/api/datasets/{identifier}/content").status_code == 409
        assert replace(client, identifier, key).status_code == 202
        assert replace(client, identifier, key, content=b"changed").status_code == 409
        assert replace(client, identifier, revision="1").status_code == 409
        assert client.delete(f"/api/datasets/{identifier}").status_code == 409
        with app.state.session_factory() as db:
            assert len(list(db.scalars(select(DocumentParseTask)))) == 1
        complete(app, identifier)
        current = client.get(f"/api/datasets/{identifier}").json()
        assert current["content_revision"] == "2"
        assert client.get(f"/api/datasets/{identifier}/content").json()["markdown"] == "# Replacement"
        assert len(client.get("/api/datasets").json()["datasets"]) == 1
        assert replace(client, identifier, key).status_code == 200


def test_failed_parse_keeps_new_source_and_uses_normal_retry():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        old_keys = set(app.state.storage.objects)
        assert replace(client, identifier).status_code == 202
        with app.state.session_factory() as db:
            dataset = db.get(UserDataset, int(identifier))
            task = db.get(DocumentParseTask, dataset.parse_task_id)
            source = task.object_name
            task.parse_status = "failed"
            task.parse_duration_ms = 1
            task.failure_reason = "service_unavailable"
            db.commit()
        assert not old_keys.intersection(app.state.storage.objects)
        assert app.state.storage.objects[source] == b"# Replacement"
        assert client.get(f"/api/datasets/{identifier}/content").status_code == 409
        assert client.get(f"/api/datasets/{identifier}").json()["parse_status"] == "failed"
        retried = client.post(f"/api/datasets/{identifier}/retry")
        assert retried.status_code == 202, retried.text
        complete(app, identifier)
        assert client.get(f"/api/datasets/{identifier}/content").json()["markdown"] == "# Replacement"


def test_invalid_file_or_stale_revision_does_not_delete_old_files():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        before = dict(app.state.storage.objects)
        assert replace(client, identifier, content=b"\x00").status_code == 400
        assert replace(client, identifier, revision="99").status_code == 412
        assert app.state.storage.objects == before


def test_storage_delete_failure_stops_replacement():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        before = dict(app.state.storage.objects)
        app.state.storage.fail_cleanup = True
        assert replace(client, identifier).status_code == 502
        assert app.state.storage.objects == before
        assert client.get(f"/api/datasets/{identifier}").json()["content_revision"] == "0"


def test_upload_failure_does_not_restore_deleted_content(monkeypatch):
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        def fail(*args, **kwargs):
            raise RuntimeError("storage unavailable")
        monkeypatch.setattr(app.state.storage, "upload_stream", fail)
        assert replace(client, identifier).status_code == 502
        assert app.state.storage.objects == {}
        assert client.get(f"/api/datasets/{identifier}").json()["upload_status"] == "failed"
        assert client.get(f"/api/datasets/{identifier}/content").status_code == 409


def test_cross_user_content_and_replacement_are_hidden():
    app = build_test_app()
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner)
        identifier = ready(owner, app)
        before = dict(app.state.storage.objects)
        register(other, "unrelated@example.invalid")
        assert other.get(f"/api/datasets/{identifier}").status_code == 404
        assert replace(other, identifier).status_code == 404
        assert app.state.storage.objects == before


def test_agent_reads_new_content_and_rejects_previous_reference():
    from linkresume.core.errors import ApiError
    from linkresume.modules.agent.resume_tools import search_materials, validate_source_ids
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        def search():
            with app.state.session_factory() as db:
                return search_materials(db, user_id=1, query="", types=["dataset"], limit=10, storage=app.state.storage, max_bytes=2097152)
        original = search()[0]["source_id"]
        assert replace(client, identifier).status_code == 202
        complete(app, identifier, "# Replaced reference")
        updated = search()[0]
        assert updated["source_id"] != original
        with app.state.session_factory() as db:
            assert validate_source_ids(db, user_id=1, source_ids=[updated["source_id"]])
            with pytest.raises(ApiError):
                validate_source_ids(db, user_id=1, source_ids=[original])


@pytest.mark.parametrize("delete_folder", [False, True])
def test_delete_synchronously_removes_all_content_objects(delete_folder):
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        assert replace(client, identifier).status_code == 202
        complete(app, identifier)
        with app.state.session_factory() as db:
            dataset = db.get(UserDataset, int(identifier))
            dataset.content_object_name = f"users/1/datasets/converted/fictional-custom.md"
            app.state.storage.objects[dataset.content_object_name] = b"custom"
            folder = dataset.folder_id
            db.commit()
        path = f"/api/datasets/folders/{folder}?confirm_contents=true" if delete_folder else f"/api/datasets/{identifier}"
        response = client.delete(path)
        assert response.status_code == 200, response.text
        assert app.state.storage.objects == {}
        with app.state.session_factory() as db:
            assert db.scalar(select(DocumentParseTask)) is None
            assert db.scalar(select(UserDataset)) is None


def test_dataset_content_is_read_only():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        assert client.put(f"/api/datasets/{identifier}/content", json={"markdown": "changed"}).status_code == 404
        assert client.get(f"/api/datasets/{identifier}/content").json()["markdown"] == "# Original"


def test_replacement_preserves_interview_association():
    from tests.integration.api.test_interviews import create_application, create_job, session_payload
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        application = create_application(client, create_job(client, "虚构资料关联公司"))
        created = client.post(
            f"/api/job-applications/{application['id']}/interview-sessions",
            json=session_payload(str(uuid4())),
        )
        assert created.status_code == 201, created.text
        session_id = created.json()["session"]["id"]
        attached = client.post(f"/api/interview-sessions/{session_id}/assets/attach", json={"dataset_id": identifier})
        assert attached.status_code == 201, attached.text
        before = client.get(f"/api/datasets/{identifier}").json()
        result = replace(client, identifier, revision=before["content_revision"])
        assert result.status_code == 202, result.text
        assert result.json()["interview_session_id"] == session_id
        assert result.json()["interview_source_type"] == "uploaded"
        assert result.json()["folder_id"] == before["folder_id"]


def test_replacement_capacity_counts_only_new_file():
    app = build_test_app(max_bytes=25, dataset_max_count_per_user=2, dataset_max_total_bytes_per_user=25)
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        assert upload_file(client, filename="other.md", content=b"y" * 5).status_code == 202
        # Replacing at the count limit frees the old bytes; 20 + 5 fits exactly.
        result = replace(client, identifier, content=b"x" * 20)
        assert result.status_code == 202, result.text
        complete(app, identifier)
        before = dict(app.state.storage.objects)
        assert replace(client, identifier, revision="2", content=b"x" * 21).status_code == 409
        assert app.state.storage.objects == before


def test_old_worker_result_cannot_reappear_after_replacement():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        with app.state.session_factory() as db:
            old_task_id = db.get(UserDataset, int(identifier)).parse_task_id
        assert replace(client, identifier).status_code == 202
        current_objects = dict(app.state.storage.objects)
        processor = DatasetParseProcessor(
            session_factory=app.state.session_factory, storage=app.state.storage,
            redis=app.state.redis, document_converter=None, settings=app.state.settings,
        )
        assert not processor._persist_success(parse_task_id=old_task_id, user_id=1, markdown="# Stale", started=monotonic(), attempt=1)
        assert app.state.storage.objects == current_objects
        complete(app, identifier)
        assert client.get(f"/api/datasets/{identifier}/content").json()["markdown"] == "# Replacement"
