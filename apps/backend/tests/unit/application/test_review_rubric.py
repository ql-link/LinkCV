import pytest

from drawoffer.application.interviews import review_rubric as rubric


def test_technical_session_keeps_professional_depth_and_hr_questions_do_not_feed_it():
    axis, weights = rubric.mixed_weights(["technical", "technical", "technical", "hr"], set())
    assert axis == "professional_depth"
    # 3/4 technical rows + 1/4 hr row with its first column zeroed, renormalized.
    raw = {
        "professional_depth": 0.35 * 0.75,
        "structure": 0.20 * 0.75 + 0.20 * 0.25,
        "job_fit": 0.20 * 0.75 + 0.25 * 0.25,
        "resume_consistency": 0.10 * 0.75 + 0.05 * 0.25,
        "communication": 0.15 * 0.75 + 0.20 * 0.25,
    }
    total = sum(raw.values())
    assert weights == {key: round(value / total, 4) for key, value in raw.items()}
    assert sum(weights.values()) == pytest.approx(1, abs=1e-3)


def test_people_heavy_session_switches_the_first_axis_to_motivation():
    axis, weights = rubric.mixed_weights(["hr", "behavioral", "hr", "technical", "behavioral"], set())
    assert axis == "motivation_fit"
    assert "professional_depth" not in weights
    assert weights["motivation_fit"] > 0


def test_missing_material_drops_dimensions_instead_of_scoring_them_low():
    _, weights = rubric.mixed_weights(["technical"], {"job_fit", "resume_consistency"})
    assert weights["job_fit"] == 0 and weights["resume_consistency"] == 0
    assert sum(weights.values()) == pytest.approx(1, abs=1e-3)
    assert rubric.dimension_score({"structure": 5}, weights) == pytest.approx(100.0)


@pytest.mark.parametrize(("title", "requirement", "expected"), [
    ("高级后端开发工程师", None, 4),
    ("Senior Backend Engineer", "1 年", 4),
    ("后端开发", "1-2 年经验", 2),
    ("后端开发", "3-5年", 3),
    ("后端开发", "8 years", 4),
    ("后端开发", None, 3),
])
def test_expected_depth_follows_the_job(title, requirement, expected):
    assert rubric.expected_depth(title, requirement) == expected


def test_question_score_formula_and_unassessable_answers():
    assert rubric.question_score(verdicts=["hit", "partial", "miss", "hit"], achieved_depth=2, expected=3,
                                 factual_errors=1, answer_status="answered") == pytest.approx(43.1, abs=0.1)
    assert rubric.question_score(verdicts=["hit"], achieved_depth=5, expected=3, factual_errors=0,
                                 answer_status="answered") == 100.0
    assert rubric.question_score(verdicts=["hit"], achieved_depth=0, expected=3, factual_errors=9,
                                 answer_status="answered") == 0.0
    assert rubric.question_score(verdicts=[], achieved_depth=0, expected=3, factual_errors=0,
                                 answer_status="declined") == 0.0
    assert rubric.question_score(verdicts=["hit"], achieved_depth=3, expected=3, factual_errors=0,
                                 answer_status="missing") is None


def test_total_and_grade_bands():
    assert rubric.total_score([80, 90], 50.0) == pytest.approx(74.5)
    assert rubric.total_score([], 50.0) is None
    assert rubric.total_score([70], None) == 70.0
    assert [rubric.grade(value) for value in (85, 84.9, 70, 60, 59.9, None)] == [
        "excellent", "good", "good", "pass", "improve", None,
    ]


@pytest.mark.parametrize(("total", "fatal", "verdict"), [
    (85, 0, "likely_pass"),
    (85, 1, "promising"),
    (85, 2, "at_risk"),
    (75, 0, "promising"),
    (65, 0, "at_risk"),
    (59, 0, "likely_fail"),
    (59, 3, "likely_fail"),
])
def test_base_verdict_bands(total, fatal, verdict):
    assert rubric.base_verdict(total, fatal) == verdict


def test_interviewer_signals_move_at_most_one_step_and_need_two_agreeing():
    assert rubric.adjust_by_signals("promising", 1, 0) == ("promising", 0)
    assert rubric.adjust_by_signals("promising", 3, 0) == ("likely_pass", 1)
    assert rubric.adjust_by_signals("likely_pass", 3, 0) == ("likely_pass", 0)
    assert rubric.adjust_by_signals("promising", 0, 2) == ("at_risk", -1)
    assert rubric.adjust_by_signals("promising", 2, 2) == ("promising", 0)


def test_fatal_questions_are_low_scores_on_the_main_type_or_resume_conflicts():
    outcomes = [
        rubric.QuestionOutcome("technical", 30, False),
        rubric.QuestionOutcome("technical", 90, False),
        rubric.QuestionOutcome("behavioral", 10, False),
        rubric.QuestionOutcome("behavioral", 95, True),
    ]
    assert rubric.fatal_count(outcomes) == 2


def test_confidence_levels():
    assert rubric.confidence(assessable=2, diarized=True, transcript_chars=9000)[0] == "low"
    assert rubric.confidence(assessable=6, diarized=False, transcript_chars=9000)[0] == "low"
    assert rubric.confidence(assessable=6, diarized=True, transcript_chars=9000) == ("high", None)
    assert rubric.confidence(assessable=4, diarized=True, transcript_chars=9000) == ("medium", None)


def test_quotes_ignore_whitespace_and_punctuation_but_not_wording():
    transcript = rubric.normalize_quote("面试官：你好，请介绍项目。\n我：我负责缓存改造， 先测量再优化。")
    assert rubric.quote_in("我负责缓存改造先测量再优化", transcript)
    assert not rubric.quote_in("我主导了缓存改造", transcript)
    assert not rubric.quote_in("  ", transcript)
