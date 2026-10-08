"""Deterministic per-question scoring, report metrics and evidence checks for mock interviews."""

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


def _default_competency(item: dict[str, Any], interview_type: str) -> str:
    """Competency for signals planned before v4 tagged them."""
    if item.get("is_intro"):
        return "communication"
    if interview_type == "hr":
        return "motivation"
    if item.get("is_skill_check"):
        return "knowledge"
    if item.get("is_open_design"):
        return "problem_solving"
    if str(item.get("project") or "").strip():
        return "ownership"
    return "knowledge"


def signal_specs(item: dict[str, Any], interview_type: str) -> list[dict[str, Any]]:
    """Planned signals as ``{text, competency, core}`` with 1–3 core signals (BR1)."""
    default = _default_competency(item, interview_type)
    specs: list[dict[str, Any]] = []
    for raw in item.get("expected_signals") or []:
        if isinstance(raw, str):
            raw = {"text": raw}
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        competency = raw.get("competency")
        if competency not in rubric.SIGNAL_COMPETENCIES:
            competency = default
        specs.append({"text": text, "competency": competency, "core": bool(raw.get("core"))})
    cores = [index for index, spec in enumerate(specs) if spec["core"]]
    if specs and not cores:
        specs[0]["core"] = True
    for index in cores[rubric.MAX_CORE_SIGNALS:]:
        specs[index]["core"] = False
    return specs


def _probed_depth(root: MockInterviewQuestion, questions: list[MockInterviewQuestion]) -> int:
    asked = [q.depth_level for q in questions if _root_id(q) == root.id and q.answer_status == "answered"]
    return max(asked, default=0)


