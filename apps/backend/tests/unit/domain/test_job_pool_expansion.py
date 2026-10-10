"""Provider contracts use fictional jobs and never contact public careers sites."""
import asyncio
import base64
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

from linkresume.application.job_pool.adapters import CollectionError, OfficialAdapter, OfficialHTTP
from linkresume.application.job_pool.catalog import CATALOG, validate_source
from linkresume.core.errors import ApiError


def source(key):
    return next(item for item in CATALOG if item.key == key)


class NoLogoAdapter(OfficialAdapter):
    async def company_logo(self, *args):
        return None


def run_transport(responder, exercise):
    async def run():
        http = OfficialHTTP(transport=httpx.MockTransport(responder), delay=0)
        try:
            return await exercise(NoLogoAdapter(http))
        finally:
            await http.close()
    return asyncio.run(run())


def test_expansion_preserves_original_source_identity_and_whitelist():
    old_keys = {'tencent', 'bytedance', 'minimax', 'meituan', 'moonshot', 'baidu', 'jd', 'netease',
        'alibaba', 'kuaishou', 'xiaohongshu', 'bilibili', 'pdd', 'didi', 'ctrip', 'xiaomi', 'ant',
        'mihoyo', 'dewu', 'dewu-campus', 'zhipu', 'lilith', 'kurogame', 'moonton', '01ai', 'deepseek'}
    assert old_keys == {item.key for item in CATALOG[:26]}
    assert len({(item.adapter, item.host) for item in CATALOG}) == len(CATALOG)
    for item in CATALOG[26:]:
        assert validate_source(item.adapter, item.config()) == item.host
        with pytest.raises(ApiError):
            validate_source(item.adapter, item.config() | {'host': 'internal.example.test'})
    assert source('zhihu').site_id == 78336 and '/apply/' in source('zhihu').url
    assert source('huawei').portals == ('SR',)  # Placeholder campus descriptions are not claimed.


@pytest.mark.parametrize('encrypted', [False, True])
def test_moka_reduced_list_reads_full_matching_tenant_detail(encrypted):
    entry = source('sina')
    calls = []
    detail = {'id': 'fictional-1', 'orgId': entry.host, 'title': '示例研发工程师',
        'jobDescription': '<p>开发虚构系统</p><p>掌握Python</p>', 'locations': [{'name': '上海市'}]}
    def respond(request):
        calls.append(request)
        body = json.loads(request.content)
        assert body['orgId'] == entry.host and body['siteId'] == entry.site_id
        value = {'code': 0, 'success': True, 'data': {'jobs': [{'id': 'fictional-1', 'title': '示例研发工程师'}]}}
        if request.url.path.endswith('/job'):
            assert body['jobId'] == 'fictional-1'
            value['data'] = detail
        if encrypted:
            key = b'fictional-key123'
            padder = PKCS7(128).padder()
            raw = padder.update(json.dumps(value).encode()) + padder.finalize()
            enc = Cipher(algorithms.AES(key), modes.CBC(b'de7c21ed8d6f50fe')).encryptor()
            value = {'necromancer': key.decode(), 'data': base64.b64encode(enc.update(raw) + enc.finalize()).decode()}
        return httpx.Response(200, json=value)
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert result.is_complete and len(result.jobs) == 1
    assert result.jobs[0].description == '开发虚构系统\n\n掌握Python'
    assert result.jobs[0].locations['cities'] == ['上海']
    assert len(calls) == 2


@pytest.mark.parametrize('mismatch', [{'id': 'wrong'}, {'orgId': 'another-tenant'}])
def test_moka_detail_mismatch_is_partial_and_keeps_good_jobs(mismatch):
    entry = source('zhihu')
    def respond(request):
        if request.url.path.endswith('/jobs/v2'):
            return httpx.Response(200, json={'code': 0, 'success': True, 'data': {'jobs': [
                {'id': 'good', 'title': '示例岗位', 'jobDescription': '开发虚构系统'},
                {'id': 'bad', 'title': '示例岗位'}]}})
        return httpx.Response(200, json={'code': 0, 'success': True, 'data': {
            'id': 'bad', 'orgId': entry.host, 'jobDescription': '错误详情'} | mismatch})
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert not result.is_complete and result.invalid_count == 1
    assert [j.source_job_key for j in result.jobs] == ['id:good']
    assert '/apply/zhihu/78336' in result.jobs[0].source_url


