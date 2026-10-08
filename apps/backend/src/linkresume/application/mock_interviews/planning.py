"""Server-side plan selection: the model proposes topics, this module enforces the rules."""

from __future__ import annotations

import math
from typing import Any

from linkresume.application.mock_interviews import rubric
from linkresume.application.mock_interviews.outputs import InterviewPlan, PlanItem


def select_plan(
    plan: InterviewPlan, *, difficulty: str, question_count: int, interview_type: str = "technical",
    require_skills: bool = True,
    skills: list[str] | None = None,
) -> tuple[list[PlanItem], list[str]]:
    """Pick ``question_count`` topics from selected-then-candidates under the difficulty rules.

    Returns the ordered topics plus the list of violated hard requirements
    (empty when the plan is acceptable). A short list means the caller should
    ask the model again.
    """
    profile = rubric.DIFFICULTY_PROFILES[difficulty]
    gap_cap = max(1, math.ceil(question_count * rubric.GAP_RATIO_CAP[profile.gap_ratio]))
    design_cap = {"none": 0, "at most one": 1, "exactly one": 1}[profile.open_design_questions]
    skill_need = required_skill_checks(interview_type, question_count) if require_skills else 0
    declared = [str(item) for item in skills or [] if str(item).strip()]

    def is_real_skill_check(item: PlanItem) -> bool:
        """The model's tag only counts when it names a skill the resume declares."""
        if not item.is_skill_check:
            return False
        if not declared:
            return True
        name = _norm(item.skill)
        return bool(name) and any(name in _norm(skill) or _norm(skill) in name for skill in declared)

    # 技术栈考察点不绑定具体项目，也不占项目名额。
    plan = plan.model_copy(
        update={
            "selected": [_untag(item, is_real_skill_check(item)) for item in plan.selected],
            "candidates": [_untag(item, is_real_skill_check(item)) for item in plan.candidates],
        }
    )
    # 模型常漏填 project 或对同一段经历用不同写法，先归并到已知经历名再计数。
    known = [item.project for item in [*plan.selected, *plan.candidates] if item.project.strip()]
    plan = plan.model_copy(
        update={
            "selected": [_with_project(item, known) for item in plan.selected],
            "candidates": [_with_project(item, known) for item in plan.candidates],
        }
    )
    cap = project_cap(interview_type, question_count)

    chosen: list[PlanItem] = []
    topics: set[str] = set()
    per_project: dict[str, int] = {}
    gaps = 0
    designs = 0

    def admit(item: PlanItem) -> bool:
        nonlocal gaps, designs
        if item.topic in topics:
            return False
        project = project_key(item.project)
        if project and per_project.get(project, 0) >= cap:
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

    # 简历声明的技术栈至少要被直接考察，不能只问项目。
    if skill_need:
        taken = 0
        for item in [*plan.selected, *plan.candidates]:
            if taken >= skill_need:
                break
            if item.is_skill_check and admit(item):
                taken += 1
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
    if sum(item.is_skill_check for item in chosen) < skill_need:
        problems.append("skill_check")
    if profile.open_design_questions == "exactly one" and not any(item.is_open_design for item in chosen):
        problems.append("open_design")
    if interview_type in SPREAD_TYPES and any(_needs_project(item) for item in chosen):
        problems.append("project")
    return order_topics(chosen, difficulty), problems


def _norm(text: str) -> str:
    return "".join(text.split()).casefold()


# 综合面与技术面要把题目分散到不同经历；项目深挖面按设计集中在 1–2 个项目，不设单项目上限。
SPREAD_TYPES = ("technical", "comprehensive")
_PROJECT_NOISE = str.maketrans("", "", "-_·•.,，。、:：;；/\\|()（）[]【】<>《》\"'“”‘’")


def project_key(name: str) -> str:
    """Comparable form of an experience name: no spaces, punctuation or case."""
    return _norm(name).translate(_PROJECT_NOISE)


def same_project(left: str, right: str) -> bool:
    """Treat "字节实习" and "字节 - 实习（后端）" as one experience; empty names never match."""
    a, b = project_key(left), project_key(right)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = sorted((a, b), key=len)
    return len(shorter) >= 2 and shorter in longer


def _canonical(name: str, known: list[str]) -> str:
    """Map a project name onto the first known spelling of the same experience."""
    return next((other for other in known if same_project(name, other)), name)


def _with_project(item: PlanItem, known: list[str]) -> PlanItem:
    """Normalise the project name; fill it when the topic or anchor names a known project."""
    if item.is_skill_check or item.is_intro:
        return item
    if item.project.strip():
        return item.model_copy(update={"project": _canonical(item.project, known)})
    text = project_key(item.topic + item.anchor)
    for other in known:
        key = project_key(other)
        if len(key) >= 2 and key in text:
            return item.model_copy(update={"project": other})
    return item


