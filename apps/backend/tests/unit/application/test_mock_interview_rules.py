from __future__ import annotations

import pytest

from linkresume.application.mock_interviews import rubric
from linkresume.application.mock_interviews.retrieval import (
    MaterialDocument,
    MaterialRetriever,
    split_chunks,
    tokenize,
)
from linkresume.application.mock_interviews.service import _align_signals, _parse_header, _split_header
from linkresume.application.mock_interviews.outputs import QuestionEvaluation, SignalJudgement


def test_question_score_combines_signals_depth_and_errors() -> None:
    # intermediate expects L3; L2 is one level short -> factor 0.85
    score = rubric.question_score(
        signal_verdicts=["hit", "partial", "miss", "hit"],
        achieved_depth=2,
        difficulty="intermediate",
        factual_errors=1,
        skipped=False,
    )
    assert score == pytest.approx(0.625 * 0.85 * 100 - 10, abs=0.01)


def test_question_score_floor_and_skip() -> None:
    assert rubric.question_score(
        signal_verdicts=["miss"], achieved_depth=0, difficulty="senior", factual_errors=3, skipped=False
    ) == 0.0
    assert rubric.question_score(
        signal_verdicts=["hit"], achieved_depth=5, difficulty="junior", factual_errors=0, skipped=True
    ) == 0.0


def test_depth_meeting_expectation_is_not_penalised() -> None:
    assert rubric.question_score(
        signal_verdicts=["hit", "hit"], achieved_depth=5, difficulty="senior", factual_errors=0, skipped=False
    ) == 100.0


def test_weights_drop_job_fit_without_job_and_hr_has_no_depth() -> None:
    weights = rubric.effective_weights("technical", has_job=False)
    assert weights["job_fit"] == 0
    assert sum(weights.values()) == pytest.approx(1.0, abs=1e-3)
    assert weights["professional_depth"] == pytest.approx(0.35 / 0.8, abs=1e-3)
    assert rubric.effective_weights("hr", has_job=True)["professional_depth"] == 0


def test_every_interview_type_weights_sum_to_one() -> None:
    for weights in rubric.DIMENSION_WEIGHTS.values():
        assert sum(weights.values()) == pytest.approx(1.0, abs=1e-3)


def test_total_score_formula() -> None:
    dimension = rubric.dimension_score(
        {"professional_depth": 4, "structure": 3, "job_fit": 5, "resume_consistency": 4, "communication": 3},
        rubric.effective_weights("technical", has_job=True),
    )
    assert dimension == pytest.approx(75 * 0.35 + 50 * 0.2 + 100 * 0.2 + 75 * 0.15 + 50 * 0.1)
    assert rubric.total_score([80, 60], dimension) == pytest.approx(70 * 0.7 + dimension * 0.3, abs=0.01)


def test_low_confidence_rules() -> None:
    assert rubric.low_confidence(answered=1, total=3)
    assert rubric.low_confidence(answered=2, total=5)
    assert not rubric.low_confidence(answered=3, total=5)


def test_depth_clamping_follows_difficulty() -> None:
    assert rubric.clamp_depth("junior", 5) == 3
    assert rubric.clamp_start_depth("senior", 1) == 3
    assert rubric.clamp_start_depth("intermediate", 5) == 3


def test_tokenize_uses_cjk_bigrams_and_ascii_words() -> None:
    tokens = tokenize("订单系统 QPS 提升")
    assert {"订单", "单系", "系统", "qps", "提升"} <= set(tokens)


def test_retriever_ranks_relevant_chunk_first_and_splits_headings() -> None:
    documents = [
        MaterialDocument(
            dataset_id="1",
            title="项目复盘.md",
            version="content-1",
            markdown="# 背景\n团队建设与周会记录。\n# 性能\n订单系统重构后 QPS 从 2000 提升到 10000。",
        ),
        MaterialDocument(dataset_id="2", title="其他.md", version="content-1", markdown="年会活动安排。"),
    ]
    assert len(split_chunks(documents[0])) == 2
    results = MaterialRetriever(documents).search("订单系统 QPS 提升", limit=3)
    assert results[0].dataset_id == "1"
    assert "10000" in results[0].text
    assert MaterialRetriever([]).empty
    fallback = MaterialRetriever(documents).leading(limit=2)
    assert [item.dataset_id for item in fallback] == ["1", "2"]


def test_header_parsing_accepts_json_first_line_only() -> None:
    first, rest = _split_header('{"action":"follow_up","depth_level":3}\n具体怎么定位的？')
    assert rest == "具体怎么定位的？"
    header = _parse_header(first)
    assert header is not None and header.action == "follow_up" and header.depth_level == 3
    assert _split_header('{"action":"next') is None
    assert _parse_header("不是 JSON") is None


