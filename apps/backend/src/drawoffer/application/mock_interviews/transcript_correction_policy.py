"""Conservative acceptance of recognition repairs, distinct from manual edits."""

from __future__ import annotations

import difflib
import re
from decimal import Decimal

from drawoffer.application.mock_interviews.outputs import TranscriptChange

_SEPARATORS = re.compile(r"[\s，。！？、；：,.!?;:‘’“”\"'（）()【】\[\]]+")
_NUMBERS = re.compile(r"\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?")
_DIGITS = dict(zip("零〇一二两三四五六七八九", (0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9), strict=True))
_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000, "亿": 100000000}
_PROTECTED = re.compile(
    r"没有|不能|不是|不得|不|没|未|无|非|参与|负责|协助|主导|独立|领导|嗯|那个|呃|啊"
    r"|\b(?:no|not|never|cannot|assisted|led|owned)\b|n't", re.IGNORECASE,
)
_ALIASES = {"Redis": ("瑞迪斯", "瑞迪"), "Kafka": ("卡夫卡", "卡福卡", "卡夫咖")}
_FACT_MARKS = re.compile(r"[%％￥¥$€£]|[+−-](?=\d)|毫秒|微秒|纳秒|分钟|小时|秒|天|年|元")


def change_ratio(original: str, corrected: str) -> float:
    """Share of original characters replaced, inserted or deleted (manual policy)."""
    if not original:
        return 1.0 if corrected else 0.0
    changed = sum(
        max(i2 - i1, j2 - j1)
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=original, b=corrected, autojunk=False).get_opcodes()
        if tag != "equal"
    )
    return changed / len(original)


def _decimal(value: str) -> str:
    # Decimal.normalize() rounds to the active precision; do not round facts.
    text = format(Decimal(value), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _number(match: re.Match[str]) -> str:
    value = match.group()
    if len(value) > 64:
        raise ValueError("numeric segment is too long")
    if value[0] not in _DIGITS and value[0] not in _UNITS:
        return _decimal(value)
    integer, _, fraction = value.partition("点")
    if not any(char in _UNITS for char in integer):
        number = int("".join(str(_DIGITS[char]) for char in integer))
    else:
        total = section = digit = 0
        for char in integer:
            if char in _DIGITS:
                digit = _DIGITS[char]
            elif _UNITS[char] < 10000:
                section += (digit or 1) * _UNITS[char]
                digit = 0
            else:
                section += digit
                if char == "亿":
                    total = (total + section) * _UNITS[char]
                else:
                    total += section * _UNITS[char]
                section = digit = 0
        number = total + section + digit
    decimal = str(number) + ("." + "".join(str(_DIGITS[char]) for char in fraction) if fraction else "")
    return _decimal(decimal)


def _surface(text: str) -> str:
    # Keep %, signs, currency and operators: punctuation removal must not erase facts.
    return _SEPARATORS.sub("", text).casefold()


def _equivalent(text: str, glossary: list[str], context: str) -> str:
    result = text
    grounding = "\n".join([*glossary, context])
    for canonical, aliases in _ALIASES.items():
        if re.search(r"(?<![A-Za-z])" + canonical + r"(?![A-Za-z])", grounding, re.IGNORECASE):
            for alias in aliases:
                result = result.replace(alias, canonical)
    return _surface(_NUMBERS.sub(_number, result))


def rejection_reason(
    original: str, corrected: str, changes: list[TranscriptChange], *, glossary: list[str], context: str,
    max_change_ratio: float,
) -> str | None:
    # Exact traces must account for all non-punctuation edits, rather than trusting reasons.
    spans: list[tuple[int, int, str]] = []
    for change in changes:
        start = original.find(change.original)
        while start >= 0 and any(start < end and start + len(change.original) > begin for begin, end, _ in spans):
            start = original.find(change.original, start + 1)
        if start < 0 or change.original == change.corrected:
            return "changes_invalid"
        spans.append((start, start + len(change.original), change.corrected))
    if not spans:
        return "changes_invalid"
    rebuilt, cursor = "", 0
    for start, end, replacement in sorted(spans):
        rebuilt += original[cursor:start] + replacement
        cursor = end
    rebuilt += original[cursor:]
    if _surface(rebuilt) != _surface(corrected):
        return "changes_invalid"
    if [x.casefold() for x in _PROTECTED.findall(original)] != [x.casefold() for x in _PROTECTED.findall(corrected)]:
        return "meaning_changed"
    try:
        if [_number(x) for x in _NUMBERS.finditer(original)] != [_number(x) for x in _NUMBERS.finditer(corrected)]:
            return "numbers_changed"
        before, after = _equivalent(original, glossary, context), _equivalent(corrected, glossary, context)
    except ValueError:
        return "numbers_invalid"
    if _FACT_MARKS.findall(before) != _FACT_MARKS.findall(after):
        return "units_changed"
    for term in glossary:
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9.+-]*", term):
            pattern = re.compile(r"(?<![a-z0-9])" + re.escape(_surface(term)) + r"(?![a-z0-9])")
            occurrences = len(pattern.findall(before))
            if occurrences and occurrences != len(pattern.findall(after)):
                return "terms_changed"
    if change_ratio(before, after) > max_change_ratio:
        return "change_ratio_exceeded"
    return None
