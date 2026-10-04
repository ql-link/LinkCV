"""Deterministic scoring rules for real-interview AI reviews (report v2).

The model only returns evidence-backed judgements; every number, weight,
verdict and confidence shown to the user is computed here, so a stored report
can be re-derived from its parts. Rules follow
``.specs/LOCAL-20261003-INTERVIEW-REVIEW-V2/ai-review-report-design.md``.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Literal

RUBRIC_VERSION = "real-v1"

Category = Literal["technical", "project", "behavioral", "hr"]
CATEGORIES: tuple[Category, ...] = ("technical", "project", "behavioral", "hr")
FIRST_AXIS_DEFAULT = "professional_depth"
FIRST_AXIS_HR = "motivation_fit"
SHARED_AXES = ("structure", "job_fit", "resume_consistency", "communication")

# Column order: first axis, structure, job_fit, resume_consistency, communication.
BASE_WEIGHTS: dict[Category, tuple[float, float, float, float, float]] = {
    "technical": (0.35, 0.20, 0.20, 0.10, 0.15),
    "project": (0.30, 0.20, 0.15, 0.25, 0.10),
    "behavioral": (0.05, 0.30, 0.15, 0.20, 0.30),
    "hr": (0.30, 0.20, 0.25, 0.05, 0.20),
}
HR_SWITCH_SHARE = 0.6
QUESTION_SCORE_SHARE = 0.7
DIMENSION_SCORE_SHARE = 0.3
DEPTH_PENALTY_PER_LEVEL = 0.15
FACTUAL_ERROR_PENALTY = 10
SIGNAL_POINTS = {"hit": 1.0, "partial": 0.5, "miss": 0.0}
FATAL_QUESTION_SCORE = 40
DEFAULT_EXPECTED_DEPTH = 3
SENIOR_TITLE = re.compile(r"高级|资深|专家|架构师|senior|staff|principal|lead", re.IGNORECASE)
YEARS = re.compile(r"(\d{1,2})\s*(?:年|\+?\s*years?)", re.IGNORECASE)
PUNCTUATION = re.compile(r"[\s　，。！？、；：,.!?;:\"'“”‘’（）()【】\[\]《》<>…—\-]+")

Verdict = Literal["likely_pass", "promising", "at_risk", "likely_fail"]
VERDICT_ORDER: tuple[Verdict, ...] = ("likely_fail", "at_risk", "promising", "likely_pass")


def normalize_quote(text: str) -> str:
    """Whitespace- and punctuation-insensitive form used for quote checks."""
    return PUNCTUATION.sub("", text).casefold()


def quote_in(quote: str | None, normalized_transcript: str) -> bool:
    needle = normalize_quote(quote or "")
    return bool(needle) and needle in normalized_transcript


def first_axis(categories: list[str]) -> str:
    if not categories:
        return FIRST_AXIS_DEFAULT
    people = sum(1 for item in categories if item in {"hr", "behavioral"})
    return FIRST_AXIS_HR if people / len(categories) >= HR_SWITCH_SHARE else FIRST_AXIS_DEFAULT


def mixed_weights(categories: list[str], unassessed: set[str]) -> tuple[str, dict[str, float]]:
    """Blend base weights by the share of each question category, then renormalize.

    Unassessed dimensions (no job, no resume, no valid evidence) drop to 0 so
    missing material never lowers a score.
    """
    axis = first_axis(categories)
    counts = Counter(item for item in categories if item in BASE_WEIGHTS)
    total = sum(counts.values())
    if not total:
        counts = Counter({"technical": 1})
        total = 1
    keys = (axis, *SHARED_AXES)
    sums = dict.fromkeys(keys, 0.0)
    for category, count in counts.items():
        row = list(BASE_WEIGHTS[category])  # type: ignore[index]
        # HR questions never test professional depth; technical ones never test motivation.
        if axis == FIRST_AXIS_DEFAULT and category == "hr":
            row[0] = 0.0
        if axis == FIRST_AXIS_HR and category in {"technical", "project"}:
            row[0] = 0.0
        for key, value in zip(keys, row, strict=True):
            sums[key] += value * count / total
    for key in unassessed:
        if key in sums:
            sums[key] = 0.0
    weight_total = sum(sums.values())
    if weight_total <= 0:
        return axis, {key: 0.0 for key in keys}
    return axis, {key: round(value / weight_total, 4) for key, value in sums.items()}


def expected_depth(job_title: str | None, experience_requirement: str | None) -> int:
    if job_title and SENIOR_TITLE.search(job_title):
        return 4
    years = [int(item) for item in YEARS.findall(experience_requirement or "")]
    if not years:
        return DEFAULT_EXPECTED_DEPTH
    most = max(years)
    if most <= 2:
        return 2
    if most <= 5:
        return 3
    return 4


def question_score(
    *,
    verdicts: list[str],
    achieved_depth: int,
    expected: int,
    factual_errors: int,
    answer_status: str,
) -> float | None:
    """0–100; ``None`` when the answer is missing from the transcript (not counted)."""
    if answer_status == "missing":
        return None
    if answer_status == "declined":
        return 0.0
    signal = sum(SIGNAL_POINTS.get(item, 0.0) for item in verdicts) / len(verdicts) if verdicts else 0.0
    shortfall = max(0, expected - achieved_depth)
    depth_factor = max(0.0, 1.0 - DEPTH_PENALTY_PER_LEVEL * shortfall)
    score = signal * depth_factor * 100 - factual_errors * FACTUAL_ERROR_PENALTY
    return round(max(0.0, score), 1)


def dimension_score(scores: dict[str, int], weights: dict[str, float]) -> float | None:
    used = {key: weight for key, weight in weights.items() if weight and key in scores}
    total = sum(used.values())
    if not total:
        return None
    return round(sum(scores[key] / 5 * 100 * weight for key, weight in used.items()) / total, 1)


def total_score(question_scores: list[float], weighted_dimensions: float | None) -> float | None:
    if not question_scores:
        return None
    average = sum(question_scores) / len(question_scores)
    if weighted_dimensions is None:
        return round(average, 1)
    return round(average * QUESTION_SCORE_SHARE + weighted_dimensions * DIMENSION_SCORE_SHARE, 1)


def grade(total: float | None) -> str | None:
    if total is None:
        return None
    if total >= 85:
        return "excellent"
    if total >= 70:
        return "good"
    if total >= 60:
        return "pass"
    return "improve"


@dataclass(frozen=True)
class QuestionOutcome:
    category: str
    score: float | None
    resume_conflict: bool


def fatal_count(questions: list[QuestionOutcome]) -> int:
    """Very low scores on the session's main question type, or answers contradicting the resume."""
    categories = Counter(item.category for item in questions)
    dominant = categories.most_common(1)[0][0] if categories else None
    return sum(
        1
        for item in questions
        if item.resume_conflict
        or (item.score is not None and item.score < FATAL_QUESTION_SCORE and item.category == dominant)
    )


