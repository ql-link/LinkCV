from datetime import timedelta
from pathlib import Path
import asyncio
import importlib.util

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from linkresume.application.job_pool import service
from linkresume.application.job_pool.catalog import CATALOG
from linkresume.application.job_pool.types import JobObservation, SyncResult
from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.identity.models import User
from linkresume.modules.interviews.models import JobApplication
from linkresume.modules.job_descriptions.models import GlobalCompany, JobDescription
from linkresume.modules.job_pool.models import GlobalJob, GlobalJobSource
from tests.fakes import FakeRedis


class Storage:
    def ensure_bucket(self):
        pass


@pytest.fixture
def app():
    return create_app(Settings(database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="fictional-job-pool-test-secret-32-chars", job_pool_sync_enabled=True),
        storage=Storage(), redis=FakeRedis(), create_schema=True)


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        response = client.post("/api/auth/register", json={"email": "zhangsan@example.test", "password": "password-123"})
        assert response.status_code == 201
        yield client


def observation(key="1", **kwargs):
    values = dict(source_job_key="id:" + key, job_title="示例研发岗位", description="负责虚构平台开发。要求掌握Python。",
        recruitment_channel="campus", employment_type="internship", job_category="研发",
        locations={"schema_version": 1, "cities": ["上海", "北京"], "raw": ["上海市", "北京市"]},
        source_url="https://careers.tencent.com/jobdesc.html?postId=" + key)
    values.update(kwargs)
    return JobObservation(**values)


def seed(app):
    with app.state.session_factory() as db:
        company = GlobalCompany(company_name="示例科技", normalized_name="示例科技")
        db.add(company)
        db.flush()
        source = GlobalJobSource(company_id=company.id, adapter_key="tencent", tenant_key="careers.tencent.com",
            portal_config={"schema_version": 1, "host": "careers.tencent.com", "portals": ["social"], "site_id": None}, is_enabled=1)
        db.add(source)
        db.commit()
        return source.id


def sync(app, source_id, jobs, *, complete=True, now=None):
    now = now or utc_now()
    with app.state.session_factory() as db:
        service.queue_source(db, source_id, enabled=True, now=now)
        task = service.claim_source(db, source_id, interval_seconds=43200, now=now)
        assert task
        generation = task[1]
        assert service.write_observations(db, source_id, generation, jobs, now=now)
        assert service.finish(db, source_id, generation, SyncResult(jobs=jobs, is_complete=complete), now=now)
        return generation


def test_search_filter_cursor_and_list_omits_body(app, client):
    source = seed(app)
    sync(app, source, [observation(str(i)) for i in range(3)])
    response = client.get("/api/job-pool", params={"keyword": "研发", "city": "上海市", "recruitment_type": "internship", "limit": 1})
    assert response.status_code == 200, response.text
    page = response.json()
    assert len(page["items"]) == 1 and page["next_cursor"]
    assert "description" not in page["items"][0]
    assert page["items"][0]["joined_application_id"] is None
    assert client.get("/api/job-pool", params={"cursor": page["next_cursor"], "city": "北京"}).status_code == 400
    assert client.get("/api/job-pool", params={"keyword": "研"}).status_code == 400
    assert client.get("/api/job-pool", params={"city": "杭州"}).json()["items"] == []
    filters = client.get("/api/job-pool/filters").json()
    assert filters["cities"] == ["上海", "北京"]
    assert filters["categories"] == ["研发"]


