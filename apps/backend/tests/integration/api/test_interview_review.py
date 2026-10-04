from __future__ import annotations

import json
import time
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.modules.interviews.models import InterviewSession
from linkresume.modules.llm.gateway import GatewayResult
from linkresume.modules.llm.models import LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute
from linkresume.modules.llm.resolver import MOCK_INTERVIEW, validation_fingerprint
from tests.integration.api.test_interview_prep import USAGE, build_app, create_session
from tests.integration.api.test_interviews import register

Q1 = "请介绍一下你负责的缓存改造项目"
A1 = "我负责示例系统的缓存改造，先测量热点再分层缓存，接口延迟下降了一半"
Q2 = "如果缓存和数据库不一致怎么办"
A2 = "我会先更新数据库再删除缓存，并用消息队列补偿删除失败"
Q3 = "你为什么想加入我们团队"
A3 = "我想做更大规模的后端系统，这和岗位方向一致"
TEXT = "\n\n".join([
    f"面试官：{Q1}？", f"我：{A1}。", f"面试官：{Q2}？", f"我：{A2}。",
    f"面试官：{Q3}？", f"我：{A3}。", "面试官：我们团队后续还有一轮，你什么时候可以到岗？",
    "我：一个月内可以到岗。", "面试官：好的，接下来我介绍一下团队和后续流程。",
])


def extraction(**overrides):
    body = {
        "questions": [
            {"question": Q1, "answer": A1, "category": "project", "answer_status": "answered", "follow_ups": 1},
            {"question": Q2, "answer": A2, "category": "technical", "answer_status": "answered", "follow_ups": 0},
            {"question": Q3, "answer": A3, "category": "hr", "answer_status": "answered", "follow_ups": 0},
        ],
        "interviewer_signals": [
            {"polarity": "positive", "quote": "你什么时候可以到岗", "meaning": "询问到岗时间"},
            {"polarity": "positive", "quote": "接下来我介绍一下团队和后续流程", "meaning": "介绍后续流程"},
            {"polarity": "negative", "quote": "编造的面试官原话", "meaning": "不存在"},
        ],
    }
    body.update(overrides)
    return body


RUBRIC = {"items": [
    {"index": 1, "expected_signals": ["说明背景", "说明个人动作", "给出量化结果"]},
    {"index": 2, "expected_signals": ["说明更新顺序", "说明失败补偿"]},
    {"index": 3, "expected_signals": ["动机与岗位一致"]},
]}


def judge(quotes: list[str | None], verdicts: list[str], depth: int = 3):
    return {
        "signals": [{"signal": f"要点{i}", "verdict": v, "quote": q} for i, (v, q) in enumerate(zip(verdicts, quotes, strict=True))],
        "achieved_depth": depth, "factual_errors": [], "resume_conflict": None,
        "strength": "回答结构清楚", "improvement": "补充量化数据", "suggested_answer": "先给结论，再补充实际数据，需要补充。",
    }


def overall(evidence: str = A1):
    rating = {"score": 4, "evidence": evidence, "comment": "表达清楚"}
    return {
        "professional_depth": rating, "motivation_fit": None, "structure": rating, "job_fit": rating,
        "resume_consistency": rating, "communication": rating,
        "headline": "项目讲得清楚，一致性方案需要更完整", "summary": "整体表现良好。",
        "improvements": [
            {"title": "补充失败补偿细节", "detail": "说明补偿重试与对账。", "dimension": "professional_depth", "question_indexes": [2]},
            {"title": "量化项目收益", "detail": "补充上线前后的数据。", "dimension": "structure", "question_indexes": [1]},
        ],
    }