def score_root(
    interview: MockInterview,
    item: dict[str, Any],
    root: MockInterviewQuestion,
    questions: list[MockInterviewQuestion],
    value: QuestionEvaluation | None,
) -> dict[str, object]:
    """Deterministic score for one main question from the model's judgements (BR1–BR5)."""
    specs = signal_specs(item, interview.interview_type)
    if value is None:
        return {
            "skipped": True,
            "score": 0.0,
            "signals": [{"signal": s["text"], "competency": s["competency"], "core": s["core"],
                         "verdict": "miss", "evidence": ""} for s in specs],
            "expression": None,
            "achieved_depth": 0,
            "probed_depth": 0,
            "depth_status": "not_scored",
            "factual_errors": [],
            "highlights": [],
            "weaknesses": [],
            "reference_answer": "",
        }
    answers = " ".join(q.answer_text or "" for q in questions if _root_id(q) == root.id)
    aligned = _align_signals([s["text"] for s in specs], value, answers)
    signals = [{**entry, "competency": spec["competency"], "core": spec["core"]} for entry, spec in zip(aligned, specs, strict=True)]
    expression_verdict = value.expression.verdict
    expression_evidence = value.expression.evidence
    if expression_verdict != "miss" and not quoted_in(expression_evidence, answers):
        expression_verdict, expression_evidence = "miss", ""
    # 没有候选人原话支撑的"事实错误"可能是模型臆断，不扣分也不展示。
    errors = [
        {"description": error.description, "severity": error.severity}
        for error in value.factual_errors
        if quoted_in(error.evidence, answers)
    ]
    # 自我介绍与 HR 面没有技术深度要求。
    depth_scored = interview.interview_type in rubric.DEPTH_SCORED_TYPES and not item.get("is_intro")
    probed = _probed_depth(root, questions)
    factor, status = rubric.depth_outcome(
        difficulty=interview.difficulty,
        probed_depth=probed,
        achieved_depth=value.achieved_depth,
        depth_scored=depth_scored,
    )
    score = rubric.question_score(
        signals=[(bool(s["core"]), str(s["verdict"])) for s in signals] + [(False, expression_verdict)],
        depth_factor=factor,
        error_severities=[str(e["severity"]) for e in errors],
        skipped=False,
    )
    return {
        "skipped": False,
        "score": score,
        "signals": signals,
        "expression": {"verdict": expression_verdict, "evidence": expression_evidence, "note": value.expression.note},
        "achieved_depth": value.achieved_depth,
        "probed_depth": probed,
        "depth_status": status,
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


def _competency_evidence(question_results: list[dict[str, Any]]) -> dict[str, list[tuple[bool, str, int]]]:
    """``(core, verdict, sequence_no)`` per competency from answered questions, intro included."""
    pool: dict[str, list[tuple[bool, str, int]]] = {key: [] for key in rubric.SIGNAL_COMPETENCIES}
    for item in question_results:
        if item.get("skipped"):
            continue
        sequence_no = int(item["sequence_no"])
        for signal in item.get("signals") or []:
            pool.setdefault(str(signal["competency"]), []).append((bool(signal["core"]), str(signal["verdict"]), sequence_no))
        expression = item.get("expression")
        if expression:
            pool["communication"].append((False, str(expression["verdict"]), sequence_no))
    return pool


def _competencies(
    question_results: list[dict[str, Any]], *, has_job: bool, delivery: float | None
) -> list[dict[str, object]]:
    pool = _competency_evidence(question_results)
    all_weight = sum(rubric.signal_weight(core) for entries in pool.values() for core, _, _ in entries)
    result: list[dict[str, object]] = []
    for key in rubric.SIGNAL_COMPETENCIES:
        entries = pool.get(key) or []
        if not entries:
            continue
        weight = sum(rubric.signal_weight(core) for core, _, _ in entries)
        assessed = weight >= rubric.MIN_COMPETENCY_WEIGHT
        score: float | None = None
        if assessed:
            score = rubric.weighted_points([(core, verdict) for core, verdict, _ in entries]) * 100
            if key == "communication" and delivery is not None:
                share = rubric.VOICE_DELIVERY_SHARE
                score = score * (1 - share) + delivery * 100 * share
            score = round(score, 1)
        result.append({
            "key": key,
            "assessed": assessed,
            "score": score,
            "level": rubric.competency_level(score),
            "weight": round(weight / all_weight, 4) if all_weight else 0.0,
            "question_refs": sorted({seq for _, _, seq in entries}),
            "comment": "",
        })
    if has_job:
        job_questions = [
            item for item in question_results
            if item.get("anchor_kind") == "job" and not item.get("is_intro") and not item.get("skipped")
        ]
        score = round(sum(float(item["score"]) for item in job_questions) / len(job_questions), 1) if job_questions else None
        result.append({
            "key": "job_fit",
            "assessed": score is not None,
            "score": score,
            "level": rubric.competency_level(score),
            "weight": 0.0,
            "question_refs": [int(item["sequence_no"]) for item in job_questions],
            "comment": "",
        })
    return result


RISK_TEXT = {
    "zh": {
        "low_question": "Q{number} 得分 {score}",
        "major_error": "Q{number} 出现严重事实错误",
        "material_conflict": "回答与参考资料冲突：{claim}",
        "skipped_core": "Q{number} 未作答",
        "insufficient": "作答的主问题少于 2 道，无法判断",
        "score": "总分 {score}",
        "core": "核心要点命中率 {rate}%",
        "flags": "{count} 处风险信号",
    },
    "en": {
        "low_question": "Q{number} scored {score}",
        "major_error": "Q{number} contains a major factual error",
        "material_conflict": "Answer conflicts with materials: {claim}",
        "skipped_core": "Q{number} was skipped",
        "insufficient": "Fewer than 2 main questions answered",
        "score": "Total {score}",
        "core": "Core point hit rate {rate}%",
        "flags": "{count} risk flag(s)",
    },
}


def report_metrics(
    *,
    difficulty: str,
    language: str,
    has_job: bool,
    question_results: list[dict[str, Any]],
    fact_items: list[dict[str, Any]],
    voice_metrics: dict[str, Any] | None,
) -> dict[str, Any]:
    """Every number in a v4 report, derived only from per-question results (BR5–BR10).

    Pure: the first evaluation and single-question re-evaluation both call it.
    """
    text = RISK_TEXT.get(language, RISK_TEXT["zh"])
    scored = [item for item in question_results if not item.get("is_intro")]
    answered = [item for item in scored if not item.get("skipped")]
    total = rubric.total_score([float(item["score"]) for item in scored])
    delivery = rubric.voice_delivery(voice_metrics)
    flags: list[dict[str, object]] = []
    for item in scored:
        number = item.get("number")
        if item.get("skipped"):
            flags.append({"kind": "skipped_core", "sequence_no": item["sequence_no"],
                          "text": text["skipped_core"].format(number=number)})
            continue
        if float(item["score"]) < rubric.LOW_QUESTION_SCORE:
            flags.append({"kind": "low_question", "sequence_no": item["sequence_no"],
                          "text": text["low_question"].format(number=number, score=round(float(item["score"])))})
        if any(error.get("severity") == "major" for error in item.get("factual_errors") or []):
            flags.append({"kind": "major_error", "sequence_no": item["sequence_no"],
                          "text": text["major_error"].format(number=number)})
    for fact in fact_items:
        if fact.get("verdict") == "conflict":
            flags.append({"kind": "material_conflict", "sequence_no": fact.get("root_sequence_no"),
                          "text": text["material_conflict"].format(claim=str(fact.get("claim") or "")[:60])})
    core = [(True, str(s["verdict"])) for item in answered for s in item.get("signals") or [] if s.get("core")]
    core_hit_rate = round(rubric.weighted_points(core), 4) if core else 0.0
    level = rubric.verdict_level(answered=len(answered), total=total, risk_flags=len(flags), core_hit_rate=core_hit_rate)
    if level == "insufficient":
        reasons = [text["insufficient"]]
    else:
        reasons = [
            text["score"].format(score=round(total)),
            text["core"].format(rate=round(core_hit_rate * 100)),
            text["flags"].format(count=len(flags)),
        ]
    return {
        "total_score": total,
        "verdict": {
            "level": level,
            "target": difficulty,
            "core_hit_rate": core_hit_rate,
            "risk_flags": flags,
            "reasons": reasons,
        },
        "dimensions": _competencies(question_results, has_job=has_job, delivery=delivery),
        "voice_delivery": delivery,
        "low_confidence": rubric.low_confidence(answered=len(answered), total=len(scored)),
    }


def normalize_actions(
    actions: list[Any],
    *,
    question_results: list[dict[str, Any]],
    row_to_root: dict[int, int],
    competency_keys: set[str],
    resume_text: str,
) -> list[dict[str, Any]]:
    """Validate model-written actions (BR11): real question refs, real resume quotes, stable order."""
    scores = {int(item["sequence_no"]): float(item["score"]) for item in question_results}
    result: list[dict[str, Any]] = []
    for action in actions:
        refs: list[int] = []
        for ref in action.question_refs:
            root = row_to_root.get(int(ref), int(ref))
            if root in scores and root not in refs:
                refs.append(root)
        kind = action.kind
        quote = action.resume_quote.strip()
        if kind == "resume" and not quoted_in(quote, resume_text):
            kind, quote = "practice", ""
        if kind != "resume":
            quote = ""
        result.append({
            "title": action.title,
            "detail": action.detail,
            "priority": action.priority,
            "kind": kind,
            "question_refs": refs,
            "competency": action.competency if action.competency in competency_keys else None,
            "resume_quote": quote or None,
        })
    return sorted(
        result,
        key=lambda item: (
            0 if item["priority"] == "high" else 1,
            min((scores[ref] for ref in item["question_refs"]), default=101.0),
        ),
    )


def follow_up_grounded(probe_quote: str, answer: str, probe_gap: str = "") -> bool:
    """A follow-up must quote a substantive stretch of what the candidate said and name what is missing."""
    return len(_normalize(probe_quote)) >= 6 and bool(probe_gap.strip()) and quoted_in(probe_quote, answer)