def test_join_idempotent_snapshot_and_user_isolation(app, client):
    source = seed(app)
    sync(app, source, [observation()])
    identifier = client.get("/api/job-pool").json()["items"][0]["id"]
    first = client.post(f"/api/job-pool/{identifier}/join")
    assert first.status_code == 201, first.text
    again = client.post(f"/api/job-pool/{identifier}/join")
    assert again.status_code == 200 and again.json()["application_id"] == first.json()["application_id"]
    sync(app, source, [observation(job_title="新的公共标题", description="更新后的公共岗位正文")])
    with app.state.session_factory() as db:
        private = db.get(JobDescription, int(first.json()["job_id"]))
        application = db.get(JobApplication, int(first.json()["application_id"]))
        assert private.job_title == "示例研发岗位"
        assert private.employment_type == "internship"
        assert application.job_title_snapshot == "示例研发岗位"
        assert db.scalar(select(func.count()).select_from(JobDescription)) == 1
        assert db.scalar(select(func.count()).select_from(JobApplication)) == 1
    detail = client.get(f"/api/job-pool/{identifier}").json()
    assert detail["title"] == "新的公共标题" and detail["joined_application_id"] == first.json()["application_id"]
    client.post("/api/auth/logout")
    assert client.get("/api/job-pool").status_code == 401
    assert client.post("/api/auth/register", json={"email": "lisi@example.test", "password": "password-123"}).status_code == 201
    assert client.get(f"/api/job-pool/{identifier}").json()["joined_application_id"] is None
    other = client.post(f"/api/job-pool/{identifier}/join")
    assert other.status_code == 201 and other.json()["job_id"] != first.json()["job_id"]


def test_join_preserves_maximum_body_and_long_locations(app, client):
    source = seed(app)
    cities = ["虚构城市" + str(index) + "甲" * 85 for index in range(128)]
    body = "虚构岗位正文" * 33333 + "。。"
    assert len(body) == 200_000
    sync(app, source, [observation(description=body,
        locations={"schema_version": 1, "cities": cities, "raw": cities})])
    identifier = client.get("/api/job-pool").json()["items"][0]["id"]
    response = client.post(f"/api/job-pool/{identifier}/join")
    assert response.status_code == 201, response.text
    with app.state.session_factory() as db:
        private = db.get(JobDescription, int(response.json()["job_id"]))
        assert private.description == body
        assert private.work_city == cities[0]
        assert private.notes == "工作地点：" + ", ".join(cities)


def test_partial_does_not_close_and_complete_requires_two_misses_and_24h(app, client):
    source = seed(app)
    now = utc_now()
    sync(app, source, [observation()], now=now)
    sync(app, source, [], now=now + timedelta(hours=1), complete=False)
    with app.state.session_factory() as db:
        job = db.scalar(select(GlobalJob))
        assert job.availability_status == "active" and job.missing_count == 0
    sync(app, source, [], now=now + timedelta(hours=2))
    sync(app, source, [], now=now + timedelta(hours=3))
    with app.state.session_factory() as db:
        job = db.scalar(select(GlobalJob))
        assert job.availability_status == "missing" and job.missing_count == 2
    sync(app, source, [], now=now + timedelta(hours=26))
    with app.state.session_factory() as db:
        job = db.scalar(select(GlobalJob))
        assert job.availability_status == "closed"
        identifier = str(job.id)
    assert client.post(f"/api/job-pool/{identifier}/join").status_code == 409
    sync(app, source, [observation()], now=now + timedelta(hours=27), complete=False)
    with app.state.session_factory() as db:
        job = db.scalar(select(GlobalJob))
        assert job.availability_status == "active" and job.missing_count == 0 and job.missing_since is None


def test_source_fencing_and_anomaly_review_once(app, client):
    source = seed(app)
    now = utc_now()
    sync(app, source, [observation(str(i)) for i in range(20)], now=now)
    generation = sync(app, source, [], now=now + timedelta(hours=1))
    with app.state.session_factory() as db:
        row = db.get(GlobalJobSource, source)
        assert row.sync_status == "anomalous"
        assert db.scalar(select(func.count()).select_from(GlobalJob).where(GlobalJob.missing_count > 0)) == 0
        service.accept(db, source, generation, now=now + timedelta(hours=1))
        service.accept(db, source, generation, now=now + timedelta(hours=1))
        assert set(db.scalars(select(GlobalJob.missing_count))) == {1}
        service.queue_source(db, source, enabled=True, now=now + timedelta(hours=2))
        with pytest.raises(Exception) as error:
            service.accept(db, source, generation)
        assert error.value.code == "JOB_SYNC_STALE"
        task = service.claim_source(db, source, interval_seconds=43200, now=now + timedelta(hours=2))
        assert service.claim_source(db, source, interval_seconds=43200, now=now + timedelta(hours=2)) is None
        assert not service.write_observations(db, source, generation, [observation()], now=now + timedelta(hours=2))
        assert not service.renew(db, source, task[1], now=now + timedelta(hours=2, seconds=121))
        takeover = service.claim_source(db, source, interval_seconds=43200, now=now + timedelta(hours=2, seconds=121))
        assert takeover and takeover[1] > task[1]
        assert not service.write_observations(db, source, task[1], [observation()], now=now + timedelta(hours=2, seconds=121))


