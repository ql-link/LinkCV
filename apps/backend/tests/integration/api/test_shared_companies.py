from sqlalchemy import select

from linkresume.core.storage import get_storage
from linkresume.modules.job_descriptions.models import GlobalCompany, JobDescription
from tests.integration.api.test_job_pool import app, client, observation, seed, sync
from tests.integration.api.test_company_logos import LogoStorage, upload
from linkresume.modules.job_pool.models import GlobalJobSource


def admin(app):
    from linkresume.modules.identity.models import User
    with app.state.session_factory() as db:
        db.scalar(select(User)).is_admin = True
        db.commit()


def create_import(client, name="Example Tech", **values):
    return client.post("/api/job-descriptions", json={"job_title": "虚构研发岗位", "company_name": name,
        "description": "负责虚构产品研发", "source_type": "external_import",
        "source_url": "https://www.zhipin.com/job_detail/fictional-shared.html", **values})


def test_company_admin_permissions_alias_validation_and_version_conflict(app, client):
    seed(app)
    assert client.get("/api/admin/companies").status_code == 403
    admin(app)
    company = client.get("/api/admin/companies").json()["items"][0]
    path = "/api/admin/companies/" + company["id"]
    saved = client.patch(path, json={"base_version": "0", "aliases": ["Example Tech", " example tech ", "示例品牌"]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["aliases"] == ["Example Tech", "示例品牌"]
    assert saved.json()["lock_version"] == "1"
    assert client.patch(path, json={"base_version": "0", "logo_url": "https://cdn.example.test/logo.png"}).status_code == 409
    for change in ({"aliases": None}, {"aliases": [" "]}, {"aliases": ["a"] * 31}, {"logo_url": "http://example.test/logo"}, {"logo_url": "https://user:pass@example.test/logo"}, {}):
        assert client.patch(path, json={"base_version": "1", **change}).status_code == 400
    filters = client.get("/api/job-pool/filters").json()["companies"][0]
    assert filters["aliases"] == ["Example Tech", "示例品牌"]


def test_company_write_rechecks_admin_role_after_acquiring_user_lock(app, client, monkeypatch):
    from linkresume.modules.job_descriptions import company_routes
    seed(app)
    admin(app)
    company = client.get("/api/admin/companies").json()["items"][0]
    lock = company_routes.lock_active_user
    def demoted(db, identifier):
        user = lock(db, identifier)
        user.is_admin = False
        return user
    monkeypatch.setattr(company_routes, "lock_active_user", demoted)
    response = client.patch("/api/admin/companies/" + company["id"], json={"base_version": "0", "aliases": ["不能写入"]})
    assert response.status_code == 403
    with app.state.session_factory() as db:
        assert db.get(GlobalCompany, int(company["id"])).aliases == []


def test_multiple_company_filter_and_cursor_are_order_independent(app, client):
    one = seed(app)
    with app.state.session_factory() as db:
        company = GlobalCompany(company_name="示例制造", normalized_name="示例制造")
        db.add(company)
        db.flush()
        source = GlobalJobSource(company_id=company.id, adapter_key="feishu", tenant_key="jobs.bytedance.com",
            portal_config={"schema_version": 1, "host": "jobs.bytedance.com", "portals": ["campus"], "site_id": None}, is_enabled=1)
        db.add(source)
        db.commit()
        two = source.id
    sync(app, one, [observation("1"), observation("2")])
    sync(app, two, [observation("3")])
    companies = client.get("/api/job-pool/filters").json()["companies"]
    ids = [company["id"] for company in companies]
    params = [("company_ids", identifier) for identifier in ids] + [("limit", "1")]
    first = client.get("/api/job-pool", params=params).json()
    assert len(first["items"]) == 1 and first["next_cursor"]
    next_page = client.get("/api/job-pool", params=[("company_ids", ids[1]), ("company_ids", ids[0]),
        ("company_ids", ids[0]), ("cursor", first["next_cursor"])])
    assert next_page.status_code == 200, next_page.text
    assert client.get("/api/job-pool", params={"company_id": ids[0]}).status_code == 200
    assert client.get("/api/job-pool", params={"company_ids": "0"}).status_code == 400
    assert client.get("/api/job-pool", params=[("company_ids", "1")] * 201).status_code == 400


def test_plugin_alias_match_shares_logo_and_admin_change_keeps_snapshot(app, client):
    source = seed(app)
    sync(app, source, [observation()])
    admin(app)
    company = client.get("/api/admin/companies").json()["items"][0]
    path = "/api/admin/companies/" + company["id"]
    client.patch(path, json={"base_version": "0", "aliases": ["Example Tech"]})
    created = create_import(client, logo_url="https://cdn.example.test/import.png")
    assert created.status_code == 201, created.text
    assert client.get("/api/job-pool").json()["items"][0]["company"]["logo_url"].endswith("import.png")
    company = client.get("/api/admin/companies").json()["items"][0]
    assert company["logo_source"] == "plugin"
    job = created.json()["job_description"]
    assert client.patch(path, json={"base_version": company["lock_version"], "logo_url": "https://cdn.example.test/admin.png"}).status_code == 200
    with app.state.session_factory() as db:
        assert db.get(JobDescription, int(job["id"])).logo_url.endswith("import.png")
    assert client.get("/api/job-pool").json()["items"][0]["company"]["logo_url"].endswith("admin.png")


def test_ambiguous_alias_never_shares_personal_logo(app, client):
    with app.state.session_factory() as db:
        db.add_all([GlobalCompany(company_name="虚构甲", normalized_name="虚构甲", aliases=["Example Tech"]),
            GlobalCompany(company_name="虚构乙", normalized_name="虚构乙", aliases=["Example Tech"])])
        db.commit()
    assert create_import(client, logo_url="https://cdn.example.test/private.png").status_code == 201
    with app.state.session_factory() as db:
        assert all(company.logo_url is None for company in db.scalars(select(GlobalCompany)))


def test_matched_upload_publishes_only_clean_bytes_and_retains_old_public_logo(app, client):
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with app.state.session_factory() as db:
        db.add(GlobalCompany(company_name="虚构公司", normalized_name="虚构公司", aliases=["Example Tech"]))
        db.commit()
    created = create_import(client)
    assert created.status_code == 201, created.text
    job = created.json()["job_description"]
    result = upload(client, job)
    assert result.status_code == 200, result.text
    private_url = result.json()["logo_url"]
    admin(app)
    company = client.get("/api/admin/companies").json()["items"][0]
    public_url = company["logo_url"]
    assert public_url.startswith("/api/company-logos/")
    assert company["logo_source"] == "plugin"
    client.patch("/api/admin/companies/" + company["id"], json={"base_version": company["lock_version"], "logo_url": "https://cdn.example.test/new.png"})
    client.post("/api/auth/logout")
    assert client.get(private_url).status_code == 401
    image = client.get(public_url)
    assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
    assert image.headers["cache-control"].startswith("public")
    assert client.get(public_url, headers={"If-None-Match": image.headers["etag"]}).status_code == 304
    assert client.get("/api/company-logos/" + "a" * 64 + ".webp").status_code == 404


def test_unmatched_uploaded_images_are_not_public(app, client):
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    job = create_import(client).json()["job_description"]
    result = upload(client, job)
    assert result.status_code == 200
    assert not any(name.startswith("public-company-logos/") for name in storage.objects)
    digest = result.json()["revision"]
    assert client.get(f"/api/company-logos/{digest}.webp").status_code == 404


def test_shared_storage_failure_does_not_block_private_logo(app, client):
    class PartialStorage(LogoStorage):
        def put(self, name, *args, **kwargs):
            if name.startswith("public-company-logos/"):
                raise RuntimeError("fictional public storage failure")
            super().put(name, *args, **kwargs)
    storage = PartialStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with app.state.session_factory() as db:
        db.add(GlobalCompany(company_name="虚构公司", normalized_name="虚构公司", aliases=["Example Tech"]))
        db.commit()
    job = create_import(client).json()["job_description"]
    saved = upload(client, job)
    assert saved.status_code == 200
    assert client.get(saved.json()["logo_url"]).status_code == 200
    with app.state.session_factory() as db:
        assert db.scalar(select(GlobalCompany)).logo_url is None


def test_new_private_job_uses_immutable_shared_default_without_mutating_old_job(app, client):
    from linkresume.application.interviews.service import application_logo_url
    from linkresume.modules.interviews.models import JobApplication
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with app.state.session_factory() as db:
        db.add(GlobalCompany(company_name="虚构公司", normalized_name="虚构公司", aliases=["Example Tech"]))
        db.commit()
    imported = create_import(client).json()["job_description"]
    assert upload(client, imported).status_code == 200
    created = client.post("/api/job-descriptions", json={"job_title": "新的虚构岗位", "company_name": "Example Tech", "source_type": "manual"})
    assert created.status_code == 201, created.text
    new_job = created.json()["job_description"]
    assert new_job["logo_url"].startswith("/api/company-logos/")
    updated = client.put("/api/job-descriptions/" + new_job["id"], json={"base_lock_version": new_job["lock_version"], "logo_url": new_job["logo_url"]})
    assert updated.status_code == 200, updated.text
    source_id = seed(app)
    sync(app, source_id, [observation()])
    with app.state.session_factory() as db:
        source_company = db.get(GlobalCompany, db.get(GlobalJobSource, source_id).company_id)
        source_company.logo_url = new_job["logo_url"]
        db.commit()
    pool_job = client.get("/api/job-pool").json()["items"][0]
    joined = client.post("/api/job-pool/" + pool_job["id"] + "/join").json()
    with app.state.session_factory() as db:
        assert application_logo_url(db.get(JobApplication, int(joined["application_id"]))) == new_job["logo_url"]
