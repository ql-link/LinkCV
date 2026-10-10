"""Anonymous public careers readers. Never persist entire upstream responses."""
from __future__ import annotations

from urllib.parse import urlencode

from linkresume.application.job_pool.types import JobObservation, cities, clean_text, job_key, source_date


ADAPTERS = {"byd", "midea", "gree", "hikvision", "dayee"}
BYD_API = "https://job.byd.com/portal/api/portal-api/"
HIK_API = "https://talent.hikvision.com/api/ats/official/"


def checked(value, status_key, expected, *, array=False):
    if (not isinstance(value, dict) or value.get(status_key) != expected
            or (expected is True and value.get(status_key) is not True)
            or (type(expected) is int and type(value.get(status_key)) is not int)
            or not isinstance(value.get("data"), list if array else dict)):
        raise ValueError("invalid public careers response")
    return value["data"]


def object_value(value):
    if not isinstance(value, dict):
        raise ValueError("invalid public careers object")
    return value


def sections(row, *keys):
    values = [row[key] for key in keys]
    if any(not isinstance(value, str) for value in values):
        raise ValueError("missing public job description")
    body = "\n\n".join(values)
    if not clean_text(body):
        raise ValueError("empty public job description")
    return body


def locations(value):
    return [part.strip().rsplit("-", 1)[-1] for part in str(value or "").replace("、", ",").replace("，", ",").split(",") if part.strip()]


def page_size(value):
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 100:
        raise ValueError("invalid public page size")
    return value


async def byd_entries(http, sessions):
    key = ("byd", "entries")
    if key not in sessions:
        data = checked(await http.request(BYD_API + "postEntryConfig/list", headers={"lang": "zh_CN"}), "code", 0, array=True)
        if not isinstance(data, list) or not data or any(not isinstance(item, dict) for item in data):
            raise ValueError("missing BYD public recruitment entries")
        sessions[key] = data
    return sessions[key]


async def hik_company(http, sessions):
    key = ("hikvision", "company")
    if key not in sessions:
        data = checked(await http.request(HIK_API + "officialConfig/rest/getConfigInfo?domainStr=talent.hikvision.com"), "success", True)
        company = object_value(data["officialSubjInfoVo"])["companyId"]
        if not isinstance(company, str) or not company:
            raise ValueError("missing public careers company")
        sessions[key] = company
    return sessions[key]


async def dayee_request(http, tenant, portal, action, form):
    suite = portal.split(":")[0]
    url = f"https://{tenant}/wecruit/positionInfo/{action}/{suite}?iSaJAx=isAjax&request_locale=zh_CN"
    return checked(await http.request(url, form=form), "state", "200")


