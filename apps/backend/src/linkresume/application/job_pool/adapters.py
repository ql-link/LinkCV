"""Self-maintained readers for public official careers endpoints.

Endpoint research references: Hiring-Radar (MIT) and career-ops (MIT).
No upstream package, page cap, body truncation, or partial-as-complete contract is used.
"""
from __future__ import annotations

import asyncio
import base64
import ipaddress
import hashlib
import hmac
import time
import json
import socket
import re
from urllib.parse import quote
from urllib.parse import urlencode, urljoin, urlsplit
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7
from pydantic import ValidationError

from linkresume.application.job_pool.catalog import entry_for, validate_source
from linkresume.application.job_pool.html_jobs import HaierDetail
from linkresume.application.job_pool import manufacturing
from linkresume.application.job_pool.logos import FIXED_LOGOS, extract_logo, logo_page, safe_logo_url
from linkresume.application.job_pool.types import JobObservation, SyncResult, cities, clean_text, job_key, source_date


class CollectionError(Exception):
    def __init__(self, code: str):
        self.code = code


class OfficialHTTP:
    def __init__(self, *, timeout=20, max_bytes=2_097_152, transport=None, delay=.5):
        self.client = httpx.AsyncClient(timeout=timeout, follow_redirects=False, transport=transport,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"})
        self.max_bytes = max_bytes
        self.delay = delay
        self.check_dns = transport is None
        self.verified_hosts: set[str] = set()

    async def close(self):
        await self.client.aclose()

    async def request(self, url, *, body=None, form=None, headers=None, as_text=False, same_url_retry=False):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise CollectionError("JOB_SOURCE_UNSAFE_URL")
        if self.check_dns and parsed.hostname not in self.verified_hosts:
            try:
                addresses = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, 443, type=socket.SOCK_STREAM)
                if not addresses or any(not ipaddress.ip_address(x[4][0]).is_global for x in addresses):
                    raise CollectionError("JOB_SOURCE_UNSAFE_URL")
            except OSError as error:
                raise CollectionError("JOB_SOURCE_NETWORK_ERROR") from error
            self.verified_hosts.add(parsed.hostname)
        method = "POST" if body is not None or form is not None else "GET"
        default_headers = {"Referer": f"{parsed.scheme}://{parsed.netloc}/", "Origin": f"{parsed.scheme}://{parsed.netloc}"}
        for attempt in range(3):
            await asyncio.sleep(self.delay)
            try:
                async with self.client.stream(method, url, json=body, data=form, headers=default_headers | (headers or {})) as response:
                    # Some public careers shells set an anonymous cookie then redirect to the same page.
                    # Replay that GET once; never visit a redirect destination.
                    if (same_url_retry and method == "GET" and attempt == 0 and response.status_code == 302
                            and response.headers.get("location")
                            and urljoin(url, response.headers["location"]) == url):
                        continue
                    if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    if response.status_code != 200:
                        raise CollectionError("JOB_SOURCE_ACCESS_DENIED" if response.status_code in {401, 403} else "JOB_SOURCE_HTTP_ERROR")
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > self.max_bytes:
                            raise CollectionError("JOB_SOURCE_RESPONSE_TOO_LARGE")
                    try:
                        return chunks.decode("utf-8") if as_text else json.loads(chunks)
                    except (ValueError, UnicodeDecodeError) as error:
                        raise CollectionError("JOB_SOURCE_INVALID_RESPONSE") from error
            except httpx.RequestError as error:
                if attempt == 2:
                    raise CollectionError("JOB_SOURCE_NETWORK_ERROR") from error
                await asyncio.sleep(2 ** attempt)
        raise CollectionError("JOB_SOURCE_NETWORK_ERROR")


def pair_type(channel, employment):
    text = str(channel or "")
    channel = "campus" if text in {"campus", "校招", "校园招聘", "CAMPUS", "GRADUATE"} else "experienced" if text in {"experienced", "社招", "社会招聘", "SOCIAL"} else "unknown"
    employment_text = str(employment or "").lower()
    employment = "internship" if employment_text in {"实习", "实习生", "intern", "internship", "实习生招聘"} else "full_time" if employment_text in {"正式", "全职", "full_time", "full-time"} else "unknown"
    return channel, employment


def category(value):
    text = str(value or "")
    for result, words in (("研发", ("技术", "研发", "开发", "算法")), ("产品", ("产品",)), ("设计", ("设计", "美术")), ("运营", ("运营",)), ("市场/销售", ("市场", "销售", "商务")), ("职能", ("职能", "综合", "人力", "财务", "法务")), ("生产/制造", ("生产", "制造", "工艺")), ("质量", ("质量", "品质", "质检")), ("供应链", ("供应链", "采购", "物流", "仓储"))):
        if any(word in text for word in words):
            return result
    return None


def text_locations(value):
    if isinstance(value, list):
        names = []
        for item in value:
            if isinstance(item, dict):
                city = item.get("city")
                city = city.get("name") if isinstance(city, dict) else city
                names.append(str(item.get("name") or item.get("cityName") or item.get("label") or city or ""))
            elif isinstance(item, str):
                names.append(item)
        return names
    return [x.strip() for x in str(value or "").replace("，", ",").replace("、", ",").split(",") if x.strip()]


