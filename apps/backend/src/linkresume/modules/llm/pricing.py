"""Deterministic provider pricing; missing evidence is never interpreted as free usage."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def validate_manual_pricing(pricing: dict | None) -> None:
    if pricing is None:
        return
    currency = pricing.get("currency")
    if not isinstance(currency, str) or len(currency) != 3 or not currency.isascii() or not currency.isalpha():
        raise ValueError("currency required")
    if len(json.dumps(pricing)) > 65536:
        raise ValueError("rules too large")
    lines = pricing.get("lines")
    if lines is not None:
        if not isinstance(lines, list) or not 1 <= len(lines) <= 100:
            raise ValueError("billing lines required")
        for line in lines:
            if not isinstance(line, dict) or not isinstance(line.get("billable"), str) or not line.get("unit"):
                raise ValueError("billing item and unit required")
            decimal(line.get("cost_usd"))
    else:
        decimal(pricing.get("input_per_million"))
        decimal(pricing.get("output_per_million"))


def decimal(value: object) -> Decimal:
    if isinstance(value, bool):
        raise ValueError("invalid rate")
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError("invalid decimal") from error
    if not result.is_finite() or result < 0:
        raise ValueError("invalid rate")
    return result


def catalog_pricing(item: dict) -> dict | None:
    raw = item.get("pricing")
    lines = item.get("pricing_lines")
    if not isinstance(raw, dict) and not isinstance(lines, list):
        return None
    observed = utc_now().isoformat()
    result = {"schemaVersion": 2, "source": item.get("pricing_source", "aihubmix_catalog"),
              "observedAt": observed, "checked_at": observed, "currency": "USD",
              "raw": raw, "promotion": item.get("promotion"), "lines": []}
    if isinstance(lines, list) and lines:
        # Preserve all billing items. Unsupported ones cannot silently fall back to a legacy price.
        result["lines"] = [{k: line[k] for k in ("billable", "unit", "cost_usd", "source", "tier") if k in line}
                           for line in lines if isinstance(line, dict)]
    elif isinstance(raw, dict) and not raw.get("tiers"):
        for key, billable in (("input", "prompt_tokens"), ("output", "completion_tokens"),
                              ("cache_read", "cached_tokens"), ("cache_write", "cache_write_tokens")):
            if raw.get(key) is not None:
                result["lines"].append({"billable": billable, "unit": "million_tokens", "cost_usd": str(raw[key])})
        result["legacy"] = True
    else:
        result["unsupportedReason"] = "unsupported_legacy_tiers"
    # Keep the simple-price display contract, only when the price actually is simple.
    if isinstance(raw, dict) and not raw.get("tiers") and not item.get("promotion"):
        result["input_per_million"] = str(raw.get("input")) if raw.get("input") is not None else None
        result["output_per_million"] = str(raw.get("output")) if raw.get("output") is not None else None
    return result


def route_pricing(route) -> dict | None:
    pricing = route.pricing_json
    if route.pricing_mode != "manual_override" and not (pricing and pricing.get("schemaVersion") == 2):
        pricing = catalog_pricing(route.metadata_json or {}) or pricing
    return dict(pricing) if pricing else None


def normalize_usage(input_tokens: int | None, output_tokens: int | None, details: dict | None,
                    *, exclusive: bool = False) -> dict:
    d = details or {}
    if not isinstance(d, dict):
        d = {"usagePresent": False}
    result = {"schemaVersion": 1, "usagePresent": d.get("usagePresent", (input_tokens is not None and output_tokens is not None) or d.get("audioSeconds") is not None or d.get("characters") is not None),
              "usageSource": d.get("usageSource", "pi" if exclusive else "gateway"),
              "outputTokens": output_tokens, "reasoningTokens": d.get("reasoning"),
              "cacheReadTokens": d.get("cacheRead"), "cacheWriteTokens": d.get("cacheWrite"),
              "cacheWrite1hTokens": d.get("cacheWrite1h"),
              "audioSeconds": d.get("audioSeconds"), "characters": d.get("characters"),
              "billable": d.get("billable", {})}
    read, write = d.get("cacheRead"), d.get("cacheWrite")
    if exclusive:
        result["uncachedInputTokens"] = input_tokens
        result["contextInputTokens"] = input_tokens + read + write if all(isinstance(v, int) for v in (input_tokens, read, write)) else None
    else:
        result["contextInputTokens"] = input_tokens
        result["uncachedInputTokens"] = input_tokens - read - write if all(isinstance(v, int) for v in (input_tokens, read, write)) else input_tokens
    return result


@dataclass(frozen=True)
class CostResult:
    amount: Decimal | None
    currency: str | None
    reason: str | None
    breakdown: tuple[dict, ...] = ()


def _time_match(condition: dict, at: datetime | None) -> bool:
    if at is None or at.tzinfo is None:
        raise LookupError("request_time_unknown")
    local = at.astimezone(ZoneInfo(condition["timezone"]))
    minute = local.hour * 60 + local.minute
    for span in condition["ranges"]:
        start, end = span.split("-")
        a = sum(int(v) * f for v, f in zip(start.split(":"), (60, 1)))
        b = sum(int(v) * f for v, f in zip(end.split(":"), (60, 1)))
        if a <= minute < b if a < b else minute >= a or minute < b:
            return True
    return False


def _line(lines: list[dict], name: str, context: int | None, at: datetime | None) -> dict | None:
    candidates = []
    for line in lines:
        if line.get("billable") != name:
            continue
        tier = line.get("tier") or {}
        lo, hi = tier.get("min_tokens", 0), tier.get("max_tokens", -1)
        if (lo > 0 or hi >= 0) and context is None:
            raise LookupError("context_usage_missing")
        if context is not None and (context < lo or hi >= 0 and context > hi):
            continue
        condition = tier.get("time_condition")
        if condition and not _time_match(condition, at):
            continue
        candidates.append(line)
    timed = [line for line in candidates if (line.get("tier") or {}).get("time_condition")]
    candidates = timed or candidates
    if len(candidates) > 1:
        raise LookupError("ambiguous_price_rule")
    return candidates[0] if candidates else None


def calculate_cost(usage: dict | None, pricing: dict | None, *, at: datetime | None = None,
                   protocol: str | None = None) -> CostResult:
    try:
        if not pricing:
            raise LookupError("price_missing")
        if not usage or not usage.get("usagePresent"):
            raise LookupError("usage_missing")
        for key in ("uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "contextInputTokens"):
            value = usage.get(key)
            if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
                raise LookupError("usage_invalid")
        if pricing.get("unsupportedReason"):
            raise LookupError(pricing["unsupportedReason"])
        if pricing.get("promotion"):
            # A discount without an authoritative effective interval is not evidence of a rate.
            raise LookupError("promotion_rule_unverified")
        currency = pricing.get("currency")
        if not isinstance(currency, str) or len(currency) != 3 or not currency.isalpha():
            raise LookupError("currency_invalid")
        if protocol in ("openai_asr_file", "openai_tts", "aliyun_asr_realtime", "aliyun_tts_realtime") and pricing.get("legacy"):
            raise LookupError("speech_unit_unknown")
        lines = pricing.get("lines")
        if not isinstance(lines, list):
            lines = [{"billable": name, "unit": "million_tokens", "cost_usd": pricing[key]}
                     for key, name in (("input_per_million", "prompt_tokens"), ("output_per_million", "completion_tokens")) if pricing.get(key) is not None]
        names = {line.get("billable") for line in lines}
        token_pricing = "prompt_tokens" in names or "completion_tokens" in names
        quantities = dict(usage.get("billable") or {})
        if token_pricing:
            quantities.update(prompt_tokens=usage.get("uncachedInputTokens"), completion_tokens=usage.get("outputTokens"))
            for billable, key in (("cached_tokens", "cacheReadTokens"), ("cache_write_tokens", "cacheWriteTokens")):
                quantity = usage.get(key)
                if billable in names and quantity is None:
                    raise LookupError("cache_usage_missing")
                quantities[billable] = quantity or 0
            if usage.get("cacheWrite1hTokens") is not None:
                hour = decimal(usage["cacheWrite1hTokens"])
                writes = decimal(usage.get("cacheWriteTokens"))
                if hour > writes:
                    raise LookupError("usage_invalid")
                quantities["cache_write_1_hour_tokens"] = hour
                quantities["cache_write_tokens"] = writes - hour
        if "audio_seconds" in names:
            quantities["audio_seconds"] = usage.get("audioSeconds")
        if "characters" in names:
            quantities["characters"] = usage.get("characters")
        total = Decimal(0)
        breakdown = []
        for name, quantity in quantities.items():
            if quantity is None:
                raise LookupError("usage_missing")
            count = decimal(quantity)
            if count == 0 and name not in names:
                continue
            line = _line(lines, name, usage.get("contextInputTokens"), at)
            if line is None:
                raise LookupError("price_item_missing")
            unit = line.get("unit")
            divisor = {"million_tokens": 1_000_000, "token": 1, "request": 1, "image": 1,
                       "second": 1, "hour": 3600, "character": 1, "million_characters": 1_000_000}.get(unit)
            if divisor is None:
                raise LookupError("price_unit_unknown")
            rate = decimal(line.get("cost_usd"))
            amount = count * rate / Decimal(divisor)
            total += amount
            breakdown.append({"billable": name, "quantity": str(count), "unit": unit,
                              "rate": str(rate), "amount": str(amount), "tier": line.get("tier")})
        if token_pricing and not {"prompt_tokens", "completion_tokens"}.issubset(names):
            raise LookupError("price_item_missing")
        if not quantities or not lines:
            raise LookupError("price_item_missing")
        if total >= Decimal("10000000000"):
            raise LookupError("cost_out_of_range")
        return CostResult(total.quantize(Decimal("0.0000000001")), currency.upper(), None, tuple(breakdown))
    except LookupError as error:
        return CostResult(None, None, str(error))
    except (TypeError, ValueError, KeyError, InvalidOperation, ArithmeticError):
        return CostResult(None, None, "price_or_usage_invalid")
