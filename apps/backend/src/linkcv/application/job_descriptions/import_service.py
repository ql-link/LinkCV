from __future__ import annotations

import re
from decimal import Decimal

from pydantic import ValidationError

from linkcv.domain.job_source import InvalidJobSource, normalize_job_source
from linkcv.modules.job_descriptions.schemas import (
    BrowserJobCapture,
    EmploymentType,
    JobDescriptionCreateRequest,
    JobDescriptionImportRequest,
    SalaryPeriod,
    WorkMode,
)


class InvalidJobImport(ValueError):
    pass


_SPACE_RE = re.compile(r"[\t\v\f \u00a0\u3000]+")
_BLANK_LINES_RE = re.compile(r"\n{3,}")
_MONTHLY_SALARY_RE = re.compile(
    r"(?P<minimum>\d+(?:\.\d+)?)\s*[-~—–至]\s*"
    r"(?P<maximum>\d+(?:\.\d+)?)\s*[kK](?:\s*[·x×]\s*(?P<months>\d+)\s*薪)?"
)
_CNY_SALARY_RE = re.compile(
    r"(?P<minimum>\d+(?:\.\d+)?)\s*[-~—–至]\s*"
    r"(?P<maximum>\d+(?:\.\d+)?)\s*元\s*/?\s*(?P<period>小时|时|天|日|月|年)"
)
_WORK_SCHEDULE_RE = re.compile(
    r"(?:每周\s*)?\d+\s*天\s*[/／]\s*周|"
    r"(?:至少\s*|连续\s*)?\d+\s*个?月|"
    r"长期实习|短期实习|双休|单双休|排班|远程办公|居家办公|弹性工作"
)
_BENEFIT_RE = re.compile(
    r"福利|补贴|补助|奖金|全勤奖|员工旅游|带薪年假|五险|一金|体检|"
    r"团建|下午茶|餐补|包吃|包住|免费班车|节日礼品"
)
_SIZE_RE = re.compile(r"(?:少于\s*)?\d+(?:\s*[-~—–至]\s*\d+)?\s*人|\d+\s*人以上")
_FINANCING_MARKERS = (
    "未融资",
    "不需要融资",
    "天使轮",
    "A轮",
    "B轮",
    "C轮",
    "D轮",
    "战略融资",
    "已上市",
    "上市公司",
)


def build_job_description_from_capture(
    payload: JobDescriptionImportRequest,
) -> JobDescriptionCreateRequest:
    try:
        source = normalize_job_source(payload.source_url)
    except InvalidJobSource as error:
        raise InvalidJobImport("invalid source URL") from error
    if source.site != "boss" or source.job_id is None:
        raise InvalidJobImport("only BOSS job detail pages are supported")

    capture = payload.capture
    job_title = _single_line(capture.job_title)
    company_name = _single_line(capture.company_name)
    description = _description(capture.description_text)
    if not job_title or not company_name or not description:
        raise InvalidJobImport("title, company and description are required")

    salary_text = _single_line(capture.salary_text)
    salary_min, salary_max, salary_currency, salary_period, months = _salary(
        salary_text
    )
    company_industry, company_size, company_financing_stage = _company_fields(
        capture
    )
    experience_requirement, work_schedule = _requirements(capture)

    try:
        return JobDescriptionCreateRequest(
            job_title=job_title,
            company_name=company_name,
            employment_type=_employment_type(capture.employment_type_text),
            description=description,
            skills=_clean_skills(capture.skills),
            education_requirement=_single_line(capture.education_text),
            experience_requirement=experience_requirement,
            work_schedule=work_schedule,
            work_city=_single_line(capture.work_city),
            work_address=_single_line(capture.work_address),
            work_mode=_work_mode(capture),
            salary_text=salary_text,
            salary_min=salary_min,
            salary_max=salary_max,
            salary_currency=salary_currency,
            salary_period=salary_period,
            salary_months_per_year=months,
            company_legal_name=_single_line(capture.company_legal_name),
            company_industry=company_industry,
            company_size=company_size,
            company_financing_stage=company_financing_stage,
            company_description=_multiline(capture.company_description),
            recruiter_name=_single_line(capture.recruiter_name),
            recruiter_title=_single_line(capture.recruiter_title),
            source_type="external_import",
            source_url=source.url,
            duplicate_resolution=payload.duplicate_resolution,
        )
    except ValidationError as error:
        raise InvalidJobImport("capture exceeds the storage contract") from error


