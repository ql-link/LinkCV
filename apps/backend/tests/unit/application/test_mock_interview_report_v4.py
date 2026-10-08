from __future__ import annotations

import pytest

from linkresume.application.mock_interviews.outputs import ActionItem
from linkresume.application.mock_interviews.scoring import normalize_actions, report_metrics


def _question(sequence_no, number, score, *, signals=(), expression="hit", intro=False, skipped=False,
              anchor_kind="resume", errors=()):
    return {
        "sequence_no": sequence_no,
        "number": number,
        "topic": f"题目 {number}",
        "is_intro": intro,
        "anchor_kind": anchor_kind,
        "skipped": skipped,
        "score": score,
        "signals": [
            {"signal": f"s{i}", "competency": competency, "core": core, "verdict": verdict, "evidence": ""}
            for i, (competency, core, verdict) in enumerate(signals)
        ],
        "expression": None if skipped else {"verdict": expression, "evidence": "", "note": ""},
        "factual_errors": [{"description": "x", "severity": item} for item in errors],
    }


def _metrics(questions, **kwargs):
    defaults = dict(difficulty="intermediate", language="zh", has_job=False, fact_items=[], voice_metrics=None)
    defaults.update(kwargs)
    return report_metrics(question_results=questions, **defaults)


STRONG = (("knowledge", True, "hit"), ("problem_solving", False, "hit"), ("knowledge", False, "partial"))


def test_total_excludes_intro_and_counts_skipped_as_zero() -> None:
    questions = [
        _question(1, 1, 100, signals=(("communication", True, "hit"),), intro=True),
        _question(2, 2, 90, signals=STRONG),
        _question(5, 3, 0, signals=STRONG, skipped=True),
    ]
    metrics = _metrics(questions)
    assert metrics["total_score"] == 45.0
    flags = metrics["verdict"]["risk_flags"]
    assert [(f["kind"], f["sequence_no"]) for f in flags] == [("skipped_core", 5)]
    assert flags[0]["text"] == "Q3 未作答"
    # one answered main question -> no verdict, low confidence
    assert metrics["verdict"]["level"] == "insufficient"
    assert metrics["low_confidence"] is True


def test_meets_requires_score_no_flags_and_core_hits() -> None:
    questions = [_question(i, i, 85, signals=STRONG) for i in (1, 2, 3)]
    metrics = _metrics(questions)
    assert metrics["verdict"]["level"] == "meets"
    assert metrics["verdict"]["core_hit_rate"] == 1.0
    assert metrics["verdict"]["target"] == "intermediate"


def test_risk_flags_from_low_scores_major_errors_and_material_conflicts() -> None:
    questions = [
        _question(1, 1, 90, signals=STRONG),
        _question(3, 2, 35, signals=STRONG),
        _question(6, 3, 88, signals=STRONG, errors=("major",)),
    ]
    facts = [{"verdict": "conflict", "claim": "QPS 提升到 3 万", "root_sequence_no": 1},
             {"verdict": "not_found", "claim": "无关", "root_sequence_no": 1}]
    metrics = _metrics(questions, fact_items=facts)
    kinds = [f["kind"] for f in metrics["verdict"]["risk_flags"]]
    assert kinds == ["low_question", "major_error", "material_conflict"]
    assert metrics["verdict"]["level"] == "below"


def test_competencies_regroup_evidence_and_mark_thin_evidence_unassessed() -> None:
    questions = [
        _question(1, 1, 80, signals=(("knowledge", True, "hit"), ("problem_solving", False, "miss"))),
        _question(2, 2, 60, signals=(("knowledge", True, "partial"),), expression="partial"),
    ]
    dims = {d["key"]: d for d in _metrics(questions)["dimensions"]}
    # knowledge: 2×1 + 2×0.5 over 4
    assert dims["knowledge"]["score"] == 75.0 and dims["knowledge"]["level"] == "strong"
    assert dims["knowledge"]["question_refs"] == [1, 2]
    # problem_solving has weight 1 < 3 -> not assessed
    assert dims["problem_solving"]["assessed"] is False and dims["problem_solving"]["score"] is None
    # communication: two expression bonus signals -> weight 2 < 3
    assert dims["communication"]["assessed"] is False
    assert "job_fit" not in dims
    assert sum(d["weight"] for d in dims.values()) == pytest.approx(1.0, abs=1e-3)


def test_job_fit_uses_job_anchored_questions_and_voice_delivery_feeds_communication() -> None:
    questions = [
        _question(1, 1, 80, signals=STRONG, anchor_kind="job"),
        _question(2, 2, 60, signals=STRONG),
        _question(3, 3, 40, signals=STRONG, anchor_kind="job"),
    ]
    reference = {"chars_per_minute": [180, 260], "long_pauses": [0, 2], "filler_ratio": [0.0, 0.03]}
    voice = {"chars_per_minute": 400, "long_pauses": 9, "filler_ratio": 0.5, "reference": reference}
    metrics = _metrics(questions, has_job=True, voice_metrics=voice)
    dims = {d["key"]: d for d in metrics["dimensions"]}
    assert dims["job_fit"]["score"] == 60.0 and dims["job_fit"]["question_refs"] == [1, 3]
    # three expression hits -> 100, delivery 0 -> 100 × 0.8
    assert metrics["voice_delivery"] == 0.0
    assert dims["communication"]["score"] == 80.0


def test_job_fit_without_job_anchored_questions_is_unassessed() -> None:
    metrics = _metrics([_question(1, 1, 80, signals=STRONG)], has_job=True)
    job = next(d for d in metrics["dimensions"] if d["key"] == "job_fit")
    assert job["assessed"] is False and job["score"] is None


def test_actions_drop_unknown_refs_map_follow_ups_and_require_real_resume_quotes() -> None:
    questions = [_question(1, 1, 90, signals=STRONG), _question(4, 2, 30, signals=STRONG)]
    actions = [
        ActionItem(title="练习", priority="normal", question_refs=[1, 99]),
        ActionItem(title="改简历", priority="high", kind="resume", resume_quote="编造的原句", question_refs=[5]),
        ActionItem(title="真改简历", priority="high", kind="resume", resume_quote="主导订单系统重构",
                   question_refs=[1], competency="ownership"),
        ActionItem(title="提示", competency="not_a_key"),
    ]
    result = normalize_actions(
        actions,
        question_results=questions,
        row_to_root={1: 1, 4: 4, 5: 4},
        competency_keys={"ownership", "knowledge"},
        resume_text="2023 年 主导订单系统重构，QPS 提升",
    )
    titles = [item["title"] for item in result]
    # high first; within a priority, the lowest referenced score first
    assert titles == ["改简历", "真改简历", "练习", "提示"]
    by_title = {item["title"]: item for item in result}
    assert by_title["改简历"]["kind"] == "practice" and by_title["改简历"]["resume_quote"] is None
    assert by_title["改简历"]["question_refs"] == [4]
    assert by_title["真改简历"]["kind"] == "resume" and by_title["真改简历"]["competency"] == "ownership"
    assert by_title["练习"]["question_refs"] == [1]
    assert by_title["提示"]["competency"] is None
