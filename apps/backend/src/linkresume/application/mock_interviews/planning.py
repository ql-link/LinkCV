"""Server-side plan selection: the model proposes topics, this module enforces the rules."""

from __future__ import annotations

import math
from typing import Any

from linkresume.application.mock_interviews import rubric
from linkresume.application.mock_interviews.outputs import InterviewPlan, PlanItem


def select_plan(plan: InterviewPlan, *, difficulty: str, question_count: int) -> tuple[list[PlanItem], list[str]]:
    """Pick ``question_count`` topics from selected-then-candidates under the difficulty rules.

    Returns the ordered topics plus the list of violated hard requirements
    (empty when the plan is acceptable). A short list means the caller should
    ask the model again.
    """
    profile = rubric.DIFFICULTY_PROFILES[difficulty]
    gap_cap = max(1, math.ceil(question_count * rubric.GAP_RATIO_CAP[profile.gap_ratio]))
    design_cap = {"none": 0, "at most one": 1, "exactly one": 1}[profile.open_design_questions]

    chosen: list[PlanItem] = []
    topics: set[str] = set()
    per_project: dict[str, int] = {}
    gaps = 0
    designs = 0

    def admit(item: PlanItem) -> bool:
        nonlocal gaps, designs
        if item.topic in topics:
            return False
        project = item.project.strip().casefold()
        if project and per_project.get(project, 0) >= rubric.MAX_TOPICS_PER_PROJECT:
            return False
        if item.is_gap and gaps >= gap_cap:
            return False
        if item.is_open_design and designs >= design_cap:
            return False
        chosen.append(item)
        topics.add(item.topic)
        if project:
            per_project[project] = per_project.get(project, 0) + 1
        gaps += int(item.is_gap)
        designs += int(item.is_open_design)
        return True

    # "exactly one" 开放设计题：先保证它入选，其余再按模型的筛选顺序补齐。
    if profile.open_design_questions == "exactly one":
        for item in [*plan.selected, *plan.candidates]:
            if item.is_open_design and admit(item):
                break
    for item in [*plan.selected, *plan.candidates]:
        if len(chosen) >= question_count:
            break
        admit(item)
    chosen = chosen[:question_count]

    problems: list[str] = []
    if len(chosen) < question_count:
        problems.append("count")
    if profile.open_design_questions == "exactly one" and not any(item.is_open_design for item in chosen):
        problems.append("open_design")
    return order_topics(chosen, difficulty), problems


def order_topics(items: list[PlanItem], difficulty: str) -> list[PlanItem]:
    """Warm-up first: clamp start depth, then order by ascending depth (stable)."""
    clamped = [
        item.model_copy(update={"start_depth": rubric.clamp_start_depth(difficulty, item.start_depth)})
        for item in items
    ]
    return sorted(clamped, key=lambda item: item.start_depth)


def plan_payload(items: list[PlanItem]) -> dict[str, Any]:
    return {"selected": [item.model_dump() for item in items]}