@pytest.mark.parametrize('bad_detail', [False, True])
def test_cpo_anonymous_csrf_detail_and_placeholder_isolation(bad_detail):
    entry = source('lingxi')
    calls = []
    def respond(request):
        calls.append(request)
        if request.method == 'GET':
            assert request.url.path == '/off-campus/position-list' and not request.url.query
            return httpx.Response(200, text='<script>{__token__: "fictional-csrf"}</script>')
        assert request.headers['X-XSRF-TOKEN'] == 'fictional-csrf'
        assert parse_qs(request.url.query.decode())['_csrf'] == ['fictional-csrf']
        if request.url.path == '/position/search':
            body = json.loads(request.content)
            assert body['pageIndex'] == 1 and body['pageSize'] == 50
            content = {'datas': [{'id': 'fictional-1'}], 'totalCount': '1'}
        else:
            content = {'id': 'fictional-1', 'name': '示例工程师', 'description': '-' if bad_detail else '开发虚构系统',
                'requirement': '-' if bad_detail else '掌握Python', 'workLocations': ['上海市']}
        return httpx.Response(200, json={'success': True, 'content': content})
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert len(calls) == 3
    assert result.is_complete is (not bad_detail)
    assert len(result.jobs) == (0 if bad_detail else 1)
    if bad_detail:
        assert result.invalid_count == 1 and result.error_code
    else:
        assert result.jobs[0].locations['cities'] == ['上海']


def test_cpo_detail_for_another_job_is_rejected():
    class HTTP:
        async def request(self, url, **kwargs):
            return {'success': True, 'content': {'id': 'wrong', 'name': '示例岗位', 'description': '职责', 'requirement': '要求'}}
    reader = OfficialAdapter(HTTP())
    reader.sessions[('cpo', 'careers.aliyun.com')] = 'fictional-csrf'
    with pytest.raises(ValueError):
        asyncio.run(reader.normalize('alibaba-cpo', 'careers.aliyun.com', {}, 'social', {'id': 'requested'}))


@pytest.mark.parametrize('adapter,tenant,portal,row,channel,employment,path', [
    ('beisen', 'iflytek.zhiye.com', '2', {'JobAdId': 'fictional-1', 'JobAdName': '示例工程师', 'Duty': '开发虚构系统',
        'Require': '掌握Python', 'LocNames': '广东省·深圳市,上海市', 'Category': '校园招聘', 'Kind': '实习', 'Salary': '面议'},
        'campus', 'internship', '/campus/detail'),
    ('huawei', 'career.huawei.com', 'SR', {'jobId': 'fictional-1', 'jobName': '示例工程师', 'mainBusiness': '开发虚构系统',
        'jobRequire': '掌握Python', 'workPlace': '上海市/深圳市'}, 'experienced', 'unknown', '/cn/social-recruitment-job-list'),
    ('dji', 'we.dji.com', 'Y', {'positionId': 'fictional-1', 'jobTitle': '示例工程师', 'duty': '开发虚构系统',
        'requirement': '掌握Python', 'locationDescription': '上海市'}, 'unknown', 'internship', '/zh-CN/position/detail'),
    ('jd-campus', 'campus.jd.com', 'present', {'publishId': 'fictional-1', 'positionName': '示例工程师',
        'workContent': '开发虚构系统', 'qualification': '掌握Python', 'workCity': None,
        'requirementVoList': [{'workCity': '上海市'}, {'workCity': '深圳市'}], 'education': 7}, 'campus', 'full_time', '/'),
    ('netease-campus', 'campus.163.com', '69', {'id': 'fictional-1', 'positionName': '示例工程师',
        'positionDescription': '开发虚构系统', 'positionRequirement': '掌握Python', 'workPlaceName': '上海市'},
        'campus', 'full_time', '/app/job/position'),
])
def test_new_native_shapes_keep_full_body_channels_cities_and_distinct_urls(adapter, tenant, portal, row, channel, employment, path):
    async def exercise():
        reader = OfficialAdapter(None)
        first = await reader.normalize(adapter, tenant, {}, portal, row)
        id_field = next(k for k in ('JobAdId', 'jobId', 'positionId', 'publishId', 'id') if k in row)
        second = await reader.normalize(adapter, tenant, {}, portal, row | {id_field: 'fictional-2'})
        return first, second
    first, second = asyncio.run(exercise())
    assert first.description == '开发虚构系统\n\n掌握Python'
    assert first.recruitment_channel == channel and first.employment_type == employment
    assert '上海' in first.locations['cities']
    assert urlsplit(first.source_url).path == path
    assert first.source_url != second.source_url and first.source_job_key != second.source_job_key
    if adapter == 'beisen':
        assert '广东省·深圳市' in first.locations['raw'] and '深圳' in first.locations['cities']
        assert first.salary_text == '面议'
    if adapter == 'jd-campus':
        assert 'publishId=fictional-1' in first.source_url and 'education_requirement' not in first.source_attributes
    if adapter == 'netease-campus':
        assert parse_qs(urlsplit(first.source_url).query)['id'] == ['69']