def _needs_project(item: PlanItem) -> bool:
    """Resume or material topics are about an experience and must name it."""
    return (
        item.anchor_kind in ("resume", "material")
        and not item.project.strip()
        and not (item.is_skill_check or item.is_open_design or item.is_gap or item.is_intro)
    )


def project_cap(interview_type: str, question_count: int) -> int:
    return rubric.MAX_TOPICS_PER_PROJECT if interview_type in SPREAD_TYPES else max(question_count, 1)


def _untag(item: PlanItem, real: bool) -> PlanItem:
    if real:
        return item.model_copy(update={"project": ""})
    return item.model_copy(update={"is_skill_check": False}) if item.is_skill_check else item


def required_skill_checks(interview_type: str, question_count: int) -> int:
    """How many topics must test the declared tech stack itself rather than a project."""
    if interview_type == "technical":
        return 2 if question_count >= 5 else 1
    if interview_type == "comprehensive":
        return 1
    return 0


PROBLEM_HINTS = {
    "count": "考察点数量不足，请补足到要求的数量。",
    "open_design": "缺少要求的开放设计题（is_open_design=true）。",
    "skill_check": "缺少针对简历中技术栈本身的考察点（is_skill_check=true，skill 填技术名，不绑定具体项目）。",
    "project": "有来自简历经历的考察点没有填写 project：请填写所属经历名称，同一段经历在所有考察点中用完全相同的写法。",
}


def order_topics(items: list[PlanItem], difficulty: str) -> list[PlanItem]:
    """Warm-up first: clamp start depth, then order by ascending depth (stable)."""
    clamped = [
        item.model_copy(update={"start_depth": rubric.clamp_start_depth(difficulty, item.start_depth)})
        for item in items
    ]
    return sorted(clamped, key=lambda item: item.start_depth)


def plan_payload(items: list[PlanItem]) -> dict[str, Any]:
    return {"selected": [item.model_dump() for item in items]}


MAX_INTRO_REPLACEMENTS = 2
MIN_INTRO_CHARS = 30

INTRO_TEXT = {
    "zh": {
        "topic": "自我介绍",
        "anchor": "简历整体经历与求职目标",
        "signals": [
            {"text": "用 1–2 分钟概括最相关的教育或工作经历", "competency": "ownership", "core": True},
            {"text": "点出与目标岗位最匹配的经验或项目", "competency": "ownership", "core": False},
            {"text": "说明求职方向或动机", "competency": "motivation", "core": False},
            {"text": "表达有条理、重点突出", "competency": "communication", "core": False},
        ],
        "follow_ups": ["最能体现岗位匹配的一段经历", "为什么选择这个方向"],
    },
    "en": {
        "topic": "Self-introduction",
        "anchor": "Overall background and career goal",
        "signals": [
            {"text": "Summarises the most relevant education or work in 1-2 minutes", "competency": "ownership", "core": True},
            {"text": "Highlights the experience that best matches the target role", "competency": "ownership", "core": False},
            {"text": "States career direction or motivation", "competency": "motivation", "core": False},
            {"text": "Speaks in a clear, focused order", "competency": "communication", "core": False},
        ],
        "follow_ups": ["The experience most relevant to the role", "Why this direction"],
    },
}


def intro_item(language: str) -> PlanItem:
    """The fixed opening question: every real interview starts with a self-introduction."""
    text = INTRO_TEXT.get(language, INTRO_TEXT["zh"])
    return PlanItem(
        topic=text["topic"],
        anchor=text["anchor"],
        anchor_kind="resume",
        start_depth=1,
        expected_signals=list(text["signals"]),
        follow_up_directions=list(text["follow_ups"]),
        is_intro=True,
    )


def with_intro(items: list[PlanItem], language: str) -> list[PlanItem]:
    return [intro_item(language), *items]