class OfficialAdapter:
    def __init__(self, http: OfficialHTTP, *, max_pages=2000):
        self.http = http
        self.max_pages = max_pages
        self.sessions = {}

    async def collect(self, adapter, tenant, config):
        validate_source(adapter, config)
        if adapter == "pending":
            return SyncResult(error_code="JOB_SOURCE_ADAPTER_PENDING")
        result = SyncResult(is_complete=True)
        seen: dict[str, JobObservation] = {}
        total_payload_bytes = 0
        try:
            for portal in config["portals"]:
                page_fingerprints = set()
                portal_ids = set()
                initial_total = None
                exhausted = False
                for page in range(1, self.max_pages + 1):
                    rows, total, size = await self.page(adapter, tenant, config, portal, page)
                    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                        raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
                    if total is not None:
                        if isinstance(total, str) and total.isdecimal():
                            total = int(total)
                        if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
                        if initial_total is None:
                            initial_total = total
                        elif total != initial_total:
                            result.is_complete = False
                            result.error_code = "JOB_SOURCE_COUNT_CHANGED"
                    if rows:
                        fingerprint = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=True).encode()).digest()
                        if fingerprint in page_fingerprints:
                            raise CollectionError("JOB_SOURCE_PAGINATION_REPEATED")
                        page_fingerprints.add(fingerprint)
                    for row in rows:
                        try:
                            job = await self.normalize(adapter, tenant, config, portal, row)
                            if job.source_job_key in portal_ids:
                                result.is_complete = False
                                result.error_code = "JOB_SOURCE_COUNT_CHANGED"
                            portal_ids.add(job.source_job_key)
                            previous = seen.get(job.source_job_key)
                            total_payload_bytes += len(job.model_dump_json().encode()) - (len(previous.model_dump_json().encode()) if previous else 0)
                            if total_payload_bytes > 64 * 1024 * 1024:
                                raise CollectionError("JOB_SOURCE_COLLECTION_TOO_LARGE")
                            seen[job.source_job_key] = job
                        except (ValueError, TypeError, KeyError, ValidationError):
                            result.invalid_count += 1
                            result.is_complete = False
                            result.error_code = "JOB_SOURCE_INVALID_JOB"
                    if len(rows) < size:
                        exhausted = True
                        if initial_total is not None and len(portal_ids) != initial_total:
                            result.is_complete = False
                            result.error_code = "JOB_SOURCE_COUNT_MISMATCH"
                        break
                if not exhausted:
                    result.is_complete = False
                    result.error_code = "JOB_SOURCE_PAGE_LIMIT"
                # A reported cap cannot establish that an entire portal was visited.
                if adapter == "feishu" and initial_total is not None and initial_total >= 10000:
                    result.is_complete = False
                    result.error_code = "JOB_SOURCE_RESULT_CAP"
        except CollectionError as error:
            result.is_complete = False
            result.error_code = error.code
        except (KeyError, TypeError, ValueError):
            result.is_complete = False
            result.error_code = "JOB_SOURCE_INVALID_RESPONSE"
        result.jobs = list(seen.values())
        # Artwork is optional: a failed logo request must never turn a complete
        # job walk into a partial result or become an offline signal.
        if self.http is not None:
            try:
                result.company_logo_url = await asyncio.wait_for(self.company_logo(adapter, tenant, config), timeout=8)
                if result.company_logo_url is None:
                    result.company_logo_error_code = "JOB_SOURCE_LOGO_NOT_FOUND"
            except CollectionError as error:
                result.company_logo_error_code = error.code
            except (TimeoutError, ValueError, TypeError):
                result.company_logo_error_code = "JOB_SOURCE_LOGO_UNAVAILABLE"
        return result

    async def company_logo(self, adapter, tenant, config=None):
        source = entry_for(adapter, tenant, config)
        if source.key in FIXED_LOGOS:
            return safe_logo_url(source, FIXED_LOGOS[source.key])
        page = await self.http.request(logo_page(source), as_text=True, headers={"Referer": source.url}, same_url_retry=adapter in {"moka", "moka-campus"})
        return extract_logo(source, page) if isinstance(page, str) else None

    async def page(self, adapter, tenant, config, portal, page):
        if adapter in manufacturing.ADAPTERS:
            return await manufacturing.page(self.http, self.sessions, adapter, tenant, portal, page)
        size = 20 if adapter == "baidu" else 50
        offset = (page - 1) * size
        if adapter == "tencent":
            value = await self.http.request("https://careers.tencent.com/tencentcareer/api/post/Query?" + urlencode({"pageIndex": page, "pageSize": size, "language": "zh-cn"}))
            if value.get("Code") != 200:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            data = value["Data"]
            return data["Posts"], data["Count"], size
        if adapter == "feishu":
            headers = {"website-path": portal} if portal != "default" else {}
            value = await self.http.request(f"https://{tenant}/api/v1/search/job/posts", body={"keyword": "", "limit": size, "offset": offset, "portal_type": entry_for(adapter, tenant).portal_type}, headers=headers)
            if value.get("code") != 0:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            data = value["data"]
            return data["job_post_list"], data.get("count"), size
        if adapter in {"moka", "moka-campus"}:
            data = await self.moka_request("jobs/v2", tenant, config, {"limit": size, "offset": offset}, adapter=adapter)
            return data["jobs"], None, size  # Moka total=0 is not reliable.
        if adapter == "haier":
            value = await self.http.request("https://maker.haier.net/client/job/searchdata.html", form={"page": page, "pagesize": size})
            data = value.get("data")
            if value.get("status") != 1 or not isinstance(data, dict):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return data["list"], data["count"], size
        if adapter == "oppo-campus":
            value = await self.http.request("https://careers.oppo.com/openapi/position/pageNew", body={
                "pageNum": page, "pageSize": size, "positionName": "", "projectList": [],
                "positionTypeList": [], "workCityCodeList": []}, headers={"Tenant-Id": "1000"})
            data = value.get("data")
            if value.get("code") != 0 or not isinstance(data, dict):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            actual_size = data.get("size")
            if (data.get("current") != page or not isinstance(actual_size, int)
                    or isinstance(actual_size, bool) or not 1 <= actual_size <= 100):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return data["records"], data["total"], actual_size
        if adapter == "meituan":
            code = {"social": "3", "campus": "1", "intern": "2"}[portal]
            value = await self.http.request("https://zhaopin.meituan.com/api/official/job/getJobList", body={"page": {"pageNo": page, "pageSize": size}, "keywords": "", "jobShareType": "1", "jobType": [{"code": code, "subCode": []}], "cityList": [], "department": [], "jfJgList": [], "typeCode": [], "specialCode": []})
            data = value.get("data")
            if not isinstance(data, dict):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return data["list"], data["page"]["totalCount"], size
        if adapter == "baidu":
            value = await self.http.request("https://talent.baidu.com/httservice/getPostListNew", form={"recruitType": portal, "pageSize": size, "keyWord": "", "curPage": page}, headers={"Referer": "https://talent.baidu.com/jobs/social"})
            data = value.get("data")
            if not isinstance(data, dict):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return data["list"], data.get("total"), size
        if adapter == "jd":
            value = await self.http.request("https://zhaopin.jd.com/web/job/job_list", form={"pageIndex": page, "pageSize": size, "jobType": int(portal)}, headers={"X-Requested-With": "XMLHttpRequest"})
            if not isinstance(value, list):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value, None, size
        if adapter == "ant":
            size = 10
            value = await self.ant_request(f"/api/{portal}/position/search", {"key": "", "regions": "", "categories": "", "subCategories": "", "bgCode": "", "socialQrCode": "", "pageIndex": page, "pageSize": size, "channel": "group_official_site" if portal == "social" else "campus_group_official_site", "language": "zh"})
            # Campus also includes trainee postings. Walk the raw list without filtering,
            # then classify batchType during normalization so totals remain meaningful.
            return value["content"], value["totalCount"], size
        if adapter == "mihoyo":
            value = await self.mihoyo_request("/v1/job/list", self.mihoyo_body(portal) | {"pageNo": page, "pageSize": size})
            return value["list"], value["total"], size
        if adapter == "beisen":
            value = await self.http.request(f"https://{tenant}/api/Jobad/GetJobAdPageList", body={
                "PageIndex": page - 1, "PageSize": size, "LocId": [], "Category": [portal], "KeyWords": "",
                "SpecialType": 0, "PortalId": "", "DisplayFields": ["Category", "Kind", "LocId", "PostDate", "Salary"]})
            if value.get("Code") != 200 or not isinstance(value.get("Data"), list):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["Data"], value["Count"], size
        if adapter == "huawei":
            value = await self.http.request("https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub/getJobPage?X-HW-ID=app_000000035886",
                body={"curPage": page, "pageSize": size, "jobType": portal}, headers={
                    "X-HW-ID": "app_000000035886", "X-Jalor-TenantAlias": "hcm", "X-Language": "zh_CN",
                    "X-Referer": "https://career.huawei.com/cn", "Origin": "https://career.huawei.com", "Referer": "https://career.huawei.com/"})
            if value.get("status") != "SUCCESS":
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["data"]["result"], value["data"]["pageVO"]["totalRows"], size
        if adapter == "dji":
            value = await self.http.request(f"https://{tenant}/hire_front/api/common/position/queryPositionCardList", body={
                "currentPage": page, "pageSize": size, "keyWord": "", "recruitmentTypes": [], "cityList": [],
                "teamList": [], "positionCategoryList": [], "schoolFlag": portal})
            if value.get("code") != "S0000":
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            data = value["data"]
            rows = data["datas"]
            if rows is None and data.get("totalCount") == 0:
                rows = []
            return rows, data["totalCount"], size
        if adapter == "jd-campus":
            value = await self.http.request(f"https://{tenant}/api/wx/position/page?type={portal}", body={
                "pageSize": size, "pageIndex": page - 1, "parameter": {"positionName": "", "planIdList": [],
                "jobDirectionCodeList": [], "workCityCodeList": [], "positionDeptList": []}})
            if value.get("success") is not True:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["body"]["items"], value["body"]["totalNumber"], size
        if adapter == "netease-campus":
            value = await self.http.request(f"https://{tenant}/api/campuspc/position/getJobList?" + urlencode({
                "pageSize": size, "currentPage": page, "projectId": portal}))
            if value.get("code") != 200:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["data"]["list"], value["data"]["total"], size
        if adapter == "tme":
            data = await self.tme_request(tenant, "/job/list" if portal == "social" else "/uc-job/list", {"page": page})
            meta = data["_meta"]
            # This official API fixes its own page size; the request's pageSize is ignored.
            size = meta["page_size"]
            if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 100 or meta.get("current_page") != page:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return data["items"], meta["total_count"], size
        if adapter == "alibaba-cpo":
            data = await self.cpo_request(tenant, "/position/search", {"channel": "group_official_site", "language": "zh",
                "batchId": "", "categories": "", "deptCodes": [], "key": "", "pageIndex": page, "pageSize": size,
                "regions": "", "subCategories": "", "shareType": "", "shareId": "", "myReferralShareCode": ""})
            rows = data["datas"]
            if rows is None and str(data.get("totalCount")) == "0":
                rows = []
            return rows, data["totalCount"], size
        if adapter == "kuaishou-social":
            data = await self.kuaishou_social_request("/api/v1/open/positions/simple", {
                "pageNum": page, "pageSize": size, "positionNatureCode": "C001" if portal == "social" else "C002",
                "channelCode": "official" if portal == "social" else "G002"})
            return data["list"], data["total"], size
        if adapter == "lenovo":
            value = await self.http.request(f"https://{tenant}/gateway/jobBase/list?" + urlencode({
                "pageNum": page, "pageSize": size, "projectType": portal}))
            if value.get("code") != 0 or not isinstance(value.get("result"), dict):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["result"]["rows"], value["result"]["total"], size
        if adapter == "weimob":
            data = await self.weimob_request("/front/position/position/list", body={
                "page": page, "pageSize": size, "positionName": None, "functionType": None,
                "positionNature": None, "recruitType": None, "workAddress": None})
            actual_size = data["pageSize"]
            if (data.get("currPage") != page or not isinstance(actual_size, int)
                    or isinstance(actual_size, bool) or not 1 <= actual_size <= 100):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return data["data"], data["count"], actual_size
        if adapter == "netease":
            value = await self.http.request("https://hr.163.com/api/hr163/position/queryPage", body={"currentPage": page, "pageSize": size, "keyword": ""})
            data = value.get("data")
            if not isinstance(data, dict):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return data["list"], data.get("total"), size
        if adapter == "xiaohongshu":
            value = await self.http.request(f"https://{tenant}/websiterecruit/position/pageQueryPosition", body={"recruitType": portal, "positionName": "", "pageNum": page, "pageSize": size})
            if value.get("statusCode") != 200:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["data"]["list"], value["data"]["total"], size
        if adapter == "pdd":
            size = 10  # Official endpoint fixes page size to ten, regardless of requested size.
            path = "train/list" if portal == "intern" else "list"
            value = await self.http.request(f"https://{tenant}/api/careers/api/recruit/position/{path}", body={"page": page, "pageSize": size})
            if value.get("success") is not True:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["result"]["list"], value["result"]["total"], size
        if adapter == "didi":
            size = 16
            value = await self.http.request(f"https://{tenant}/recruit-portal-service/api/job/front/list?" + urlencode({"page": page, "size": size, "recruitType": 1}))
            if (value.get("meta") or {}).get("code") != 0:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["data"]["items"], value["data"]["total"], size
        if adapter == "ctrip":
            kind = {"social": ["Regular"], "intern": ["Intern_Long_Term"], "campus": []}[portal]
            value = await self.http.request(f"https://{tenant}/api/hrrecruit/getJobAd", body={"condition": {"fromId": [], "keyword": "", "kind": kind, "country": [], "city": [], "bucode": [], "jobFamilyCode": [], "jobFamilyGroupCode": [], "category": 2 if portal == "campus" else 1}, "pager": {"index": str(page), "size": str(size)}}, headers={"Cookie": "language=zh-CN"})
            if value.get("retCode") != "201":
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["retValue"]["recruitJobAdList"], value["retValue"]["total"], size
        if adapter == "kuaishou":
            value = await self.http.request(f"https://{tenant}/recruit/campus/e/api/v1/open/positions/simple", body={"pageNum": page, "pageSize": size, "positionNatureCode": "fulltime"})
            if value.get("code") != 0:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            return value["result"]["list"], value["result"]["total"], size
        if adapter == "alibaba":
            size = 10
            body = {"channel": "new_campus_group_official_site", "categoryType": "internship" if portal == "intern" else "freshman", "language": "zh", "batchId": "", "categories": "", "deptCodes": [], "key": "", "pageIndex": page, "pageSize": size, "regions": "", "subCategories": "", "shareType": "", "shareId": "", "myReferralShareCode": ""}
            data = await self.alibaba_request(tenant, "/position/search", body)
            rows, total = data["datas"], data["totalCount"]
            # The official empty internship portal uses datas=null with an explicit zero total.
            if rows is None and str(total) == "0":
                rows = []
            return rows, total, size
        if adapter == "bilibili":
            channel = "social" if portal == "social" else "campus"
            kind = 0 if portal == "intern" else 3
            body = {"pageSize": size, "pageNum": page, "positionName": "", "postCode": "", "postCodeList": "", "workLocationList": "", "workTypeList": [kind], "positionTypeList": str(kind)}
            if channel == "campus":
                body["recruitType"] = 1
            path = "/api/srs/position/positionList" if channel == "social" else "/api/campus/position/positionList"
            data = await self.bilibili_request(tenant, portal, path, body=body)
            return data["list"], data["total"], size
        raise CollectionError("JOB_SOURCE_ADAPTER_PENDING")

    async def kuaishou_social_request(self, path, params):
        # Anonymous browser signing material from the public careers client;
        # no applicant account, session or personal credentials are used.
        public_key = "652f962a-0575-4575-98d2-f04e2291bee2"
        timestamp = str(int(time.time() * 1000))
        canonical = urlencode(sorted(params.items()))
        signature = hmac.new(public_key.encode(), (timestamp + canonical + public_key).encode(), hashlib.sha256).hexdigest()
        value = await self.http.request("https://zhaopin.kuaishou.cn/recruit/e" + path + "?" + urlencode(params),
            headers={"sign": signature, "signTimestamp": timestamp, "Referer": "https://zhaopin.kuaishou.cn/recruit/e/"})
        if value.get("code") != 0 or not isinstance(value.get("result"), dict):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["result"]

    async def kuaishou_labels(self, portal):
        key = ("kuaishou-labels", portal)
        if key not in self.sessions:
            data = await self.kuaishou_social_request("/api/v1/open/positions/label", {
                "channelCode": "official" if portal == "social" else "G002",
                "positionNatureCode": "C001" if portal == "social" else "C002"})
            labels = {}
            def visit(rows):
                if not isinstance(rows, list):
                    raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
                for row in rows:
                    labels[row["code"]] = row["name"]
                    if row.get("children"):
                        visit(row["children"])
            for group in ("domestic", "foreign", "category"):
                visit(data.get(group) or [])
            self.sessions[key] = labels
        return self.sessions[key]

    async def lenovo_cities(self, tenant):
        key = ("lenovo-cities", tenant)
        if key not in self.sessions:
            value = await self.http.request(f"https://{tenant}/gateway/sysDict/all")
            if value.get("code") != 0 or not isinstance(value.get("result"), list):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            city_dict = next((item for item in value["result"] if item.get("dictCode") == "city_portal"), None)
            if not city_dict or not isinstance(city_dict.get("children"), list):
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            self.sessions[key] = {str(item["dictValue"]): item["dictName"] for item in city_dict["children"]}
        return self.sessions[key]

    async def weimob_request(self, path, *, body=None, params=None):
        # Public careers browser signature, unrelated to applicant/staff authentication.
        nonce = uuid4().hex
        raw = json.dumps(body, ensure_ascii=False, separators=(",", ":")) if body is not None else urlencode(sorted((params or {}).items()))
        signature = hashlib.md5((raw + "123!@#$%^&*()_+<>?{}abc" + nonce).encode()).hexdigest()
        url = "https://job.weimob.com/recruit-manage" + path
        if params:
            url += "?" + urlencode(params)
        value = await self.http.request(url, body=body, headers={"requestId": nonce, "sign": signature})
        if value.get("code") != 0 or not isinstance(value.get("data"), dict):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["data"]

    async def tme_request(self, tenant, path, params):
        value = await self.http.request(f"https://{tenant}/api" + path + "?" + urlencode(params))
        if str(value.get("code")) != "200" or not isinstance(value.get("data"), dict):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["data"]

    async def moka_request(self, path, tenant, config, body, *, adapter="moka"):
        # Regional endpoints come only from registered site metadata, never admin input.
        host = "app-tc.mokahr.com" if urlsplit(entry_for(adapter, tenant, config).url).hostname == "app-tc.mokahr.com" else "app.mokahr.com"
        value = await self.http.request(f"https://{host}/api/outer/ats-apply/website/" + path,
            body={"orgId": tenant, "siteId": config["site_id"], "locale": "zh-CN"} | body)
        if isinstance(value.get("data"), str) and value.get("necromancer"):
            try:
                decryptor = Cipher(algorithms.AES(value["necromancer"].encode()), modes.CBC(b"de7c21ed8d6f50fe")).decryptor()
                raw = decryptor.update(base64.b64decode(value["data"])) + decryptor.finalize()
                unpad = PKCS7(128).unpadder()
                value = json.loads(unpad.update(raw) + unpad.finalize())
            except (ValueError, TypeError) as error:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE") from error
        if value.get("code") != 0 or value.get("success") is not True or not isinstance(value.get("data"), dict):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["data"]

    async def cpo_request(self, tenant, path, body):
        key = ("cpo", tenant)
        base = f"https://{tenant}"
        if key not in self.sessions:
            page = await self.http.request(base + "/off-campus/position-list", as_text=True, same_url_retry=True)
            token = re.search(r'__token__\s*:\s*"([^\"]+)"', page)
            if not token:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            self.sessions[key] = token[1]
        token = self.sessions[key]
        value = await self.http.request(base + path + "?" + urlencode({"_csrf": token}), body=body,
            headers={"X-XSRF-TOKEN": token, "Referer": base + "/off-campus/position-list"})
        if value.get("success") is not True or not isinstance(value.get("content"), dict):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["content"]

    async def ant_request(self, path, body):
        value = await self.http.request("https://hrcareersweb.antgroup.com" + path, body=body,
            headers={"Origin": "https://talent.antgroup.com", "Referer": "https://talent.antgroup.com/"})
        if value.get("success") is not True:
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value

    @staticmethod
    def mihoyo_body(portal):
        body = {"channelDetailIds": [1], "hireType": 0 if portal == "social" else 1}
        if portal != "social":
            body["jobNatures"] = [3 if portal == "intern" else 1]
        return body

    async def mihoyo_request(self, path, body):
        value = await self.http.request("https://ats.openout.mihoyo.com/ats-portal" + path, body=body,
            headers={"Origin": "https://jobs.mihoyo.com", "Referer": "https://jobs.mihoyo.com/"})
        if value.get("code") != 0 or value.get("success") is not True or not isinstance(value.get("data"), dict):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["data"]

    async def alibaba_request(self, tenant, path, body):
        base = f"https://{tenant}"
        if tenant not in self.sessions:
            html = await self.http.request(base + "/campus/index", as_text=True)
            token = re.search(r'__token__\s*:\s*"([^\"]+)"', html)
            if token is None:
                raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
            self.sessions[tenant] = token.group(1)
        token = self.sessions[tenant]
        value = await self.http.request(base + path + "?" + urlencode({"_csrf": token}), body=body,
            headers={"X-XSRF-TOKEN": token, "Referer": base + "/campus/index"})
        if value.get("success") is not True or not isinstance(value.get("content"), dict):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["content"]

    async def bilibili_request(self, tenant, portal, path, body=None):
        channel = "social" if portal == "social" else "campus"
        base = f"https://{tenant}"
        headers = {"X-AppKey": "ops.ehr-api.auth", "X-UserType": "2", "X-Channel": channel,
            "Referer": base + f"/{channel}/positions"}
        # Anonymous CSRF handshake, refreshed per request; no login or account credentials.
        value = await self.http.request(base + "/api/auth/v1/csrf/token", headers=headers)
        if value.get("code") != 0 or not isinstance(value.get("data"), str):
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        headers["X-CSRF"] = value["data"]
        value = await self.http.request(base + path, body=body, headers=headers)
        if value.get("code") != 0:
            raise CollectionError("JOB_SOURCE_INVALID_RESPONSE")
        return value["data"]

    async def normalize(self, adapter, tenant, config, portal, row):
        if adapter in manufacturing.ADAPTERS:
            return await manufacturing.normalize(self.http, self.sessions, adapter, tenant, portal, row, category)
        channel = employment = "unknown"
        attrs = {"schema_version": 1}
        published = salary = None
        if adapter == "tencent":
            identifier = row["PostId"]
            detail = await self.http.request("https://careers.tencent.com/tencentcareer/api/post/ByPostId?" + urlencode({"postId": str(identifier), "language": "zh-cn"}))
            if detail.get("Code") != 200 or not isinstance(detail.get("Data"), dict):
                raise ValueError("missing Tencent details")
            row = detail["Data"]
            title = row["RecruitPostName"]
            body = row["Responsibility"] + "\n\n" + row["Requirement"]
            locations = text_locations(row.get("LocationName"))
            raw_category = row.get("CategoryName")
            url = "https://careers.tencent.com/jobdesc.html?" + urlencode({"postId": identifier})
            channel = "experienced"
        elif adapter == "feishu":
            identifier, title = row["id"], row["title"]
            if row.get("requirement") is None:
                # Some official postings omit a separate requirements section. Fetch full detail
                # to distinguish a legitimate null from a reduced list representation.
                headers = {"website-path": portal} if portal != "default" else {}
                value = await self.http.request(f"https://{tenant}/api/v1/job/posts/{quote(str(identifier), safe='')}?portal_type={entry_for(adapter, tenant).portal_type}", headers=headers)
                detail = (value.get("data") or {}).get("job_post_detail")
                if value.get("code") != 0 or not isinstance(detail, dict) or str(detail.get("id")) != str(identifier):
                    raise ValueError("missing Feishu details")
                row = row | detail
            body = row["description"] + "\n\n" + (row["requirement"] or "")
            city = row.get("city") or row.get("city_info")
            locations = text_locations(row.get("city_list") or ([city] if city else []))
            kind = row.get("recruit_type") or {}
            channel, employment = pair_type((kind.get("parent") or {}).get("name"), kind.get("name"))
            if channel == "unknown" and portal == "campus":
                channel = "campus"
            if portal == "internship" and employment == "unknown":
                employment = "internship"
            raw_category = (row.get("job_category") or {}).get("name")
            url = f"https://{tenant}/{portal if portal != 'default' else 'experienced'}/position/{quote(str(identifier), safe='')}/detail"
            published = source_date(row.get("publish_time"))
        elif adapter in {"moka", "moka-campus"}:
            identifier, title = row["id"], row["title"]
            if not isinstance(row.get("jobDescription"), str) or not row["jobDescription"].strip():
                detail = await self.moka_request("job", tenant, config, {"jobId": identifier}, adapter=adapter)
                if str(detail.get("id")) != str(identifier) or detail.get("orgId") != tenant:
                    raise ValueError("missing Moka details")
                row = row | detail
            body = row["jobDescription"]
            locations = text_locations(row.get("locations", []))
            channel, employment = pair_type("campus" if row.get("showIsCampus") or row.get("hireMode") == 2 or portal == "campus" else "experienced", row.get("commitment"))
            raw_category = row.get("jobType") or (row.get("zhineng") or {}).get("name")
            attrs["department"] = (row.get("department") or {}).get("name")
            url = entry_for(adapter, tenant, config).url.rstrip("/") + f"#/job/{quote(str(identifier), safe='')}"
            published = source_date(row.get("publishedAt"))
        elif adapter == "haier":
            identifier, title = row["id"], row["job_name"]
            url = "https://maker.haier.net/client/job/detail/id/" + quote(str(identifier), safe="")
            page = await self.http.request(url, as_text=True)
            detail = HaierDetail()
            detail.feed(page)
            body = detail.description(identifier)
            locations = [part.rsplit("-", 1)[-1] for part in text_locations(row.get("location"))]
            raw_category = row.get("func_desc")
            salary = row.get("salary_label") or None
            attrs["department"] = row.get("bu_name") or None
            # This public pool is not labelled consistently as campus/social.
            # Do not infer a recruitment channel, employment or publication time.
        elif adapter == "oppo-campus":
            identifier = row["idProjPosition"]
            value = await self.http.request("https://careers.oppo.com/openapi/position/detail?" + urlencode({"id": identifier}),
                headers={"Tenant-Id": "1000"})
            detail = value.get("data")
            if (value.get("code") != 0 or not isinstance(detail, dict)
                    or str(detail.get("idRecruitPosition")) != str(identifier)):
                raise ValueError("mismatched OPPO campus details")
            title = detail["positionName"]
            duty, requirements = detail.get("positionDesc"), detail.get("positionRequire")
            if not isinstance(duty, str) or not clean_text(duty) or not isinstance(requirements, str) or not clean_text(requirements):
                raise ValueError("missing OPPO campus sections")
            body = duty + "\n\n" + requirements
            for label, field in (("知识技能要求", "knowledgeSkill"), ("AI能力要求", "aiCapabilityLevelDesc"), ("加分项", "bonusItem")):
                if detail.get(field):
                    body += "\n\n" + label + "\n" + detail[field]
            places = detail.get("workCityVOList") or []
            locations = text_locations([p["workCityName"] for p in places] or detail.get("workCityName"))
            kind = detail.get("recruitmentType")
            if kind in {"Graduate", "doctor"}:
                channel = "campus"
            elif kind == "Intern":
                employment = "internship"
            raw_category = detail.get("positionTypeName")
            published = source_date(detail.get("releaseTime"))
            attrs["batch"] = detail.get("projectName")
            url = "https://careers.oppo.com/campus/post/" + quote(str(identifier), safe="")
        elif adapter == "meituan":
            identifier, title = row["jobUnionId"], row["name"]
            body = row["jobDuty"] + "\n\n" + row["jobRequirement"]
            locations = text_locations(row.get("cityList") or row.get("city"))
            raw_category = (row.get("jobFamily") or {}).get("name") if isinstance(row.get("jobFamily"), dict) else row.get("jobFamily")
            channel = "experienced" if portal == "social" else "campus" if portal == "campus" else "unknown"
            employment = "internship" if portal == "intern" else "full_time"
            url = "https://zhaopin.meituan.com/web/position/detail?" + urlencode({"jobUnionId": identifier, "jobType": {"social": "3", "campus": "1", "intern": "2"}[portal]})
        elif adapter == "baidu":
            identifier, title = row["postId"], row["name"]
            body = row["workContent"] + "\n\n" + row["serviceCondition"]
            locations = text_locations(row.get("workPlace"))
            channel, employment = pair_type(portal, "internship" if portal == "INTERN" else "unknown")
            raw_category = row.get("postType")
            published = source_date(row.get("publishDate"))
            attrs.update(education_requirement=row.get("education"), experience_requirement=row.get("workYears"), department=row.get("orgName"))
            url = f"https://talent.baidu.com/jobs/detail/{portal}/{quote(str(identifier), safe='')}"
        elif adapter == "jd":
            identifier, title = row["positionId"], row["positionName"]
            # Both responsibilities and requirements are mandatory for a new JD.
            body = row["workContent"] + "\n\n" + row["qualification"]
            locations = text_locations(row.get("workCity"))
            raw_category = row.get("positionType")
            channel = "experienced"
            published = source_date(row.get("formatPublishTime"))
            url = f"https://zhaopin.jd.com/web/job/job_detail/{quote(str(identifier), safe='')}"
        elif adapter == "ant":
            identifier = row["id"]
            if row.get("description") is None or row.get("requirement") is None:
                value = await self.ant_request("/api/position/getDetail", {"id": identifier, "language": "zh", "channel": "group_official_site" if portal == "social" else "campus_group_official_site"})
                detail = value.get("content")
                if not isinstance(detail, dict) or str(detail.get("id")) != str(identifier):
                    raise ValueError("missing Ant details")
                row = row | detail
            title = row["name"]
            body = row["description"] + "\n\n" + row["requirement"]
            locations = text_locations(row.get("workLocations"))
            raw_category = row.get("categoryName") or ",".join(row.get("categories") or [])
            channel = "experienced" if portal == "social" else "campus"
            employment = "internship" if row.get("batchType") == "trainee" else "full_time"
            published = source_date(row.get("publishTime"))
            attrs.update(department=row.get("department"), batch=row.get("batchName"))
            url = f"https://{tenant}/{'off-campus' if portal == 'social' else 'campus'}-position?" + urlencode({"positionId": identifier, "lang": "zh"})
        elif adapter == "mihoyo":
            identifier = row["id"]
            detail = await self.mihoyo_request("/v1/job/info", self.mihoyo_body(portal) | {"id": str(identifier)})
            if str(detail.get("id")) != str(identifier):
                raise ValueError("missing MiHoYo details")
            row = row | detail
            title = row["title"]
            body = row["description"] + "\n\n" + row["jobRequire"]
            locations = [item["addressDetail"] for item in row.get("addressDetailList", [])]
            raw_category = row.get("competencyType")
            channel = "experienced" if portal == "social" else "campus"
            employment = "internship" if portal == "intern" else "full_time"
            attrs["department"] = row.get("projectName")
            url = f"https://{tenant}/#/position/{quote(str(identifier), safe='')}"
        elif adapter == "beisen":
            identifier, title = row["JobAdId"], row["JobAdName"]
            body = row["Duty"] + "\n\n" + row["Require"]
            raw_locations = text_locations(row.get("LocNames"))
            # Beisen explicitly returns province·city; keep full text without inferring geography.
            locations = [part.rsplit("·", 1)[-1] for part in raw_locations]
            channel, employment = pair_type(row.get("Category"), row.get("Kind"))
            raw_category = row.get("ClassificationOne")
            salary = row.get("Salary") or None
            published = source_date(row.get("PostDate"))
            url = f"https://{tenant}/{'campus' if portal == '2' else 'social'}/detail?" + urlencode({"jobAdId": identifier})
        elif adapter == "huawei":
            identifier, title = row["jobId"], row["jobName"]
            body = row["mainBusiness"] + "\n\n" + row["jobRequire"]
            locations = text_locations(str(row.get("workPlace") or "").replace("/", ","))
            channel, employment = "experienced", "unknown"
            raw_category = row.get("jobFamilyName")
            published = source_date(row.get("lastUpdateDate"))
            attrs["department"] = row.get("deptName")
            url = "https://career.huawei.com/cn/social-recruitment-job-list?" + urlencode({"jobId": identifier})
        elif adapter == "dji":
            identifier, title = row["positionId"], row["jobTitle"]
            body = row["duty"] + "\n\n" + row["requirement"]
            locations = text_locations(row.get("locationDescription"))
            channel = "experienced" if portal == "N" else "unknown"
            employment = "internship" if portal == "Y" else "unknown"
            raw_category = row.get("positionCategorySecond") or row.get("positionCategory")
            published = source_date(row.get("approveTime"))
            attrs["department"] = row.get("team")
            url = f"https://{tenant}/zh-CN/position/detail?" + urlencode({"positionId": identifier})
        elif adapter == "jd-campus":
            identifier, title = row["publishId"], row["positionName"]
            body = row["workContent"] + "\n\n" + row["qualification"]
            locations = text_locations(row.get("workCity")) or text_locations([
                item.get("workCity") for item in row.get("requirementVoList", []) if isinstance(item, dict) and item.get("workCity")])
            raw_category = row.get("jobDirection") or row.get("jobCategory")
            channel = "campus" if portal == "present" else "unknown"
            employment = "internship" if portal == "internship" else "full_time"
            published = source_date(row.get("publishTime"))
            attrs.update(education_requirement=row.get("education") if isinstance(row.get("education"), str) else None, batch=row.get("planName"))
            url = f"https://{tenant}/#/job/detail?" + urlencode({"publishId": identifier})
        elif adapter == "netease-campus":
            identifier, title = row["id"], row["positionName"]
            body = row["positionDescription"] + "\n\n" + row["positionRequirement"]
            locations = text_locations(row.get("workPlaceName"))
            raw_category = row.get("positionTypeName")
            channel, employment = "campus", "full_time"
            published = source_date(row.get("updateTime"))
            url = f"https://{tenant}/app/job/position?" + urlencode({"id": portal, "positionId": identifier})
        elif adapter == "tme":
            identifier = row["id"]
            detail = await self.tme_request(tenant, "/job/info" if portal == "social" else "/uc-job/info", {"id": str(identifier)})
            if str(detail.get("id")) != str(identifier):
                raise ValueError("missing TME details")
            row = row | detail
            title = row["name"]
            body = row["duty"] + "\n\n" + row["requirement"]
            locations = text_locations(row.get("work_city"))
            raw_category = row.get("jobf_descr")
            kind = str(row.get("job_type_descr") or "")
            channel = "experienced" if portal == "social" else "unknown" if "实习" in kind else "campus"
            employment = "internship" if "实习" in kind else pair_type(None, row.get("work_nature_descr"))[1]
            attrs["department"] = row.get("company_set") or row.get("setid_descr")
            url = f"https://{tenant}/{'jobs/details' if portal == 'social' else 'campus/post-details'}/?" + urlencode({"id": identifier})
            # The two public APIs may use independent numeric id namespaces.
            identifier = f"{portal}:{identifier}"
        elif adapter == "alibaba-cpo":
            identifier = row["id"]
            detail = await self.cpo_request(tenant, "/position/detail", {"id": identifier, "channel": "group_official_site", "language": "zh"})
            if str(detail.get("id")) != str(identifier):
                raise ValueError("missing CPO details")
            row = row | detail
            title = row["name"]
            if all(clean_text(row[field]) in {"", "-", "--", "暂无", "无"} for field in ("description", "requirement")):
                raise ValueError("missing CPO job body")
            body = row["description"] + "\n\n" + row["requirement"]
            locations = text_locations(row.get("workLocations"))
            raw_category = row.get("categoryName") or ",".join(row.get("categories") or [])
            channel, employment = "experienced", "unknown"
            published = source_date(row.get("publishTime"))
            attrs["department"] = row.get("department")
            url = f"https://{tenant}/off-campus/position-detail?" + urlencode({"positionId": identifier, "positionType": "social"})
        elif adapter == "kuaishou-social":
            identifier = row["id"]
            detail = await self.kuaishou_social_request("/api/v1/open/position", {"id": str(identifier)})
            if str(detail.get("id")) != str(identifier):
                raise ValueError("missing Kuaishou details")
            row = row | detail
            title = row["name"]
            body = row["description"] + "\n\n" + row["positionDemand"]
            labels = await self.kuaishou_labels(portal)
            codes = row.get("workLocationsCode") or ([row["workLocationCode"]] if row.get("workLocationCode") else [])
            if any(code not in labels for code in codes):
                raise ValueError("unknown Kuaishou city code")
            locations = [labels[code] for code in codes]
            raw_category = row.get("positionCategoryName") or labels.get(row.get("positionCategoryCode"))
            channel = "experienced" if portal == "social" else "unknown"
            employment = "full_time" if portal == "social" else "internship"
            attrs["department"] = row.get("departmentName")
            published = source_date(row.get("releaseTime"))
            url = f"https://{tenant}/recruit/e/#/official/{'social' if portal == 'social' else 'trainee'}/job-info/{quote(str(identifier), safe='')}"
        elif adapter == "lenovo":
            identifier, title = row["id"], row["jobName"]
            body = row["jobDuties"] + "\n\n" + row["jobRequirement"]
            city_dict = await self.lenovo_cities(tenant)
            codes = text_locations(row.get("workPlace"))
            if any(code not in city_dict for code in codes):
                raise ValueError("unknown Lenovo city code")
            locations = [city_dict[code] for code in codes]
            raw_category = row.get("typeName")
            channel = "unknown" if portal == "2" else "campus"
            employment = "internship" if portal == "2" else "full_time"
            url = f"https://{tenant}/position/detail?" + urlencode({"id": identifier})
        elif adapter == "weimob":
            identifier = row["id"]
            detail = await self.weimob_request("/front/position/internal/positionDetail", params={"id": str(identifier)})
            if str(detail.get("id")) != str(identifier):
                raise ValueError("missing Weimob public details")
            row = row | detail
            title = row["positionName"]
            body = row["positionDesc"] + "\n\n" + row["positionRequire"]
            locations = text_locations(row.get("workAddresses"))
            kind = row.get("positionNature")
            channel = "experienced" if kind == "FULL" else "campus" if kind == "SCHOOL" else "unknown"
            employment = "full_time" if kind == "FULL" else "internship" if kind == "INTERNSHIP" else "unknown"
            raw_category = {"SKILL": "技术", "PRODUCT": "产品", "DESIGN": "设计", "OPERATE": "运营",
                "MARKETING": "市场", "FUNCTION": "职能"}.get(row.get("functionType"))
            attrs["department"] = row.get("deptName")
            url = f"https://{tenant}/public/websitePositionDetail?" + urlencode({"positionId": identifier})
        elif adapter == "netease":
            identifier, title = row["id"], row["name"]
            body = row["description"] + "\n\n" + row["requirement"]
            locations = text_locations(row.get("workPlaceNameList"))
            raw_category = row.get("firstPostTypeName")
            employment_text = row.get("workTypeName") or row.get("positionTypeName")
            channel, employment = pair_type("experienced", employment_text)
            url = f"https://hr.163.com/position/detail?id={identifier}"
            attrs.update(education_requirement=row.get("reqEducationName"), experience_requirement=row.get("reqWorkYearsName"), department=row.get("firstDepName"))
        elif adapter == "xiaohongshu":
            identifier, title = row["positionId"], row["positionName"]
            body = row["duty"] + "\n\n" + row["qualification"]
            locations = text_locations(row.get("workplace"))
            raw_category = row.get("jobType")
            channel = "experienced" if portal == "social" else "campus" if portal == "campus" else "unknown"
            employment = "internship" if portal == "intern" else "full_time"
            published = source_date(row.get("publishTime"))
            url = f"https://{tenant}/{portal}/position?" + urlencode({"positionId": identifier})
        elif adapter == "pdd":
            identifier, title = row["id"], row["name"]
            body = row["jobDuty"]
            locations = text_locations(row.get("workLocationName") or row.get("workLocation"))
            raw_category = row.get("jobName")
            channel = "campus"
            employment = "internship" if portal == "intern" else "full_time"
            published = source_date(row.get("releaseTime"))
            if row.get("graduationYear"):
                attrs["graduation_year"] = str(row["graduationYear"])
            url = f"https://{tenant}/campus/{'intern' if portal == 'intern' else 'grad'}?" + urlencode({"id": identifier})
        elif adapter == "didi":
            identifier = row["jdId"]
            value = await self.http.request(f"https://{tenant}/recruit-portal-service/api/job/front/view/{quote(str(identifier), safe='')}")
            if (value.get("meta") or {}).get("code") != 0:
                raise ValueError("missing Didi details")
            row = row | value["data"]
            title = row["jobName"]
            body = (row.get("jobDesc") or row["jobDuty"]) + "\n\n" + (row.get("qualification") or row["jobQualification"])
            locations = text_locations(row.get("workArea"))
            raw_category = row.get("jobTypeName")
            channel = "experienced"
            attrs["department"] = row.get("deptName")
            url = f"https://{tenant}/social/p/{quote(str(identifier), safe='')}"
        elif adapter == "ctrip":
            identifier, title = row["fromId"], row["jobTitle"]
            # This endpoint returns the complete ATS JD in requirements; duty is nullable.
            body = "\n\n".join(part for part in (row.get("duty"), row["requirements"]) if isinstance(part, str) and part.strip())
            locations = text_locations(row.get("cityName"))
            raw_category = row.get("jobFamilyGroupName")
            channel = "campus" if portal == "campus" else "experienced"
            employment = "internship" if portal == "intern" else "full_time"
            published = source_date(row.get("publishDate"))
            attrs["department"] = row.get("buName")
            url = f"https://{tenant}/#/{'campus' if portal == 'campus' else 'experienced'}/jobList?" + urlencode({"fromId": identifier})
        elif adapter == "kuaishou":
            identifier, title = row["id"], row["name"]
            body = row["description"] + "\n\n" + row["positionDemand"]
            locations = text_locations(row.get("workLocationDicts"))
            raw_category = row.get("positionCategoryName")
            channel, employment = "campus", "full_time"
            published = source_date(row.get("releaseTime"))
            attrs["department"] = row.get("departmentName")
            url = f"https://{tenant}/recruit/campus/e/#/campus/job-info/{quote(str(identifier), safe='')}"
        elif adapter == "alibaba":
            identifier = row["id"]
            detail = await self.alibaba_request(tenant, "/position/detail", {"id": identifier, "channel": "new_campus_group_official_site", "language": "zh"})
            row = row | detail
            title = row["name"]
            body = row["description"] + "\n\n" + row["requirement"]
            locations = text_locations(row.get("workLocations"))
            raw_category = row.get("categoryName")
            channel = "campus"
            employment = "internship" if portal == "intern" else "full_time"
            published = source_date(row.get("publishTime"))
            attrs.update(department=row.get("department"), batch=row.get("batchName"))
            url = f"https://{tenant}/campus/position?" + urlencode({"positionId": identifier, "positionType": "internship" if portal == "intern" else "campus"})
        elif adapter == "bilibili":
            identifier = row["id"]
            prefix = "/api/srs" if portal == "social" else "/api/campus"
            row = row | await self.bilibili_request(tenant, portal, prefix + f"/position/detail/{quote(str(identifier), safe='')}")
            title = row["positionName"]
            body = row["positionDescription"]
            locations = text_locations(row.get("workLocation"))
            raw_category = row.get("postCodeName")
            channel = "experienced" if portal == "social" else "campus"
            employment = "internship" if portal == "intern" else "full_time"
            url = f"https://{tenant}/{'social' if portal == 'social' else 'campus'}/positions/{quote(str(identifier), safe='')}"
            if portal != "social":
                url += "?" + urlencode({"type": 0 if portal == "intern" else 3})
        else:
            raise ValueError("unsupported adapter")
        location_data = cities(locations)
        if adapter == "beisen":
            location_data["raw"] = list(dict.fromkeys(raw_locations))
        return JobObservation(source_job_key=job_key(identifier, url), job_title=title,
            description=body, recruitment_channel=channel, employment_type=employment,
            locations=location_data, job_category=category(raw_category),
            salary_text=salary, source_url=url, source_attributes=attrs, published_at=published)
