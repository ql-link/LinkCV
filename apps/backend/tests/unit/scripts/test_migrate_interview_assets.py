"""Unit coverage for scripts/release/migrate_interview_assets.py."""

import hashlib
import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

import linkresume.models  # noqa: F401
from linkresume.core.database import Base
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import (
    InterviewAsset,
    InterviewSession,
    JobApplication,
)
from linkresume.modules.resumes.models import DocumentParseTask

REPO_ROOT = Path(__file__).resolve().parents[5]


def load_migrator() -> ModuleType:
    path = REPO_ROOT / "apps/backend/scripts/release/migrate_interview_assets.py"
    spec = importlib.util.spec_from_file_location(
        "linkresume_migrate_interview_assets_test", path
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def stat(self, object_name: str) -> None:
        if object_name not in self.objects:
            raise KeyError(object_name)

    def copy(self, source_object_name: str, target_object_name: str) -> None:
        self.objects[target_object_name] = self.objects[source_object_name]

    def delete(self, object_name: str) -> None:
        self.objects.pop(object_name, None)

    def list_names(self, prefix: str) -> list[str]:
        return [name for name in self.objects if name.startswith(prefix)]


def build_database():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine


def seed_legacy_row(
    engine,
    *,
    file_name: str,
    asset_type: str,
    object_name: str,
    source_type: str = "recorded",
    sha256: str | None = None,
    duration_ms: int | None = None,
    file_size: int = 128,
    content_type: str = "audio/webm",
) -> int:
    start = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)
    with Session(engine) as db:
        user = User(email="migrate@example.invalid", nickname="迁移用户")
        db.add(user)
        db.flush()
        application = JobApplication(
            user_id=user.id,
            company_name_snapshot="示例科技",
            job_title_snapshot="后端工程师",
            job_snapshot={"raw": "content"},
            calendar_color="blue",
            current_stage_type="interview",
            current_round_no=1,
            current_stage_label="一面",
            stage_state="awaiting_result",
            status="active",
            lifecycle_status="active",
            offer_status="none",
            is_favorite=0,
            lock_version=1,
        )
        db.add(application)
        db.flush()
        session = InterviewSession(
            application_id=application.id,
            client_request_id="11111111-1111-4111-8111-111111111111",
            stage_type="interview",
            stage_label="一面",
            status="scheduled",
            round_result="pending",
            start_at=start,
            end_at=start + timedelta(hours=1),
            schedule_kind="fixed_slot",
            timezone="Asia/Shanghai",
            mode="video",
            lock_version=1,
        )
        db.add(session)
        db.flush()
        asset = InterviewAsset(
            interview_session_id=session.id,
            source_type=source_type,
            asset_type=asset_type,
            original_file_name=file_name,
            content_type=content_type,
            file_size=file_size,
            duration_ms=duration_ms,
            object_name=object_name,
            sha256=sha256,
        )
        db.add(asset)
        db.commit()
        return asset.id


def test_dry_run_reports_pending_without_writes(capsys) -> None:
    module = load_migrator()
    engine = build_database()
    storage = FakeStorage()
    object_name = "users/1/interviews/1/1/rec-1.webm"
    storage.objects[object_name] = b"audio-bytes"
    seed_legacy_row(
        engine,
        file_name="面试录音.webm",
        asset_type="audio",
        object_name=object_name,
        duration_ms=60_000,
    )

    assert module.migrate(engine, storage, execute=False) == 0

    with Session(engine) as db:
        assert db.scalars(select(UserDataset)).all() == []
        assert db.scalars(select(InterviewAsset)).all()
    assert object_name in storage.objects
    assert "pending=1" in capsys.readouterr().out


def test_execute_migrates_audio_row_and_is_idempotent() -> None:
    module = load_migrator()
    engine = build_database()
    storage = FakeStorage()
    payload = b"recorded-audio"
    object_name = "users/1/interviews/1/1/rec-2.webm"
    storage.objects[object_name] = payload
    asset_id = seed_legacy_row(
        engine,
        file_name="终面录音.webm",
        asset_type="audio",
        object_name=object_name,
        source_type="recorded",
        sha256=hashlib.sha256(payload).hexdigest(),
        duration_ms=95_000,
        file_size=len(payload),
        content_type="audio/webm",
    )

    assert module.migrate(engine, storage, execute=True) == 0

    target = module.migrated_object_name(1, asset_id, "终面录音.webm")
    assert target.startswith("users/1/datasets/")
    assert storage.objects[target] == payload
    assert object_name not in storage.objects

    with Session(engine) as db:
        assert db.scalars(select(InterviewAsset)).all() == []
        dataset = db.scalars(select(UserDataset)).one()
        assert dataset.legacy_interview_asset_id == asset_id
        assert dataset.asset_kind == "audio"
        assert dataset.interview_session_id is not None
        assert dataset.interview_source_type == "recorded"
        assert dataset.duration_ms == 95_000
        assert dataset.idempotency_key == module.migrated_idempotency_key(asset_id)
        task = db.get(DocumentParseTask, dataset.parse_task_id)
        assert task is not None
        assert task.upload_status == "succeeded"
        assert task.parse_status == "succeeded"
        assert task.parse_duration_ms == 0

    # Rerun is a no-op: nothing pending, nothing double-inserted.
    assert module.migrate(engine, storage, execute=True) == 0
    with Session(engine) as db:
        assert len(db.scalars(select(UserDataset)).all()) == 1


def test_document_rows_queue_for_parsing() -> None:
    module = load_migrator()
    engine = build_database()
    storage = FakeStorage()
    object_name = "users/1/interviews/1/1/notes.md"
    storage.objects[object_name] = b"# notes"
    asset_id = seed_legacy_row(
        engine,
        file_name="面试笔记.md",
        asset_type="document",
        object_name=object_name,
        source_type="uploaded",
        file_size=7,
        content_type="text/markdown",
    )

    assert module.migrate(engine, storage, execute=True) == 0

    with Session(engine) as db:
        dataset = db.scalars(select(UserDataset)).one()
        task = db.get(DocumentParseTask, dataset.parse_task_id)
        assert dataset.asset_kind == "document"
        assert task is not None
        assert task.parse_status == "queued"
        assert task.parse_duration_ms is None


def test_missing_object_marks_failure_and_keeps_row() -> None:
    module = load_migrator()
    engine = build_database()
    storage = FakeStorage()
    object_name = "users/1/interviews/1/1/gone.webm"
    asset_id = seed_legacy_row(
        engine,
        file_name="丢失录音.webm",
        asset_type="audio",
        object_name=object_name,
    )

    assert module.migrate(engine, storage, execute=True) == 1

    with Session(engine) as db:
        assert db.get(InterviewAsset, asset_id) is not None
        assert db.scalars(select(UserDataset)).all() == []


def test_unsupported_extension_is_reported() -> None:
    module = load_migrator()
    engine = build_database()
    storage = FakeStorage()
    object_name = "users/1/interviews/1/1/archive.zip"
    storage.objects[object_name] = b"zip"
    seed_legacy_row(
        engine,
        file_name="archive.zip",
        asset_type="document",
        object_name=object_name,
        source_type="uploaded",
    )

    assert module.migrate(engine, storage, execute=True) == 1

    with Session(engine) as db:
        assert db.scalars(select(UserDataset)).all() == []
        assert (
            db.execute(text("SELECT COUNT(*) FROM interview_assets")).scalar_one() == 1
        )
