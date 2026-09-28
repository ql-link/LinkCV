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
    assert dimension == pytest.approx(80 * 0.35 + 60 * 0.2 + 100 * 0.2 + 80 * 0.15 + 60 * 0.1)
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
