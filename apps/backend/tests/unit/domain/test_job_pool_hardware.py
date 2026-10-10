"""Official hardware and manufacturing contracts use fictional data only."""
import asyncio
import json
from html import escape
from urllib.parse import parse_qs

import httpx
import pytest

from linkresume.application.job_pool.adapters import OfficialAdapter, OfficialHTTP, category
from linkresume.application.job_pool.catalog import CATALOG, entry_for


def source(key):
    return next(item for item in CATALOG if item.key == key)


def collect(key, respond):
    class NoLogo(OfficialAdapter):
        async def company_logo(self, *args):
            return None

    async def run():
        http = OfficialHTTP(transport=httpx.MockTransport(respond), delay=0)
        try:
            entry = source(key)
            return await NoLogo(http).collect(entry.adapter, entry.host, entry.config())
        finally:
            await http.close()
    return asyncio.run(run())


@pytest.mark.parametrize("key", ["catl", "catl-social"])
def test_campus_and_social_moka_sites_keep_separate_registration_and_job_urls(key):
    entry = source(key)
    def respond(request):
        body = json.loads(request.content)
        assert body["orgId"] == "catlhr" and body["siteId"] == entry.site_id
        if request.url.path.endswith("jobs/v2"):
            data = {"jobs": [{"id": "fictional-1", "title": "示例工程师"}]}
        else:
            data = {"id": "fictional-1", "orgId": "catlhr", "jobDescription": "开发虚构系统，要求掌握Python"}
        return httpx.Response(200, json={"code": 0, "success": True, "data": data})
    result = collect(key, respond)
    assert result.is_complete and len(result.jobs) == 1
    assert result.jobs[0].source_url == entry.url.rstrip("/") + "#/job/fictional-1"
    assert result.jobs[0].recruitment_channel == ("campus" if key == "catl" else "experienced")
    assert entry_for(entry.adapter, entry.host, entry.config()) == entry
    with pytest.raises(StopIteration):
        entry_for(entry.adapter, entry.host, entry.config() | {"site_id": 123})


@pytest.mark.parametrize("key", ["catl", "catl-social"])
def test_moka_campus_and_social_logo_reads_the_registered_site_not_the_other_channel(key):
    entry = source(key)
    image = "https://public-cdn.mokahr.com/catlhr/fictional-brand.png"
    class HTTP:
        async def request(self, url, **kwargs):
            assert url == entry.url and kwargs["same_url_retry"] is True
            data = {"siteId": entry.site_id, "org": {"id": "catlhr", "logo": image}}
            return '<input id="init-data" value="' + escape(json.dumps(data), quote=True) + '">'
    assert asyncio.run(OfficialAdapter(HTTP()).company_logo(entry.adapter, entry.host, entry.config())) == image


def haier_html(identifier="fictional-1", *, requirements=True):
    value = '<span class="collection" data-id="' + identifier + '"></span>'
    value += '<div class="title1"><span>职责描述</span></div><div class="cb-wordwrap"><div>开发虚构系统</div><p>维护平台</p></div>'
    if requirements:
        value += '<div class="title1">任职要求</div><div class="cb-wordwrap">掌握Python<script>hidden()</script><br>善于协作</div>'
    return value + '<div class="title1">工作地点</div><div class="cb-wordwrap">示例园区</div>'


def test_haier_reads_nested_full_sections_and_ignores_other_page_content():
    def respond(request):
        if request.method == "POST":
            form = parse_qs(request.content.decode())
            assert form == {"page": ["1"], "pagesize": ["50"]}
            row = {"id": "fictional-1", "job_name": "示例生产工程师", "location": "江苏省-苏州市",
                "func_desc": "生产制造", "salary_label": "薪资面议", "bu_name": "示例事业部",
                "update_time": "2026-01-01", "private_extra": "must not persist"}
            return httpx.Response(200, json={"status": 1, "data": {"count": 1, "list": [row]}})
        return httpx.Response(200, text=haier_html())
    result = collect("haier", respond)
    job = result.jobs[0]
    assert result.is_complete and result.invalid_count == 0
    assert all(value in job.description for value in ["开发虚构系统", "维护平台", "掌握Python", "善于协作"])
    assert "hidden" not in job.description and "示例园区" not in job.description
    assert job.job_category == "生产/制造" and job.locations["cities"] == ["苏州"]
    assert job.recruitment_channel == job.employment_type == "unknown" and job.published_at is None
    assert job.source_attributes == {"schema_version": 1, "department": "示例事业部"}


