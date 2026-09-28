"""Deterministic difficulty and scoring rules for mock interviews.

The model only judges individual criteria with evidence; every number that
reaches the user is computed here so a report can be re-derived from its parts.
"""

from __future__ import annotations

from dataclasses import dataclass

RUBRIC_VERSION = "v1"

DIMENSIONS = (
    "professional_depth",
    "structure",
    "job_fit",
    "resume_consistency",
    "communication",
)

DIMENSION_WEIGHTS: dict[str, dict[str, float]] = {
    "technical": {
        "professional_depth": 0.35,
        "structure": 0.20,
        "job_fit": 0.20,
        "resume_consistency": 0.15,
        "communication": 0.10,
    },
    "project_deep_dive": {
        "professional_depth": 0.30,
        "structure": 0.20,
        "job_fit": 0.15,
        "resume_consistency": 0.25,
        "communication": 0.10,
    },
    "hr": {
        "professional_depth": 0.0,
        "structure": 0.30,
        "job_fit": 0.30,
        "resume_consistency": 0.10,
        "communication": 0.30,
    },
}
DIMENSION_WEIGHTS["comprehensive"] = {
    "professional_depth": 0.225,
    "structure": 0.275,
    "job_fit": 0.20,
    "resume_consistency": 0.175,
    "communication": 0.125,
}

QUESTION_SCORE_SHARE = 0.7
DIMENSION_SCORE_SHARE = 0.3
DEPTH_PENALTY_PER_LEVEL = 0.15
FACTUAL_ERROR_PENALTY = 10
SIGNAL_POINTS = {"hit": 1.0, "partial": 0.5, "miss": 0.0}
MIN_ANSWERED_FOR_CONFIDENCE = 2


@dataclass(frozen=True)
class DifficultyProfile:
    start_depth_min: int
    start_depth_max: int
    max_depth: int
    expected_depth: int
    gap_ratio: str
    open_design_questions: str


DIFFICULTY_PROFILES = {
    "junior": DifficultyProfile(1, 2, 3, 2, "low", "none"),
    "intermediate": DifficultyProfile(2, 3, 4, 3, "medium", "at most one"),
    "senior": DifficultyProfile(3, 3, 5, 4, "high", "exactly one"),
}

MAX_FOLLOW_UPS = 2


def clamp_depth(difficulty: str, depth: int) -> int:
    profile = DIFFICULTY_PROFILES[difficulty]
    return max(1, min(profile.max_depth, depth))


def clamp_start_depth(difficulty: str, depth: int) -> int:
    profile = DIFFICULTY_PROFILES[difficulty]
    return max(profile.start_depth_min, min(profile.start_depth_max, depth))


def question_score(
    *,
    signal_verdicts: list[str],
    achieved_depth: int,
    difficulty: str,
    factual_errors: int,
    skipped: bool,
) -> float:
    if skipped:
        return 0.0
    if signal_verdicts:
        signal = sum(SIGNAL_POINTS[item] for item in signal_verdicts) / len(signal_verdicts)
    else:
        signal = 0.0
    shortfall = max(0, DIFFICULTY_PROFILES[difficulty].expected_depth - achieved_depth)
    depth_factor = max(0.0, 1.0 - DEPTH_PENALTY_PER_LEVEL * shortfall)
    score = signal * depth_factor * 100 - factual_errors * FACTUAL_ERROR_PENALTY
    return round(max(0.0, score), 2)


def effective_weights(interview_type: str, *, has_job: bool) -> dict[str, float]:
    weights = dict(DIMENSION_WEIGHTS[interview_type])
    if not has_job:
        weights["job_fit"] = 0.0
    total = sum(weights.values())
    return {key: round(value / total, 4) if total else 0.0 for key, value in weights.items()}


def dimension_score(scores: dict[str, int], weights: dict[str, float]) -> float:
    return round(
        sum(scores.get(key, 0) / 5 * 100 * weight for key, weight in weights.items() if weight),
        2,
    )


def total_score(question_scores: list[float], weighted_dimension_score: float) -> float:
    average = sum(question_scores) / len(question_scores) if question_scores else 0.0
    return round(
        average * QUESTION_SCORE_SHARE + weighted_dimension_score * DIMENSION_SCORE_SHARE,
        2,
    )


def low_confidence(*, answered: int, total: int) -> bool:
    skipped = total - answered
    return answered < MIN_ANSWERED_FOR_CONFIDENCE or skipped * 2 > total
