import pytest
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


def fake_fetch(monkeypatch, data=None):
    from linkresume.modules.job_descriptions import company_routes
    from tests.integration.api.test_company_logos import picture
    calls = []
    def fetch(url):
        calls.append(url)
        return data if data is not None else picture("green", mark=(10, 10, 390, 60))
    monkeypatch.setattr(company_routes, "fetch_logo", fetch)
    return calls


def test_plugin_external_url_never_becomes_default_and_admin_change_keeps_snapshot(app, client, monkeypatch):
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    source = seed(app)
    sync(app, source, [observation()])
    admin(app)
    company = client.get("/api/admin/companies").json()["items"][0]
    path = "/api/admin/companies/" + company["id"]
    client.patch(path, json={"base_version": "0", "aliases": ["Example Tech"]})
    created = create_import(client, logo_url="https://cdn.example.test/import.png")
    assert created.status_code == 201, created.text
    assert client.get("/api/job-pool").json()["items"][0]["company"]["logo_url"] is None
    job = created.json()["job_description"]
    assert upload(client, job).status_code == 200
    company = client.get("/api/admin/companies").json()["items"][0]
    assert company["logo_source"] == "plugin" and company["logo_url"].startswith("/api/company-logos/")
    calls = fake_fetch(monkeypatch)
    changed = client.patch(path, json={"base_version": company["lock_version"], "logo_url": "https://cdn.example.test/admin.png"})
    assert changed.status_code == 200, changed.text
    assert calls == ["https://cdn.example.test/admin.png"]
    assert changed.json()["logo_source"] == "admin" and changed.json()["logo_url"] != company["logo_url"]
    assert changed.json()["logo_url"].startswith("/api/company-logos/")
    with app.state.session_factory() as db:
        assert db.get(JobDescription, int(job["id"])).logo_url.endswith("import.png")
    assert client.get("/api/job-pool").json()["items"][0]["company"]["logo_url"] == changed.json()["logo_url"]


def test_admin_upload_and_clear_lock_the_company_logo(app, client, monkeypatch):
    from tests.integration.api.test_company_logos import picture
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with app.state.session_factory() as db:
        db.add(GlobalCompany(company_name="虚构公司", normalized_name="虚构公司", aliases=["Example Tech"]))
        db.commit()
    admin(app)
    company = client.get("/api/admin/companies").json()["items"][0]
    path = "/api/admin/companies/" + company["id"]
    uploaded = client.put(path + "/logo", files={"file": ("logo.png", picture("blue"), "image/png")},
        data={"base_version": "0"})
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["logo_source"] == "admin" and uploaded.json()["lock_version"] == "1"
    assert client.get(uploaded.json()["logo_url"]).status_code == 200
    assert client.put(path + "/logo", files={"file": ("logo.png", picture("blue"), "image/png")},
        data={"base_version": "0"}).status_code == 409
    assert client.put(path + "/logo", files={"file": ("logo.png", b"not an image", "image/png")},
        data={"base_version": "1"}).status_code == 422
    cleared = client.patch(path, json={"base_version": "1", "logo_url": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["logo_url"] is None and cleared.json()["logo_source"] == "admin"
    # A cleared admin logo is final: a plugin upload no longer fills it.
    job = create_import(client).json()["job_description"]
    assert upload(client, job).status_code == 200
    assert client.get("/api/admin/companies").json()["items"][0]["logo_url"] is None


def test_admin_logo_address_rejects_internal_hosts_before_any_request(app, client, monkeypatch):
    import socket
    from linkresume.application.job_descriptions import logo_fetch
    from linkresume.core.errors import ApiError
    seed(app)
    admin(app)
    company = client.get("/api/admin/companies").json()["items"][0]
    path = "/api/admin/companies/" + company["id"]
    def resolve(host, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 443))]
    monkeypatch.setattr(logo_fetch.socket, "getaddrinfo", resolve)
    requested = []
    from types import SimpleNamespace
    monkeypatch.setattr(logo_fetch, "httpx", SimpleNamespace(Client=lambda *a, **k: requested.append(1),
        HTTPError=Exception, BaseTransport=object))
    for url in ("https://intranet.example.test/logo.png", "https://127.0.0.1/logo.png",
            "https://[::ffff:127.0.0.1]/logo.png", "https://169.254.169.254/latest"):
        response = client.patch(path, json={"base_version": "0", "logo_url": url})
        assert response.status_code == 422, (url, response.text)
        assert response.json()["error"] == "COMPANY_LOGO_URL_REJECTED"
    assert requested == []
    with pytest.raises(ApiError):
        logo_fetch.validate_logo_url("https://example.test:8443/logo.png")