class ReviewGateway:
    """Answers each review step by its system prompt, so call order does not matter."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.user_messages: list[str] = []
        self.replies: dict[str, list[object]] = {"extract": [], "rubric": [], "judge": [], "overall": []}

    def queue(self, step: str, *bodies: object) -> None:
        self.replies[step].extend(bodies)

    async def complete(self, *, model, messages, api_base, api_key) -> GatewayResult:
        del model, api_base, api_key
        system = "\n".join(m.content for m in messages if m.role == "system" and isinstance(m.content, str))
        step = (
            "extract" if "整理一场真实面试" in system
            else "rubric" if "制定评分要点" in system
            else "judge" if "评估真实面试中的一道题" in system
            else "overall"
        )
        self.calls.append(step)
        self.user_messages.append("\n".join(m.content for m in messages if m.role == "user" and isinstance(m.content, str)))
        body = self.replies[step].pop(0) if self.replies[step] else "not json"
        return GatewayResult(content=body if isinstance(body, str) else json.dumps(body, ensure_ascii=False), usage=USAGE)


def setup_app(tmp_path, *, configure=True):
    gateway = ReviewGateway()
    app = build_app(f"sqlite+pysqlite:///{tmp_path / 'review.db'}", gateway, configure=configure)
    if configure:
        with app.state.session_factory() as db:
            binding = db.scalar(select(LLMUseCaseRoute))
            binding.use_case = MOCK_INTERVIEW
            route = db.get(LLMModelRoute, binding.route_id)
            binding.validated_fingerprint = validation_fingerprint(binding, route, db.get(LLMProviderConnection, route.connection_id))
            db.commit()
    return app, gateway


def happy_path(gateway: ReviewGateway) -> None:
    gateway.queue("extract", extraction())
    gateway.queue("rubric", RUBRIC)
    gateway.queue(
        "judge",
        judge([A1, "编造的原句", None], ["hit", "hit", "miss"]),
        judge(["先更新数据库再删除缓存", None], ["hit", "miss"], depth=2),
        judge([A3], ["hit"]),
    )
    gateway.queue("overall", overall())


def completed(client, text=TEXT):
    session = create_session(client)
    response = client.post(f'/api/interview-sessions/{session["id"]}/complete', json={
        "base_lock_version": session["lock_version"], "questions_markdown": text, "review_summary": "手写总结保留"})
    assert response.status_code == 200, response.text
    return response.json()["session"]


def generate(client, session, request_id=None):
    return client.post(f'/api/interview-sessions/{session["id"]}/review:generate', json={
        "base_lock_version": session["lock_version"], "request_id": request_id or str(uuid4())})


def wait_review(client, session_id, timeout=10.0):
    deadline = time.monotonic() + timeout
    while True:
        body = client.get(f"/api/interview-sessions/{session_id}").json()["session"]
        if body["review_status"] != "generating" or time.monotonic() > deadline:
            return body
        time.sleep(0.05)


def test_review_v2_scores_from_verified_quotes_and_runs_in_background(tmp_path):
    app, gateway = setup_app(tmp_path)
    happy_path(gateway)
    with TestClient(app) as client:
        register(client, "review-v2@example.com")
        session = completed(client)
        request_id = str(uuid4())
        accepted = generate(client, session, request_id)
        assert accepted.status_code == 202, accepted.text
        assert accepted.json()["session"]["review_status"] in {"generating", "ready"}
        result = wait_review(client, session["id"])
        assert result["review_status"] == "ready", result["review_error"]
        report = result["review_report"]
        assert report["schema_version"] == 2
        assert gateway.calls.count("judge") == 3 and gateway.calls[0] == "extract"

        # The rubric call never sees any answer.
        rubric_message = gateway.user_messages[gateway.calls.index("rubric")]
        assert A1 not in rubric_message and Q1 in rubric_message

        q1, q2, q3 = report["questions"]
        # Q1: hit, unverifiable hit → partial, miss; depth 3 meets expected L3.
        assert [s["verdict"] for s in q1["signals"]] == ["hit", "partial", "miss"]
        assert q1["score"] == 50.0
        # Q2: hit + miss, achieved L2 vs expected L3 → 0.5 × 0.85 × 100.
        assert q2["score"] == 42.5
        assert q3["score"] == 100.0
        assert q1["key"] != q2["key"] and len(q1["key"]) == 64

        assert report["first_axis"] == "professional_depth"
        dims = {d["key"]: d for d in report["dimensions"]}
        assert dims["resume_consistency"]["assessed"] is False and dims["resume_consistency"]["weight"] == 0
        assert dims["structure"]["assessed"] is True
        assert abs(sum(d["weight"] for d in report["dimensions"]) - 1) < 0.01
        expected_total = round((50.0 + 42.5 + 100.0) / 3 * 0.7 + 80.0 * 0.3, 1)
        assert report["total_score"] == expected_total
        assert report["verdict"]["signals"] and len(report["verdict"]["signals"]) == 2
        assert report["verdict"]["adjusted_by_signals"] == 1
        assert report["basis"]["downgraded_quotes"] >= 2
        assert report["basis"]["resume_title"] is None and report["basis"]["has_job"] is True
        assert report["improvements"][0]["priority"] == "key"
        assert result["questions_markdown"] == TEXT and result["review_summary"] == "手写总结保留"
        assert not result["review_stale"]

        again = generate(client, result, request_id)
        assert again.status_code == 202
        assert gateway.calls.count("extract") == 1


def test_paraphrased_questions_are_dropped_and_no_questions_fails_keeping_previous_report(tmp_path):
    app, gateway = setup_app(tmp_path)
    happy_path(gateway)
    with TestClient(app) as client:
        register(client, "review-v2-drop@example.com")
        session = completed(client)
        generate(client, session)
        first = wait_review(client, session["id"])
        assert first["review_status"] == "ready"
        gateway.queue("extract", extraction(questions=[
            {"question": "被改写过的问题", "answer": None, "category": "technical", "answer_status": "missing", "follow_ups": 0},
        ]))
        generate(client, first)
        failed = wait_review(client, session["id"])
        assert failed["review_status"] == "failed"
        assert failed["review_error"] == "INTERVIEW_REVIEW_NO_QUESTIONS"
        assert failed["review_report"]["total_score"] == first["review_report"]["total_score"]


def test_missing_model_fails_in_background_without_losing_text(tmp_path):
    app, gateway = setup_app(tmp_path, configure=False)
    with TestClient(app) as client:
        register(client, "review-unconfigured@example.com")
        session = completed(client)
        assert generate(client, session).status_code == 202
        result = wait_review(client, session["id"])
        assert result["review_status"] == "failed" and result["review_report"] is None or result["review_report"].get("schema_version") is None
        assert result["review_error"] == "LLM_MODEL_NOT_CONFIGURED"
        assert result["questions_markdown"] == TEXT
        assert gateway.calls == []


def test_review_owner_state_and_lock_are_checked_before_model(tmp_path):
    app, gateway = setup_app(tmp_path)
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "review-a@example.com")
        register(other, "review-b@example.com")
        scheduled = create_session(owner)
        assert generate(owner, scheduled).status_code == 409
        session = completed(owner)
        assert generate(other, session).status_code == 404
        assert generate(owner, {**session, "lock_version": session["lock_version"] - 1}).status_code == 409
        changed = owner.put(f'/api/interview-sessions/{session["id"]}', json={
            "base_lock_version": session["lock_version"], "questions_markdown": None})
        assert generate(owner, changed.json()["session"]).status_code == 400
        assert gateway.calls == []


def test_interrupted_generation_is_reported_on_retry_and_legacy_reports_still_read(tmp_path):
    app, gateway = setup_app(tmp_path)
    with TestClient(app) as client:
        register(client, "review-legacy@example.com")
        session = completed(client)
        legacy = {
            "schema_version": 1, "summary": "旧版总结", "source_hash": "0" * 64, "overall_score": 7,
            "generated_at": "2026-09-01T00:00:00Z",
            "project_expression": {"score": 7, "reason": "理由", "evidence": None},
            "system_design": {"score": 7, "reason": "理由", "evidence": None},
            "communication": {"score": 7, "reason": "理由", "evidence": None},
            "questions": [],
        }
        request_id = str(uuid4())
        from linkresume.application.interviews.review_service import source_hash
        with app.state.session_factory() as db:
            row = db.get(InterviewSession, int(session["id"]))
            row.review_report = {**legacy, "request_source_hash": source_hash(TEXT)}
            row.review_request_id = request_id
            row.review_status = "generating"
            row.review_started_at = row.review_heartbeat_at = None
            db.commit()
        detail = client.get(f'/api/interview-sessions/{session["id"]}').json()["session"]
        assert detail["review_report"]["schema_version"] == 1
        assert detail["review_report"]["overall_score"] == 7
        retried = generate(client, detail, request_id)
        assert retried.status_code == 502
        assert retried.json()["error"] == "INTERVIEW_REVIEW_INTERRUPTED"
