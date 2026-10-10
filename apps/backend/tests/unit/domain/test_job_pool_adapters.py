import asyncio

import httpx
import pytest

from linkresume.application.job_pool.adapters import CollectionError, OfficialAdapter, OfficialHTTP
from linkresume.application.job_pool.catalog import CATALOG, validate_source
from linkresume.application.job_pool.types import JobObservation, cities, clean_text, job_key, source_date
from linkresume.core.errors import ApiError


def fictional_job(key="1"):
    return JobObservation(source_job_key="id:" + key, job_title="示例工程师", description="开发虚构平台，要求掌握 Python。",
        locations=cities(["上海市"]), source_url="https://careers.tencent.com/jobdesc.html?postId=" + key)


class PagedReader(OfficialAdapter):
    def __init__(self, pages, **kwargs):
        super().__init__(None, **kwargs)
        self.pages = pages
        self.visited = []

    async def page(self, adapter, tenant, config, portal, page):
        self.visited.append((portal, page))
        value = self.pages[page - 1]
        if isinstance(value, Exception):
            raise value
        return value

    async def normalize(self, adapter, tenant, config, portal, row):
        if row.get("invalid"):
            raise ValueError("incomplete fictional JD")
        return fictional_job(row["id"])


def collect(reader, key="tencent"):
    source = next(item for item in CATALOG if item.key == key)
    config = source.config()
    config["portals"] = config["portals"][:1]
    return asyncio.run(reader.collect(source.adapter, source.host, config))


def test_pagination_visits_terminal_page_and_deduplicates_native_identity():
    reader = PagedReader([([{"id": "1"}, {"id": "2"}], "2", 2), ([], "2", 2)])
    result = collect(reader)
    assert result.is_complete and len(result.jobs) == 2
    assert reader.visited == [("social", 1), ("social", 2)]


@pytest.mark.parametrize("failure", [CollectionError("JOB_SOURCE_NETWORK_ERROR"), KeyError("changed response field")])
def test_late_response_failure_keeps_valid_observations_but_never_complete(failure):
    result = collect(PagedReader([([{"id": "1"}], 2, 1), failure]))
    assert not result.is_complete and len(result.jobs) == 1 and result.error_code


@pytest.mark.parametrize("pages,expected", [
    ([([{"id": "1"}], 2, 1), ([{"id": "1"}], 2, 1)], "JOB_SOURCE_PAGINATION_REPEATED"),
    ([([{"id": "1"}], 2, 2)], "JOB_SOURCE_COUNT_MISMATCH"),
    ([([{"id": "1", "invalid": True}], 1, 2)], "JOB_SOURCE_COUNT_MISMATCH"),
])
def test_incomplete_or_repeated_pages_are_not_an_offline_signal(pages, expected):
    result = collect(PagedReader(pages))
    assert not result.is_complete and result.error_code == expected


def test_page_limit_and_feishu_result_cap_remain_partial():
    result = collect(PagedReader([([{"id": "1"}], None, 1)], max_pages=1))
    assert result.error_code == "JOB_SOURCE_PAGE_LIMIT" and not result.is_complete
    result = collect(PagedReader([([], 10000, 50)]), "bytedance")
    assert result.error_code == "JOB_SOURCE_RESULT_CAP" and not result.is_complete


def test_count_changing_during_walk_is_not_complete():
    result = collect(PagedReader([([{"id": "1"}], 1, 1), ([], 2, 1)]))
    assert result.error_code == "JOB_SOURCE_COUNT_CHANGED" and not result.is_complete


def test_job_data_is_safe_versioned_and_retains_identity():
    assert clean_text("<p>岗位</p><script>secret()</script><p>要求 &amp; 技能</p>") == "岗位\n\n要求 & 技能"
    assert cities(["上海市", "上海", "上海市"]) == {"schema_version": 1, "cities": ["上海"], "raw": ["上海市", "上海"]}
    assert source_date("2026-01-01 08:00:00").isoformat() == "2026-01-01T00:00:00+00:00"
    assert source_date("invalid") is None
    assert job_key(None, "https://example.test/job?id=1") != job_key(None, "https://example.test/job?id=2")
    with pytest.raises(ValueError):
        fictional_job().model_validate(fictional_job().model_dump() | {"source_attributes": {"schema_version": 1, "recruiter_email": "fictional@example.test"}})


def test_catalog_is_whitelisted_and_disallows_duplicate_portals():
    assert len(CATALOG) == 190 and len({item.name for item in CATALOG}) == 183
    assert len({(item.adapter, item.host) for item in CATALOG}) == len(CATALOG)
    assert all(item.adapter != "pending" for item in CATALOG)
    for source in CATALOG:
        assert validate_source(source.adapter, source.config()) == source.host
    with pytest.raises(ApiError):
        validate_source("feishu", {"host": "internal.example.test", "portals": ["index"]})
    with pytest.raises(ApiError):
        validate_source("tencent", {"host": "careers.tencent.com", "portals": ["social", "social"]})


