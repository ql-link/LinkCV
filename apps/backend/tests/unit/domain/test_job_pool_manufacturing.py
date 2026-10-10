"""Fictional public jobs; transport mocks never contact a careers site."""
import asyncio
import json
from urllib.parse import parse_qs

import httpx
import pytest

from linkresume.application.job_pool.adapters import OfficialAdapter, OfficialHTTP
from linkresume.application.job_pool.catalog import CATALOG


def run(key, respond, portals=None):
    class NoLogo(OfficialAdapter):
        async def company_logo(self, *args):
            return None

    async def collect():
        source = next(item for item in CATALOG if item.key == key)
        config = source.config()
        if portals is not None:
            config["portals"] = portals
        http = OfficialHTTP(transport=httpx.MockTransport(respond), delay=0)
        try:
            return await NoLogo(http).collect(source.adapter, source.host, config)
        finally:
            await http.close()
    return asyncio.run(collect())


def reply(value):
    return httpx.Response(200, json=value)


def test_byd_social_uses_offsets_and_never_copies_other_jobs_or_private_fields():
    offsets = []

    def respond(request):
        body = json.loads(request.content)
        assert "Authorization" not in request.headers
        assert request.headers["lang"] == "zh_CN"
        if request.url.path.endswith("queryList"):
            offsets.append(body["pageNum"])
            rows = [{"id": str(i)} for i in range(body["pageNum"], min(body["pageNum"] + 50, 51))]
            return reply({"code": 0, "data": {"data": rows, "total": 51}})
        identifier = body["id"]
        return reply({"code": 0, "data": {"id": identifier, "positionName": "测试工程师",
            "city": "深圳市", "orgName": "示例研发部", "tagDetailList": [
                {"name": "工作职责", "detail": "验证示例设备。"}, {"name": "任职要求", "detail": "掌握测试方法。"}],
            "positionRegionList": [{"id": "unrelated", "positionName": "其他岗位"}], "userIds": "private"}})

    result = run("byd", respond, ["social"])
    assert result.is_complete and len(result.jobs) == 51 and offsets == [0, 50]
    assert all(job.source_job_key != "id:unrelated" for job in result.jobs)
    assert all("掌握测试方法" in job.description and job.recruitment_channel == "experienced" for job in result.jobs)
    assert "private" not in result.model_dump_json()
    assert "#/social/socialPositionDetails?id=0" in result.jobs[0].source_url


def test_byd_dynamic_topics_and_all_variants_survive_overlapping_campus_portals():
    topics = {"应届生": "new-topic", "博士生": "doctor-topic", "实习生": "intern-topic"}
    requested = []

    def respond(request):
        if request.url.path.endswith("postEntryConfig/list"):
            return reply({"code": 0, "data": [{"postEntryName": name, "schoolTopic": topic, "status": "00111",
                "batch": "2028", "degree": "doctor" if name == "博士生" else ""} for name, topic in topics.items()]})
        if request.method == "POST":
            body = json.loads(request.content)
            requested.append(body["topicCode"])
            return reply({"code": 0, "data": [{"id": "intern" if body["topicCode"] == "intern-topic" else "campus"}],
                "page": {"pageIndex": body["pageIndex"], "pageSize": 50, "totalCount": 1}})
        query = dict(request.url.params)
        assert query["degree"] == query["abroad"] == ""
        return reply({"code": 0, "data": {"id": query["id"], "jobName": "示例研发工程师", "jobType": "研发技术",
            "batch": 2028, "campusNature": "008502" if query["id"] == "intern" else "008501", "workPlace": "深圳市,广州市",
            "updateTime": "2028-01-01", "positionInfoList": [
                {"division": "示例甲部", "researchDirection": "硬件", "jobDuty": "完整职责甲", "jobRequirements": "完整要求甲"},
                {"division": "示例乙部", "researchDirection": "软件", "jobDuty": "完整职责乙", "jobRequirements": "完整要求乙"}]}})

    result = run("byd", respond, list(topics))
    assert result.is_complete and len(result.jobs) == 2 and requested == list(topics.values())
    for job in result.jobs:
        assert all(text in job.description for text in ["完整职责甲", "完整要求甲", "完整职责乙", "完整要求乙"])
        assert job.published_at is None and job.source_attributes["batch"] == "2028"
    assert next(job for job in result.jobs if job.source_job_key == "id:intern").employment_type == "internship"