@pytest.mark.parametrize("html", [haier_html("another-job"), haier_html(requirements=False), '<div>招聘首页</div>',
    haier_html() + '<div class="title1">职责描述</div><div class="cb-wordwrap">重复内容</div>'])
def test_haier_missing_or_mismatched_sections_keep_collection_partial(html):
    def respond(request):
        if request.method == "POST":
            return httpx.Response(200, json={"status": 1, "data": {"count": 1, "list": [{"id": "fictional-1", "job_name": "示例岗位"}]}})
        return httpx.Response(200, text=html)
    result = collect("haier", respond)
    assert not result.is_complete and not result.jobs and result.invalid_count == 1


def test_haier_provider_failure_is_not_an_empty_complete_result():
    result = collect("haier", lambda request: httpx.Response(200, json={"status": 0, "data": {"count": 0, "list": []}}))
    assert not result.is_complete and result.error_code == "JOB_SOURCE_INVALID_RESPONSE"


def test_oppo_server_page_size_full_details_and_native_identity_are_preserved():
    visited = []
    def respond(request):
        assert request.headers["Tenant-Id"] == "1000"
        assert "authorization" not in request.headers
        if request.method == "POST":
            body = json.loads(request.content)
            visited.append(body["pageNum"])
            assert body["pageSize"] == 50 and not body["projectList"]
            ids = [1, 2] if body["pageNum"] == 1 else [3]
            return httpx.Response(200, json={"code": 0, "data": {"records": [{"idProjPosition": i} for i in ids], "total": 3, "size": 2, "current": body["pageNum"]}})
        ident = request.url.params["id"]
        data = {"idRecruitPosition": int(ident), "atsProjectPositionId": 999, "positionName": "示例工程师",
            "positionDesc": "开发虚构系统", "positionRequire": "掌握Python", "knowledgeSkill": "理解架构",
            "aiCapabilityLevelDesc": "理解AI", "bonusItem": "开源经验", "workCityVOList": [{"workCityName": "上海市"}],
            "recruitmentType": "Intern" if ident == "3" else "Graduate", "positionTypeName": "供应链",
            "projectName": "示例校园项目", "releaseTime": "2026-01-01", "candidate_extra": "must not persist"}
        return httpx.Response(200, json={"code": 0, "data": data})
    result = collect("oppo-campus", respond)
    assert result.is_complete and len(result.jobs) == 3 and visited == [1, 2]
    job = result.jobs[0]
    assert all(value in job.description for value in ["开发虚构系统", "掌握Python", "理解架构", "理解AI", "开源经验"])
    assert job.source_url.endswith("/campus/post/1") and job.source_job_key == "id:1"
    assert job.recruitment_channel == "campus" and job.employment_type == "unknown"
    assert result.jobs[2].recruitment_channel == "unknown" and result.jobs[2].employment_type == "internship"
    assert job.source_attributes == {"schema_version": 1, "batch": "示例校园项目"}


@pytest.mark.parametrize("data", [{"records": [], "total": 0, "size": 50, "current": 2},
    {"records": [], "total": 0, "size": 0, "current": 1},
    {"records": [], "total": 0, "size": True, "current": 1}])
def test_oppo_invalid_pagination_is_never_an_empty_complete_result(data):
    result = collect("oppo-campus", lambda request: httpx.Response(200, json={"code": 0, "data": data}))
    assert not result.is_complete and result.error_code == "JOB_SOURCE_INVALID_RESPONSE"


@pytest.mark.parametrize("detail", [{"idRecruitPosition": 2}, {"idRecruitPosition": 1, "positionName": "示例岗位", "positionDesc": "职责", "positionRequire": None}])
def test_oppo_wrong_identity_or_missing_requirements_keeps_partial(detail):
    def respond(request):
        data = {"records": [{"idProjPosition": 1}], "total": 1, "size": 50, "current": 1} if request.method == "POST" else detail
        return httpx.Response(200, json={"code": 0, "data": data})
    result = collect("oppo-campus", respond)
    assert not result.is_complete and not result.jobs and result.invalid_count == 1


@pytest.mark.parametrize("raw,expected", [("生产制造", "生产/制造"), ("品质", "质量"), ("供应链", "供应链"),
    ("采购", "供应链"), ("软件开发", "研发"), ("陌生类别", None)])
def test_manufacturing_categories_are_searchable_without_guessing_unknown_values(raw, expected):
    assert category(raw) == expected