def test_admin_logo_fetch_does_not_follow_redirects(monkeypatch):
    import httpx
    from linkresume.application.job_descriptions import logo_fetch
    from linkresume.core.errors import ApiError
    monkeypatch.setattr(logo_fetch.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 443))])
    seen = []
    def handler(request):
        seen.append((str(request.url), request.headers["host"]))
        return httpx.Response(302, headers={"location": "https://10.0.0.8/logo.png"})
    with pytest.raises(ApiError) as error:
        logo_fetch.fetch_logo("https://cdn.example.test/logo.png", transport=httpx.MockTransport(handler))
    assert error.value.status_code == 502
    # The connection is pinned to the checked address and the redirect is not followed.
    assert seen == [("https://93.184.216.34/logo.png", "cdn.example.test")]


def test_shared_placeholder_is_suspected_reviewed_and_blocked(app, client):
    from tests.integration.api.test_company_logos import picture
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with app.state.session_factory() as db:
        db.add_all([GlobalCompany(company_name=f"虚构公司{index}", normalized_name=f"虚构公司{index}") for index in range(4)])
        db.commit()
    placeholder = picture("gray", mark=(150, 50, 250, 150))
    for index in range(2):
        assert upload(client, create_import(client, name=f"虚构公司{index}").json()["job_description"], placeholder).status_code == 200
    admin(app)
    shared = [company for company in client.get("/api/admin/companies").json()["items"] if company["logo_url"]]
    assert len(shared) == 2
    # The third different company name makes the image suspected; it is no longer shared.
    third = create_import(client, name="虚构公司2").json()["job_description"]
    assert upload(client, third, placeholder).status_code == 200
    suspected = client.get("/api/admin/companies/logo-fingerprints").json()["items"]
    assert len(suspected) == 1 and suspected[0]["company_count"] == 3
    assert len(suspected[0]["sample_names"]) == 3
    assert client.get(suspected[0]["image_url"]).status_code == 200
    with app.state.session_factory() as db:
        assert db.scalar(select(GlobalCompany).where(GlobalCompany.company_name == "虚构公司2")).logo_url is None
    marked = client.post(f"/api/admin/companies/logo-fingerprints/{suspected[0]['id']}/mark-placeholder")
    assert marked.status_code == 200 and marked.json()["cleared_company_count"] == 2
    assert client.post(f"/api/admin/companies/logo-fingerprints/{suspected[0]['id']}/mark-placeholder").json()["cleared_company_count"] == 0
    assert all(company["logo_url"] is None for company in client.get("/api/admin/companies").json()["items"])
    blocked = upload(client, create_import(client, name="虚构公司3").json()["job_description"], placeholder)
    assert blocked.status_code == 200 and blocked.json() == {"logo_url": None, "revision": "none"}
    allowed = client.post(f"/api/admin/companies/logo-fingerprints/{suspected[0]['id']}/allow")
    assert allowed.json()["status"] == "allowed"
    assert client.get("/api/admin/companies/logo-fingerprints").json()["items"] == []
    assert client.post("/api/admin/companies/logo-fingerprints/999/allow").status_code == 404


def test_low_quality_upload_is_kept_privately_but_not_shared(app, client):
    from io import BytesIO
    from PIL import Image
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    with app.state.session_factory() as db:
        db.add(GlobalCompany(company_name="虚构公司", normalized_name="虚构公司", aliases=["Example Tech"]))
        db.commit()
    tiny = BytesIO()
    Image.new("RGB", (16, 16), "red").save(tiny, format="PNG")
    saved = upload(client, create_import(client).json()["job_description"], tiny.getvalue())
    assert saved.status_code == 200 and saved.json()["revision"] != "none"
    with app.state.session_factory() as db:
        assert db.scalar(select(GlobalCompany)).logo_url is None


