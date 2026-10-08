from __future__ import annotations

import re
import unicodedata
from decimal import Decimal

from linkresume.modules.job_descriptions.schemas import JobDescriptionDraft


_NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?"
_AMOUNT_RE = re.compile(
    rf"(?<![\d.,+\-])(?P<minimum>{_NUMBER})(?P<minimum_unit>万元|万|K|W)?(?:元)?"
    rf"(?:[-~至](?P<maximum>{_NUMBER})(?P<maximum_unit>万元|万|K|W)?(?:元)?)?"
    r"(?![A-Z\d~\-至百千万亿兆])(?![.,]\d)"
)
_MONTHS_RE = re.compile(r"(?<!\d)(\d{1,5})薪")
_UNCERTAIN_RE = re.compile(
    r"不保证|不承诺|未承诺|历史|旧版|旧员工|作废|传闻|网友|评论|模拟|"
    r"估算|预计|可能|期望|演示|提成|佣金|分成|[%‰]|上不封顶|综合收入|大约|"
    r"约(?:人民币|[A-Z]{3}|\d)"
)
_CURRENCIES = {
    "CNY": r"人民币|(?<![A-Z])(?:CNY|RMB)(?![A-Z])",
    "USD": r"美元|美金|(?<![A-Z])USD(?![A-Z])",
    "EUR": r"欧元|(?<![A-Z])EUR(?![A-Z])",
    "GBP": r"英镑|(?<![A-Z])GBP(?![A-Z])",
    "HKD": r"港币|港元|(?<![A-Z])HKD(?![A-Z])",
    "JPY": r"日元|日圆|(?<![A-Z])JPY(?![A-Z])",
}
_PERIODS = {
    "month": r"月薪|每月|/月|MONTHLY|PERMONTH",
    "year": r"年薪|每年|/年|ANNUAL|YEARLY|PERYEAR",
    "day": r"日薪|每[天日]|/[天日]|DAILY|PERDAY",
    "hour": r"时薪|每小时|/小时|/时|HOURLY|PERHOUR",
}
_SALARY_FIELDS = (
    "salary_min", "salary_max", "salary_currency", "salary_period",
    "salary_months_per_year",
)
_FULLWIDTH_ASCII = str.maketrans({chr(code): chr(code - 0xFEE0) for code in range(0xFF01, 0xFF5F)})


def _compact(value: str) -> str:
    normalized = value.translate(_FULLWIDTH_ASCII).upper()
    normalized = normalized.translate(str.maketrans({"—": "-", "–": "-", "～": "~"}))
    return re.sub(r"\s+", "", normalized)


def _salary_is_from_input(salary_text: str, source_text: str) -> bool:
    # Whitespace and typography may change, but words and numbers must remain.
    return _compact(salary_text) in _compact(source_text)