def test_http_retry_size_guard_redirect_and_non_json(monkeypatch):
    async def no_delay(*args):
        pass
    monkeypatch.setattr(asyncio, "sleep", no_delay)
    attempts = []
    def responder(request):
        attempts.append(request)
        if len(attempts) < 3:
            return httpx.Response(429)
        return httpx.Response(200, json={"ok": True})
    async def exercise():
        http = OfficialHTTP(transport=httpx.MockTransport(responder), delay=0)
        try:
            assert await http.request("https://example.test/api") == {"ok": True}
            with pytest.raises(CollectionError) as denied:
                await http.request("http://127.0.0.1/api")
            assert denied.value.code == "JOB_SOURCE_UNSAFE_URL"
        finally:
            await http.close()
        for response, expected in [(httpx.Response(200, content=b"x" * 100), "JOB_SOURCE_RESPONSE_TOO_LARGE"),
            (httpx.Response(302, headers={"location": "http://127.0.0.1"}), "JOB_SOURCE_HTTP_ERROR"),
            (httpx.Response(200, text="not JSON"), "JOB_SOURCE_INVALID_RESPONSE")]:
            http = OfficialHTTP(transport=httpx.MockTransport(lambda request: response), max_bytes=20, delay=0)
            try:
                with pytest.raises(CollectionError) as error:
                    await http.request("https://example.test/api")
                assert error.value.code == expected
            finally:
                await http.close()
    asyncio.run(exercise())
    assert len(attempts) == 3


@pytest.mark.parametrize("adapter,tenant,portal,row", [
    ("meituan", "zhaopin.meituan.com", "intern", {"jobUnionId": "fictional1", "name": "示例工程师", "jobDuty": "开发虚构系统", "jobRequirement": "掌握Python", "cityList": [{"name": "上海市"}]}),
    ("baidu", "talent.baidu.com", "GRADUATE", {"postId": "fictional1", "name": "示例工程师", "workContent": "开发虚构系统", "serviceCondition": "掌握Python", "workPlace": "上海市"}),
    ("xiaohongshu", "job.xiaohongshu.com", "campus", {"positionId": "fictional1", "positionName": "示例工程师", "duty": "开发虚构系统", "qualification": "掌握Python", "workplace": "上海市，北京市"}),
    ("pdd", "careers.pddglobalhr.com", "intern", {"id": "fictional1", "name": "示例工程师", "jobDuty": "职责：开发虚构系统；要求：掌握Python", "workLocation": "上海市"}),
    ("ctrip", "job.ctrip.com", "social", {"fromId": "fictional1", "jobTitle": "示例工程师", "duty": None, "requirements": "职责：开发虚构系统；要求：掌握Python", "cityName": "上海市"}),
    ("kuaishou", "campus.kuaishou.cn", "campus", {"id": "fictional1", "name": "示例工程师", "description": "开发虚构系统", "positionDemand": "掌握Python", "workLocationDicts": [{"name": "上海市"}]}),
])
def test_verified_official_field_shapes(adapter, tenant, portal, row):
    job = asyncio.run(OfficialAdapter(None).normalize(adapter, tenant, {}, portal, row))
    assert job.description and "上海" in job.locations["cities"]
    if portal == "intern":
        assert job.employment_type == "internship"
    if portal in {"campus", "GRADUATE"}:
        assert job.recruitment_channel == "campus"


def test_feishu_legitimate_null_requirement_requires_confirmed_full_detail():
    row = {"id": "fictional1", "title": "示例平台工程师", "description": "开发虚构平台", "requirement": None,
        "city_list": [{"name": "上海市"}], "recruit_type": {"name": "全职", "parent": {"name": "社招"}}}
    class HTTP:
        async def request(self, url, **kwargs):
            assert "/api/v1/job/posts/fictional1?portal_type=2" in url
            return {"code": 0, "data": {"job_post_detail": row}}
    result = asyncio.run(OfficialAdapter(HTTP()).normalize("feishu", "vrfi1sk8a0.jobs.feishu.cn", {}, "index", row))
    assert result.description == "开发虚构平台" and result.employment_type == "full_time"


def test_alibaba_explicit_zero_with_null_list_is_empty_not_failure():
    class HTTP:
        async def request(self, url, **kwargs):
            return {"success": True, "content": {"datas": None, "totalCount": 0}}
    reader = OfficialAdapter(HTTP())
    reader.sessions["campus-talent.alibaba.com"] = "fictional-anonymous-token"
    rows, total, size = asyncio.run(reader.page("alibaba", "campus-talent.alibaba.com", {}, "intern", 1))
    assert rows == [] and total == 0 and size == 10


@pytest.mark.parametrize('location', [None, '/another-page', 'https://elsewhere.example.test/page', 'http://example.test/page', '/page'])
def test_anonymous_cookie_replay_only_visits_the_same_https_page_once(location):
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(302, headers={'location': location, 'set-cookie': 'anonymous=fictional; Path=/'} if location else {})
    async def exercise():
        http = OfficialHTTP(transport=httpx.MockTransport(respond), delay=0)
        try:
            with pytest.raises(CollectionError):
                await http.request('https://example.test/page', as_text=True, same_url_retry=True)
        finally:
            await http.close()
    asyncio.run(exercise())
    assert len(requests) == (2 if location == '/page' else 1)
    assert all(str(r.url) == 'https://example.test/page' for r in requests)


