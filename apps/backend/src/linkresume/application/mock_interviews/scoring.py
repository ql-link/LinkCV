"""Deterministic per-question scoring and evidence checks for mock interviews."""

from __future__ import annotations

import re
from typing import Any

from linkresume.application.mock_interviews import rubric
from linkresume.application.mock_interviews.outputs import QuestionEvaluation, SignalJudgement
from linkresume.modules.mock_interviews.models import MockInterview, MockInterviewQuestion


def _root_id(question: MockInterviewQuestion) -> int:
    return question.parent_id or question.id


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).casefold()


def quoted_in(evidence: str, answers: str) -> bool:
    """True when ``evidence`` is a verbatim (whitespace/case-insensitive) excerpt of ``answers``."""
    return bool(evidence) and _normalize(evidence) in _normalize(answers)


def score_root(
    interview: MockInterview,
    item: dict[str, Any],
    root: MockInterviewQuestion,
    questions: list[MockInterviewQuestion],
    value: QuestionEvaluation | None,
) -> dict[str, object]:
    """Deterministic score for one main question from the model's judgements."""
    signals = list(item.get("expected_signals") or [])
    if value is None:
        verdicts: list[dict[str, object]] = [
            {"signal": signal, "verdict": "miss", "evidence": ""} for signal in signals
        ]
        return {
            "skipped": True,
            "score": 0.0,
            "achieved_depth": 0,
            "signals": verdicts,
            "factual_errors": [],
            "highlights": [],
            "weaknesses": [],
            "reference_answer": "",
        }
    answers = " ".join(q.answer_text or "" for q in questions if _root_id(q) == root.id)
    verdicts = _align_signals(signals, value, answers)
    # 没有候选人原话支撑的"事实错误"可能是模型臆断，不扣分也不展示。
    errors = [error.description for error in value.factual_errors if quoted_in(error.evidence, answers)]
    score = rubric.question_score(
        signal_verdicts=[str(v["verdict"]) for v in verdicts],
        achieved_depth=value.achieved_depth,
        difficulty=interview.difficulty,
        factual_errors=len(errors),
        skipped=False,
        interview_type=interview.interview_type,
    )
    return {
        "skipped": False,
        "score": score,
        "achieved_depth": value.achieved_depth,
        "signals": verdicts,
        "factual_errors": errors,
        "highlights": value.highlights,
        "weaknesses": value.weaknesses,
        "reference_answer": value.reference_answer,
    }


def _align_signals(
    signals: list[str], value: QuestionEvaluation, answers: str
) -> list[dict[str, object]]:
    """Map judgements onto the planned signals; unquoted judgements count as a miss.

    Order of preference: explicit index, exact name, then positional fill for
    judgements that carry neither (legacy outputs). A judgement that names a
    valid index is never reused for another signal.
    """
    remaining = list(value.signals)
    matched: dict[int, SignalJudgement] = {}
    for item in list(remaining):
        if item.index is not None and 0 <= item.index < len(signals) and item.index not in matched:
            matched[item.index] = item
            remaining.remove(item)
    for index, signal in enumerate(signals):
        if index in matched:
            continue
        hit = next(
            (item for item in remaining if item.index is None and _normalize(item.signal) == _normalize(signal)),
            None,
        )
        if hit is not None:
            matched[index] = hit
            remaining.remove(hit)
    positional = [item for item in remaining if item.index is None]
    aligned: list[dict[str, object]] = []
    for index, signal in enumerate(signals):
        judgement = matched.get(index)
        if judgement is None and positional:
            judgement = positional.pop(0)
        verdict = judgement.verdict if judgement else "miss"
        evidence = judgement.evidence if judgement else ""
        if verdict != "miss" and not quoted_in(evidence, answers):
            verdict, evidence = "miss", ""
        aligned.append({"signal": signal, "verdict": verdict, "evidence": evidence})
    return aligned


def practice_focus(question_results: list[dict[str, object]], limit: int = 3) -> list[dict[str, object]]:
    """The weakest answered topics, so the report can point at what to practise next."""
    answered = [item for item in question_results if not item.get("skipped")]
    weakest = sorted(answered, key=lambda item: float(item.get("score") or 0))[:limit]
    return [
        {
            "topic": item.get("topic"),
            "sequence_no": item.get("sequence_no"),
            "score": item.get("score"),
            "reason": (item.get("weaknesses") or [""])[0],
        }
        for item in weakest
        if float(item.get("score") or 0) < 70
    ]


def follow_up_grounded(probe_quote: str, answer: str) -> bool:
    """A follow-up must quote what the candidate actually said."""
    return len(_normalize(probe_quote)) >= 4 and quoted_in(probe_quote, answer)