def apply_intro_adaptation(
    items: list[dict[str, Any]],
    replacements: list[Any],
    intro_answer: str,
    difficulty: str,
    interview_type: str = "technical",
) -> tuple[list[dict[str, Any]], int]:
    """Swap in topics built on what the candidate stressed in the self-introduction.

    Only unasked topics (index ≥ 1) can be replaced, the anchor must quote the
    introduction verbatim, and the plan keeps its length. In spread interviews
    an experience never loses its only topic and never exceeds the project cap,
    so stressing one internship cannot push the others out of the interview.
    Returns the new plan items and how many replacements were applied.
    """
    from linkresume.application.mock_interviews.scoring import quoted_in

    result = list(items)
    applied = 0
    used: set[int] = set()
    spread = interview_type in SPREAD_TYPES

    def count(project: str, skip: int) -> int:
        return sum(
            1
            for position, other in enumerate(result)
            if position != skip and same_project(project, str(other.get("project") or ""))
        )

    for replacement in replacements:
        if applied >= MAX_INTRO_REPLACEMENTS:
            break
        index = replacement.index
        if index < 1 or index >= len(result) or index in used:
            continue
        item = replacement.item
        if not quoted_in(item.anchor, intro_answer) or len(item.anchor.strip()) < 4:
            continue
        # 不替换承担硬性要求的考察点（开放设计题、技术栈考察）。
        current = result[index]
        if current.get("is_open_design") or current.get("is_skill_check"):
            continue
        known = [str(other.get("project") or "") for position, other in enumerate(result) if position != index]
        known = [name for name in known if name.strip()]
        item = _with_project(item, known)
        if spread:
            current_project = str(current.get("project") or "")
            # 某段经历唯一的考察点不能被换掉，否则这段经历就不会被问到。
            if current_project.strip() and count(current_project, index) == 0:
                continue
            if item.project.strip() and count(item.project, index) >= rubric.MAX_TOPICS_PER_PROJECT:
                continue
        fixed = item.model_copy(
            update={
                "anchor_kind": "intro",
                "start_depth": rubric.clamp_start_depth(difficulty, item.start_depth),
                "is_intro": False,
            }
        )
        if any(fixed.topic == other.get("topic") for other in result):
            continue
        result[index] = fixed.model_dump()
        used.add(index)
        applied += 1
    return result, applied


SKILL_TEXT = {
    "zh": {
        "topic": "{skill} 核心机制与常见陷阱",
        "anchor": "简历技能：{skill}",
        "signals": [
            {"text": "说清 {skill} 的核心机制或原理", "competency": "knowledge", "core": True},
            {"text": "举出使用中的常见陷阱或性能问题", "competency": "knowledge", "core": False},
            {"text": "说明相关的选型或取舍", "competency": "problem_solving", "core": False},
            {"text": "能结合实际场景说明怎么用", "competency": "knowledge", "core": False},
        ],
        "follow_ups": ["最容易踩的坑是什么", "和替代方案相比怎么取舍"],
    },
    "en": {
        "topic": "{skill}: core mechanics and pitfalls",
        "anchor": "Resume skill: {skill}",
        "signals": [
            {"text": "Explains the core mechanics of {skill}", "competency": "knowledge", "core": True},
            {"text": "Names common pitfalls or performance issues", "competency": "knowledge", "core": False},
            {"text": "Discusses selection and trade-offs", "competency": "problem_solving", "core": False},
            {"text": "Applies it to a concrete scenario", "competency": "knowledge", "core": False},
        ],
        "follow_ups": ["The most common pitfall", "Trade-offs against alternatives"],
    },
}


def fill_skill_checks(
    items: list[PlanItem], skills: list[str], need: int, difficulty: str, language: str
) -> list[PlanItem]:
    """Guarantee tech-stack coverage when the model could not deliver it.

    Builds template topics for the most prominent declared skills and puts
    them in place of topics that carry no hard requirement, preferring the
    experience with the most topics so no experience loses its only one.
    """
    have = sum(item.is_skill_check for item in items)
    text = SKILL_TEXT.get(language, SKILL_TEXT["zh"])
    covered = {_norm(item.skill) for item in items if item.is_skill_check}
    result = list(items)

    def priority(index: int) -> tuple[int, int]:
        project = result[index].project
        if not project.strip():
            return (1, -index)
        others = sum(1 for other in result if same_project(project, other.project))
        # 0：所在经历还有别的题；2：该经历唯一的题，最后才动。
        return (0 if others > 1 else 2, -index)

    for skill in skills:
        if have >= need:
            break
        if _norm(skill) in covered:
            continue
        replaceable = [
            index
            for index in range(len(result))
            if not result[index].is_skill_check and not result[index].is_open_design
        ]
        if not replaceable:
            break
        replace_at = min(replaceable, key=priority)
        result[replace_at] = PlanItem(
            topic=text["topic"].format(skill=skill),
            anchor=text["anchor"].format(skill=skill),
            start_depth=rubric.DIFFICULTY_PROFILES[difficulty].start_depth_min,
            expected_signals=[{**signal, "text": signal["text"].format(skill=skill)} for signal in text["signals"]],
            follow_up_directions=list(text["follow_ups"]),
            is_skill_check=True,
            skill=skill,
        )
        covered.add(_norm(skill))
        have += 1
    return order_topics(result, difficulty)
