from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Importance = Literal["must", "important", "nice"]
Coverage = Literal["covered", "partial", "missing"]
MatchStatus = Literal["pending", "ready", "failed"]
RecommendationState = Literal[
    "no_resume", "no_jobs", "computing", "ready", "idle", "unavailable"
]

MAX_REQUIREMENTS = 12


class _Requirement(BaseModel):
    """One job requirement as judged by the model; extra keys are ignored."""

    model_config = ConfigDict(extra="ignore")

    text: str = Field(min_length=1, max_length=400)
    importance: Importance = "important"
    coverage: Coverage
    evidence: str | None = Field(default=None, max_length=1_000)
    terms: list[str] = Field(default_factory=list, max_length=12)


class MatchAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore")

    requirements: list[_Requirement] = Field(min_length=3, max_length=30)


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_id: str = Field(min_length=1, max_length=20)


class MatchHighlights(BaseModel):
    covered: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)


class MatchRecord(BaseModel):
    status: MatchStatus
    stale: bool
    score: int | None
    headline: str | None
    hits: list[str]
    gaps: list[str]
    highlights: MatchHighlights
    analyzed_at: str | None
    error_code: str | None


class MatchResponse(BaseModel):
    match: MatchRecord | None


class RecommendationResume(BaseModel):
    id: str
    title: str


class RecommendationItem(BaseModel):
    job_id: str
    job_title: str
    company_name: str
    logo_url: str | None
    score: int
    application_status: str | None


class RecommendationsResponse(BaseModel):
    state: RecommendationState
    resume: RecommendationResume | None
    items: list[RecommendationItem]
    pending_count: int
    can_compute: bool