@pytest.mark.parametrize("entries", [[], [{"postEntryName": "应届生", "status": "disabled"}],
    [{"postEntryName": "应届生", "status": "00111", "schoolTopic": "example"}] * 2])
def test_missing_or_ambiguous_byd_topics_cannot_be_complete(entries):
    result = run("byd", lambda request: reply({"code": 0, "data": entries}), ["应届生"])
    assert not result.is_complete and result.error_code == "JOB_SOURCE_INVALID_RESPONSE"


@pytest.mark.parametrize("bad_detail", ["wrong-id", "missing", "empty", "labels-only"])
def test_byd_invalid_details_never_produce_an_offline_signal(bad_detail):
    def respond(request):
        if request.url.path.endswith("queryList"):
            return reply({"code": 0, "data": {"data": [{"id": "example"}], "total": 1}})
        tags = [] if bad_detail == "missing" else [{"name": "工作职责", "detail": "" if bad_detail in {"empty", "labels-only"} else "完整职责"}]
        return reply({"code": 0, "data": {"id": "different" if bad_detail == "wrong-id" else "example",
            "positionName": "测试工程师", "tagDetailList": tags}})
    result = run("byd", respond, ["social"])
    assert not result.is_complete and result.jobs == [] and result.invalid_count == 1


def test_hikvision_group_list_and_detail_use_distinct_company_and_ad_identifiers():
    def respond(request):
        if "getConfigInfo" in request.url.path:
            assert request.url.params["domainStr"] == "talent.hikvision.com"
            return reply({"success": True, "data": {"officialSubjInfoVo": {"companyId": "example-company"}}})
        if request.method == "POST":
            assert json.loads(request.content)["companyId"] == ""
            return reply({"success": True, "data": {"pageNum": 1, "pageSize": 50, "total": 1,
                "list": [{"postSecureId": "example-ad"}]}})
        assert request.url.params["companyId"] == "example-company"
        assert request.url.params["adIdStr"] == "example-ad"
        return reply({"success": True, "data": {"ad": {"adIdStr": "example-ad", "postIdStr": "different-position-id",
            "postName": "示例实习工程师", "postDesc": "完整职责", "qualifications": "完整要求",
            "recruitType": "3", "locationDesc": "杭州市", "recruitPerson": "private"}}})
    result = run("hikvision", respond)
    assert result.is_complete and result.jobs[0].source_job_key == "id:example-ad"
    assert result.jobs[0].employment_type == "internship" and result.jobs[0].recruitment_channel == "unknown"
    assert result.jobs[0].source_url.endswith("?postId=example-ad") and "private" not in result.model_dump_json()


def test_dayee_uses_actual_page_size_and_public_detail_link():
    requested = []
    portal = next(item for item in CATALOG if item.key == "honor").portals[0]

    def respond(request):
        body = parse_qs(request.content.decode())
        if "/listPosition/" in request.url.path:
            number = int(body["currentPage"][0]);requested.append(number)
            assert body["pageSize"] == ["50"] and body["recruitType"] == ["2"]
            rows = [{"postId": str(i)} for i in range((number - 1) * 2, min(number * 2, 3))]
            return reply({"state": "200", "data": {"pageForm": {"currentPage": number, "pageSize": 2,
                "dataCount": 3, "pageData": rows}}})
        identifier = body["postId"][0]
        return reply({"state": "200", "data": {"postId": identifier, "postName": "示例工程师",
            "workContent": "完整职责", "serviceCondition": "完整要求", "recruitType": 2, "workTypeStr": "全职",
            "totalApplyNum": 999, "orgConfig": "private"}})
    result = run("honor", respond, [portal])
    assert result.is_complete and len(result.jobs) == 3 and requested == [1, 2]
    assert "/pb/posDetail.html?postId=0&postType=society" in result.jobs[0].source_url
    assert "private" not in result.model_dump_json() and "999" not in result.model_dump_json()


@pytest.mark.parametrize("meta,complete", [
    ({"currentPage": 0, "pageSize": 0, "dataCount": 0, "pageData": []}, True),
    ({"currentPage": 2, "pageSize": 10, "dataCount": 0, "pageData": []}, False),
    ({"currentPage": 1, "pageSize": 0, "dataCount": 1, "pageData": [{"postId": "example"}]}, False),
    (None, False)])