def finish_scoped(app, source_id, jobs, *, filtered=0, now):
    with app.state.session_factory() as db:
        service.queue_source(db, source_id, enabled=True, now=now)
        generation = service.claim_source(db, source_id, interval_seconds=43200, now=now)[1]
        assert service.write_observations(db, source_id, generation, jobs, now=now)
        assert service.finish(db, source_id, generation, SyncResult(jobs=jobs, is_complete=True, filtered_count=filtered), now=now)
        return db.get(GlobalJobSource, source_id).last_sync_result


def test_new_admission_scope_rebaselines_once_instead_of_reporting_a_drop(app, client):
    source = seed(app)
    with app.state.session_factory() as db:
        # Baseline counted before the scope existed.
        db.get(GlobalJobSource, source).last_sync_result = {"schema_version": 1, "baseline_count": 100}
        db.commit()
    now = utc_now()
    summary = finish_scoped(app, source, [observation(str(i)) for i in range(30)], filtered=70, now=now)
    with app.state.session_factory() as db:
        assert db.get(GlobalJobSource, source).sync_status == "succeeded"
    assert summary["baseline_count"] == 30 and summary["scope_version"] == service.SCOPE_VERSION
    assert summary["latest"]["counts"]["filtered"] == 70 and summary["latest"]["observed_count"] == 30
    summary = finish_scoped(app, source, [observation(str(i)) for i in range(10)], now=now + timedelta(hours=1))
    with app.state.session_factory() as db:
        assert db.get(GlobalJobSource, source).sync_status == "anomalous"
    assert summary["latest"]["error_code"] == "JOB_SOURCE_COUNT_DROP"


