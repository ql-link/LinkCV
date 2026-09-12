from time import monotonic
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from linkcv.modules.datasets.models import UserDataset, DatasetReplacement
from linkcv.modules.resumes.models import DocumentParseTask
from linkcv.services.dataset_replacement_service import reconcile_replacements
from linkcv.workers.dataset_parse_worker import DatasetParseProcessor
from tests.integration.api.test_user_datasets import (
    build_test_app,
    register,
    upload_file,
    mark_dataset_succeeded,
)


def ready(client, app):
    result = upload_file(client)
    assert result.status_code == 202
    identifier = result.json()["id"]
    mark_dataset_succeeded(app, int(identifier), b"# Original")
    return identifier




def replace(client, identifier, key=None, revision="0", content=b"# Replacement"):
    return client.post(
        f"/api/datasets/{identifier}/replacements",
        files={"file": ("notes.md", content, "text/markdown")},
        data={"confirm_replace": "true"},
        headers={
            "If-Match": f'"dataset-{identifier}-{revision}"',
            "Idempotency-Key": key or str(uuid4()),
        },
    )


def complete(app, operation, text="# Replacement"):
    with app.state.session_factory() as db:
        op = db.get(DatasetReplacement, int(operation["id"]))
        task = db.get(DocumentParseTask, op.parse_task_id)
        task.parse_status = "processing"
        task.parse_duration_ms = None
        task.parse_attempt_count = 1
        task_id, user_id = task.id, task.user_id
        db.commit()
    processor = DatasetParseProcessor(
        session_factory=app.state.session_factory,
        storage=app.state.storage,
        redis=app.state.redis,
        document_converter=None,
        settings=app.state.settings,
    )
    assert processor._persist_success(
        parse_task_id=task_id,
        user_id=user_id,
        markdown=text,
        started=monotonic(),
        attempt=1,
    )






def test_same_name_returns_candidates_and_replacement_keeps_identity():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        collision = upload_file(client)
        assert collision.status_code == 409
        assert collision.json()["candidates"][0]["id"] == identifier
        assert collision.json()["suggested_name"] == "notes (1).md"
        with app.state.session_factory() as db:
            dataset = db.get(UserDataset, int(identifier))
            dataset.content_object_name = db.get(
                DocumentParseTask, dataset.parse_task_id
            ).converted_object_name
            db.commit()
        key = str(uuid4())
        created = replace(client, identifier, key)
        assert created.status_code == 202, created.text
        operation = created.json()
        assert replace(client, identifier, key).json()["id"] == operation["id"]
        assert replace(client, identifier, key, content=b"changed").status_code == 409
        assert client.delete(f"/api/datasets/{identifier}").status_code == 409
        complete(app, operation)
        result = client.get(f"/api/datasets/{identifier}").json()
        assert result["id"] == identifier and result["content_revision"] == "1"
        assert result["replacement"] is None
        assert (
            client.get(f"/api/datasets/{identifier}/content").json()["markdown"]
            == "# Replacement"
        )
        assert len(client.get("/api/datasets").json()["datasets"]) == 1
        assert replace(client, identifier, key).json()["status"] == "applied"


def test_failed_replacement_restores_old_content_and_retries_saved_source():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        operation = replace(client, identifier).json()
        with app.state.session_factory() as db:
            op = db.get(DatasetReplacement, int(operation["id"]))
            task = db.get(DocumentParseTask, op.parse_task_id)
            source = task.object_name
            task.parse_status = "failed"
            task.parse_duration_ms = 1
            task.failure_reason = "service_unavailable"
            db.commit()
        reconcile_replacements(app.state.session_factory)
        current = client.get(f"/api/datasets/{identifier}").json()
        assert current["replacement"]["status"] == "failed"
        assert current["replacement"]["retryable"] is True
        assert (
            client.get(f"/api/datasets/{identifier}/content").json()["markdown"]
            == "# Original"
        )
        path = f"/api/datasets/{identifier}/replacements/{operation['id']}/retry"
        payload = {"confirm_replace": True, "request_id": str(uuid4())}
        assert (
            client.post(
                path, json=payload, headers={"If-Match": f'"dataset-{identifier}-99"'}
            ).status_code
            == 412
        )
        retried = client.post(
            path, json=payload, headers={"If-Match": f'"dataset-{identifier}-0"'}
        )
        assert retried.status_code == 202, retried.text
        assert app.state.storage.objects[source] == b"# Replacement"
        complete(app, operation)
        assert (
            client.get(f"/api/datasets/{identifier}/content").json()["markdown"]
            == "# Replacement"
        )
        assert (
            client.get(f"/api/datasets/{identifier}").json()["content_revision"] == "1"
        )