def test_anonymous_cookie_replay_reads_page_without_following_another_destination():
    requests = []
    def respond(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(302, headers={'location': '/page', 'set-cookie': 'anonymous=fictional; Path=/'})
        assert request.headers['cookie'] == 'anonymous=fictional'
        return httpx.Response(200, text='fictional tenant page')
    async def exercise():
        http = OfficialHTTP(transport=httpx.MockTransport(respond), delay=0)
        try:
            assert await http.request('https://example.test/page', as_text=True, same_url_retry=True) == 'fictional tenant page'
        finally:
            await http.close()
    asyncio.run(exercise())
    assert len(requests) == 2


@pytest.mark.parametrize('portal,expected', [('index', ('experienced', 'full_time')), ('campus', ('campus', 'full_time')), ('internship', ('campus', 'internship'))])
def test_xiaomi_uses_its_portal_type_for_list_and_confirmed_full_detail(portal, expected):
    row = {'id': 'fictional1', 'title': '示例工程师', 'description': '开发虚构平台', 'requirement': None,
        'city_info': {'name': '上海市'}, 'recruit_type': {'name': '实习' if portal == 'internship' else '全职', 'parent': {'name': '社招' if portal == 'index' else '校招'}}}
    class HTTP:
        async def request(self, url, **kwargs):
            assert kwargs['headers']['website-path'] == portal
            if '/search/' in url:
                assert kwargs['body']['portal_type'] == 6 and kwargs['body']['offset'] == 50
                return {'code': 0, 'data': {'job_post_list': [row], 'count': 51}}
            assert '?portal_type=6' in url
            return {'code': 0, 'data': {'job_post_detail': row}}
    async def exercise():
        reader = OfficialAdapter(HTTP())
        rows, total, size = await reader.page('feishu', 'xiaomi.jobs.f.mioffice.cn', {}, portal, 2)
        assert total == 51 and size == 50
        job = await reader.normalize('feishu', 'xiaomi.jobs.f.mioffice.cn', {}, portal, rows[0])
        assert (job.recruitment_channel, job.employment_type) == expected
        assert job.locations['cities'] == ['上海'] and job.source_url.endswith('/fictional1/detail')
    asyncio.run(exercise())


def test_ant_campus_mixed_batch_is_walked_completely_and_classified_without_losing_trainees():
    rows = [dict(id=str(i), name='示例工程师', description='开发虚构平台', requirement='掌握Python',
        workLocations=['上海市'], categories=['研发'], batchType='trainee' if i == 9 else 'graduate') for i in range(10)]
    class HTTP:
        async def request(self, url, **kwargs):
            if kwargs.get('as_text'):
                return ''
            assert url == 'https://hrcareersweb.antgroup.com/api/campus/position/search'
            assert kwargs['body']['channel'] == 'campus_group_official_site'
            assert kwargs['headers']['Origin'] == 'https://talent.antgroup.com'
            return {'success': True, 'content': rows if kwargs['body']['pageIndex'] == 1 else [], 'totalCount': 10}
    entry = next(s for s in CATALOG if s.key == 'ant')
    config = entry.config() | {'portals': ['campus']}
    result = asyncio.run(OfficialAdapter(HTTP()).collect(entry.adapter, entry.host, config))
    assert result.is_complete and len(result.jobs) == 10
    assert result.jobs[-1].employment_type == 'internship'
    assert all(j.recruitment_channel == 'campus' for j in result.jobs)


@pytest.mark.parametrize('mismatched_id', [False, True])
def test_mihoyo_uses_full_details_and_preserves_distinct_hash_route_identity(mismatched_id):
    from linkresume.domain.job_source import normalize_job_source
    class HTTP:
        async def request(self, url, **kwargs):
            assert url.endswith('/v1/job/info')
            assert kwargs['body']['hireType'] == 1 and kwargs['body']['jobNatures'] == [3]
            return {'code': 0, 'success': True, 'data': {'id': 'wrong' if mismatched_id else kwargs['body']['id'],
                'title': '示例实习生', 'description': '开发虚构平台', 'jobRequire': '掌握Python',
                'addressDetailList': [{'addressDetail': '上海市'}], 'competencyType': '技术'}}
    async def exercise():
        reader = OfficialAdapter(HTTP())
        if mismatched_id:
            with pytest.raises(ValueError):
                await reader.normalize('mihoyo', 'jobs.mihoyo.com', {}, 'intern', {'id': '1'})
            return
        jobs = [await reader.normalize('mihoyo', 'jobs.mihoyo.com', {}, 'intern', {'id': str(i), 'jobSummary': '摘要'}) for i in (1, 2)]
        assert all(j.description == '开发虚构平台\n\n掌握Python' and j.employment_type == 'internship' for j in jobs)
        assert jobs[0].locations['cities'] == ['上海']
        assert normalize_job_source(jobs[0].source_url).url_hash != normalize_job_source(jobs[1].source_url).url_hash
    asyncio.run(exercise())
