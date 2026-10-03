"""Account schema, cleanup and owner serialization on disposable MySQL 8.4."""
import asyncio
import os
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from linkresume.core.config import Settings, load_settings
from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.core.security import hash_password
from linkresume.modules.identity.account_deletion_service import request_deletion
from linkresume.modules.identity.dependencies import lock_active_user
from linkresume.modules.identity.models import AccountDeletionJob, AccountPreference, User
from linkresume.modules.identity.schemas import PasswordDeletionRequest
from linkresume.workers.account_deletion_worker import AccountDeletionProcessor
from tests.fakes import FakeRedis
from tests.integration.api.test_identity_resumes_assets import FakeStorage

BACKEND = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def mysql():
    raw = os.environ.get("LINKRESUME_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("Explicit disposable MySQL is required")
    url = make_url(raw)
    if url.host not in {"127.0.0.1", "localhost"} or url.database != "linkresume":
        pytest.fail("Account tests require a disposable local database named linkresume")
    admin = create_engine(url)
    name = "linkresume_account_test_" + uuid4().hex[:12]
    with admin.connect() as db:
        assert str(db.scalar(text("SELECT VERSION()"))).startswith("8.4.")
        db.execute(text(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"))
    engine = create_engine(url.set(database=name))
    old = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = url.set(database=name).render_as_string(hide_password=False)
    try:
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "migrations"))
        load_settings.cache_clear()
        assert make_url(load_settings().sqlalchemy_url).database == name
        command.upgrade(cfg, "0104")
        with engine.begin() as db:
            db.execute(text("INSERT INTO users (email,password_hash,nickname) VALUES ('historical@example.test','fictional-hash','张三')"))
        command.upgrade(cfg, "head")
        yield engine
    finally:
        if old is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = old
        load_settings.cache_clear()
        engine.dispose()
        with admin.connect() as db:
            db.execute(text(f"DROP DATABASE `{name}`"))
        admin.dispose()


def seed(factory):
    with factory() as db:
        user = User(email=f"{uuid4().hex}@example.test", nickname="张三", password_hash=hash_password("fictional123"))
        db.add(user); db.commit()
        return user.id


def close(factory, uid, redis):
    with factory() as db:
        return request_deletion(db, user_id=uid, sid="fictional-session", payload=PasswordDeletionRequest(method="password", current_password="fictional123", confirmation="注销账号"), settings=Settings(account_deletion_enabled=True), redis_client=redis)


def test_historical_upgrade_and_actual_schema(mysql):
    with mysql.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0106"
        assert db.scalar(text("SELECT contact_email FROM users WHERE email='historical@example.test'")) == "historical@example.test"
        assert db.scalar(text("SELECT COUNT(*) FROM account_preferences")) == 0
    schema = inspect(mysql)
    assert {c["name"] for c in schema.get_columns("account_preferences")} == set(AccountPreference.__table__.columns.keys())
    assert {c["name"] for c in schema.get_columns("account_deletion_jobs")} == set(AccountDeletionJob.__table__.columns.keys())
    assert schema.get_foreign_keys("account_deletion_jobs") == []
    assert len(schema.get_check_constraints("account_preferences")) == 2
    assert "resume_versions" not in schema.get_table_names()


def test_write_and_deletion_serialize_on_owner_row(mysql):
    factory = sessionmaker(mysql, expire_on_commit=False)
    uid = seed(factory)
    held, release, attempting = Event(), Event(), Event()
    def writer():
        with factory() as db:
            lock_active_user(db, uid)
            db.add(AccountPreference(user_id=uid, locale="en-US", interview_reminder_enabled=1))
            db.flush(); held.set()
            assert release.wait(5)
            db.commit()
    def deleter():
        attempting.set()
        return close(factory, uid, FakeRedis())
    with ThreadPoolExecutor(max_workers=2) as pool:
        write = pool.submit(writer)
        assert held.wait(5)
        deletion = pool.submit(deleter)
        assert attempting.wait(5)
        assert not deletion.done()
        release.set(); write.result(timeout=5); deletion.result(timeout=5)
    with factory() as db:
        assert db.get(User, uid).deletion_requested_at is not None
        assert db.get(AccountPreference, uid).locale == "en-US"
        with pytest.raises(ApiError) as caught:
            lock_active_user(db, uid)
        assert caught.value.status_code == 401


def test_parallel_deletion_creates_exactly_one_job(mysql):
    factory = sessionmaker(mysql, expire_on_commit=False)
    uid = seed(factory); redis = FakeRedis()
    def attempt():
        try:
            return close(factory, uid, redis)
        except ApiError as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 401 in results
    with factory() as db:
        assert len(db.scalars(select(AccountDeletionJob).where(AccountDeletionJob.user_id == uid)).all()) == 1


def test_cleanup_respects_real_foreign_keys_and_other_users(mysql):
    factory = sessionmaker(mysql, expire_on_commit=False)
    uid, other = seed(factory), seed(factory)
    with factory() as db:
        db.add(AccountPreference(user_id=uid)); db.add(AccountPreference(user_id=other)); db.commit()
    storage, redis = FakeStorage(), FakeRedis()
    storage.objects[f"users/{uid}/avatar/test.png"] = (b"fictional", "image/png")
    storage.objects[f"users/{other}/avatar/test.png"] = (b"other", "image/png")
    receipt = close(factory, uid, redis)
    worker = AccountDeletionProcessor(session_factory=factory, storage=storage, redis=redis, rag_client=None, settings=Settings())
    # Prior tests also leave jobs, so drain the finite queue.
    for _ in range(5):
        if not worker.run_once(): break
    with factory() as db:
        job = db.scalar(select(AccountDeletionJob).where(AccountDeletionJob.public_id == receipt["job_id"]))
        assert job.status == "completed"
        assert db.get(User, uid) is None
        assert db.get(AccountPreference, uid) is None
        assert db.get(User, other) is not None
        assert db.get(AccountPreference, other) is not None
    assert f"users/{uid}/avatar/test.png" not in storage.objects
    assert f"users/{other}/avatar/test.png" in storage.objects


def test_cleanup_deletes_personal_resource_graph_and_preserves_other_graph(mysql):
    from linkresume.modules.agent.models import (
        AgentSession, AgentRun, AgentMessage, AgentToolCall, AgentOperation,
        AgentStageEvent, ResumeChangeProposal,
    )
    from linkresume.modules.datasets.models import UserDataset, UserDatasetFolder, UserDatasetRagSync
    from linkresume.modules.identity.models import UserProfile
    from linkresume.modules.interviews.models import JobApplication, JobApplicationStage, InterviewSession
    from linkresume.modules.job_descriptions.models import JobDescription
    from linkresume.modules.mock_interviews.models import MockInterview, MockInterviewQuestion
    from linkresume.modules.resumes.models import Resume, ResumeTemplate, DocumentParseTask
    from tests.canonical_resume_fixtures import canonical_resume_payload
    factory = sessionmaker(mysql, expire_on_commit=False)
    uid, other = seed(factory), seed(factory)

    def graph(owner):
        with factory() as db:
            rows = []
            def add(row):
                db.add(row); db.flush(); rows.append(row)
                return row
            template = db.scalar(select(ResumeTemplate).where(ResumeTemplate.is_active == 1).limit(1))
            data, style = canonical_resume_payload()
            resume = add(Resume(user_id=owner, template_id=template.id, title="虚构简历", data_json=data, style_json=style))
            job = add(JobDescription(user_id=owner, company_name="虚构公司", job_title="虚构岗位", description="虚构 JD", source_type="manual"))
            application = add(JobApplication(user_id=owner, job_description_id=job.id, resume_id=resume.id,
                company_name_snapshot="虚构公司", job_title_snapshot="虚构岗位", job_snapshot={}, calendar_color="blue",
                current_stage_type="screening", current_stage_label="筛选", stage_state="awaiting_schedule"))
            stage = add(JobApplicationStage(application_id=application.id, client_request_id=str(uuid4()),
                stage_type="interview", stage_label="一面", interview_round_no=1, sequence_no=1, entered_at=utc_now()))
            calendar = add(InterviewSession(application_id=application.id, application_stage_id=stage.id,
                client_request_id=str(uuid4()), stage_type="interview", stage_label="一面", round_no=1,
                start_at=utc_now(), end_at=utc_now() + timedelta(hours=1), timezone="Asia/Shanghai", mode="video"))
            folder = add(UserDatasetFolder(user_id=owner, name="虚构资料"))
            parse = add(DocumentParseTask(user_id=owner, source_type="dataset", file_name="fictional.md",
                file_format="md", object_name=f"users/{owner}/fictional.md", upload_status="succeeded",
                upload_duration_ms=1, parse_status="failed", parse_duration_ms=1, failure_reason="content_invalid"))
            dataset = add(UserDataset(user_id=owner, folder_id=folder.id, parse_task_id=parse.id,
                interview_session_id=calendar.id, idempotency_key=str(uuid4()), request_fingerprint="f" * 64,
                file_name="fictional.md", file_format="md", content_type="text/markdown", file_size=1,
                object_name=f"users/{owner}/fictional.md", sha256="a" * 64))
            add(UserDatasetRagSync(user_id=owner, dataset_id=dataset.id, content_revision=1, status="failed"))
            mock = add(MockInterview(public_id=str(uuid4()), user_id=owner, source_type="resume", resume_id=resume.id,
                job_application_id=application.id, job_description_id=job.id, resume_title_snapshot="虚构简历",
                resume_markdown_snapshot="# 虚构简历", interview_type="technical", difficulty="intermediate",
                question_count=3, language="zh", status="completed"))
            question = add(MockInterviewQuestion(interview_id=mock.id, sequence_no=1, plan_index=1, depth_level=1, content="虚构问题"))
            add(MockInterviewQuestion(interview_id=mock.id, sequence_no=2, plan_index=1, depth_level=2,
                parent_id=question.id, content="虚构追问"))
            session = add(AgentSession(public_id=str(uuid4()), user_id=owner, title="虚构对话"))
            run = add(AgentRun(public_id=str(uuid4()), session_id=session.id, idempotency_key=str(uuid4()), started_at=utc_now(), status="succeeded"))
            add(AgentMessage(session_id=session.id, run_id=run.id, sequence_no=1, role="user", content="虚构消息"))
            add(AgentToolCall(run_id=run.id, call_key="fictional", tool_name="get_user_profile", status="succeeded"))
            operation = add(AgentOperation(public_id=str(uuid4()), session_id=session.id, state="run_created"))
            add(AgentStageEvent(agent_operation_id=operation.id, event_key="fictional", stage="preflight", result="succeeded"))
            add(ResumeChangeProposal(public_id=str(uuid4()), run_id=run.id, call_key="fictional", resume_id=resume.id,
                user_id=owner, base_lock_version=1, summary="虚构提案", expires_at=utc_now() + timedelta(hours=1)))
            add(UserProfile(user_id=owner))
            preference = AccountPreference(user_id=owner)
            db.add(preference)
            db.commit()
            return [(type(row), row.id) for row in rows]

    owned, preserved = graph(uid), graph(other)
    storage, redis = FakeStorage(), FakeRedis()
    receipt = close(factory, uid, redis)
    worker = AccountDeletionProcessor(session_factory=factory, storage=storage, redis=redis, rag_client=None, settings=Settings())
    for _ in range(5):
        if not worker.run_once(): break
    with factory() as db:
        assert db.scalar(select(AccountDeletionJob).where(AccountDeletionJob.public_id == receipt["job_id"])).status == "completed"
        assert all(db.get(model, key) is None for model, key in owned)
        assert all(db.get(model, key) is not None for model, key in preserved)
        assert db.get(User, uid) is None
        assert db.get(User, other) is not None


def test_busy_check_uses_current_read_after_a_writer_commits(mysql):
    from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
    factory = sessionmaker(mysql, expire_on_commit=False)
    uid = seed(factory)
    held, snapshot, release = Event(), Event(), Event()
    def writer():
        with factory() as db:
            lock_active_user(db, uid)
            db.add(DocumentParseTask(user_id=uid, source_type=DATASET_SOURCE_TYPE,
                file_name="fictional.md", file_format="md", object_name=f"users/{uid}/fictional.md",
                upload_status="succeeded", parse_status="queued", upload_duration_ms=1))
            db.flush(); held.set()
            assert release.wait(5)
            db.commit()
    def deleter():
        with factory() as db:
            # Establish a repeatable-read snapshot before the upload commits.
            assert db.scalar(select(DocumentParseTask.id).where(DocumentParseTask.user_id == uid)) is None
            snapshot.set()
            with pytest.raises(ApiError) as error:
                request_deletion(db, user_id=uid, sid="fictional-session",
                    payload=PasswordDeletionRequest(method="password", current_password="fictional123", confirmation="注销账号"),
                    settings=Settings(account_deletion_enabled=True), redis_client=FakeRedis())
            assert error.value.code == "ACCOUNT_BUSY"
    with ThreadPoolExecutor(max_workers=2) as pool:
        write = pool.submit(writer); assert held.wait(5)
        deletion = pool.submit(deleter); assert snapshot.wait(5)
        assert not deletion.done()
        release.set(); write.result(timeout=5); deletion.result(timeout=5)
    with factory() as db:
        assert db.get(User, uid).status == 1
        assert db.get(User, uid).deletion_requested_at is None


def test_inflight_rag_upload_is_recorded_before_deletion_and_then_removed(mysql):
    from linkresume.services.rag_sync_service import RagSyncService
    from tests.unit.services.test_rag_sync_service import add_dataset
    from tests.fakes import FakeLinkRag
    factory = sessionmaker(mysql, expire_on_commit=False)
    uid = seed(factory)
    content = {}
    dataset_id = add_dataset(factory, content, uid, "# Fictional personal material")
    held, release, attempting = Event(), Event(), Event()
    class SlowRag(FakeLinkRag):
        def upload_markdown(self, *args, **kwargs):
            held.set(); assert release.wait(5)
            return super().upload_markdown(*args, **kwargs)
    rag = SlowRag()
    service = RagSyncService(session_factory=factory,
        storage=type("Storage", (), {"get": lambda _, key: content[key]})(),
        client=rag, batch_size=20, max_attempts=3, markdown_max_bytes=1_000_000)
    service._create_missing()
    work = next(row for row in service._due("pending") if row.dataset_id == dataset_id)
    def deleter():
        attempting.set()
        return close(factory, uid, FakeRedis())
    with ThreadPoolExecutor(max_workers=2) as pool:
        upload = pool.submit(service._upload, work); assert held.wait(5)
        deletion = pool.submit(deleter); assert attempting.wait(5)
        assert not deletion.done()
        release.set(); assert upload.result(timeout=5) == 1
        receipt = deletion.result(timeout=5)
    file_id = next(iter(rag.files))
    worker = AccountDeletionProcessor(session_factory=factory, storage=FakeStorage(), redis=FakeRedis(), rag_client=rag, settings=Settings())
    for _ in range(10):
        if not worker.run_once(): break
    with factory() as db:
        job = db.scalar(select(AccountDeletionJob).where(AccountDeletionJob.public_id == receipt["job_id"]))
        assert job.status == "completed"
        assert db.get(User, uid) is None
    assert file_id in rag.deleted
    assert rag.files == {}


def test_imports_keep_event_loop_live_and_respect_owner_capacity(mysql):
    from tests.unit.workers.test_resume_import_worker import (
        assert_concurrent_finalization_at_capacity,
        build_processor,
    )
    from linkresume.modules.resumes.models import DocumentParseTask

    factory = sessionmaker(mysql, autoflush=False, expire_on_commit=False)
    built = build_processor(session_factory=factory, template_key="worker-concurrency-ci")
    _, storage, processor, import_id, _ = built
    with factory() as db:
        uid = db.get(DocumentParseTask, import_id).user_id

    held, release, starved, attempting = Event(), Event(), Event(), Event()
    upload = storage.upload

    def owner_lock_attempted(_connection, _cursor, statement, *_args):
        if held.is_set() and "FROM users" in statement and "FOR UPDATE" in statement:
            attempting.set()

    event.listen(mysql, "before_cursor_execute", owner_lock_attempted)

    def held_upload(object_name, data, content_type):
        if object_name.endswith("/converted.md") and not held.is_set():
            held.set()
            if not release.wait(5):
                starved.set()
        upload(object_name, data, content_type)

    storage.upload = held_upload

    async def concurrent_artifacts():
        first = asyncio.create_task(processor._persist_converted_markdown(
            import_id=import_id, user_id=uid, operation_id="task", markdown="# Fictional",
        ))
        second = None
        try:
            assert await asyncio.to_thread(held.wait, 5)
            second = asyncio.create_task(processor._persist_converted_markdown(
                import_id=import_id, user_id=uid, operation_id="task", markdown="# Fictional",
            ))
            # Both tasks take the same real MySQL owner lock. The loop must
            # remain able to release the first upload while the second waits.
            assert await asyncio.to_thread(attempting.wait, 5)
            assert not starved.is_set(), "owner lock blocked the event loop"
            assert not first.done()
            assert not second.done()
        finally:
            release.set()
            await asyncio.gather(first, *([second] if second is not None else []))

    try:
        asyncio.run(concurrent_artifacts())
    finally:
        storage.upload = upload
        event.remove(mysql, "before_cursor_execute", owner_lock_attempted)
    assert_concurrent_finalization_at_capacity(built)
