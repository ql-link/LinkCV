import asyncio

import pytest

from linkresume.application.job_pool import scope
from linkresume.application.job_pool.adapters import CollectionError, OfficialAdapter
from linkresume.application.job_pool.catalog import CATALOG
from linkresume.application.job_pool.types import JobObservation, cities


@pytest.mark.parametrize("title,category,expected", [
    ("后端开发工程师", None, "后端"),
    ("数字前端设计工程师", None, "芯片"),
    ("嵌入式软件工程师", None, "嵌入式"),
    ("硬件工程师", None, "硬件"),
    ("iOS开发工程师", None, "客户端"),
    ("大模型应用开发", None, "算法"),
    ("测试开发工程师", None, "测试"),
    ("示例工程师", "技术", "研发"),
    ("示例专家", "算法", "算法"),
    ("示例专家", "后端", "后端"),
    ("示例工程师", None, None),
    ("销售工程师", "技术", None),
    ("解决方案架构师", "技术", None),
    ("产品经理", "产品", None),
    ("AI产品经理", None, None),
    ("工艺工程师", "研发", None),
    ("材料研发工程师", "研发类", None),
    ("示例生产工程师", "生产制造", None),
    # Team names before or after the role do not decide the job.
    ("后端开发工程师 - 示例平台产品", None, "后端"),
    ("示例营销-搜索前端开发工程师", None, "前端"),
    ("营销算法工程师 - 示例广告", None, "算法"),
    ("视频编解码与异构计算优化工程师-示例技术", None, "研发"),
    ("Agent策略产品实习生 - 示例方舟", "产品", None),
    ("UE5游戏战斗策划专家", None, None),
    ("示例硬件研发项目经理", "研发", None),
])
def test_only_technology_roles_get_a_direction(title, category, expected):
    assert scope.classify(title, category) == expected


@pytest.mark.parametrize("places,expected", [
    (["北京", "新加坡"], ["北京"]),
    (["新加坡"], None),
    (["San Jose", "Hong Kong"], None),
    (["中国香港"], None),
    (["昆山"], ["昆山"]),
    ([], []),
])
def test_overseas_only_jobs_are_dropped_and_mixed_jobs_keep_domestic_cities(places, expected):
    assert scope.domestic_places(places) == expected


def job(key, title, category, places):
    return JobObservation(source_job_key="id:" + key, job_title=title, description="虚构岗位职责。", job_category=None,
        source_category=category, locations=cities(places), source_url="https://careers.tencent.com/jobdesc.html?postId=" + key)


class Reader(OfficialAdapter):
    def __init__(self, rows):
        super().__init__(None, scoped=True)
        self.rows = rows
        self.detailed = []

    async def page(self, adapter, tenant, config, portal, page):
        return self.rows, len(self.rows), 50

    async def normalize(self, adapter, tenant, config, portal, row):
        # Stands in for the per-job detail request.
        self.detailed.append(row["PostId"])
        return job(row["PostId"], row["RecruitPostName"], row.get("CategoryName"), [row["LocationName"]])


def test_list_rows_out_of_scope_skip_detail_and_still_count_toward_completeness():
    rows = [
        {"PostId": "1", "RecruitPostName": "后端开发工程师", "CategoryName": "技术", "LocationName": "深圳"},
        {"PostId": "2", "RecruitPostName": "大客户销售", "CategoryName": "销售", "LocationName": "深圳"},
        {"PostId": "3", "RecruitPostName": "后端开发工程师", "CategoryName": "技术", "LocationName": "新加坡"},
        {"PostId": "4", "RecruitPostName": "示例工程师", "CategoryName": "职能", "LocationName": "深圳"},
        # Undecided from the list, rejected after the detail.
        {"PostId": "5", "RecruitPostName": "示例工程师", "LocationName": "深圳"},
    ]
    source = next(item for item in CATALOG if item.key == "tencent")
    reader = Reader(rows)
    result = asyncio.run(reader.collect(source.adapter, source.host, source.config()))
    assert reader.detailed == ["1", "5"]
    assert [item.source_job_key for item in result.jobs] == ["id:1"]
    assert result.jobs[0].job_category == "后端" and "source_category" not in result.jobs[0].model_dump()
    assert result.filtered_count == 4 and result.invalid_count == 0
    assert result.is_complete and result.error_code is None


class FeishuHTTP:
    def __init__(self):
        self.bodies = []

    async def request(self, url, *, body=None, headers=None, **kwargs):
        if url.endswith("/api/v1/config/job/filters"):
            return {"code": 0, "data": {"job_type_list": [{"id": "11", "name": "研发"}, {"id": "22", "name": "销售"}]}}
        self.bodies.append(body)
        return {"code": 0, "data": {"job_post_list": [], "count": 0}}


@pytest.mark.parametrize("scoped,expected", [(True, ["11"]), (False, None)])
def test_scoped_bytedance_requests_only_research_categories(scoped, expected):
    http = FeishuHTTP()
    reader = OfficialAdapter(http, scoped=scoped)
    for page in (1, 2):
        asyncio.run(reader.page("feishu", "jobs.bytedance.com", {}, "default", page))
    assert [body.get("job_category_id_list") for body in http.bodies] == [expected, expected]


def test_missing_source_category_fails_instead_of_reading_the_capped_list():
    class Renamed(FeishuHTTP):
        async def request(self, url, **kwargs):
            if url.endswith("/filters"):
                return {"code": 0, "data": {"job_type_list": [{"id": "11", "name": "技术"}]}}
            return await super().request(url, **kwargs)
    with pytest.raises(CollectionError) as error:
        asyncio.run(OfficialAdapter(Renamed(), scoped=True).page("feishu", "jobs.bytedance.com", {}, "default", 1))
    assert error.value.code == "JOB_SOURCE_CATEGORY_UNAVAILABLE"
