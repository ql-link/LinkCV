"""Reconciliation keeps LinkRag copies in step with completed dataset documents."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import linkresume.models  # noqa: F401
from linkresume.core.database import Base
from linkresume.modules.datasets.models import UserDataset, UserDatasetRagSync
from linkresume.modules.identity.models import User
from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from linkresume.services.rag_sync_service import (
    RagSyncService,
    ready_files,
    recall_dataset_snippets,
    strip_local_images,
)
from tests.fakes import FakeLinkRag

NOW = datetime(2026, 9, 30, 8, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.value = NOW

    def __call__(self) -> datetime:
        return self.value


@pytest.fixture
def env():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    storage: dict[str, bytes] = {}
    rag = FakeLinkRag()
    clock = Clock()
    service = RagSyncService(
        session_factory=factory,
        storage=type("S", (), {"get": lambda _self, key: storage[key]})(),
        client=rag,
        batch_size=20,
        max_attempts=3,
        markdown_max_bytes=1_000_000,
        now=clock,
    )
    return factory, storage, rag, service, clock


def add_user(factory, name: str = "a") -> int:
    with factory() as db:
        user = User(email=f"{name}-{uuid4().hex[:6]}@example.invalid", nickname=name)
        db.add(user)
        db.commit()
        return user.id


def add_dataset(factory, storage, user_id: int, markdown: str, *, parse_status="succeeded", kind="document") -> int:
    with factory() as db:
        converted = f"users/{user_id}/datasets/converted/{uuid4().hex}.md"
        fmt = "md" if kind == "document" else "mp3"
        task = DocumentParseTask(
            user_id=user_id, source_type=DATASET_SOURCE_TYPE, file_name=f"项目.{fmt}", file_format=fmt,
            object_name=f"users/{user_id}/datasets/source/{uuid4().hex}.{fmt}", upload_status="succeeded",
            parse_status=parse_status, upload_duration_ms=1, converted_object_name=converted,
            parse_duration_ms=1 if parse_status == "succeeded" else None,
        )
        db.add(task)
        db.flush()
        dataset = UserDataset(
            user_id=user_id, file_name=f"项目.{fmt}", file_format=fmt, content_type="text/markdown",
            idempotency_key=uuid4().hex, request_fingerprint="0" * 64, file_size=len(markdown.encode()),
            object_name=task.object_name, sha256="0" * 64, parse_task_id=task.id, asset_kind=kind,
        )
        db.add(dataset)
        db.commit()
        storage[converted] = markdown.encode()
        return dataset.id


def record(factory, dataset_id: int) -> UserDatasetRagSync | None:
    with factory() as db:
        return db.scalar(select(UserDatasetRagSync).where(UserDatasetRagSync.dataset_id == dataset_id))


def test_completed_documents_are_uploaded_then_marked_ready(env) -> None:
    factory, storage, rag, service, _ = env
    user = add_user(factory)
    ready = add_dataset(factory, storage, user, "# 项目\n![图](assets/a.png)\n订单系统 QPS 5000 ![远程](https://x.test/a.png)")
    queued = add_dataset(factory, storage, user, "未完成", parse_status="queued")
    media = add_dataset(factory, storage, user, "", kind="audio")

    rag.parse_result = "parsing"
    service.run_once()
    row = record(factory, ready)
    assert row.status == "parsing" and row.synced_revision == 0
    (upload,) = rag.files.values()
    assert upload["user_id"] == user and upload["filename"] == f"{ready}.md"
    assert upload["external_ref"] == f"dataset:{ready}:0"
    assert "assets/a.png" not in upload["markdown"]  # local image dropped
    assert "https://x.test/a.png" in upload["markdown"]  # remote image kept
    assert record(factory, queued) is None and record(factory, media) is None

    rag.parse_result = "parse_success"
    service.run_once()
    assert record(factory, ready).status == "ready"


def test_replaced_content_deletes_old_copy_before_uploading_new(env) -> None:
    factory, storage, rag, service, _ = env
    user = add_user(factory)
    dataset_id = add_dataset(factory, storage, user, "旧内容")
    service.run_once()
    service.run_once()
    old_file = record(factory, dataset_id).rag_file_id
    with factory() as db:
        dataset = db.get(UserDataset, dataset_id)
        dataset.content_revision = 1
        db.commit()
    with factory() as db:
        assert ready_files(db, user_id=user, dataset_ids=None) == {}  # stale copy never recalled

    rag.fail = {"delete_file"}
    service.run_once()
    row = record(factory, dataset_id)
    assert row.status == "pending" and row.rag_file_id == old_file  # not uploaded while old one remains
    assert len(rag.files) == 1

    rag.fail = set()
    row_next = row.next_attempt_at
    service._now = lambda: row_next + timedelta(seconds=1)
    service.run_once()
    row = record(factory, dataset_id)
    assert old_file in rag.deleted
    # Uploaded and polled in the same round.
    assert row.status == "ready" and row.rag_file_id != old_file and row.synced_revision == 1
    assert [f["external_ref"] for f in rag.files.values()] == [f"dataset:{dataset_id}:1"]


def test_deleted_dataset_removes_rag_file_and_record(env) -> None:
    factory, storage, rag, service, _ = env
    user = add_user(factory)
    dataset_id = add_dataset(factory, storage, user, "内容")
    service.run_once()
    file_id = record(factory, dataset_id).rag_file_id
    with factory() as db:
        dataset = db.get(UserDataset, dataset_id)
        task = db.get(DocumentParseTask, dataset.parse_task_id)
        db.delete(dataset)
        db.delete(task)
        db.commit()
    rag.fail = {"delete_file"}
    service.run_once()
    assert record(factory, dataset_id) is not None  # kept for retry
    rag.fail = set()
    service.run_once()
    assert record(factory, dataset_id) is None
    assert file_id in rag.deleted and not rag.files


def test_missing_rag_file_counts_as_deleted(env) -> None:
    factory, storage, rag, service, _ = env
    user = add_user(factory)
    dataset_id = add_dataset(factory, storage, user, "内容")
    rag.parse_result = "parsing"
    service.run_once()
    rag.files.clear()  # already gone on the RAG side
    service.run_once()
    row = record(factory, dataset_id)
    # Polling a vanished file requeues it; the next round uploads again.
    assert row.status == "pending" and row.rag_file_id is None
    service.run_once()
    assert record(factory, dataset_id).status == "parsing"


def test_failures_back_off_and_stop_at_limit(env) -> None:
    factory, storage, rag, service, clock = env
    user = add_user(factory)
    dataset_id = add_dataset(factory, storage, user, "内容")
    rag.fail = {"upload_markdown"}
    service.run_once()
    row = record(factory, dataset_id)
    assert (row.status, row.attempt_count, row.last_error) == ("pending", 1, "LINKRAG_TEST_FAILURE")
    service.run_once()  # not due yet
    assert record(factory, dataset_id).attempt_count == 1
    for _ in range(2):
        clock.value += timedelta(hours=2)
        service.run_once()
    row = record(factory, dataset_id)
    assert (row.status, row.attempt_count) == ("failed", 3)
    clock.value += timedelta(hours=2)
    service.run_once()
    assert record(factory, dataset_id).attempt_count == 3  # stopped

    rag.fail = set()
    assert service.reset_failed() == 1
    service.run_once()
    assert record(factory, dataset_id).status == "ready"


def test_rag_parse_failure_deletes_copy_and_retries(env) -> None:
    factory, storage, rag, service, clock = env
    user = add_user(factory)
    dataset_id = add_dataset(factory, storage, user, "内容")
    rag.parse_result = "parse_failed"
    service.run_once()
    row = record(factory, dataset_id)
    assert row.status == "pending" and row.rag_file_id is None and row.attempt_count == 1
    assert rag.files == {}


def test_empty_content_after_cleanup_fails_without_upload(env) -> None:
    factory, storage, rag, service, _ = env
    user = add_user(factory)
    dataset_id = add_dataset(factory, storage, user, "![only](images/a.png)")
    service.run_once()
    row = record(factory, dataset_id)
    assert row.status == "failed" and row.last_error == "CONTENT_EMPTY"
    assert rag.files == {}


def test_recall_maps_hits_and_drops_foreign_or_unmapped(env) -> None:
    factory, storage, rag, service, _ = env
    owner = add_user(factory, "owner")
    other = add_user(factory, "other")
    mine = add_dataset(factory, storage, owner, "订单系统")
    theirs = add_dataset(factory, storage, other, "别人的资料")
    service.run_once()
    service.run_once()
    mine_file = record(factory, mine).rag_file_id
    theirs_file = record(factory, theirs).rag_file_id
    rag.recall_hits = {mine_file: "订单系统 QPS 5000"}
    rag.foreign_hits = [(theirs_file, "别人的资料"), (123456, "未知")]
    with factory() as db:
        snippets, covered = recall_dataset_snippets(
            db, rag, user_id=owner, query="订单", dataset_ids=None, limit=5
        )
    assert covered == {mine}
    assert [(s.dataset_id, s.text, s.version) for s in snippets] == [(mine, "订单系统 QPS 5000", "0" * 64)]
    assert rag.recall_calls[-1]["file_ids"] == [mine_file]
    assert rag.recall_calls[-1]["user_id"] == owner


def test_strip_local_images_keeps_code_and_remote_links() -> None:
    text = (
        "a ![x](./a.png) b\n"
        "![ref][pic]\n\n[pic]: images/p.png\n"
        '<img src="local.png" alt="x"> <img src="https://cdn.test/x.png">\n'
        "![[wiki.png]] ![r](https://cdn.test/y.png)"
    )
    cleaned = strip_local_images(text)
    assert "./a.png" not in cleaned and "![ref][pic]" not in cleaned
    assert "local.png" not in cleaned and "wiki.png" not in cleaned
    assert "https://cdn.test/x.png" in cleaned and "https://cdn.test/y.png" in cleaned


def test_stale_upload_batch_does_not_create_a_second_remote_file(env):
    factory, storage, rag, service, _ = env
    uid = add_user(factory)
    dataset_id = add_dataset(factory, storage, uid, "# Fictional material")
    assert service._create_missing() == 1
    stale = service._due("pending")[0]
    assert service._upload(stale) == 1
    assert service._upload(stale) == 0
    assert len(rag.files) == 1
    assert record(factory, dataset_id).rag_file_id in rag.files


def test_deleting_owner_retains_registered_files_for_durable_cleanup(env):
    factory, storage, rag, service, _ = env
    uid = add_user(factory)
    dataset_id = add_dataset(factory, storage, uid, "# Fictional material")
    service._create_missing()
    pending = service._due("pending")[0]
    service._upload(pending)
    parsing = service._due("parsing")[0]
    with factory() as db:
        user = db.get(User, uid)
        user.status = 0
        user.deletion_requested_at = NOW
        db.commit()
    assert service._create_missing() == 0
    assert service._upload(pending) == 0
    assert service._poll(parsing) == 0
    assert service._delete_orphan(parsing) == 0
    assert record(factory, dataset_id).rag_file_id in rag.files
    assert rag.deleted == []