def base_verdict(total: float, fatal: int) -> Verdict:
    if total < 60:
        return "likely_fail"
    if fatal >= 2:
        return "at_risk"
    if total >= 80:
        return "likely_pass" if fatal == 0 else "promising"
    if total >= 70:
        return "promising"
    return "at_risk"


def adjust_by_signals(verdict: Verdict, positive: int, negative: int) -> tuple[Verdict, int]:
    """At most one step, and only with two or more agreeing interviewer signals."""
    step = 0
    if positive >= 2 and positive > negative:
        step = 1
    elif negative >= 2 and negative > positive:
        step = -1
    index = max(0, min(len(VERDICT_ORDER) - 1, VERDICT_ORDER.index(verdict) + step))
    adjusted = VERDICT_ORDER[index]
    return adjusted, VERDICT_ORDER.index(adjusted) - VERDICT_ORDER.index(verdict)


def confidence(*, assessable: int, diarized: bool, transcript_chars: int) -> tuple[str, str | None]:
    if assessable < 3:
        return "low", f"只识别出 {assessable} 道可评估的题目，判断仅供参考"
    if not diarized:
        return "low", "文字稿没有区分面试官和候选人，判断仅供参考"
    if assessable >= 5 and transcript_chars >= 3000:
        return "high", None
    return "medium", None