def test_unquoted_judgements_are_downgraded_to_miss() -> None:
    value = QuestionEvaluation(
        signals=[
            SignalJudgement(signal="说出瓶颈定位方法", verdict="hit", evidence="我用火焰图定位了热点"),
            SignalJudgement(signal="有数据验证", verdict="hit", evidence="编造的引用"),
        ],
        achieved_depth=3,
    )
    aligned = _align_signals(["说出瓶颈定位方法", "有数据验证"], value, "当时我用火焰图定位了热点函数")
    assert [item["verdict"] for item in aligned] == ["hit", "miss"]


def test_one_judgement_cannot_score_two_signals() -> None:
    # Only B was judged; A must not borrow B's verdict through the positional fallback.
    value = QuestionEvaluation(
        signals=[SignalJudgement(signal="B", verdict="hit", evidence="火焰图")],
        achieved_depth=3,
    )
    aligned = _align_signals(["A", "B"], value, "我用了火焰图")
    assert [item["verdict"] for item in aligned] == ["miss", "hit"]


def test_renamed_judgements_fill_unmatched_signals_in_order() -> None:
    value = QuestionEvaluation(
        signals=[
            SignalJudgement(signal="改写的 A", verdict="hit", evidence="火焰图"),
            SignalJudgement(signal="改写的 B", verdict="partial", evidence="本地缓存"),
        ],
        achieved_depth=3,
    )
    aligned = _align_signals(["A", "B"], value, "火焰图 本地缓存")
    assert [item["verdict"] for item in aligned] == ["hit", "partial"]


def test_slot_contention_maps_mysql_deadlock_to_conflict() -> None:
    from types import SimpleNamespace

    from sqlalchemy.exc import OperationalError

    from linkresume.application.mock_interviews.service import MockInterviewError, occupy_slot

    class Deadlocked:
        rolled_back = False

        def flush(self):
            raise OperationalError("INSERT", {}, SimpleNamespace(args=(1213, "Deadlock found")))

        def rollback(self):
            self.rolled_back = True

    db = Deadlocked()
    with pytest.raises(MockInterviewError) as caught:
        occupy_slot(db, object())
    assert caught.value.code == "MOCK_INTERVIEW_IN_PROGRESS" and db.rolled_back

    class OtherFailure(Deadlocked):
        def flush(self):
            raise OperationalError("INSERT", {}, SimpleNamespace(args=(2006, "gone away")))

    with pytest.raises(OperationalError):
        occupy_slot(OtherFailure(), object())


def test_hr_interviews_are_not_penalised_for_technical_depth() -> None:
    kwargs = dict(signal_verdicts=["hit", "hit"], achieved_depth=1, difficulty="senior", factual_errors=0, skipped=False)
    assert rubric.question_score(**kwargs, interview_type="hr") == 100.0
    assert rubric.question_score(**kwargs, interview_type="technical") < 100.0


def test_dimension_score_floor_is_zero() -> None:
    weights = {"structure": 1.0}
    assert rubric.dimension_score({"structure": 1}, weights) == 0.0
    assert rubric.dimension_score({"structure": 5}, weights) == 100.0


def test_judgement_index_beats_name_and_is_not_reused() -> None:
    value = QuestionEvaluation(
        signals=[
            SignalJudgement(index=1, signal="随便写的名字", verdict="hit", evidence="火焰图"),
            SignalJudgement(index=0, signal="另一个名字", verdict="partial", evidence="本地缓存"),
        ],
        achieved_depth=3,
    )
    aligned = _align_signals(["A", "B"], value, "火焰图 本地缓存")
    assert [item["verdict"] for item in aligned] == ["partial", "hit"]


def test_unquoted_factual_errors_do_not_cost_points() -> None:
    from types import SimpleNamespace

    from linkresume.application.mock_interviews.outputs import FactualError
    from linkresume.application.mock_interviews.scoring import score_root

    interview = SimpleNamespace(difficulty="junior", interview_type="technical")
    root = SimpleNamespace(id=1, parent_id=None, answer_text="我用了 Redis 做缓存")
    value = QuestionEvaluation(
        signals=[SignalJudgement(index=0, signal="A", verdict="hit", evidence="Redis 做缓存")],
        achieved_depth=2,
        factual_errors=[
            FactualError(description="编造", evidence="根本没说过的话"),
            FactualError(description="有据", evidence="Redis"),
        ],
    )
    result = score_root(interview, {"expected_signals": ["A"]}, root, [root], value)
    assert result["factual_errors"] == ["有据"]
    assert result["score"] == 90.0


