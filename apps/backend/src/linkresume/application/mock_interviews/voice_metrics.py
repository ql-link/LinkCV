"""Voice delivery metrics computed from word timestamps, never by a model."""

from __future__ import annotations

import re

LONG_PAUSE_MS = 3_000
FILLERS = ("嗯", "呃", "啊", "那个", "就是", "然后", "这个")
# Initial reference ranges; to be calibrated with sample data.
REFERENCE = {
    "chars_per_minute": (180, 260),
    "long_pauses": (0, 2),
    "filler_ratio": (0.0, 0.03),
}
_SPOKEN = re.compile(r"[一-鿿A-Za-z0-9]")


def _spoken_chars(text: str) -> int:
    return len(_SPOKEN.findall(text))


def answer_metrics(words: list[dict], duration_ms: int | None) -> dict[str, object]:
    text = "".join(str(item.get("text") or "") for item in words)
    chars = _spoken_chars(text)
    pauses = 0
    for previous, current in zip(words, words[1:]):
        if int(current.get("start_ms") or 0) - int(previous.get("end_ms") or 0) > LONG_PAUSE_MS:
            pauses += 1
    fillers = sum(text.count(item) * len(item) for item in FILLERS)
    duration = duration_ms or (int(words[-1].get("end_ms") or 0) if words else 0)
    return {"chars": chars, "fillers": fillers, "long_pauses": pauses, "duration_ms": duration}


def summarize(per_answer: list[dict[str, object]]) -> dict[str, object] | None:
    """Aggregate per-answer figures into the report block."""
    if not per_answer:
        return None
    chars = sum(int(item["chars"]) for item in per_answer)
    duration = sum(int(item["duration_ms"]) for item in per_answer)
    fillers = sum(int(item["fillers"]) for item in per_answer)
    pauses = sum(int(item["long_pauses"]) for item in per_answer)
    minutes = duration / 60_000
    rate = round(chars / minutes) if minutes else 0
    ratio = round(fillers / chars, 4) if chars else 0.0
    return {
        "chars_per_minute": rate,
        "long_pauses": pauses,
        "filler_ratio": ratio,
        "answer_duration_ms": duration,
        "reference": {key: list(value) for key, value in REFERENCE.items()},
        "tip": _tip(rate, pauses, ratio),
    }


def _tip(rate: int, pauses: int, ratio: float) -> str:
    low, high = REFERENCE["chars_per_minute"]
    if rate > high:
        return "语速偏快，关键结论前可以稍作停顿。"
    if rate and rate < low:
        return "语速偏慢，可以先说结论再展开细节。"
    if pauses > REFERENCE["long_pauses"][1]:
        return "长停顿较多，回答前可以先在心里列出要点。"
    if ratio > REFERENCE["filler_ratio"][1]:
        return "口头禅偏多，可以用短暂停顿代替「嗯」「那个」。"
    return "表达节奏稳定，继续保持。"
