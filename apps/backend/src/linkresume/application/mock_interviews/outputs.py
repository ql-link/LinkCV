"""Structured model outputs. Every field is validated before it is persisted."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Verdict = Literal["hit", "partial", "miss"]
FactVerdict = Literal["consistent", "conflict", "stronger_in_material", "not_found"]


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


class PlanItem(_Output):
    topic: str = Field(min_length=1, max_length=200)
    anchor: str = Field(min_length=1, max_length=500)
    anchor_kind: Literal["resume", "job", "material"] = "resume"
    start_depth: int = Field(ge=1, le=5)
    expected_signals: list[str] = Field(min_length=1, max_length=5)
    follow_up_directions: list[str] = Field(default_factory=list, max_length=3)
    is_gap: bool = False


class InterviewPlan(_Output):
    candidates: list[PlanItem] = Field(default_factory=list, max_length=20)
    selected: list[PlanItem] = Field(min_length=1, max_length=10)


class InterviewerTurn(_Output):
    action: Literal["follow_up", "next_question", "finish"]
    depth_level: int = Field(ge=1, le=5)
    message: str = Field(min_length=1, max_length=2000)


class SignalJudgement(_Output):
    signal: str = Field(max_length=300)
    verdict: Verdict
    evidence: str = Field(default="", max_length=500)


class QuestionEvaluation(_Output):
    signals: list[SignalJudgement] = Field(default_factory=list, max_length=5)
    achieved_depth: int = Field(ge=0, le=5)
    factual_errors: list[str] = Field(default_factory=list, max_length=10)
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


class DimensionJudgement(_Output):
    score: int = Field(ge=1, le=5)
    evidence: list[str] = Field(default_factory=list, max_length=2)
    comment: str = Field(default="", max_length=500)


class OverallEvaluation(_Output):
    professional_depth: DimensionJudgement
    structure: DimensionJudgement
    job_fit: DimensionJudgement | None = None
    resume_consistency: DimensionJudgement
    communication: DimensionJudgement
    headline: str = Field(max_length=200)
    summary: str = Field(max_length=2000)
    resume_risks: list[str] = Field(default_factory=list, max_length=8)
    improvements: list[str] = Field(min_length=1, max_length=5)
    off_topic_detected: bool = False