async def page(http, sessions, adapter, tenant, portal, number):
    size = 50
    if adapter == "byd":
        if portal == "social":
            data = checked(await http.request(BYD_API + "position/queryList", body={
                "positionTypeArr": [], "positionProvinceArr": [], "positionCityArr": [], "positionOrgArr": [],
                "vagueCondition": "", "searchType": 1, "zpType": "00251", "pageNum": (number - 1) * size,
                "pageSize": size}, headers={"lang": "zh_CN"}), "code", 0)
            return data["data"], data["total"], size
        entries = await byd_entries(http, sessions)
        matches = [item for item in entries if item.get("postEntryName") == portal and item.get("status") == "00111"]
        if len(matches) != 1 or not matches[0].get("schoolTopic"):
            raise ValueError("missing BYD recruitment entry")
        entry = matches[0]
        value = await http.request(BYD_API + "schoolPortal/queryPositionList", body={
            "topicCode": entry["schoolTopic"], "batch": entry.get("batch") or "",
            "campusNature": entry.get("campusNature") or "", "abroad": "00111" if entry.get("abroad") == "00111" else "",
            "degree": entry.get("degree") or "", "jobType": [], "researchDirection": [], "workPlace": [],
            "keywords": "", "pageSize": size, "pageIndex": number}, headers={"lang": "zh_CN"})
        rows = checked(value, "code", 0, array=True)
        meta = object_value(value["page"])
        if meta.get("pageIndex") != number:
            raise ValueError("invalid BYD page index")
        return rows, meta["totalCount"], page_size(meta["pageSize"])
    if adapter == "midea":
        value = await http.request("https://recruit.midea.com/backend/rec/home/out/official/position/list",
            form={"pageIndex": number, "pageSize": size})
        if (not isinstance(value, dict) or not isinstance(value.get("data"), list)
                or object_value(value["info"]).get("pageIndex") != number):
            raise ValueError("invalid Midea public positions")
        return value["data"], value["total"], page_size(value["info"]["pageSize"])
    if adapter == "gree":
        data = checked(await http.request("https://zhaopin.greeyun.com/api/apply/job?" + urlencode({
            "pageNum": number, "pageSize": size, "position": "", "property": portal})), "code", 200)
        return data["list"], data["total"], size
    if adapter == "hikvision":
        await hik_company(http, sessions)
        # The official group site explicitly clears companyId for its public list.
        # The company ID from boot config is required by its detail endpoint only.
        data = checked(await http.request(HIK_API + "officialPostPosition/getPostInfoForSys",
            body={"pageNum": number, "pageSize": size, "companyId": ""},
            headers={"Content-Type": "application/json"}), "success", True)
        if data.get("pageNum") != number:
            raise ValueError("invalid Hikvision page index")
        if data.get("total") == 0 and data.get("list") == [] and data.get("pageSize") == 0:
            return [], 0, size
        return data["list"], data["total"], page_size(data["pageSize"])
    if adapter == "dayee":
        data = await dayee_request(http, tenant, portal, "listPosition", {
            "isFrompb": "true", "recruitType": int(portal.split(":")[1]), "pageSize": size, "currentPage": number})
        meta = object_value(data["pageForm"])
        if meta.get("dataCount") == 0 and meta.get("pageData") == [] and meta.get("currentPage") == 0 and meta.get("pageSize") == 0:
            return [], 0, size
        if meta.get("currentPage") != number:
            raise ValueError("invalid Dayee page index")
        # Some tenants ignore the requested size and return their configured size.
        return meta["pageData"], meta["dataCount"], page_size(meta["pageSize"])
    raise ValueError("unsupported public careers adapter")