def _single_line(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.replace("\u200b", "").replace("\ufeff", "")
    cleaned = _SPACE_RE.sub(" ", cleaned.replace("\r", " ").replace("\n", " "))
    return cleaned.strip() or None


def _multiline(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = cleaned.replace("\u200b", "").replace("\ufeff", "")
    lines = [_SPACE_RE.sub(" ", line).strip() for line in cleaned.split("\n")]
    return _BLANK_LINES_RE.sub("\n\n", "\n".join(lines)).strip() or None


def _description(value: str | None) -> str | None:
    cleaned = _multiline(value)
    if cleaned is None:
        return None
    lines = cleaned.split("\n")
    while lines and lines[0].rstrip("：:") in {"职位描述", "职位详情", "岗位描述"}:
        lines.pop(0)
    for index, line in enumerate(lines):
        if line in {"举报", "职位发布者"} and index > 0:
            lines = lines[:index]
            break
    return _BLANK_LINES_RE.sub("\n\n", "\n".join(lines)).strip() or None


def _unique_lines(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _single_line(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _clean_skills(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in _unique_lines(values):
        if _BENEFIT_RE.search(value) or _WORK_SCHEDULE_RE.search(value):
            continue
        if any(marker in value for marker in ("全职", "兼职", "实习", "合同", "临时")):
            continue
        result.append(value)
    return result


def _requirements(capture: BrowserJobCapture) -> tuple[str | None, str | None]:
    experience = _single_line(capture.experience_text)
    schedule = _single_line(capture.work_schedule_text)
    schedule_parts: list[str] = []

    if experience:
        matches = _schedule_matches(experience)
        if matches:
            schedule_parts.extend(matches)
            remaining = _WORK_SCHEDULE_RE.sub(" ", experience)
            remaining = re.sub(r"[、,，;；|·]+", " ", remaining)
            experience = _single_line(remaining)
    if schedule:
        schedule_parts.extend(_schedule_matches(schedule) or [schedule])

    normalized_schedule = " ".join(_unique_lines(schedule_parts)) or None
    return experience, normalized_schedule


def _schedule_matches(value: str) -> list[str]:
    return [match.group(0) for match in _WORK_SCHEDULE_RE.finditer(value)]


def _employment_type(value: str | None) -> EmploymentType | None:
    normalized = _single_line(value)
    if normalized is None:
        return None
    for marker, result in (
        ("实习", "internship"),
        ("兼职", "part_time"),
        ("合同", "contract"),
        ("劳务", "contract"),
        ("临时", "temporary"),
        ("全职", "full_time"),
    ):
        if marker in normalized:
            return result
    return None


def _work_mode(capture: BrowserJobCapture) -> WorkMode | None:
    text = " ".join(
        value
        for value in (
            _single_line(capture.work_schedule_text),
            _single_line(capture.work_address),
        )
        if value
    )
    if "混合办公" in text:
        return "hybrid"
    if "远程" in text or "居家" in text:
        return "remote"
    return None


def _salary(
    salary_text: str | None,
) -> tuple[Decimal | None, Decimal | None, str | None, SalaryPeriod | None, int | None]:
    if salary_text is None:
        return None, None, None, None, None
    monthly = _MONTHLY_SALARY_RE.search(salary_text)
    if monthly:
        months = monthly.group("months")
        return (
            Decimal(monthly.group("minimum")) * 1_000,
            Decimal(monthly.group("maximum")) * 1_000,
            "CNY",
            "month",
            int(months) if months else None,
        )
    cny = _CNY_SALARY_RE.search(salary_text)
    if cny:
        period_map: dict[str, SalaryPeriod] = {
            "小时": "hour",
            "时": "hour",
            "天": "day",
            "日": "day",
            "月": "month",
            "年": "year",
        }
        return (
            Decimal(cny.group("minimum")),
            Decimal(cny.group("maximum")),
            "CNY",
            period_map[cny.group("period")],
            None,
        )
    return None, None, None, None, None


def _company_fields(
    capture: BrowserJobCapture,
) -> tuple[str | None, str | None, str | None]:
    industry = _single_line(capture.company_industry)
    size = _single_line(capture.company_size)
    financing = _single_line(capture.company_financing_stage)
    for tag in _unique_lines(capture.company_tags):
        if size is None and _SIZE_RE.fullmatch(tag):
            size = tag
        elif financing is None and any(marker in tag for marker in _FINANCING_MARKERS):
            financing = tag
        elif industry is None:
            industry = tag
    return industry, size, financing