def _plan_item(topic: str, **kwargs):
    from linkresume.application.mock_interviews.outputs import PlanItem

    return PlanItem(topic=topic, anchor="a", start_depth=kwargs.pop("start_depth", 2), expected_signals=["x"], **kwargs)


def test_plan_selection_enforces_project_gap_and_design_rules() -> None:
    from linkresume.application.mock_interviews.outputs import InterviewPlan
    from linkresume.application.mock_interviews.planning import select_plan

    plan = InterviewPlan(
        selected=[
            _plan_item("t1", project="P"),
            _plan_item("t2", project="P"),
            _plan_item("t3", project="P"),  # third topic of one project is dropped
            _plan_item("g1", is_gap=True),
            _plan_item("g2", is_gap=True),
            _plan_item("g3", is_gap=True),
        ],
        candidates=[_plan_item("c1"), _plan_item("d1", is_open_design=True)],
    )
    chosen, problems = select_plan(plan, difficulty="intermediate", question_count=5)
    topics = [item.topic for item in chosen]
    assert "t3" not in topics and not problems
    assert sum(item.is_gap for item in chosen) <= 2  # ceil(5 * 0.4)


def test_senior_plan_requires_exactly_one_open_design_and_orders_warm_up_first() -> None:
    from linkresume.application.mock_interviews.outputs import InterviewPlan
    from linkresume.application.mock_interviews.planning import select_plan

    items = [_plan_item(f"t{i}", start_depth=5) for i in range(4)]
    plan = InterviewPlan(selected=items, candidates=[_plan_item("design", is_open_design=True)])
    chosen, problems = select_plan(plan, difficulty="senior", question_count=4)
    assert not problems and sum(item.is_open_design for item in chosen) == 1
    assert all(item.start_depth == 3 for item in chosen)  # clamped into the senior range
    _, missing = select_plan(InterviewPlan(selected=items), difficulty="senior", question_count=4)
    assert missing == ["open_design"]


def test_short_plan_is_reported() -> None:
    from linkresume.application.mock_interviews.outputs import InterviewPlan
    from linkresume.application.mock_interviews.planning import select_plan

    _, problems = select_plan(InterviewPlan(selected=[_plan_item("only")]), difficulty="junior", question_count=3)
    assert "count" in problems


def test_header_split_tolerates_code_fence() -> None:
    first, rest = _split_header('```json\n{"action":"next_question","depth_level":2}\n```\n好的，下一题。')
    assert _parse_header(first) is not None and rest == "好的，下一题。"


def test_follow_up_prompt_carries_next_topic_and_allowed_actions() -> None:
    from types import SimpleNamespace

    from linkresume.application.mock_interviews import prompts

    interview = SimpleNamespace(
        interview_type="technical", difficulty="senior", language="zh", answer_mode="voice",
        resume_markdown_snapshot="r", job_snapshot_json=None, stage_snapshot_json=None, target_role=None,
    )
    messages = prompts.interviewer_messages(
        interview, plan_item={"topic": "当前"}, next_item={"topic": "下一个"}, transcript=[], follow_ups_used=0,
        allow_follow_up=True, is_opening=False, is_last_topic=False, allowed_actions=("follow_up", "next_question"),
    )
    assert "next_topic" in messages[1].content and "下一个" in messages[1].content
    assert "follow_up / next_question" in messages[0].content and "80 字" in messages[0].content


def test_follow_up_must_quote_the_candidate_answer() -> None:
    from linkresume.application.mock_interviews.scoring import follow_up_grounded

    answer = "冻结会把数据复制到独立版本表形成不可变快照"
    assert follow_up_grounded("复制到独立版本表", answer)
    assert not follow_up_grounded("", answer)
    assert not follow_up_grounded("你没说过的话", answer)
    assert not follow_up_grounded("版", answer)  # too short to be evidence


def test_follow_up_prompt_asks_for_probe_and_previous_depth() -> None:
    from types import SimpleNamespace

    from linkresume.application.mock_interviews import prompts

    interview = SimpleNamespace(
        interview_type="technical", difficulty="intermediate", language="zh", answer_mode="text",
        resume_markdown_snapshot="r", job_snapshot_json=None, stage_snapshot_json=None, target_role=None,
    )
    system = prompts.interviewer_messages(
        interview, plan_item={"topic": "当前"}, next_item=None, transcript=[], follow_ups_used=0,
        allow_follow_up=True, is_opening=False, is_last_topic=False, previous_depth=3,
    )[0].content
    assert "probe_quote" in system and "只挑价值最高的一个" in system and "上一问的深度是 L3" in system
