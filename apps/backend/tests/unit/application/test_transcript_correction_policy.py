import pytest

from linkresume.application.mock_interviews.outputs import TranscriptChange
from linkresume.application.mock_interviews.transcript_correction_policy import rejection_reason
from linkresume.application.mock_interviews.transcripts import MAX_CHANGE_RATIO, change_ratio


def check(original, corrected, pairs, *, glossary=None, context=""):
    return rejection_reason(
        original, corrected, [TranscriptChange(original=a, corrected=b, reason="识别修正") for a, b in pairs],
        glossary=glossary or [], context=context, max_change_ratio=MAX_CHANGE_RATIO,
    )


def test_grounded_term_repairs_no_longer_fail_due_to_different_character_lengths():
    original = "我们用瑞迪斯做缓存，但是没有使用卡夫卡；嗯，我只参与开发，没有负责架构。"
    corrected = original.replace("瑞迪斯", "Redis").replace("卡夫卡", "Kafka")
    assert change_ratio(original, corrected) > MAX_CHANGE_RATIO
    assert check(original, corrected, [("瑞迪斯", "Redis"), ("卡夫卡", "Kafka")], glossary=["Redis", "Kafka"]) is None
    assert check(original, corrected, [("瑞迪斯", "Redis"), ("卡夫卡", "Kafka")]) == "change_ratio_exceeded"


@pytest.mark.parametrize(("before", "after"), [
    ("P九十九是八十毫秒，不是八百毫秒", "P99是80毫秒，不是800毫秒"),
    ("两千到一万", "2000到10000"), ("三点五秒", "3.5秒"), ("８０毫秒", "80毫秒"),
])
def test_equivalent_numerals_are_accepted(before, after):
    assert check(before, after, [(before, after)]) is None


@pytest.mark.parametrize(("before", "after", "reason"), [
    ("没有使用", "使用", "meaning_changed"), ("我参与", "我主导", "meaning_changed"),
    ("嗯，那个", "", "meaning_changed"), ("80毫秒", "800毫秒", "numbers_changed"),
    ("Redis", "Kafka", "terms_changed"),
])
def test_fact_changes_and_unrelated_technical_rewrites_are_rejected(before, after, reason):
    original = "这是我回答的原话。" + before
    corrected = "这是我回答的原话。" + after
    assert check(original, corrected, [(before, after)], glossary=["Redis", "Kafka"]) == reason


def test_negation_change_is_rejected_even_under_raw_character_budget():
    original = "这段文字是为了说明我在这个项目中的实际经历，我没有负责整体架构，只参与了测试。"
    corrected = original.replace("没有", "")
    assert change_ratio(original, corrected) < MAX_CHANGE_RATIO
    assert check(original, corrected, [("没有", "")]) == "meaning_changed"


def test_untraced_edits_and_invented_change_segments_are_rejected():
    assert check("我用瑞迪斯", "我用Redis", []) == "changes_invalid"
    assert check("我用瑞迪斯", "我用Redis", [("不存在", "Redis")]) == "changes_invalid"
    assert check("我用瑞迪斯，不负责", "我用Redis，负责", [("瑞迪斯", "Redis")], glossary=["Redis"]) == "changes_invalid"


def test_correctly_spelled_technical_term_cannot_be_swapped_with_another_glossary_term():
    original = "这段文字是为了说明我在这个项目中的实际经历。我们使用Redis做缓存，做过系统压测。"
    corrected = original.replace("Redis", "Kafka")
    assert change_ratio(original, corrected) < MAX_CHANGE_RATIO
    assert check(original, corrected, [("Redis", "Kafka")], glossary=["Redis", "Kafka"]) == "terms_changed"


@pytest.mark.parametrize(("before", "after"), [("80%", "80"), ("-80", "80"), ("80毫秒", "80秒")])
def test_measurement_units_percentages_and_signs_cannot_be_erased(before, after):
    prefix = "这些文字用于说明我当时在项目中观察到的实际数值是"
    assert check(prefix + before, prefix + after, [(before, after)]) == "units_changed"


def test_oversized_numeric_input_is_rejected_without_crashing_other_answers():
    original = "这段数字" + "一" * 5000
    assert check(original, original.replace("这段", "这个"), [("这段", "这个")]) == "numbers_invalid"


def test_number_comparison_does_not_round_different_large_identifiers_to_the_same_value():
    before, after = "123456789012345678901234567890", "123456789012345678901234567891"
    assert check("编号" + before, "编号" + after, [(before, after)]) == "numbers_changed"