def test_cross_user_content_and_replacement_are_hidden():
    app = build_test_app()
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner)
        identifier = ready(owner, app)
        register(other, "unrelated@example.invalid")
        assert other.get(f"/api/datasets/{identifier}").status_code == 404
        assert other.get(f"/api/datasets/{identifier}/content").status_code == 404
        assert replace(other, identifier).status_code == 404


def test_agent_reads_replaced_content_and_rejects_previous_reference():
    import pytest
    from linkcv.core.errors import ApiError
    from linkcv.modules.agent.resume_tools import search_materials, validate_source_ids

    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)

        def search():
            with app.state.session_factory() as db:
                return search_materials(
                    db,
                    user_id=1,
                    query="",
                    types=["dataset"],
                    limit=10,
                    storage=app.state.storage,
                    max_bytes=2097152,
                )

        original = search()[0]["source_id"]
        operation = replace(client, identifier).json()
        complete(app, operation, "# Replaced reference")
        updated = search()[0]
        assert updated["source_id"] != original
        assert "Replaced reference" in str(updated)
        with app.state.session_factory() as db:
            assert validate_source_ids(db, user_id=1, source_ids=[updated["source_id"]])
            with pytest.raises(ApiError):
                validate_source_ids(db, user_id=1, source_ids=[original])


def test_failed_candidate_is_discarded_with_folder_and_cleanup_preserves_current():
    from datetime import timedelta
    from linkcv.core.database import utc_now
    from linkcv.modules.datasets.models import DatasetObjectCleanup
    from linkcv.services.dataset_content_service import cleanup_objects, enqueue_cleanup

    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        complete(app, replace(client, identifier).json(), "# Current")
        with app.state.session_factory() as db:
            dataset = db.get(UserDataset, int(identifier))
            current = dataset.content_object_name
            folder = dataset.folder_id
            enqueue_cleanup(db, 1, current, delay=-1)
            db.commit()
        cleanup_objects(app.state.session_factory, app.state.storage)
        assert app.state.storage.objects[current] == b"# Current"
        operation = replace(client, identifier, revision="1").json()
        with app.state.session_factory() as db:
            task = db.get(
                DocumentParseTask,
                db.get(DatasetReplacement, int(operation["id"])).parse_task_id,
            )
            task.parse_status = "failed"
            task.parse_duration_ms = 0
            task.failure_reason = "timeout"
            db.commit()
        reconcile_replacements(app.state.session_factory)
        response = client.delete(
            f"/api/datasets/folders/{folder}?confirm_contents=true"
        )
        assert response.status_code == 200, response.text
        with app.state.session_factory() as db:
            assert db.scalar(select(DatasetReplacement)) is None
            assert db.scalar(select(DocumentParseTask)) is None
            for entry in db.scalars(select(DatasetObjectCleanup)):
                entry.not_before = utc_now() - timedelta(seconds=1)
            db.commit()
        pending_objects = dict(app.state.storage.objects)
        assert pending_objects
        app.state.storage.fail_cleanup = True
        cleanup_objects(app.state.session_factory, app.state.storage)
        assert app.state.storage.objects == pending_objects
        app.state.storage.fail_cleanup = False
        with app.state.session_factory() as db:
            for entry in db.scalars(select(DatasetObjectCleanup)):
                entry.not_before = utc_now() - timedelta(seconds=1)
            db.commit()
        cleanup_objects(app.state.session_factory, app.state.storage)
        assert app.state.storage.objects == {}


def test_dataset_content_is_read_only():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        identifier = ready(client, app)
        response = client.put(f"/api/datasets/{identifier}/content", json={"markdown": "changed", "request_id": "test"})
        assert response.status_code == 404
        assert client.get(f"/api/datasets/{identifier}/content").json()["markdown"] == "# Original"
