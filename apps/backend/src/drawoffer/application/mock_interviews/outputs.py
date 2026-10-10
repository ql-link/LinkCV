"""Structured model outputs. Every field is validated before it is persisted."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Verdict = Literal["hit", "partial", "miss"]
FactVerdict = Literal["consistent", "conflict", "stronger_in_material", "not_found"]
Competency = Literal["knowledge", "problem_solving", "ownership", "motivation", "communication"]


class _Output(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ResumeClaim(_Output):
    text: str = Field(min_length=1, max_length=500)
    verb_strength: Literal["led", "owned", "participated", "assisted", "unknown"] = "unknown"
    quantified: bool = False
    technologies: list[str] = Field(default_factory=list, max_length=20)
    source: Literal["resume", "material"] = "resume"
    material_dataset_id: str | None = None


class JobRequirement(_Output):
    text: str = Field(min_length=1, max_length=500)
    kind: Literal["skill", "responsibility", "soft_skill"] = "skill"


class BackgroundAnalysis(_Output):
    claims: list[ResumeClaim] = Field(default_factory=list, max_length=40)
    requirements: list[JobRequirement] = Field(default_factory=list, max_length=30)
    overlaps: list[str] = Field(default_factory=list, max_length=20)
    gaps: list[str] = Field(default_factory=list, max_length=20)
    candidate_level: str = Field(default="", max_length=200)
    # 简历中声明掌握或擅长的技术栈 / 专业技能，按突出程度排序。
    skills: list[str] = Field(default_factory=list, max_length=30)


class SignalSpec(_Output):
    text: str = Field(min_length=1, max_length=300)
    # 缺省值只出现在 v4 之前生成的计划里，评分时由 scoring.signal_specs 按考察点类型补齐。
    competency: Competency | None = None
    core: bool | None = None


class PlanItem(_Output):
    topic: str = Field(min_length=1, max_length=200)
    anchor: str = Field(min_length=1, max_length=500)
    anchor_kind: Literal["resume", "job", "material", "intro"] = "resume"
    # 服务端据此裁剪：同一项目考察点上限、开放设计题数量。
    project: str = Field(default="", max_length=120)
    is_open_design: bool = False
    # 针对简历中声明的技术栈本身（而非某个项目）的考察点，skill 为对应技术名。
    is_skill_check: bool = False
    skill: str = Field(default="", max_length=60)
    # 固定的开场自我介绍，由服务端插入，不来自模型。
    is_intro: bool = False
    start_depth: int = Field(ge=1, le=5)
    expected_signals: list[SignalSpec] = Field(min_length=1, max_length=5)
    follow_up_directions: list[str] = Field(default_factory=list, max_length=3)
    is_gap: bool = False

    @field_validator("expected_signals", mode="before")
    @classmethod
    def _accept_plain_signals(cls, value: object) -> object:
        # v4 之前的计划只保存要点文字。
        if isinstance(value, list):
            return [{"text": item} if isinstance(item, str) else item for item in value]
        return value


class InterviewPlan(_Output):
    candidates: list[PlanItem] = Field(default_factory=list, max_length=20)
    selected: list[PlanItem] = Field(min_length=1, max_length=10)


class InterviewerTurn(_Output):
    action: Literal["follow_up", "next_question", "finish"]
    depth_level: int = Field(ge=1, le=5)
    # 追问时填写：被追问的候选人原话（逐字摘录）与该点缺什么，服务端据此核对追问确实基于回答。
    probe_quote: str = Field(default="", max_length=300)
    probe_gap: str = Field(default="", max_length=200)
    message: str = Field(min_length=1, max_length=2000)


class SignalJudgement(_Output):
    # expected_signals 的下标（从 0 开始），优先于名称匹配，避免判定记到错的信号上。
    index: int | None = Field(default=None, ge=0, le=20)
    signal: str = Field(max_length=300)
    verdict: Verdict
    evidence: str = Field(default="", max_length=500)


class FactualError(_Output):
    description: str = Field(min_length=1, max_length=300)
    # major=核心概念或关键事实错误；minor=细节、术语或数字口误。
    severity: Literal["minor", "major"] = "minor"
    # 候选人原话；引不出来的"事实错误"不扣分。
    evidence: str = Field(default="", max_length=500)


class ExpressionJudgement(_Output):
    verdict: Verdict
    evidence: str = Field(default="", max_length=500)
    note: str = Field(default="", max_length=300)


class QuestionEvaluation(_Output):
    signals: list[SignalJudgement] = Field(default_factory=list, max_length=5)
    expression: ExpressionJudgement
    achieved_depth: int = Field(ge=0, le=5)
    factual_errors: list[FactualError] = Field(default_factory=list, max_length=10)
    highlights: list[str] = Field(default_factory=list, max_length=5)
    weaknesses: list[str] = Field(default_factory=list, max_length=5)
    reference_answer: str = Field(default="", max_length=2000)


class ExtractedClaim(_Output):
    text: str = Field(min_length=1, max_length=300)
    kind: Literal["number", "role", "timeline", "technology", "other"] = "other"
    question_sequence_no: int | None = None


class ClaimExtraction(_Output):
    claims: list[ExtractedClaim] = Field(default_factory=list, max_length=15)


class ClaimVerification(_Output):
    verdict: FactVerdict
    quote: str = Field(default="", max_length=300)
    snippet_index: int | None = Field(default=None, ge=0, le=2)
    note: str = Field(default="", max_length=500)


class CompetencyNote(_Output):
    key: Literal["knowledge", "problem_solving", "ownership", "motivation", "communication", "job_fit"]
    comment: str = Field(default="", max_length=300)


class ActionItem(_Output):
    title: str = Field(min_length=1, max_length=80)
    detail: str = Field(default="", max_length=400)
    priority: Literal["high", "normal"] = "normal"
    kind: Literal["practice", "resume", "material"] = "practice"
    question_refs: list[int] = Field(default_factory=list, max_length=5)
    competency: str | None = Field(default=None, max_length=40)
    # 简历类行动必须逐字引用简历原句，引不出时降级为练习类。
    resume_quote: str = Field(default="", max_length=300)


class OverallEvaluation(_Output):
    headline: str = Field(max_length=200)
    summary: str = Field(max_length=2000)
    strengths: list[str] = Field(default_factory=list, max_length=5)
    competency_notes: list[CompetencyNote] = Field(default_factory=list, max_length=6)
    actions: list[ActionItem] = Field(min_length=1, max_length=6)
    off_topic_detected: bool = False


class TranscriptChange(_Output):
    original: str = Field(min_length=1, max_length=200)
    corrected: str = Field(max_length=200)
    reason: str = Field(default="", max_length=200)


class TranscriptCorrection(_Output):
    corrected: str = Field(min_length=1, max_length=8000)
    changes: list[TranscriptChange] = Field(default_factory=list, max_length=50)


class IntroReplacement(_Output):
    # 被替换考察点在计划中的下标（≥1，0 是自我介绍本身）。
    index: int = Field(ge=1, le=20)
    item: PlanItem


class IntroAdaptation(_Output):
    replacements: list[IntroReplacement] = Field(default_factory=list, max_length=3)  # 服务端最多采用 2 个
