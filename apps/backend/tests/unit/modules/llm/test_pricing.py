from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

from linkresume.modules.llm.pricing import calculate_cost, catalog_pricing, normalize_usage, route_pricing


def rules(*lines):
    return {"schemaVersion": 2, "currency": "USD", "lines": list(lines)}


def line(name, price, **tier):
    return {"billable": name, "unit": "million_tokens", "cost_usd": price, "tier": tier}


def test_existing_provider_route_uses_full_catalog_without_overriding_manual_price():
    original = {"currency": "USD", "input_per_million": "99", "output_per_million": "99"}
    route = SimpleNamespace(pricing_mode="provider", pricing_json=original,
        metadata_json={"pricing_lines": [line("prompt_tokens", "1"), line("completion_tokens", "2")]})
    assert route_pricing(route)["lines"][0]["cost_usd"] == "1"
    route.pricing_mode = "manual_override"
    assert route_pricing(route) == original


def test_exclusive_cache_and_reasoning_are_not_counted_twice():
    usage = normalize_usage(100, 40, {"cacheRead": 50, "cacheWrite": 20, "reasoning": 30}, exclusive=True)
    price = rules(line("prompt_tokens", "1"), line("completion_tokens", "2"),
                  line("cached_tokens", ".1"), line("cache_write_tokens", "1.25"))
    result = calculate_cost(usage, price)
    assert result.amount == Decimal(".000210")
    assert usage["contextInputTokens"] == 170
    inclusive = normalize_usage(170, 40, {"cacheRead": 50, "cacheWrite": 20})
    assert calculate_cost(inclusive, price).amount == result.amount


def test_context_boundary_selects_whole_request_tier():
    lines = []
    for name, low, high in (("prompt_tokens", ".1", ".2"), ("completion_tokens", ".5", ".75")):
        lines.extend([line(name, low, min_tokens=0, max_tokens=272000), line(name, high, min_tokens=272001, max_tokens=-1)])
    for count, rate in ((272000, ".1"), (272001, ".2")):
        result = calculate_cost(normalize_usage(count, 0, {"cacheRead": 0, "cacheWrite": 0}), rules(*lines))
        assert result.amount == (Decimal(count) * Decimal(rate) / 1000000).quantize(Decimal(".0000000001"))


def test_peak_windows_are_half_open_and_utc():
    condition = {"timezone": "UTC", "ranges": ["01:00-04:00", "06:00-10:00"]}
    price = rules(line("prompt_tokens", "1", default=True), line("completion_tokens", "2", default=True),
                  line("prompt_tokens", "3", time_condition=condition), line("completion_tokens", "4", time_condition=condition))
    usage = normalize_usage(1000000, 0, {"cacheRead": 0, "cacheWrite": 0})
    assert calculate_cost(usage, price).reason == "request_time_unknown"
    for hour, expected in ((1, 3), (4, 1), (6, 3), (10, 1)):
        assert calculate_cost(usage, price, at=datetime(2026, 10, 6, hour, tzinfo=timezone.utc)).amount == expected


def test_catalog_lines_override_legacy_and_preserve_precision():
    price = catalog_pricing({"pricing": {"input": 99, "output": 99}, "pricing_source": "billing_config",
        "pricing_lines": [line("prompt_tokens", ".1759375"), line("completion_tokens", "0")]})
    assert calculate_cost(normalize_usage(1000000, 0, None), price).amount == Decimal(".1759375")


def test_missing_cache_not_zero_and_sdk_zero_not_free():
    price = rules(line("prompt_tokens", "1"), line("completion_tokens", "2"), line("cached_tokens", ".1"))
    assert calculate_cost(normalize_usage(100, 2, None), price).reason == "cache_usage_missing"
    assert calculate_cost(normalize_usage(0, 0, {"usagePresent": False}), price).reason == "usage_missing"
    assert calculate_cost(normalize_usage(0, 0, {"cacheRead": 0, "cacheWrite": 0}), price).amount == 0


def test_speech_requires_explicit_unit_and_can_meter_hours():
    usage = normalize_usage(None, None, {"audioSeconds": 3600})
    legacy = catalog_pricing({"pricing": {"input": 30, "output": 30}})
    assert calculate_cost(usage, legacy, protocol="openai_asr_file").reason == "speech_unit_unknown"
    price = rules({"billable": "audio_seconds", "unit": "hour", "cost_usd": ".111"})
    assert calculate_cost(usage, price, protocol="openai_asr_file").amount == Decimal(".111")