def test_dayee_empty_and_invalid_pagination_are_distinguished(meta, complete):
    portal = next(item for item in CATALOG if item.key == "longi").portals[0]
    result = run("longi", lambda request: reply({"state": "200", "data": {"pageForm": meta}}), [portal])
    assert result.is_complete is complete


def test_midea_complete_list_jd_preserves_requirements_and_omits_staff_fields():
    def respond(request):
        assert parse_qs(request.content.decode())["pageIndex"] == ["1"]
        return reply({"data": [{"positionId": "example", "publicationName": "示例工艺工程师",
            "postDuties": "完整职责", "qualification": "完整要求", "workingPlace": "广东省-佛山,上海市-上海市",
            "superiorUnitName": "示例制造部", "postCategoryName": "生产制造", "employeeName": "private"}],
            "total": 1, "info": {"pageIndex": 1, "pageSize": 50}})
    result = run("midea", respond)
    assert result.is_complete and result.jobs[0].job_category == "生产/制造"
    assert result.jobs[0].locations["cities"] == ["佛山", "上海"]
    assert "完整要求" in result.jobs[0].description and "private" not in result.model_dump_json()


def test_gree_native_code_and_recruitment_property_are_preserved():
    def respond(request):
        portal = request.url.params["property"]
        assert request.url.params["pageNum"] == "1"
        return reply({"code": 200, "data": {"list": [{"Code": "example-" + portal, "ID": 123,
            "Position": "示例研发工程师", "Description": "完整职责", "Qualifications": "完整要求",
            "property": int(portal), "PubName": "private", "Location": "珠海市"}], "total": 1}})
    result = run("gree", respond)
    assert result.is_complete and {job.recruitment_channel for job in result.jobs} == {"campus", "experienced"}
    assert result.jobs[0].source_url.endswith("JobCode=example-1") and "private" not in result.model_dump_json()


@pytest.mark.parametrize("detail,valid", [
    ({"workContent": "合并后的完整职责与要求"}, True),
    ({"serviceCondition": "完整要求", "workContent": None}, True),
    ({"workContent": "", "serviceCondition": None}, False),
    ({"workContent": ["错误的类型"]}, False),
    ({"postId": "wrong", "workContent": "完整描述"}, False)])
def test_dayee_full_detail_can_have_combined_jd_but_must_match_id(detail, valid):
    source = next(item for item in CATALOG if item.key == "longi")
    def respond(request):
        if "/listPosition/" in request.url.path:
            return reply({"state": "200", "data": {"pageForm": {"currentPage": 1, "pageSize": 50,
                "dataCount": 1, "pageData": [{"postId": "example"}]}}})
        return reply({"state": "200", "data": {"postId": "example", "postName": "示例校招工程师", "recruitType": 1} | detail})
    result = run("longi", respond, [source.portals[1]])
    assert result.is_complete is valid
    if valid:
        assert result.jobs[0].source_url.endswith("postId=example&postType=campus")
    else:
        assert not result.jobs and result.invalid_count == 1


def test_byd_duplicate_ids_and_overstated_total_preserve_jobs_as_partial():
    def respond(request):
        if request.url.path.endswith("queryList"):
            return reply({"code": 0, "data": {"data": [{"id": "same"}, {"id": "same"}], "total": 2}})
        return reply({"code": 0, "data": {"id": "same", "positionName": "示例工程师",
            "tagDetailList": [{"name": "职责", "detail": "完整描述"}]}})
    result = run("byd", respond, ["social"])
    assert len(result.jobs) == 1 and not result.is_complete
    assert result.error_code == "JOB_SOURCE_COUNT_MISMATCH"


def test_false_status_is_not_treated_as_integer_zero_success():
    result = run("byd", lambda request: reply({"code": False, "data": {"data": [], "total": 0}}), ["social"])
    assert not result.is_complete and result.error_code == "JOB_SOURCE_INVALID_RESPONSE"


@pytest.mark.parametrize("key,body", [
    ("midea", {"data": [], "total": 0, "info": None}),
    ("gree", {"code": 200, "data": None}),
    ("hikvision", {"success": True, "data": {"officialSubjInfoVo": None}}),
    ("honor", {"state": "808", "data": {"pageForm": {}}})])
def test_bad_or_login_required_public_responses_are_partial(key, body):
    result = run(key, lambda request: reply(body))
    assert not result.is_complete and result.error_code == "JOB_SOURCE_INVALID_RESPONSE" and not result.jobs