def test_release_script_closes_out_of_scope_jobs_and_recategorizes_the_rest(app, client):
    path = Path(__file__).resolve().parents[3] / "scripts/release/close_out_of_scope_jobs.py"
    spec = importlib.util.spec_from_file_location("linkresume_close_out_of_scope_jobs_test", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    source = seed(app)
    sync(app, source, [
        observation("1", job_title="后端开发工程师"),
        observation("2", job_title="大客户销售", job_category="市场/销售"),
        observation("3", locations={"schema_version": 1, "cities": ["新加坡"], "raw": ["新加坡"]}),
        observation("4", locations={"schema_version": 1, "cities": ["上海", "东京"], "raw": ["上海市", "东京"]}),
    ])
    assert script.apply_scope(app.state.session_factory, execute=False) == (2, 2)
    with app.state.session_factory() as db:
        assert set(db.scalars(select(GlobalJob.availability_status))) == {"active"}
    assert script.apply_scope(app.state.session_factory, execute=True) == (2, 2)
    with app.state.session_factory() as db:
        jobs = {job.source_job_key: job for job in db.scalars(select(GlobalJob))}
        assert {key for key, job in jobs.items() if job.availability_status == "closed"} == {"id:2", "id:3"}
        assert jobs["id:1"].job_category == "后端"
        assert jobs["id:4"].job_category == "研发" and jobs["id:4"].locations["cities"] == ["上海"]
    assert script.apply_scope(app.state.session_factory, execute=True) == (0, 0)


def test_catalog_registers_automatically_and_protected_source_config(app, client):
    assert client.get("/api/admin/job-pool/sources").status_code == 403
    with app.state.session_factory() as db:
        user = db.scalar(select(User))
        user.is_admin = True
        db.commit()
    service.register_catalog(app.state.session_factory)
    result = client.get("/api/admin/job-pool/sources")
    assert result.status_code == 200, result.text
    assert "catalog_counts" not in result.json()
    assert client.post("/api/admin/job-pool/sources/bootstrap").status_code in {404, 405}
    rows = result.json()["items"]
    assert len(rows) == len(CATALOG) and all(not row["is_enabled"] for row in rows)
    catl_sources = [row for row in rows if row["tenant_key"] == "catlhr"]
    assert len(catl_sources) == 2 and len({row["company_id"] for row in catl_sources}) == 1
    assert {row["portal_config"]["site_id"] for row in catl_sources} == {96144, 148948}
    xcmg_sources = [row for row in rows if row["tenant_key"] == "xcmg"]
    assert len(xcmg_sources) == 2 and len({row["company_id"] for row in xcmg_sources}) == 1
    assert {row["portal_config"]["site_id"] for row in xcmg_sources} == {148090, 148091}
    service.register_catalog(app.state.session_factory)
    assert len(client.get("/api/admin/job-pool/sources").json()["items"]) == len(CATALOG)
    dewu = [row for row in rows if row["company_name"] == "得物"]
    assert len(dewu) == 2 and dewu[0]["company_id"] == dewu[1]["company_id"]
    source = next(row for row in rows if row["adapter_key"] == "tencent")
    changed = client.patch(f"/api/admin/job-pool/sources/{source['id']}", json={"base_generation": source["sync_generation"], "is_enabled": True})
    assert changed.status_code == 200
    queued = client.post(f"/api/admin/job-pool/sources/{source['id']}/sync")
    assert queued.status_code == 202
    assert client.post(f"/api/admin/job-pool/sources/{source['id']}/sync").status_code == 200
    assert client.patch(f"/api/admin/job-pool/sources/{source['id']}", json={"base_generation": "0", "is_enabled": False}).status_code == 409
    malicious = client.post("/api/admin/job-pool/sources", json={"company_id": source["company_id"], "adapter_key": "feishu",
        "portal_config": {"schema_version": 1, "host": "127.0.0.1", "portals": ["index"]}})
    assert malicious.status_code == 400


def test_failed_join_rolls_back_everything(app, client, monkeypatch):
    source = seed(app)
    sync(app, source, [observation()])
    identifier = client.get("/api/job-pool").json()["items"][0]["id"]
    def fail(*args, **kwargs):
        raise RuntimeError("fictional transaction failure")
    monkeypatch.setattr(service, "ensure_pending_application_for_job", fail)
    with pytest.raises(RuntimeError):
        client.post(f"/api/job-pool/{identifier}/join")
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(JobDescription)) == 0
        assert db.scalar(select(func.count()).select_from(JobApplication)) == 0


def test_personal_delete_releases_join_without_deleting_pool(app, client):
    source = seed(app)
    sync(app, source, [observation()])
    identifier = client.get("/api/job-pool").json()["items"][0]["id"]
    first = client.post(f"/api/job-pool/{identifier}/join").json()
    assert client.delete("/api/job-descriptions/" + first["job_id"]).status_code == 200
    assert client.get(f"/api/job-pool/{identifier}").status_code == 200
    assert client.post(f"/api/job-pool/{identifier}/join").status_code == 201


