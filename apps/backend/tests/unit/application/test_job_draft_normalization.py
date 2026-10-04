import asyncio
from decimal import Decimal

import pytest

from linkresume.application.job_descriptions.ai_import_service import (
    draft_warnings,
    parse_image_draft,
    parse_text_draft,
)
from linkresume.application.job_descriptions.draft_normalization import normalize_job_draft
from linkresume.modules.job_descriptions.schemas import JobDescriptionCreateRequest, JobDescriptionDraft
from linkresume.modules.llm.schemas import ChatUsage, StructuredChatResult


def draft(**overrides) -> JobDescriptionDraft:
    return JobDescriptionDraft(job_title="测试工程师", company_name="示例科技", **overrides)


@pytest.mark.parametrize(("value", "expected"), [
    (" 人民币 ", "CNY"), ("rmb", "CNY"), ("cny", "CNY"),
    ("美元", "USD"), ("欧元", "EUR"), ("英镑", "GBP"),
    ("港币", "HKD"), ("日元", "JPY"), ("ＵＳＤ", "USD"), ("", None),
])
def test_currency_aliases_are_valid_for_the_final_creation_contract(value, expected):
    result = draft(salary_currency=value)
    assert result.salary_currency == expected
    created = JobDescriptionCreateRequest(
        **result.model_dump(exclude={"description"}), source_type="manual",
    )
    assert created.salary_currency == expected


@pytest.mark.parametrize(("text", "minimum", "maximum", "currency", "period", "months"), [
    ("人民币14-18K每月", 14000, 18000, "CNY", "month", None),
    ("人民币12,000—18,000元/月·14薪", 12000, 18000, "CNY", "month", 14),
    ("人民币 1 万-2 万元/月", 10000, 20000, "CNY", "month", None),
    ("人民币32—48万元/年", 320000, 480000, "CNY", "year", None),
    ("人民币32—48W/年（W表示万元）", 320000, 480000, "CNY", "year", None),
    ("Annual base pay USD 75,000-95,000", 75000, 95000, "USD", "year", None),
    ("Annual base pay USD 82,000-104,000.", 82000, 104000, "USD", "year", None),
    ("GBP 22-28 per hour", 22, 28, "GBP", "hour", None),
    ("人民币180-220元/天", 180, 220, "CNY", "day", None),
    ("基本月薪人民币10000元起，没有公布上限", 10000, None, "CNY", "month", None),
    ("最高月薪人民币20000元", None, 20000, "CNY", "month", None),
    ("固定月薪人民币40000元", 40000, 40000, "CNY", "month", None),
])
def test_salary_is_completed_from_one_explicit_verified_fragment(text, minimum, maximum, currency, period, months):
    original = draft(salary_text=text)
    result = normalize_job_draft(original, source_text=f"推荐岗位人民币99999元/月\n当前岗位：{text}")
    assert result.salary_min == (Decimal(minimum) if minimum is not None else None)
    assert result.salary_max == (Decimal(maximum) if maximum is not None else None)
    assert result.salary_currency == currency
    assert result.salary_period == period
    assert result.salary_months_per_year == months
    assert result.salary_text == text
    assert original.salary_min is None
    assert draft_warnings(result, source_text=text) == []
    JobDescriptionCreateRequest(**result.model_dump(exclude={"description"}), source_type="manual")


@pytest.mark.parametrize("text", [
    "人民币15-20K/月；旧版本人民币17-22K/月",
    "人民币15-20K/月，相当于USD2000/月",
    "人民币10000元/月，加2000元补贴",
    "人民币1O-2OK/月", "人民币1O万元/月",
    "人民币15--20K/月", "人民币-1000元/月",
    "人民币32-48W/年", "15-20K/月", "人民币15-20K",
    "人民币20-15K/月", "人民币10000000000元/月",
    "人民币15-20K/月·13薪或16薪",
    "人民币14-18K/月，不承诺13薪", "候选人期望人民币50000元/月",
    "旧版薪资人民币14-18K/月", "模拟工资人民币10000元/月",
    "人民币10000元/月+提成，上不封顶", "约人民币10000元/月",
    "人民币10亿/月", "人民币1千万/年", "约USD10000 per month",
    "人民币10⁴元/月", "人民币①000元/月",
    "人民币100,00元/月", "人民币10000.001元/月", "人民币每月6%分成",
])
def test_ambiguous_or_unsupported_salary_is_not_guessed(text):
    original = draft(salary_text=text)
    result = normalize_job_draft(original, source_text=text)
    assert result == original
    assert result.salary_min is None
    assert result.salary_max is None
    assert draft_warnings(result, source_text=text)