@pytest.mark.parametrize('key,portal,response,page_field', [
    ('iflytek', '1', {'Code': 200, 'Data': [], 'Count': 0}, 'PageIndex'),
    ('jd-campus', 'present', {'success': True, 'body': {'items': [], 'totalNumber': 0}}, 'pageIndex'),
    ('dji', 'N', {'code': 'S0000', 'data': {'datas': None, 'totalCount': 0}}, 'currentPage'),
    ('huawei', 'SR', {'status': 'SUCCESS', 'data': {'result': [], 'pageVO': {'totalRows': 0}}}, 'curPage'),
    ('netease-campus', '69', {'code': 200, 'data': {'list': [], 'total': 0}}, None),
    ('lenovo', '2', {'code': 0, 'result': {'rows': [], 'total': 0}}, None),
])
def test_new_pagination_indexes_and_explicit_empty_responses(key, portal, response, page_field):
    entry = source(key)
    def respond(request):
        if page_field:
            assert json.loads(request.content)[page_field] == (1 if key in {'iflytek', 'jd-campus'} else 2)
        else:
            query = parse_qs(request.url.query.decode())
            assert query['currentPage' if key == 'netease-campus' else 'pageNum'] == ['2']
        return httpx.Response(200, json=response)
    rows, total, size = run_transport(respond, lambda a: a.page(entry.adapter, entry.host, entry.config(), portal, 2))
    assert rows == [] and total == 0 and size == 50


def test_lenovo_city_dictionary_is_cached_and_unknown_codes_are_not_cities():
    calls = []
    entry = source('lenovo')
    row = {'id': 'fictional-1', 'jobName': '示例工程师', 'jobDuties': '开发虚构系统', 'jobRequirement': '掌握Python', 'workPlace': '1,2'}
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={'code': 0, 'result': [{'dictCode': 'city_portal', 'children': [
            {'dictValue': 1, 'dictName': '北京'}, {'dictValue': 2, 'dictName': '上海'}]}]})
    async def exercise(a):
        job = await a.normalize(entry.adapter, entry.host, entry.config(), '1', row)
        other = await a.normalize(entry.adapter, entry.host, entry.config(), '2', row)
        with pytest.raises(ValueError):
            await a.normalize(entry.adapter, entry.host, entry.config(), '1', row | {'workPlace': 'unknown'})
        return job, other
    job, intern = run_transport(respond, exercise)
    assert job.locations['cities'] == ['北京', '上海'] and len(calls) == 1
    assert intern.employment_type == 'internship' and intern.recruitment_channel == 'unknown'


@pytest.mark.parametrize('portal', ['social', 'intern'])
def test_kuaishou_public_signature_details_and_provider_city_labels(portal):
    entry = source('kuaishou-social')
    def respond(request):
        params = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
        public_key = '652f962a-0575-4575-98d2-f04e2291bee2'
        text = request.headers['signTimestamp'] + urlencode(sorted(params.items())) + public_key
        assert request.headers['sign'] == hmac.new(public_key.encode(), text.encode(), hashlib.sha256).hexdigest()
        if request.url.path.endswith('/positions/simple'):
            assert params['positionNatureCode'] == ('C001' if portal == 'social' else 'C002')
            result = {'total': 1, 'list': [{'id': 'fictional-1'}]}
        elif request.url.path.endswith('/positions/label'):
            result = {'domestic': [{'code': 'Shanghai', 'name': '上海', 'children': None}], 'foreign': [],
                'category': [{'code': 'fictional-category', 'name': '算法研发'}]}
        else:
            result = {'id': 'fictional-1', 'name': '示例工程师', 'description': '开发虚构系统', 'positionDemand': '掌握Python',
                'workLocationsCode': ['Shanghai'], 'positionCategoryCode': 'fictional-category', 'recruitLeaderEmail': 'fictional@example.test'}
        return httpx.Response(200, json={'code': 0, 'result': result})
    config = entry.config() | {'portals': [portal]}
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, config))
    assert result.is_complete and len(result.jobs) == 1
    job = result.jobs[0]
    assert job.locations['cities'] == ['上海'] and job.job_category == '研发'
    assert job.employment_type == ('full_time' if portal == 'social' else 'internship')
    assert 'recruitLeaderEmail' not in job.model_dump_json()
    assert '/job-info/fictional-1' in job.source_url