def test_unmatched_names_are_counted_assigned_or_ignored(app, client):
    storage = LogoStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    seed(app)
    for name in ("虚构新公司", " 虚构新公司 ", "另一家虚构公司"):
        assert upload(client, create_import(client, name=name).json()["job_description"]).status_code == 200
    assert client.get("/api/admin/companies/unmatched-names").status_code == 403
    admin(app)
    items = client.get("/api/admin/companies/unmatched-names").json()["items"]
    assert [(item["name"], item["hit_count"]) for item in items] == [("虚构新公司", 2), ("另一家虚构公司", 1)]
    company = client.get("/api/admin/companies").json()["items"][0]
    path = f"/api/admin/companies/unmatched-names/{items[0]['id']}"
    assert client.post(path + "/assign", json={"company_id": company["id"], "base_version": "9"}).status_code == 409
    assigned = client.post(path + "/assign", json={"company_id": company["id"], "base_version": company["lock_version"]})
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["aliases"] == ["虚构新公司"]
    assert client.post(path + "/assign", json={"company_id": company["id"], "base_version": "1"}).status_code == 404
    ignored = client.post(f"/api/admin/companies/unmatched-names/{items[1]['id']}/ignore")
    assert ignored.status_code == 204
    assert client.get("/api/admin/companies/unmatched-names").json()["items"] == []
    # The new alias now matches, so the next upload shares the image instead of being recorded.
    assert upload(client, create_import(client, name="虚构新公司").json()["job_description"]).status_code == 200
    assert client.get("/api/admin/companies").json()["items"][0]["logo_url"].startswith("/api/company-logos/")


def test_assigning_a_name_that_matches_another_company_is_rejected(app, client):
    from linkresume.modules.job_descriptions.models import GlobalCompanyUnmatchedName
    from linkresume.core.database import utc_now
    with app.state.session_factory() as db:
        db.add_all([GlobalCompany(company_name="虚构甲", normalized_name="虚构甲", aliases=["虚构品牌"]),
            GlobalCompany(company_name="虚构乙", normalized_name="虚构乙"),
            GlobalCompanyUnmatchedName(normalized_name="虚构品牌", display_name="虚构品牌", last_seen_time=utc_now())])
        db.commit()
    admin(app)
    target = next(item for item in client.get("/api/admin/companies").json()["items"] if item["name"] == "虚构乙")
    with app.state.session_factory() as db:
        name_id = db.scalar(select(GlobalCompanyUnmatchedName.id))
    response = client.post(f"/api/admin/companies/unmatched-names/{name_id}/assign",
        json={"company_id": target["id"], "base_version": target["lock_version"]})
    assert response.status_code == 409 and response.json()["error"] == "COMPANY_ALIAS_TAKEN"
    with app.state.session_factory() as db:
        assert db.scalar(select(GlobalCompanyUnmatchedName.id)) == name_id


def test_ambiguous_alias_never_shares_personal_logo(app, client):
    with app.state.session_factory() as db:
        db.add_all([GlobalCompany(company_name="虚构甲", normalized_name="虚构甲", aliases=["Example Tech"]),
            GlobalCompany(company_name="虚构乙", normalized_name="虚构乙", aliases=["Example Tech"])])
        db.commit()
    assert create_import(client, logo_url="https://cdn.example.test/private.png").status_code == 201
    with app.state.session_factory() as db:
        assert all(company.logo_url is None for company in db.scalars(select(GlobalCompany)))


def test_matched_upload_publishes_only_clean_bytes_and_retains_old_public_logo(app, client, monkeypatch):
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
    fake_fetch(monkeypatch)
    replaced = client.patch("/api/admin/companies/" + company["id"], json={"base_version": company["lock_version"], "logo_url": "https://cdn.example.test/new.png"})
    assert replaced.status_code == 200 and replaced.json()["logo_url"] != public_url
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


def test_image_group_keeps_at_most_twenty_distinct_company_names(app):
    from linkresume.application.job_descriptions.company_service import MAX_GROUP_NAMES, _observe
    from linkresume.modules.job_descriptions.models import GlobalCompanyLogoFingerprint
    with app.state.session_factory() as db:
        group = GlobalCompanyLogoFingerprint(dhash="0" * 16, sample_sha256="c" * 64, review_status="allowed")
        db.add(group)
        db.flush()
        for index in range(MAX_GROUP_NAMES + 5):
            _observe(db, LogoStorage(), group, f"虚构公司{index % (MAX_GROUP_NAMES + 3)}", b"", "c" * 64)
        assert group.company_count == MAX_GROUP_NAMES == len(set(group.company_names))