def test_typographic_whitespace_differences_are_allowed_but_changed_words_are_not():
    original = draft(salary_text="人民币12000-18000元/月")
    matching = normalize_job_draft(original, source_text="人民币 １２，０００—１８，０００ 元／月")
    # Changing comma grouping is not a whitespace-only change, so it is conservative.
    assert matching.salary_min is None
    matching = normalize_job_draft(original, source_text="人民币 １２０００—１８０００ 元／月")
    assert matching.salary_min == Decimal(12000)
    invented = normalize_job_draft(original, source_text="人民币12000-19000元/月")
    assert invented == original
    assert "薪资原文未能与输入对应，请核对。" in draft_warnings(invented, source_text="人民币12000-19000元/月")


def test_other_jobs_and_candidate_expectations_do_not_fill_missing_salary_text():
    original = draft(description="职责：记录测试缺陷。")
    result = normalize_job_draft(original, source_text="候选人期望人民币50000元/月；推荐岗位人民币30000元/月。")
    assert result == original
    assert result.salary_text is None
    assert result.salary_min is None
    assert result.salary_currency is None


def test_compatibility_number_symbols_cannot_verify_plain_digit_salary():
    original = draft(salary_text="人民币1000元/月")
    result = normalize_job_draft(original, source_text="人民币①000元/月")
    assert result == original


def test_inconsistent_existing_values_are_preserved_with_a_warning():
    text = "人民币14-18K每月"
    original = draft(salary_text=text, salary_min=15000, salary_currency="CNY", salary_period="month")
    result = normalize_job_draft(original, source_text=text)
    assert result == original
    assert result.salary_max is None
    assert "结构化薪资与薪资原文不一致或提取不完整，请核对。" in draft_warnings(result, source_text=text)


def test_partial_consistent_salary_is_completed_without_default_salary_months():
    text = "人民币14-18K每月"
    result = normalize_job_draft(draft(salary_text=text, salary_min=14000), source_text=text)
    assert result.salary_max == Decimal(18000)
    assert result.salary_months_per_year is None


def test_existing_salary_months_outside_the_selected_fragment_are_not_overwritten():
    text = "人民币14-18K每月"
    result = normalize_job_draft(draft(salary_text=text, salary_months_per_year=13), source_text=text + "，13薪")
    assert result.salary_min == Decimal(14000)
    assert result.salary_months_per_year == 13
    assert "薪资原文未明确发薪月数，请核对。" in draft_warnings(result, source_text=text + "，13薪")


def test_warnings_cover_final_storage_constraints_and_ambiguity_without_exposing_values():
    result = draft(salary_min=9000, salary_max=8000, salary_currency="未知", notes="薪资来源冲突；目标岗位不明确")
    warnings = draft_warnings(result)
    assert "薪资币种未识别为三字母代码，请核对。" in warnings
    assert "结构化薪资缺少币种或计薪周期，请在创建前补充。" in warnings
    assert "薪资下限高于上限，请核对。" in warnings
    assert "输入包含多个岗位或冲突信息，请确认目标岗位及薪资。" in warnings
    assert not any("9000" in message or "8000" in message for message in warnings)


class SingleCallService:
    def __init__(self):
        self.calls = []

    async def structured_chat(self, user_id, messages, **kwargs):
        self.calls.append((user_id, messages, kwargs))
        return StructuredChatResult(
            value=draft(salary_text="人民币14-18K每月", salary_currency="人民币"),
            call_id="llmcall_fictional", usage=ChatUsage(inputTokens=20, outputTokens=10),
        )


def test_text_postprocessing_keeps_one_call_and_preserves_call_id_and_usage():
    service = SingleCallService()
    result = asyncio.run(parse_text_draft(service, user_id=1, text="工资：人民币14-18K每月"))
    assert len(service.calls) == 1
    assert result.value.salary_min == Decimal(14000)
    assert result.value.salary_currency == "CNY"
    assert result.call_id == "llmcall_fictional"
    assert result.usage.input_tokens == 20
    assert service.calls[0][2]["use_case"] == "job_text_extraction"


def test_image_does_not_complete_numbers_from_unverified_model_text():
    service = SingleCallService()
    result = asyncio.run(parse_image_draft(service, user_id=1, image_data_url="data:image/png;base64,aGVsbG8="))
    assert len(service.calls) == 1
    assert result.value.salary_currency == "CNY"
    assert result.value.salary_min is None
    assert result.value.salary_max is None
    assert draft_warnings(result.value)
