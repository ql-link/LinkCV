"""Deterministic difficulty and scoring rules for mock interviews (rubric v4).

The model only judges individual criteria with evidence; every number that
reaches the user is computed here so a report can be re-derived from its parts.
The total comes only from per-question evidence; competencies regroup the same
evidence to explain it and never add to the score.
"""

from __future__ import annotations

from dataclasses import dataclass

RUBRIC_VERSION = "v4"
# 提示词版本：任何影响出题、追问、评估口径的提示词改动都要同步递增，便于解释分数漂移。
PROMPT_VERSION = "2026-10-e"

# 能力项：前五项由要点标签汇总，job_fit 由锚定在岗位要求上的题目分汇总。
SIGNAL_COMPETENCIES = ("knowledge", "problem_solving", "ownership", "motivation", "communication")
COMPETENCIES = (*SIGNAL_COMPETENCIES, "job_fit")

SIGNAL_POINTS = {"hit": 1.0, "partial": 0.5, "miss": 0.0}
CORE_SIGNAL_WEIGHT = 2.0
BONUS_SIGNAL_WEIGHT = 1.0
MAX_CORE_SIGNALS = 3
DEPTH_PENALTY_PER_LEVEL = 0.15
ERROR_PENALTIES = {"minor": 5, "major": 15}
MAX_ERROR_PENALTY = 30
# 一个能力项至少要有约"一条核心 + 一条加分"的证据才给分。
MIN_COMPETENCY_WEIGHT = 3.0
COMPETENCY_STRONG = 75
COMPETENCY_SOLID = 55
VOICE_DELIVERY_SHARE = 0.2
LOW_QUESTION_SCORE = 40
VERDICT_MEETS_SCORE = 75
VERDICT_BORDERLINE_SCORE = 60
VERDICT_MEETS_CORE_HIT_RATE = 0.6
MIN_ANSWERED_FOR_CONFIDENCE = 2


@dataclass(frozen=True)
class DifficultyProfile:
    start_depth_min: int
    start_depth_max: int
    max_depth: int
    expected_depth: int
    gap_ratio: str
    open_design_questions: str
    max_follow_ups: int = 2


DIFFICULTY_PROFILES = {
    "junior": DifficultyProfile(1, 2, 3, 2, "low", "none", 2),
    "intermediate": DifficultyProfile(2, 3, 4, 3, "medium", "at most one", 2),
    # 高级从 L3 起步，需要 3 次追问才有空间逐级升到 L5。
    "senior": DifficultyProfile(3, 3, 5, 4, "high", "exactly one", 3),
}

# 缺口题占比上限（相对题量），计划按此在服务端裁剪而不只靠提示词。
GAP_RATIO_CAP = {"low": 0.2, "medium": 0.4, "high": 0.6}
MAX_TOPICS_PER_PROJECT = 2
# 深度阶梯描述的是技术追问；HR 面不按技术深度扣分。
DEPTH_SCORED_TYPES = ("technical", "project_deep_dive", "comprehensive")


def max_follow_ups(difficulty: str) -> int:
    return DIFFICULTY_PROFILES[difficulty].max_follow_ups


def clamp_depth(difficulty: str, depth: int) -> int:
    profile = DIFFICULTY_PROFILES[difficulty]
    return max(1, min(profile.max_depth, depth))


def clamp_start_depth(difficulty: str, depth: int) -> int:
    profile = DIFFICULTY_PROFILES[difficulty]
    return max(profile.start_depth_min, min(profile.start_depth_max, depth))


def signal_weight(core: bool) -> float:
    return CORE_SIGNAL_WEIGHT if core else BONUS_SIGNAL_WEIGHT


def weighted_points(signals: list[tuple[bool, str]]) -> float:
    """Weighted share of points for ``(core, verdict)`` pairs; 0 when there are none."""
    total = sum(signal_weight(core) for core, _ in signals)
    if not total:
        return 0.0
    return sum(signal_weight(core) * SIGNAL_POINTS[verdict] for core, verdict in signals) / total


def depth_outcome(
    *, difficulty: str, probed_depth: int, achieved_depth: int, depth_scored: bool
) -> tuple[float, str]:
    """Depth factor and status. Depth the interviewer never probed is not the candidate's fault."""
    if not depth_scored:
        return 1.0, "not_scored"
    expected = DIFFICULTY_PROFILES[difficulty].expected_depth
    shortfall = max(0, min(expected, probed_depth) - achieved_depth)
    factor = max(0.0, 1.0 - DEPTH_PENALTY_PER_LEVEL * shortfall)
    if probed_depth < expected:
        return factor, "not_probed"
    return factor, "short" if shortfall else "met"


def error_penalty(severities: list[str]) -> int:
    return min(MAX_ERROR_PENALTY, sum(ERROR_PENALTIES.get(item, ERROR_PENALTIES["minor"]) for item in severities))


def question_score(
    *,
    signals: list[tuple[bool, str]],
    depth_factor: float,
    error_severities: list[str],
    skipped: bool,
) -> float:
    if skipped:
        return 0.0
    score = weighted_points(signals) * depth_factor * 100 - error_penalty(error_severities)
    return round(max(0.0, score), 2)


def total_score(question_scores: list[float]) -> float:
    return round(sum(question_scores) / len(question_scores), 2) if question_scores else 0.0


def competency_level(score: float | None) -> str | None:
    if score is None:
        return None
    if score >= COMPETENCY_STRONG:
        return "strong"
    if score >= COMPETENCY_SOLID:
        return "solid"
    return "weak"


def _range_points(value: float, low: float, high: float) -> float:
    if low <= value <= high:
        return 1.0
    slack = (high - low) / 2
    distance = low - value if value < low else value - high
    return 0.5 if distance <= slack else 0.0


def voice_delivery(metrics: dict[str, object] | None) -> float | None:
    """0–1 delivery score from server-side voice metrics; ``None`` for text interviews."""
    if not metrics:
        return None
    reference = metrics.get("reference") or {}
    keys = ("chars_per_minute", "long_pauses", "filler_ratio")
    points = []
    for key in keys:
        low, high = reference.get(key) or (0, 0)  # type: ignore[union-attr]
        points.append(_range_points(float(metrics.get(key) or 0), float(low), float(high)))
    return round(sum(points) / len(points), 4)


def verdict_level(*, answered: int, total: float, risk_flags: int, core_hit_rate: float) -> str:
    if answered < MIN_ANSWERED_FOR_CONFIDENCE:
        return "insufficient"
    if total >= VERDICT_MEETS_SCORE and risk_flags == 0 and core_hit_rate >= VERDICT_MEETS_CORE_HIT_RATE:
        return "meets"
    if total >= VERDICT_BORDERLINE_SCORE and risk_flags <= 1:
        return "borderline"
    return "below"


def low_confidence(*, answered: int, total: int) -> bool:
    skipped = total - answered
    return answered < MIN_ANSWERED_FOR_CONFIDENCE or skipped * 2 > total