async def normalize(http, sessions, adapter, tenant, portal, row, categorize):
    channel = employment = "unknown"
    attrs = {"schema_version": 1}
    published = salary = raw_category = None
    if adapter == "byd":
        identifier = row["id"]
        if portal == "social":
            detail = checked(await http.request(BYD_API + "position/queryDetail", body={"id": identifier, "pageSize": 4},
                headers={"lang": "zh_CN"}), "code", 0)
            if str(detail.get("id")) != str(identifier):
                raise ValueError("mismatched BYD job")
            tags = detail["tagDetailList"]
            if not isinstance(tags, list) or not tags or any(not isinstance(item, dict) for item in tags):
                raise ValueError("missing BYD job description")
            if not any(isinstance(item.get("detail"), str) and clean_text(item["detail"]) for item in tags):
                raise ValueError("empty BYD job description")
            body = "\n\n".join(sections(item, "name", "detail") for item in tags)
            title = detail["positionName"]
            raw_category = row.get("positionTypeName")
            places = locations(detail.get("city"))
            attrs["department"] = detail.get("orgName")
            published = source_date(detail.get("publishTime"))
            channel = "experienced"
            path = "/social/socialPositionDetails"
        else:
            # Read the entire position, including every department/research variant.
            # Do not replace a shared ID with a doctor's or overseas-only description.
            detail = checked(await http.request(BYD_API + "schoolPortal/queryPosition?" + urlencode({
                "id": identifier, "abroad": "", "degree": ""}), headers={"lang": "zh_CN"}), "code", 0)
            if str(detail.get("id")) != str(identifier):
                raise ValueError("mismatched BYD campus job")
            variants = detail["positionInfoList"]
            if not isinstance(variants, list) or not variants or any(not isinstance(item, dict) for item in variants):
                raise ValueError("missing BYD campus descriptions")
            body = "\n\n".join("\n".join(str(item.get(key) or "") for key in ("division", "researchDirection", "workPlace"))
                + "\n\n" + sections(item, "jobDuty", "jobRequirements") for item in variants)
            title = detail["jobName"]
            raw_category = detail.get("jobType")
            places = locations(detail.get("workPlace"))
            channel = "campus"
            employment = "internship" if detail.get("campusNature") == "008502" else "unknown"
            attrs["batch"] = str(detail["batch"]) if detail.get("batch") is not None else None
            path = "/school/schoolPositionDetail"
        url = "https://job.byd.com/portal/pc/#" + path + "?" + urlencode({"id": identifier})
    elif adapter == "midea":
        identifier, title = row["positionId"], row["publicationName"] or row["demandPositionName"]
        body = sections(row, "postDuties", "qualification")
        places = locations(row.get("workingPlace"))
        raw_category = row.get("postCategoryName")
        attrs.update(department=row.get("superiorUnitName"), education_requirement=row.get("education"))
        published = source_date(row.get("releaseStartDate"))
        channel = "experienced"
        url = "https://recruit.midea.com/recruitOut/ihr/social/jobApplication?" + urlencode({"positionId": identifier, "recruitType": "social"})
    elif adapter == "gree":
        identifier, title = row["Code"], row["Position"]
        body = sections(row, "Description", "Qualifications")
        places = locations(row.get("Location"))
        raw_category = row.get("Category")
        channel = "campus" if str(row.get("property")) == "1" else "experienced" if str(row.get("property")) == "2" else "unknown"
        attrs.update(education_requirement=row.get("Education"), experience_requirement=row.get("Experience"))
        published = source_date(row.get("PubTime"))
        url = "https://zhaopin.greeyun.com/job?" + urlencode({"JobCode": identifier})
    elif adapter == "hikvision":
        identifier = row["postSecureId"]
        company = await hik_company(http, sessions)
        data = checked(await http.request(HIK_API + "officialPostPosition/findAdDetailInfo?" + urlencode({
            "adIdStr": identifier, "companyId": company})), "success", True)
        detail = object_value(data["ad"])
        if str(detail.get("adIdStr")) != str(identifier):
            raise ValueError("mismatched Hikvision job")
        title, body = detail["postName"], sections(detail, "postDesc", "qualifications")
        places = locations(detail.get("workPlace") or detail.get("locationDesc"))
        raw_category = detail.get("positionType")
        channel = "experienced" if str(detail.get("recruitType")) == "1" else "unknown"
        employment = "internship" if str(detail.get("recruitType")) == "3" else "unknown"
        attrs.update(department=detail.get("department"), education_requirement=detail.get("education"))
        url = "https://talent.hikvision.com/society/position?" + urlencode({"postId": identifier})
    elif adapter == "dayee":
        identifier = row["postId"]
        detail = await dayee_request(http, tenant, portal, "listPositionDetail", {"postId": identifier})
        if str(detail.get("postId")) != str(identifier):
            raise ValueError("mismatched Dayee job")
        # Full detail can legitimately contain one combined JD field (e.g. LONGi campus).
        # Missing sections are allowed only here, after fetching and matching full detail.
        title = detail["postName"]
        body = sections({key: "" if detail.get(key) is None else detail[key]
            for key in ("workContent", "serviceCondition")}, "workContent", "serviceCondition")
        places = locations(detail.get("workPlaceStr"))
        raw_category = detail.get("postTypeName")
        channel = "campus" if detail.get("recruitType") == 1 else "experienced" if detail.get("recruitType") == 2 else "unknown"
        employment = "full_time" if detail.get("workTypeStr") == "全职" else "internship" if detail.get("workTypeStr") in {"实习", "实习生"} else "unknown"
        attrs.update(department=detail.get("department") or detail.get("orgName"),
            education_requirement=detail.get("education"), batch=detail.get("projectName"))
        published = source_date(detail.get("publishFirstDate"))
        suite, recruit_type = portal.split(":")
        url = f"https://{tenant}/{suite}/pb/posDetail.html?" + urlencode({
            "postId": identifier, "postType": "campus" if recruit_type == "1" else "society"})
    else:
        raise ValueError("unsupported public careers adapter")
    if identifier is None or isinstance(identifier, bool) or not str(identifier).strip():
        raise ValueError("missing public job identity")
    return JobObservation(source_job_key=job_key(identifier, url), job_title=title, description=body,
        job_category=categorize(raw_category), recruitment_channel=channel, employment_type=employment,
        salary_text=salary, locations=cities(places), source_attributes=attrs, published_at=published, source_url=url)