def test_worker_persists_only_valid_partial_results_and_preserves_baseline(app, monkeypatch):
    from linkresume.workers import job_pool_worker as worker
    source = seed(app)
    sync(app, source, [observation("old")])
    with app.state.session_factory() as db:
        service.queue_source(db, source, enabled=True)
    class HTTP:
        closed = False
        def __init__(self, **kwargs):
            pass
        async def close(self):
            HTTP.closed = True
    class Adapter:
        def __init__(self, *args, **kwargs):
            pass
        async def collect(self, *args):
            return SyncResult(jobs=[observation("new")], is_complete=False, error_code="JOB_SOURCE_NETWORK_ERROR")
    monkeypatch.setattr(worker, "OfficialAdapter", Adapter)
    asyncio.run(worker.JobPoolProcessor(app.state.session_factory, app.state.settings, HTTP).process(source))
    assert HTTP.closed
    with app.state.session_factory() as db:
        row = db.get(GlobalJobSource, source)
        assert row.sync_status == "partial" and row.last_sync_result["baseline_count"] == 1
        assert row.last_sync_result["latest"]["counts"]["created"] == 1
        assert db.scalar(select(func.count()).select_from(GlobalJob)) == 2
        assert set(db.scalars(select(GlobalJob.missing_count))) == {0}