def _explicit_salary(salary_text: str) -> dict[str, object] | None:
    if any(unicodedata.category(char) in ("No", "Nl") for char in salary_text):
        return None
    text = _compact(salary_text)
    if _UNCERTAIN_RE.search(text):
        return None
    currency_text = salary_text.translate(_FULLWIDTH_ASCII).upper()
    currencies = [code for code, pattern in _CURRENCIES.items() if re.search(pattern, currency_text)]
    periods = [period for period, pattern in _PERIODS.items() if re.search(pattern, text)]
    if len(currencies) != 1 or len(periods) != 1:
        return None

    month_matches = list(_MONTHS_RE.finditer(text))
    months = {int(match.group(1)) for match in month_matches}
    if len(months) > 1 or (months and not 1 <= next(iter(months)) <= 65_535):
        return None
    amount_text = _MONTHS_RE.sub("", text)
    amount_text = re.sub(_PERIODS[periods[0]], "", amount_text)
    amount_text = amount_text.replace(currencies[0], "")
    if currencies[0] == "CNY":
        amount_text = amount_text.replace("RMB", "")
    matches = list(_AMOUNT_RE.finditer(amount_text))
    # Multiple amounts can be bonus components, conflicting offers or other jobs.
    if len(matches) != 1:
        return None
    match = matches[0]
    minimum_unit, maximum_unit = match.group("minimum_unit", "maximum_unit")
    if "W" in (minimum_unit, maximum_unit) and "W表示万元" not in text:
        return None
    scale = {None: Decimal(1), "K": Decimal(1_000), "万": Decimal(10_000),
             "万元": Decimal(10_000), "W": Decimal(10_000)}
    minimum = Decimal(match.group("minimum").replace(",", "")) * scale[minimum_unit or maximum_unit]
    maximum_raw = match.group("maximum")
    maximum = (
        Decimal(maximum_raw.replace(",", "")) * scale[maximum_unit or minimum_unit]
        if maximum_raw else minimum
    )
    if minimum > maximum or maximum > Decimal("9999999999.99"):
        return None
    if maximum_raw is None:
        prefix, suffix = amount_text[:match.start()], amount_text[match.end():]
        lower = bool(re.search(r"最低|不低于|ATLEAST|STARTING", prefix) or re.match(r"起|以上|及以上", suffix))
        upper = bool(re.search(r"最高|不超过|UPTO|ATMOST", prefix) or re.match(r"以下", suffix))
        if lower and upper:
            return None
        if lower:
            maximum = None
        elif upper:
            minimum = None
    return dict(
        salary_min=minimum, salary_max=maximum, salary_currency=currencies[0],
        salary_period=periods[0],
        salary_months_per_year=next(iter(months)) if months and periods[0] == "month" else None,
    )


def normalize_job_draft(
    draft: JobDescriptionDraft, *, source_text: str | None = None,
) -> JobDescriptionDraft:
    if not source_text or not draft.salary_text or not _salary_is_from_input(draft.salary_text, source_text):
        return draft
    facts = _explicit_salary(draft.salary_text)
    if facts is None or any(
        getattr(draft, field) is not None and getattr(draft, field) != facts[field]
        for field in _SALARY_FIELDS
        if facts[field] is not None or field in ("salary_min", "salary_max")
    ):
        return draft
    updates = {field: value for field, value in facts.items()
               if value is not None and getattr(draft, field) is None}
    return JobDescriptionDraft.model_validate({**draft.model_dump(), **updates}) if updates else draft


def salary_warnings(draft: JobDescriptionDraft, *, source_text: str | None = None) -> list[str]:
    warnings: list[str] = []
    if draft.salary_currency and not re.fullmatch(r"[A-Z]{3}", draft.salary_currency):
        warnings.append("薪资币种未识别为三字母代码，请核对。")
    numeric = draft.salary_min is not None or draft.salary_max is not None
    if numeric and (not draft.salary_currency or not draft.salary_period):
        warnings.append("结构化薪资缺少币种或计薪周期，请在创建前补充。")
    if draft.salary_min is not None and draft.salary_max is not None and draft.salary_min > draft.salary_max:
        warnings.append("薪资下限高于上限，请核对。")
    if not draft.salary_text:
        return warnings
    if source_text and not _salary_is_from_input(draft.salary_text, source_text):
        warnings.append("薪资原文未能与输入对应，请核对。")
    facts = _explicit_salary(draft.salary_text)
    if facts is None:
        if re.search(r"\d", draft.salary_text):
            warnings.append("薪资金额或单位无法可靠拆分，请核对原文。")
    elif any(
        getattr(draft, field) != facts[field] for field in _SALARY_FIELDS
        if facts[field] is not None or field in ("salary_min", "salary_max")
    ):
        warnings.append("结构化薪资与薪资原文不一致或提取不完整，请核对。")
    if draft.salary_months_per_year is not None and not any(
        int(match.group(1)) == draft.salary_months_per_year
        for match in _MONTHS_RE.finditer(_compact(draft.salary_text))
    ):
        warnings.append("薪资原文未明确发薪月数，请核对。")
    return warnings
