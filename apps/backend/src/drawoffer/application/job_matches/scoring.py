"""Deterministic scoring for resume/JD match analysis.

The model only judges each requirement; the score, hits, gaps and highlights
are computed here so the same judgement always yields the same result, and
claims the model cannot back with a resume quotation never count.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from drawoffer.modules.job_matches.schemas import (
    MAX_REQUIREMENTS,
    MatchAnalysis,
    MatchHighlights,
)

WEIGHTS = {"must": 3, "important": 2, "nice": 1}
CREDITS = {"covered": 1.0, "partial": 0.5, "missing": 0.0}
MIN_EVIDENCE_CHARS = 4
MAX_HIGHLIGHT_TERMS = 30
MAX_TERM_CHARS = 40
RESULT_VERSION = 1

_NOISE = re.compile(r"[\s*_`#>\-•·、，。,.;:；：!?！？()（）\[\]【】\"'“”‘’|/\\]+")


def normalize(text: str) -> str:
    """Drop whitespace, markdown and punctuation so quotations compare reliably."""
    return _NOISE.sub("", text).casefold()


@dataclass(frozen=True)
class ScoredMatch:
    score: int
    result: dict[str, Any]


def _supported(evidence: str | None, resume_norm: str) -> bool:
    if not evidence:
        return False
    needle = normalize(evidence)
    return len(needle) >= MIN_EVIDENCE_CHARS and needle in resume_norm


def score_analysis(
    analysis: MatchAnalysis, job_text: str, resume_text: str
) -> ScoredMatch:
    resume_norm = normalize(resume_text)
    job_folded = job_text.casefold()
    requirements: list[dict[str, Any]] = []
    covered_terms: list[str] = []
    missing_terms: list[str] = []
    weighted = 0.0
    total = 0

    for item in analysis.requirements[:MAX_REQUIREMENTS]:
        coverage = item.coverage
        verified = coverage != "missing" and _supported(item.evidence, resume_norm)
        if coverage != "missing" and not verified:
            coverage = "missing"
        weight = WEIGHTS[item.importance]
        weighted += weight * CREDITS[coverage]
        total += weight
        requirements.append(
            {
                "text": item.text.strip(),
                "importance": item.importance,
                "coverage": coverage,
                "evidence": item.evidence.strip() if verified and item.evidence else None,
                "verified": verified,
            }
        )
        target = missing_terms if coverage == "missing" else covered_terms
        for term in item.terms:
            term = term.strip()
            if 0 < len(term) <= MAX_TERM_CHARS and term.casefold() in job_folded:
                target.append(term)

    missing = _dedupe(missing_terms)
    missing_keys = {term.casefold() for term in missing}
    covered = [
        term for term in _dedupe(covered_terms) if term.casefold() not in missing_keys
    ]
    highlights = MatchHighlights(
        covered=covered[:MAX_HIGHLIGHT_TERMS], missing=missing[:MAX_HIGHLIGHT_TERMS]
    )
    score = round(100 * weighted / total) if total else 0
    return ScoredMatch(
        score=score,
        result={
            "version": RESULT_VERSION,
            "requirements": requirements,
            "highlights": highlights.model_dump(),
        },
    )


def _dedupe(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for term in terms:
        key = term.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(term)
    return unique


def summarize(result: dict[str, Any]) -> tuple[str | None, list[str], list[str]]:
    """Headline (heaviest missing requirement), hits and gaps from a stored result."""
    requirements = list(result.get("requirements") or [])
    hits = [r["text"] for r in requirements if r.get("coverage") == "covered"]
    gaps = [r["text"] for r in requirements if r.get("coverage") != "covered"]
    missing = [r for r in requirements if r.get("coverage") == "missing"]
    headline = None
    if missing:
        heaviest = max(missing, key=lambda r: WEIGHTS.get(str(r.get("importance")), 0))
        headline = heaviest["text"]
    return headline, hits, gaps