def test_worker_write_failure_keeps_committed_chunks_without_missing_checks(app, monkeypatch):
    from linkresume.workers import job_pool_worker as worker
    source = seed(app)
    sync(app, source, [observation("old")])
    with app.state.session_factory() as db:
        service.queue_source(db, source, enabled=True)
    class HTTP:
        def __init__(self, **kwargs):
            pass
        async def close(self):
            pass
    class Adapter:
        def __init__(self, *args, **kwargs):
            pass
        async def collect(self, *args):
            return SyncResult(jobs=[observation(str(index)) for index in range(101)], is_complete=True)
    write = service.write_observations
    calls = 0
    def failing_write(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("fictional second chunk failure")
        return write(*args, **kwargs)
    monkeypatch.setattr(worker, "OfficialAdapter", Adapter)
    monkeypatch.setattr(service, "write_observations", failing_write)
    asyncio.run(worker.JobPoolProcessor(app.state.session_factory, app.state.settings, HTTP).process(source))
    with app.state.session_factory() as db:
        row = db.get(GlobalJobSource, source)
        assert row.sync_status == "partial" and row.last_sync_result["baseline_count"] == 1
        assert row.last_sync_result["latest"]["error_code"] == "JOB_SOURCE_WRITE_FAILED"
        assert row.last_sync_result["latest"]["counts"]["created"] == 100
        assert set(db.scalars(select(GlobalJob.missing_count))) == {0}


def finish_with_logo(app, source_id, storage, data, **values):
    logo = "https://cdn.multilingualres.hr.tencent.com/tencentcareer/static/images/fictional-brand.png"
    with app.state.session_factory() as db:
        service.queue_source(db, source_id, enabled=True)
        task = service.claim_source(db, source_id, interval_seconds=43200)
        assert service.finish(db, source_id, task[1], SyncResult(company_logo_url=logo, company_logo_bytes=data,
            **values), storage=storage)
        return db.get(GlobalJobSource, source_id).last_sync_result["latest"]["company_logo_error_code"]


def test_official_logo_is_stored_on_site_and_is_visible_in_pool_and_personal_snapshot(app, client):
    from tests.integration.api.test_company_logos import LogoStorage, picture
    storage = LogoStorage()
    source_id = seed(app)
    sync(app, source_id, [observation()])
    assert finish_with_logo(app, source_id, storage, picture("red"), jobs=[observation()], is_complete=True) is None
    job = client.get("/api/job-pool").json()["items"][0]
    logo = job["company"]["logo_url"]
    assert logo.startswith("/api/company-logos/") and f"public-company-logos/{logo[19:]}" in storage.objects
    assert client.get("/api/job-pool/" + job["id"]).json()["company"]["logo_url"] == logo
    joined = client.post("/api/job-pool/" + job["id"] + "/join").json()
    with app.state.session_factory() as db:
        assert db.get(JobDescription, int(joined["job_id"])).logo_url == logo
        assert db.get(JobApplication, int(joined["application_id"])).job_snapshot["logo_url"] == logo
        company = db.get(GlobalCompany, db.get(GlobalJobSource, source_id).company_id)
        assert company.logo_source == "official"
    # A newer official image replaces the old one; an admin choice is never replaced.
    assert finish_with_logo(app, source_id, storage, picture("blue"), is_complete=False) is None
    with app.state.session_factory() as db:
        company = db.get(GlobalCompany, db.get(GlobalJobSource, source_id).company_id)
        assert company.logo_url != logo
        company.logo_source = "admin"
        chosen = company.logo_url
        db.commit()
    assert finish_with_logo(app, source_id, storage, picture("green"), is_complete=False) is None
    with app.state.session_factory() as db:
        assert db.get(GlobalCompany, db.get(GlobalJobSource, source_id).company_id).logo_url == chosen
        assert db.get(JobDescription, int(joined["job_id"])).logo_url == logo
        assert db.get(JobApplication, int(joined["application_id"])).job_snapshot["logo_url"] == logo


def test_invalid_official_artwork_is_reported_without_changing_sync_outcome(app, client):
    from tests.integration.api.test_company_logos import LogoStorage
    source_id = seed(app)
    assert finish_with_logo(app, source_id, LogoStorage(), b"<svg></svg>", is_complete=True) == "JOB_SOURCE_LOGO_INVALID"
    with app.state.session_factory() as db:
        row = db.get(GlobalJobSource, source_id)
        assert row.sync_status == "succeeded" and row.last_sync_result["latest"]["error_code"] is None
        assert db.get(GlobalCompany, row.company_id).logo_url is None


def test_stale_or_untrusted_logo_cannot_fill_company_and_logo_failure_is_optional(app, client):
    source_id = seed(app)
    with app.state.session_factory() as db:
        service.queue_source(db, source_id, enabled=True)
        old = service.claim_source(db, source_id, interval_seconds=43200)
        service.queue_source(db, source_id, enabled=True, now=utc_now() + timedelta(seconds=121))
        current = service.claim_source(db, source_id, interval_seconds=43200)
        assert not service.finish(db, source_id, old[1], SyncResult(company_logo_url="https://cdn.multilingualres.hr.tencent.com/fictional.png"))
        assert service.finish(db, source_id, current[1], SyncResult(is_complete=True,
            company_logo_url="https://internal.example.test/logo.png", company_logo_error_code="JOB_SOURCE_LOGO_UNAVAILABLE"))
        row = db.get(GlobalJobSource, source_id)
        assert row.sync_status == "succeeded"
        assert row.last_sync_result["latest"]["error_code"] is None
        assert row.last_sync_result["latest"]["company_logo_error_code"] == "JOB_SOURCE_LOGO_UNAVAILABLE"
        assert db.get(GlobalCompany, row.company_id).logo_url is None


def test_catalog_registration_preserves_existing_source_selection_and_company_logo(app, client):
    config = {'schema_version': 1, 'host': 'jobs.bytedance.com', 'portals': ['campus'], 'site_id': None}
    with app.state.session_factory() as db:
        user = db.scalar(select(User))
        user.is_admin = True
        company = GlobalCompany(company_name='字节跳动', normalized_name='字节跳动',
            logo_url='https://lf3-static.bytednsdoc.com/fictional-existing-brand.png')
        db.add(company)
        db.flush()
        existing = GlobalJobSource(company_id=company.id, adapter_key='feishu', tenant_key='jobs.bytedance.com',
            portal_config=config, is_enabled=1, sync_generation=3)
        db.add(existing)
        db.commit()
        company_id, source_id = company.id, str(existing.id)
    service.register_catalog(app.state.session_factory)
    rows = client.get('/api/admin/job-pool/sources').json()['items']
    assert len(rows) == len(CATALOG)
    preserved = next(row for row in rows if row['id'] == source_id)
    assert preserved['is_enabled'] and preserved['portal_config'] == config
    assert preserved['sync_generation'] == '3'
    with app.state.session_factory() as db:
        assert db.get(GlobalCompany, company_id).logo_url.endswith('/fictional-existing-brand.png')