def test_tme_actual_page_size_walks_second_page_and_fetches_complete_detail():
    entry = source('tme')
    visited = []
    def respond(request):
        params = parse_qs(request.url.query.decode())
        if request.url.path == '/api/job/list':
            page = int(params['page'][0])
            visited.append(page)
            ids = range(1, 21) if page == 1 else [21]
            return httpx.Response(200, json={'code': '200', 'data': {'items': [{'id': str(i)} for i in ids],
                '_meta': {'total_count': 21, 'page_size': 20, 'current_page': page}}})
        identifier = params['id'][0]
        return httpx.Response(200, json={'code': '200', 'data': {'id': identifier, 'name': '示例工程师',
            'duty': '开发虚构系统', 'requirement': '掌握Python', 'work_city': '上海市'}})
    config = entry.config() | {'portals': ['social']}
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, config))
    assert result.is_complete and len(result.jobs) == 21 and visited == [1, 2]
    assert all(j.description == '开发虚构系统\n\n掌握Python' for j in result.jobs)


def test_tme_campus_internship_and_social_ids_do_not_collide():
    entry = source('tme')
    def respond(request):
        if request.url.path.endswith('/list'):
            return httpx.Response(200, json={'code': '200', 'data': {'items': [{'id': '1', 'work_nature_descr': '全职'}],
                '_meta': {'total_count': 1, 'page_size': 20, 'current_page': 1}}})
        detail = {'id': '1', 'name': '示例工程师', 'duty': '开发虚构系统', 'requirement': '掌握Python', 'work_city': '上海市'}
        if '/uc-job/' in request.url.path:
            detail['job_type_descr'] = '日常实习生'
        return httpx.Response(200, json={'code': '200', 'data': detail})
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert result.is_complete and len(result.jobs) == 2
    social, intern = result.jobs
    assert social.employment_type == 'full_time' and intern.employment_type == 'internship'
    assert intern.recruitment_channel == 'unknown'
    assert social.source_job_key != intern.source_job_key and social.source_url != intern.source_url


@pytest.mark.parametrize('response', [
    {'code': '200', 'data': {'items': [], '_meta': {'total_count': 0, 'page_size': 20, 'current_page': 1}}},
    {'code': '200', 'data': {'items': [], '_meta': {'total_count': 0, 'page_size': 0, 'current_page': 2}}},
    {'code': '403', 'data': {}},
])
def test_tme_wrong_page_metadata_and_rejected_response_are_not_empty_results(response):
    entry = source('tme')
    def respond(request):
        return httpx.Response(200, json=response)
    async def exercise(a):
        with pytest.raises(CollectionError):
            await a.page(entry.adapter, entry.host, entry.config(), 'social', 2)
    run_transport(respond, exercise)


def test_jd_internship_does_not_infer_graduate_channel_from_careers_domain():
    row = {'publishId': 'fictional-1', 'positionName': '示例实习生', 'workContent': '开发虚构系统', 'qualification': '掌握Python'}
    job = asyncio.run(OfficialAdapter(None).normalize('jd-campus', 'campus.jd.com', {}, 'internship', row))
    assert job.employment_type == 'internship' and job.recruitment_channel == 'unknown'


@pytest.mark.parametrize('key,expected_host', [('moonshot', 'app.mokahr.com'), ('vipshop', 'app-tc.mokahr.com')])
def test_moka_uses_registered_region_for_both_list_and_complete_detail(key, expected_host):
    entry = source(key)
    visited = []
    def respond(request):
        visited.append(request)
        assert request.url.host == expected_host
        body = json.loads(request.content)
        assert body['siteId'] == entry.site_id and body['orgId'] == entry.host
        if request.url.path.endswith('/jobs/v2'):
            data = {'jobs': [{'id': 'fictional-1', 'title': '示例岗位'}]}
        else:
            data = {'id': 'fictional-1', 'orgId': entry.host, 'jobDescription': '职责：开发虚构系统；要求：掌握Python'}
        return httpx.Response(200, json={'code': 0, 'success': True, 'data': data})
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert result.is_complete and len(result.jobs) == 1 and len(visited) == 2
    assert urlsplit(result.jobs[0].source_url).hostname == expected_host
    with pytest.raises(ApiError):
        validate_source(entry.adapter, entry.config() | {'api_host': 'internal.example.test'})


@pytest.mark.parametrize('key,portal', [('baichuan', 'baichuanzhaopin'), ('modelbest', 'career'),
    ('infinigence', 'infinigence'), ('aisphere', 'join'), ('juzibot', 'juzibot'), ('dedao', 'shezhao'),
    ('ireader', 'zhangyue'), ('coconutisland', 'coconut_jobs')])
