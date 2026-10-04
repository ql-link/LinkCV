"""Free, local ranking used to choose which jobs are worth a model call."""

from __future__ import annotations

from linkresume.application.mock_interviews.retrieval import tokenize

SKILL_WEIGHT = 0.6
DESCRIPTION_WEIGHT = 0.4
MIN_TOKEN_CHARS = 2


def _token_set(text: str) -> set[str]:
    return {token for token in tokenize(text) if len(token) >= MIN_TOKEN_CHARS}


def resume_profile(resume_text: str) -> tuple[str, set[str]]:
    return resume_text.casefold(), _token_set(resume_text)


def prefilter_score(
    profile: tuple[str, set[str]], *, title: str, description: str, skills: list[str]
) -> float:
    """0–1 overlap between the job's skills/description and the resume text."""
    resume_folded, resume_tokens = profile
    wanted = [skill.strip() for skill in skills if skill and skill.strip()]
    skill_coverage = (
        sum(1 for skill in wanted if skill.casefold() in resume_folded) / len(wanted)
        if wanted
        else None
    )
    job_tokens = _token_set(f"{title}\n{description}")
    description_overlap = (
        len(job_tokens & resume_tokens) / len(job_tokens) if job_tokens else 0.0
    )
    if skill_coverage is None:
        return description_overlap
    return SKILL_WEIGHT * skill_coverage + DESCRIPTION_WEIGHT * description_overlap
