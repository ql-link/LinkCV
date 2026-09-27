import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[5]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load(ROOT / "scripts/release/retire_dataset_operations.py", "retire_dataset_operations")
revision = load(ROOT / "apps/backend/migrations/versions/0088_remove_dataset_replacement_and_cleanup_.py", "revision_0088")


@pytest.fixture
def engine():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        for statement in (
            "CREATE TABLE user_dataset (id INTEGER PRIMARY KEY, parse_task_id INTEGER, object_name TEXT, content_object_name TEXT)",
            "CREATE TABLE document_parse_tasks (id INTEGER PRIMARY KEY, user_id INTEGER, source_type TEXT, object_name TEXT, converted_object_name TEXT)",
            "CREATE TABLE dataset_replacements (id INTEGER PRIMARY KEY, user_id INTEGER, parse_task_id INTEGER)",
            "CREATE TABLE dataset_object_cleanup (id INTEGER PRIMARY KEY, user_id INTEGER, object_name TEXT)",
            "INSERT INTO document_parse_tasks VALUES (1, 1, 'dataset', 'users/1/datasets/current.md', 'users/1/datasets/converted/1.md')",
            "INSERT INTO document_parse_tasks VALUES (2, 1, 'dataset', 'users/1/datasets/candidate.md', 'users/1/datasets/converted/2-1.md')",
            "INSERT INTO user_dataset VALUES (1, 1, 'users/1/datasets/current.md', 'users/1/datasets/converted/1.md')",
            "INSERT INTO dataset_replacements VALUES (1, 1, 2), (2, 1, 1)",
            "INSERT INTO dataset_object_cleanup VALUES (1, 1, 'users/1/datasets/old.md'), (2, 1, 'users/1/datasets/converted/1.md')",
        ):
            conn.execute(text(statement))
    yield engine
    engine.dispose()


def test_preflight_refuses_nonempty_tables_before_any_drop(engine, monkeypatch):
    with engine.begin() as conn:
        monkeypatch.setattr(revision, "op", SimpleNamespace(get_bind=lambda: conn))
        with pytest.raises(RuntimeError, match="retire_dataset_operations"):
            revision.upgrade()
        assert {"dataset_replacements", "dataset_object_cleanup"} <= set(inspect(conn).get_table_names())


def test_retirement_preserves_current_files_and_is_repeatable(engine, monkeypatch):
    deleted = []
    storage = SimpleNamespace(delete=deleted.append)
    with engine.begin() as conn:
        summary = release.retire_operations(conn)
        assert summary == {"replacements": 2, "cleanup_records": 2, "unused_tasks": 1, "unused_objects": 4}
        assert conn.scalar(text("SELECT COUNT(*) FROM dataset_replacements")) == 2
        release.retire_operations(conn, storage, execute=True)
        assert "users/1/datasets/current.md" not in deleted
        assert "users/1/datasets/converted/1.md" not in deleted
        assert conn.scalar(text("SELECT COUNT(*) FROM document_parse_tasks")) == 1
        assert conn.scalar(text("SELECT parse_task_id FROM user_dataset")) == 1
        assert release.retire_operations(conn, storage, execute=True)["unused_objects"] == 0
        monkeypatch.setattr(revision, "op", SimpleNamespace(get_bind=lambda: conn))
        revision.upgrade()
        revision.upgrade()  # A partial MySQL DROP can be retried safely.
        assert not {"dataset_replacements", "dataset_object_cleanup"} & set(inspect(conn).get_table_names())


def test_storage_failure_keeps_records_for_maintenance_retry(engine):
    def fail(key):
        raise RuntimeError("storage unavailable")
    with pytest.raises(RuntimeError, match="storage unavailable"), engine.begin() as conn:
        release.retire_operations(conn, SimpleNamespace(delete=fail), execute=True)
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT COUNT(*) FROM dataset_replacements")) == 2
        assert conn.scalar(text("SELECT COUNT(*) FROM document_parse_tasks")) == 2


def test_unsafe_legacy_key_is_rejected_before_deletion(engine):
    deleted = []
    with engine.begin() as conn:
        conn.execute(text("UPDATE dataset_object_cleanup SET object_name='users/2/datasets/private.md' WHERE id=1"))
        with pytest.raises(RuntimeError, match="outside"):
            release.retire_operations(conn, SimpleNamespace(delete=deleted.append), execute=True)
    assert deleted == []