def test_custom_feishu_portal_is_used_for_list_detail_and_original_job_url(key, portal):
    entry = source(key)
    assert entry.portals == (portal,)
    row = {'id': 'fictional-1', 'title': '示例岗位', 'description': '开发虚构系统', 'requirement': None}
    paths = []
    def respond(request):
        paths.append(request.url.path)
        assert request.headers['website-path'] == portal
        if request.method == 'POST':
            assert json.loads(request.content)['portal_type'] == 2
            data = {'job_post_list': [row], 'count': 1}
        else:
            data = {'job_post_detail': row | {'requirement': '掌握Python'}}
        return httpx.Response(200, json={'code': 0, 'data': data})
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert result.is_complete and result.jobs[0].description == '开发虚构系统\n\n掌握Python'
    assert urlsplit(result.jobs[0].source_url).path == f'/{portal}/position/fictional-1/detail'
    assert len(paths) == 2
    with pytest.raises(ApiError):
        validate_source(entry.adapter, entry.config() | {'portals': ['index']})


def test_weimob_public_signature_pagination_and_reduced_list_detail():
    entry = source('weimob')
    visited = []
    def respond(request):
        nonce = request.headers['requestId']
        raw = request.content.decode() if request.method == 'POST' else request.url.query.decode()
        expected = hashlib.md5((raw + '123!@#$%^&*()_+<>?{}abc' + nonce).encode()).hexdigest()
        assert request.headers['sign'] == expected
        if request.method == 'POST':
            body = json.loads(request.content)
            assert body['positionNature'] is None and body['recruitType'] is None
            assert body['pageSize'] == 50
            visited.append(body['page'])
            # The provider can return a different page size; use its metadata.
            rows = [{'id': '1'}, {'id': '2'}] if body['page'] == 1 else [{'id': '3'}]
            data = {'data': rows, 'count': 3, 'currPage': body['page'], 'pageSize': 2}
        else:
            assert request.url.path == '/recruit-manage/front/position/internal/positionDetail'
            identifier = parse_qs(request.url.query.decode())['id'][0]
            data = {'id': identifier, 'positionName': '示例岗位', 'positionDesc': '开发虚构系统',
                'positionRequire': '掌握Python', 'positionNature': 'INTERNSHIP', 'functionType': 'SKILL',
                'workAddresses': [{'label': '上海市'}], 'deptName': '示例团队', 'private_field': 'excluded'}
        return httpx.Response(200, json={'code': 0, 'data': data})
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert result.is_complete and len(result.jobs) == 3 and visited == [1, 2]
    assert all(j.employment_type == 'internship' and j.recruitment_channel == 'unknown' for j in result.jobs)
    assert all(j.locations['cities'] == ['上海'] and j.job_category == '研发' for j in result.jobs)
    assert len({j.source_url for j in result.jobs}) == 3
    assert all('private_field' not in j.model_dump_json() for j in result.jobs)


@pytest.mark.parametrize('response', [
    {'code': 0, 'data': {'data': [], 'count': 0, 'currPage': 1, 'pageSize': 50}},
    {'code': 0, 'data': {'data': [], 'count': 0, 'currPage': 2, 'pageSize': 0}},
    {'code': 1, 'data': {}},
])
def test_weimob_wrong_page_or_rejected_provider_response_is_not_empty_complete(response):
    entry = source('weimob')
    def respond(request):
        return httpx.Response(200, json=response)
    async def exercise(a):
        with pytest.raises(CollectionError):
            await a.page(entry.adapter, entry.host, entry.config(), 'all', 2)
    run_transport(respond, exercise)


def test_weimob_mismatched_public_details_are_partial_and_keep_valid_jobs():
    entry = source('weimob')
    def respond(request):
        if request.method == 'POST':
            data = {'data': [{'id': '1'}, {'id': '2'}], 'count': 2, 'currPage': 1, 'pageSize': 50}
        else:
            identifier = parse_qs(request.url.query.decode())['id'][0]
            data = {'id': 'wrong' if identifier == '2' else '1', 'positionName': '示例岗位',
                'positionDesc': '开发虚构系统', 'positionRequire': '掌握Python', 'positionNature': 'SCHOOL'}
        return httpx.Response(200, json={'code': 0, 'data': data})
    result = run_transport(respond, lambda a: a.collect(entry.adapter, entry.host, entry.config()))
    assert not result.is_complete and result.invalid_count == 1 and len(result.jobs) == 1
    assert result.jobs[0].recruitment_channel == 'campus'
    assert result.jobs[0].employment_type == 'unknown'
