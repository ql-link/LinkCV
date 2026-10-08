from __future__ import annotations

import asyncio
import json
import time
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.datasets.models import UserDataset
from linkresume.modules.llm.gateway import GatewayResult, GatewayStreamEvent, GatewayUsage
from linkresume.modules.llm.models import (
    LLMCallLog,
    LLMModel,
    LLMModelRoute,
    LLMProviderConnection,
    LLMUseCaseRoute,
)
from linkresume.modules.llm.resolver import MOCK_INTERVIEW, validation_fingerprint
from linkresume.modules.mock_interviews.models import MockInterview, MockInterviewQuestion
from linkresume.modules.product_events.models import ProductEvent
from linkresume.modules.resumes.models import DATASET_SOURCE_TYPE, DocumentParseTask
from tests.fakes import FakeRedis
from tests.integration.api.test_interviews import (
    FakeStorage as InterviewFakeStorage,
    create_pending_application,
    register,
)


class FakeStorage(InterviewFakeStorage):
    def delete_prefix(self, prefix: str) -> None:
        for name in self.list_names(prefix):
            self.delete(name)


def create_resume(client: TestClient, app, title: str | None = None) -> dict[str, object]:
    response = client.post(
        "/api/resumes",
        json={"title": title or f"求职测试简历-{uuid4().hex[:6]}", "template_id": app.state.test_template_id},
    )
    assert response.status_code == 201, response.text
    return response.json()["resume"]

USAGE = GatewayUsage(input_tokens=10, output_tokens=5)
SIGNALS = ["说出瓶颈定位方法", "对比过替代方案", "有数据验证"]


def plan_item(index: int) -> dict[str, object]:
    return {
        "topic": f"考察点{index}",
        "anchor": "负责订单系统重构",
        "anchor_kind": "resume",
        "start_depth": 5,
        "expected_signals": SIGNALS,
        "follow_up_directions": ["具体做法", "为什么"],
    }


class ScriptedGateway:
    """Answers each prompt family with a fixed structured or streamed reply."""

    def __init__(self) -> None:
        self.turn_headers: list[dict[str, object]] = []
        self.fail_evaluation = False
        self.fail_turn = False
        self.systems: list[str] = []
        self.users: list[str] = []

    def _system(self, messages) -> str:
        return "\n".join(m.content for m in messages if m.role == "system" and isinstance(m.content, str))

    async def complete(self, *, model, messages, api_base, api_key, protocol_code="openai_chat") -> GatewayResult:
        del model, api_base, api_key
        system = self._system(messages)
        self.systems.append(system)
        self.users.append("\n".join(str(m.content) for m in messages if m.role == "user"))
        if "正在为一场模拟面试做背景分析" in system:
            payload = {"claims": [{"text": "负责订单系统重构", "verb_strength": "owned"}], "candidate_level": "社招 3 年"}
        elif "刚做完自我介绍" in system:
            payload = {"replacements": []}
        elif "制定面试计划" in system:
            count = int(system.split("恰好 ")[1].split(" ")[0])
            payload = {"candidates": [], "selected": [plan_item(i) for i in range(count)]}
        elif "只评估这一道主问题" in system:
            if self.fail_evaluation:
                return GatewayResult(content="not json", usage=USAGE)
            payload = {
                "signals": [
                    {"signal": SIGNALS[0], "verdict": "hit", "evidence": "用火焰图定位热点"},
                    {"signal": SIGNALS[1], "verdict": "partial", "evidence": "对比过本地缓存"},
                    {"signal": SIGNALS[2], "verdict": "hit", "evidence": "这句话没有出现在回答里"},
                ],
                "expression": {"verdict": "hit", "evidence": "用火焰图定位热点", "note": "结论先行"},
                "achieved_depth": 3,
                "factual_errors": [],
                "highlights": ["定位方法清楚"],
                "weaknesses": ["缺少数据"],
                "reference_answer": "先定位瓶颈再给出方案与验证数据。",
            }
        elif "抽取可以核验" in system:
            payload = {"claims": [{"text": "QPS 从 2000 提升到 10000", "kind": "number", "question_sequence_no": 1}]}
        elif "核验候选人的一条陈述" in system:
            payload = {"verdict": "conflict", "quote": "QPS 从 2000 提升到 5000", "snippet_index": 0, "note": "资料数值更低"}
        elif "结论与行动清单" in system:
            payload = {
                "headline": "基础扎实",
                "summary": "整体表现良好。",
                "strengths": ["定位方法清楚"],
                "competency_notes": [{"key": "knowledge", "comment": "原理讲得清楚"}],
                "actions": [
                    {"title": "练习用数据支撑结论", "priority": "normal", "kind": "practice", "question_refs": [2, 999]},
                    {"title": "补充 QPS 提升的验证方式", "priority": "high", "kind": "resume",
                     "resume_quote": "简历里没有的句子", "question_refs": [2]},
                ],
            }
        else:
            raise AssertionError(system[:200])
        return GatewayResult(content=json.dumps(payload, ensure_ascii=False), usage=USAGE)

    async def start_stream(self, *, model, messages, api_base, api_key, protocol_code="openai_chat"):
        del model, api_base, api_key
        system = self._system(messages)
        self.systems.append(system)
        if self.fail_turn:
            async def broken():
                yield GatewayStreamEvent(type="delta", content='{"action"')
                yield GatewayStreamEvent(type="done", usage=USAGE)

            return broken()
        if self.turn_headers:
            header = self.turn_headers.pop(0)
        else:
            # Default to the move-on action the prompt allows (finish on the last topic).
            header = {"action": "finish" if "finish" in system.split("只能是以下之一：")[-1].split("。")[0] else "next_question", "depth_level": 2}
        text = "好的，请问你是如何定位性能瓶颈的？" if header["action"] != "finish" else "今天的面试到这里，感谢。"

        async def events():
            line = json.dumps(header)
            yield GatewayStreamEvent(type="delta", content=line[:10])
            yield GatewayStreamEvent(type="delta", content=line[10:] + "\n" + text[:4])
            yield GatewayStreamEvent(type="delta", content=text[4:])
            yield GatewayStreamEvent(type="done", usage=USAGE)

        return events()


@pytest.fixture(autouse=True)
def database_dir(tmp_path, monkeypatch):
    # Background preparation/evaluation writes race with request threads. The
    # shared in-memory SQLite connection (StaticPool) lets one thread's rollback
    # discard another's commit, which production pooled connections never do,
    # so every app gets its own file-backed database with per-thread connections.
    monkeypatch.setattr(_database, "directory", tmp_path)


class _Database:
    directory = None

    def url(self) -> str:
        if self.directory is None:
            return "sqlite+pysqlite:///:memory:"
        return f"sqlite+pysqlite:///{self.directory / f'mock-{uuid4().hex}.db'}"


_database = _Database()


def build_app(
    gateway: ScriptedGateway, *, configure: bool = True, storage: FakeStorage | None = None, linkrag=None
):
    app = create_app(
        Settings(
            database_url=_database.url(),
            jwt_secret="integration-test-secret-with-32-bytes",
            llm_credential_encryption_keys=f"test:{Fernet.generate_key().decode('ascii')}",
        ),
        storage=storage or FakeStorage(),
        redis=FakeRedis(),
        llm_gateway=gateway,
        linkrag_client=linkrag,
        create_schema=True,
    )
    with app.state.session_factory() as db:
        from linkresume.modules.resumes.models import ResumeTemplate
        from tests.canonical_resume_fixtures import canonical_template_payload

        data, style = canonical_template_payload(key="mock-interview-test")
        template = ResumeTemplate(
            key="mock-interview-test", name="模拟面试测试模板", description="测试", data_json=data, style_json=style, is_active=1
        )
        db.add(template)
        db.commit()
        app.state.test_template_id = str(template.id)
    if configure:
        configure_mock_interview_model(app)
    return app


def configure_mock_interview_model(app) -> None:
    with app.state.session_factory() as db:
        connection = LLMProviderConnection(
            provider_code="aihubmix",
            name="测试",
            credential_ciphertext=app.state.llm_service.encrypt_credential(json.dumps({"api_key": "fictional-key"})),
            settings_json={},
            is_enabled=True,
            runtime_config_version=1,
        )
        db.add(connection)
        db.flush()
        model = LLMModel(display_name="interview-model")
        db.add(model)
        db.flush()
        route = LLMModelRoute(
            model_id=model.id, connection_id=connection.id, target_kind="model", invoke_target="interview-model",
            origin="manual", is_enabled=True, is_target_available=True,
        )
        db.add(route)
        db.flush()
        binding = LLMUseCaseRoute(
            use_case=MOCK_INTERVIEW, route_id=route.id, protocol_code="openai_chat", priority=100,
            is_enabled=True, validated_at=utc_now(),
        )
        db.add(binding)
        db.flush()
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()


def wait_for(client: TestClient, interview_id: str, statuses: set[str], timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        response = client.get(f"/api/mock-interviews/{interview_id}")
        assert response.status_code == 200, response.text
        body = response.json()["mock_interview"]
        if body["status"] in statuses:
            return body
        if body["status"] in {"preparation_failed", "evaluation_failed"} - statuses:
            raise AssertionError(f"{body['status']}: {body['error_code']}")
        if time.monotonic() > deadline:
            raise AssertionError(f"status stayed {body['status']}")
        time.sleep(0.02)


def sse_events(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "event" in lines:
            events.append((lines["event"], json.loads(lines["data"])))
    return events


def answer(client: TestClient, interview_id: str, question_id: str, text: str, key: str | None = None):
    return client.post(
        f"/api/mock-interviews/{interview_id}/answers",
        json={"question_id": question_id, "answer": text},
        headers={"Idempotency-Key": key or uuid4().hex},
    )


def start_interview(client: TestClient, app, **overrides) -> dict:
    resume = create_resume(client, app)
    payload = {"resume_id": resume["id"], "question_count": 3, "difficulty": "intermediate", **overrides}
    response = client.post("/api/mock-interviews", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["mock_interview"]


def test_full_interview_from_resume_produces_recomputable_report() -> None:
    gateway = ScriptedGateway()
    gateway.turn_headers = [
        {"action": "next_question", "depth_level": 2},  # opening
        {"action": "follow_up", "depth_level": 5, "probe_quote": "我用火焰图定位热点", "probe_gap": "缺少数据验证"},  # limited to previous depth + 1
        {"action": "next_question", "depth_level": 2},
        {"action": "next_question", "depth_level": 2},
        {"action": "next_question", "depth_level": 2},
        {"action": "finish", "depth_level": 2},
    ]
    app = build_app(gateway)
    with TestClient(app) as client:
        register(client, "mock-full@example.test")
        created = start_interview(client, app)
        assert created["status"] == "preparing"
        detail = wait_for(client, created["id"], {"in_progress"})
        first = detail["questions"][0]
        assert first["kind"] == "main" and first["depth_level"] == 1  # the opening question is the fixed self-introduction
        assert "如何定位" in first["content"]

        response = answer(client, created["id"], first["id"], "我用火焰图定位热点，也对比过本地缓存。")
        events = sse_events(response.text)
        assert [name for name, _ in events][0] == "answer.accepted"
        assert any(name == "interviewer.delta" for name, _ in events)
        turn = next(data for name, data in events if name == "interviewer.turn")
        assert turn["action"] == "follow_up"
        assert turn["question"]["depth_level"] == 2  # intro is L1; a follow-up rises at most one level
        assert turn["question"]["parent_id"] == first["id"]

        answer(client, created["id"], turn["question"]["id"], "用火焰图定位热点。")
        detail = wait_for(client, created["id"], {"in_progress"})
        third = detail["questions"][-1]
        assert third["kind"] == "main" and third["plan_index"] == 1
        answer(client, created["id"], third["id"], "用火焰图定位热点")
        detail = wait_for(client, created["id"], {"in_progress"})
        fourth = detail["questions"][-1]
        assert fourth["plan_index"] == 2
        answer(client, created["id"], fourth["id"], "用火焰图定位热点")
        detail = wait_for(client, created["id"], {"in_progress"})
        last = detail["questions"][-1]
        assert last["plan_index"] == 3  # self-introduction + the 3 requested questions
        final = sse_events(answer(client, created["id"], last["id"], "对比过本地缓存").text)
        assert next(data for name, data in final if name == "interviewer.turn")["action"] == "finish"

        report_detail = wait_for(client, created["id"], {"completed"})
        report = report_detail["report"]
        assert report["closing_message"].startswith("今天的面试")
        with app.state.session_factory() as db:
            completed = db.scalars(
                select(ProductEvent).where(ProductEvent.event_name == "mock_interview_completed")
            ).all()
        assert [e.properties_json["answer_mode"] for e in completed] == ["text"]
        assert len(report["questions"]) == 4  # intro + 3 requested questions
        first_signals = report["questions"][0]["signals"]
        # The third judgement quoted text that is not in the answers.
        assert [item["verdict"] for item in first_signals] == ["hit", "partial", "miss", "miss"]
        assert report["questions"][0]["topic"] == "自我介绍"  # fixed intro takes the first slot
        assert report["questions"][0]["expression"]["verdict"] == "hit"
        weights = {item["key"]: item["weight"] for item in report["dimensions"]}
        assert "job_fit" not in weights  # no JD supplied
        assert sum(weights.values()) == pytest.approx(1.0, abs=1e-3)
        knowledge = next(item for item in report["dimensions"] if item["key"] == "knowledge")
        assert knowledge["comment"] == "原理讲得清楚"
        scored = [item["score"] for item in report["questions"] if not item["is_intro"]]
        # The self-introduction is feedback only; the total is the plain question average.
        assert report["total_score"] == pytest.approx(sum(scored) / 3, abs=0.01)
        assert report_detail["total_score"] == pytest.approx(report["total_score"])
        assert report["verdict"]["level"] in {"meets", "borderline", "below"}
        assert report["verdict"]["target"] == report_detail["difficulty"]
        assert report_detail["verdict"] == report["verdict"]["level"]
        assert report_detail["rubric_version"] == "v4"
        listed = client.get("/api/mock-interviews").json()["items"]
        assert next(item for item in listed if item["id"] == created["id"])["verdict"] == report["verdict"]["level"]
        # Unknown refs are dropped and an unquotable resume line becomes a practice item; high priority first.
        assert [item["title"] for item in report["actions"]] == ["补充 QPS 提升的验证方式", "练习用数据支撑结论"]
        assert report["actions"][0]["kind"] == "practice" and report["actions"][0]["resume_quote"] is None
        assert all(ref != 999 for item in report["actions"] for ref in item["question_refs"])
        assert "improvements" not in report and "dimension_score" not in report
        assert report["fact_check"]["status"] == "not_requested"
        assert report["rubric_version"] == "v4"
        assert report["answer_mode"] == "text" and report["voice_metrics"] is None
    with app.state.session_factory() as db:
        logs = db.scalars(select(LLMCallLog)).all()
        assert logs and {log.use_case for log in logs} == {MOCK_INTERVIEW}
        assert {log.source for log in logs} == {"mock_interview"}


def test_concurrency_slot_and_release() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-slot@example.test")
        created = start_interview(client, app)
        wait_for(client, created["id"], {"in_progress"})
        resume = create_resume(client, app, "第二份简历")
        blocked = client.post("/api/mock-interviews", json={"resume_id": resume["id"]})
        assert blocked.status_code == 409
        assert blocked.json()["error"] == "MOCK_INTERVIEW_IN_PROGRESS"
        assert client.delete(f"/api/mock-interviews/{created['id']}").status_code == 409
        abandoned = client.post(f"/api/mock-interviews/{created['id']}/abandon")
        assert abandoned.json()["mock_interview"]["status"] == "abandoned"
        assert client.post("/api/mock-interviews", json={"resume_id": resume["id"]}).status_code == 201


def test_idle_interview_is_abandoned_lazily() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-idle@example.test")
        created = start_interview(client, app)
        wait_for(client, created["id"], {"in_progress"})
        with app.state.session_factory() as db:
            row = db.scalar(select(MockInterview).where(MockInterview.public_id == created["id"]))
            row.last_activity_at = utc_now().replace(year=2020)
            db.commit()
        resume = create_resume(client, app, "新简历")
        assert client.post("/api/mock-interviews", json={"resume_id": resume["id"]}).status_code == 201
        assert client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]["status"] == "abandoned"


def test_answer_is_idempotent_and_must_target_current_question() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-idem@example.test")
        created = start_interview(client, app)
        detail = wait_for(client, created["id"], {"in_progress"})
        question_id = detail["questions"][0]["id"]
        key = uuid4().hex
        first = answer(client, created["id"], question_id, "第一次回答", key)
        assert any(name == "interviewer.turn" for name, _ in sse_events(first.text))
        replay = answer(client, created["id"], question_id, "第一次回答", key)
        assert [name for name, _ in sse_events(replay.text)] == ["answer.accepted"]
        stale = answer(client, created["id"], question_id, "另一个回答")
        assert stale.status_code == 409
        assert stale.json()["error"] == "MOCK_INTERVIEW_QUESTION_MISMATCH"
        detail = client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]
        assert len(detail["questions"]) == 2
        assert detail["questions"][0]["answer_text"] == "第一次回答"


def test_lost_reply_keeps_answer_and_can_be_regenerated() -> None:
    gateway = ScriptedGateway()
    app = build_app(gateway)
    with TestClient(app) as client:
        register(client, "mock-retry-reply@example.test")
        created = start_interview(client, app)
        detail = wait_for(client, created["id"], {"in_progress"})
        gateway.fail_turn = True
        response = answer(client, created["id"], detail["questions"][0]["id"], "我的回答")
        assert any(name == "interviewer.failed" for name, _ in sse_events(response.text))
        detail = client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]
        assert detail["needs_reply"] is True
        assert detail["questions"][0]["answer_text"] == "我的回答"
        gateway.fail_turn = False
        retried = client.post(f"/api/mock-interviews/{created['id']}/reply:retry")
        assert any(name == "interviewer.turn" for name, _ in sse_events(retried.text))
        assert client.post(f"/api/mock-interviews/{created['id']}/reply:retry").status_code == 409


def test_skip_and_finish_early_and_empty_finish_abandons() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-finish@example.test")
        created = start_interview(client, app)
        detail = wait_for(client, created["id"], {"in_progress"})
        empty = client.post(f"/api/mock-interviews/{created['id']}/finish")
        assert empty.json()["mock_interview"]["status"] == "abandoned"

        second = start_interview(client, app, follow_up_enabled=False)
        detail = wait_for(client, second["id"], {"in_progress"})
        skipped = client.post(
            f"/api/mock-interviews/{second['id']}/skip",
            json={"question_id": detail["questions"][0]["id"]},
            headers={"Idempotency-Key": uuid4().hex},
        )
        assert sse_events(skipped.text)[0][1]["skipped"] is True
        detail = wait_for(client, second["id"], {"in_progress"})
        answer(client, second["id"], detail["questions"][-1]["id"], "用火焰图定位热点")
        finished = client.post(f"/api/mock-interviews/{second['id']}/finish")
        assert finished.json()["mock_interview"]["status"] == "evaluating"
        report = wait_for(client, second["id"], {"completed"})["report"]
        assert report["questions"][0]["skipped"] is True and report["questions"][0]["score"] == 0
        assert report["questions"][2]["skipped"] is True
        assert report["low_confidence"] is True


def test_evaluation_failure_keeps_transcript_and_retry_recovers() -> None:
    gateway = ScriptedGateway()
    app = build_app(gateway)
    with TestClient(app) as client:
        register(client, "mock-eval-retry@example.test")
        created = start_interview(client, app, follow_up_enabled=False)
        detail = wait_for(client, created["id"], {"in_progress"})
        answer(client, created["id"], detail["questions"][0]["id"], "用火焰图定位热点")
        gateway.fail_evaluation = True
        client.post(f"/api/mock-interviews/{created['id']}/finish")
        failed = wait_for(client, created["id"], {"evaluation_failed"})
        assert failed["error_code"] == "LLM_RESPONSE_INVALID"
        assert failed["questions"][0]["answer_text"] == "用火焰图定位热点"
        # A failed evaluation no longer occupies the slot.
        other = client.post("/api/mock-interviews", json={"resume_id": failed["resume_id"]})
        assert other.status_code == 201
        other = other.json()["mock_interview"]
        wait_for(client, other["id"], {"in_progress"})
        client.post(f"/api/mock-interviews/{other['id']}/abandon")
        gateway.fail_evaluation = False
        retried = client.post(f"/api/mock-interviews/{created['id']}/retry")
        assert retried.json()["mock_interview"]["status"] == "evaluating"
        assert wait_for(client, created["id"], {"completed"})["report"]["headline"] == "基础扎实"


def test_stale_task_lease_marks_preparation_failed() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-lease@example.test")
        created = start_interview(client, app)
        wait_for(client, created["id"], {"in_progress"})
        with app.state.session_factory() as db:
            row = db.scalar(select(MockInterview).where(MockInterview.public_id == created["id"]))
            row.status = "preparing"
            row.active_user_id = row.user_id
            row.task_lease_until = utc_now().replace(year=2020)
            db.commit()
        detail = client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]
        assert detail["status"] == "preparation_failed"
        assert detail["error_code"] == "MOCK_INTERVIEW_TASK_INTERRUPTED"
        retried = client.post(f"/api/mock-interviews/{created['id']}/retry")
        assert retried.json()["mock_interview"]["status"] == "preparing"
        assert retried.json()["mock_interview"]["questions"] == []
        assert len(wait_for(client, created["id"], {"in_progress"})["questions"]) == 1


def test_from_job_application_snapshots_stage_and_survives_source_deletion() -> None:
    gateway = ScriptedGateway()
    app = build_app(gateway)
    with TestClient(app) as client:
        register(client, "mock-application@example.test")
        application = create_pending_application(client, "示例科技")
        stage = client.post(
            f"/api/job-applications/{application['id']}/stages",
            json={"stage_type": "interview", "stage_label": "HR 面", "client_request_id": str(uuid4())},
        )
        missing = client.post("/api/mock-interviews", json={"job_application_id": application["id"]})
        assert missing.status_code == 422
        assert missing.json()["error"] == "MOCK_INTERVIEW_RESUME_REQUIRED"
        resume = create_resume(client, app, "求职测试简历")
        created = client.post(
            "/api/mock-interviews",
            json={"job_application_id": application["id"], "resume_id": resume["id"], "question_count": 3},
        ).json()["mock_interview"]
        assert created["source_type"] == "job_application"
        assert created["company_name"] == "示例科技"
        if stage.status_code in (200, 201):
            assert created["stage_label"] == "HR 面"
            assert created["interview_type"] == "hr"
        wait_for(client, created["id"], {"in_progress"})
        plan_prompt = next(system for system in gateway.systems if "制定面试计划" in system)
        assert "后端开发工程师" not in plan_prompt  # job text is data, not in the system prompt
        client.post(f"/api/mock-interviews/{created['id']}/abandon")
        listed = client.get(f"/api/mock-interviews?job_application_id={application['id']}").json()["items"]
        assert [item["id"] for item in listed] == [created["id"]]
        assert client.delete(f"/api/resumes/{resume['id']}").status_code == 200
        after = client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]
        assert after["resume_id"] is None
        assert after["resume_title"] == "求职测试简历"


def test_other_users_cannot_access_and_unconfigured_model_creates_nothing() -> None:
    app = build_app(ScriptedGateway(), configure=False)
    with TestClient(app) as client:
        register(client, "mock-unconfigured@example.test")
        resume = create_resume(client, app)
        response = client.post("/api/mock-interviews", json={"resume_id": resume["id"]})
        assert response.status_code == 503
        assert response.json()["error"] == "LLM_MODEL_NOT_CONFIGURED"
        with app.state.session_factory() as db:
            assert db.scalar(select(MockInterview.id)) is None
    app = build_app(ScriptedGateway())
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "mock-owner@example.test")
        created = start_interview(owner, app)
        register(other, "mock-other@example.test")
        assert other.get(f"/api/mock-interviews/{created['id']}").status_code == 404
        assert other.post(f"/api/mock-interviews/{created['id']}/abandon").status_code == 404
        assert other.get("/api/mock-interviews").json()["items"] == []
        foreign = other.post("/api/mock-interviews", json={"resume_id": created["resume_id"]})
        assert foreign.status_code == 404


def seed_dataset(app, user_email: str, storage: FakeStorage, markdown: str, *, parse_status: str = "succeeded") -> str:
    from linkresume.modules.identity.models import User

    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == user_email))
        task = DocumentParseTask(
            user_id=user.id, source_type=DATASET_SOURCE_TYPE, file_name="项目复盘.md", file_format="md",
            object_name=f"users/{user.id}/datasets/source/{uuid4().hex}.md", upload_status="succeeded",
            parse_status=parse_status, upload_duration_ms=1,
            parse_duration_ms=1 if parse_status == "succeeded" else None, converted_object_name=f"users/{user.id}/datasets/converted/{uuid4().hex}.md",
        )
        db.add(task)
        db.flush()
        dataset = UserDataset(
            user_id=user.id, file_name="项目复盘.md", file_format="md", content_type="text/markdown",
            idempotency_key=uuid4().hex, request_fingerprint="0" * 64,
            file_size=len(markdown.encode()), object_name=task.object_name, sha256="0" * 64,
            parse_task_id=task.id, asset_kind="document",
        )
        db.add(dataset)
        db.commit()
        storage.objects[task.converted_object_name] = markdown.encode()
        return str(dataset.id)


def test_reference_materials_drive_fact_check_with_verified_quotes() -> None:
    storage = FakeStorage()
    gateway = ScriptedGateway()
    app = build_app(gateway, storage=storage)
    with TestClient(app) as client:
        register(client, "mock-material@example.test")
        dataset_id = seed_dataset(
            app, "mock-material@example.test", storage, "# 性能\n订单系统重构后 QPS 从 2000 提升到 5000。"
        )
        pending = seed_dataset(app, "mock-material@example.test", storage, "未解析", parse_status="processing")
        resume = create_resume(client, app)
        rejected = client.post("/api/mock-interviews", json={"resume_id": resume["id"], "material_ids": [pending]})
        assert rejected.status_code == 422
        assert rejected.json()["error"] == "MOCK_INTERVIEW_MATERIAL_INVALID"
        created = client.post(
            "/api/mock-interviews",
            json={"resume_id": resume["id"], "question_count": 3, "follow_up_enabled": False, "material_ids": [dataset_id]},
        ).json()["mock_interview"]
        assert created["materials"][0]["dataset_id"] == dataset_id
        assert created["materials_in_questions"] is False
        detail = wait_for(client, created["id"], {"in_progress"})
        analysis_user = next(user for system, user in zip(gateway.systems, gateway.users) if "正在为一场模拟面试做背景分析" in system)
        # By default questions come from the resume only; materials stay for the report.
        assert "5000" not in analysis_user
        answer(client, created["id"], detail["questions"][0]["id"], "QPS 从 2000 提升到 10000，用火焰图定位热点")
        client.post(f"/api/mock-interviews/{created['id']}/finish")
        report = wait_for(client, created["id"], {"completed"})["report"]
        fact = report["fact_check"]
        assert fact["status"] == "completed"
        assert fact["items"][0]["verdict"] == "conflict"
        assert fact["items"][0]["source"]["dataset_id"] == dataset_id
        assert fact["items"][0]["source"]["title"] == "项目复盘.md"


def test_materials_in_questions_switch_feeds_analysis_and_carries_to_repeat() -> None:
    storage = FakeStorage()
    gateway = ScriptedGateway()
    app = build_app(gateway, storage=storage)
    with TestClient(app) as client:
        register(client, "mock-material-switch@example.test")
        dataset_id = seed_dataset(
            app, "mock-material-switch@example.test", storage, "# 性能\n订单系统重构后 QPS 从 2000 提升到 5000。"
        )
        resume = create_resume(client, app)
        created = client.post(
            "/api/mock-interviews",
            json={
                "resume_id": resume["id"], "question_count": 3, "follow_up_enabled": False,
                "material_ids": [dataset_id], "materials_in_questions": True,
            },
        ).json()["mock_interview"]
        assert created["materials_in_questions"] is True
        detail = wait_for(client, created["id"], {"in_progress"})
        analysis_user = next(user for system, user in zip(gateway.systems, gateway.users) if "正在为一场模拟面试做背景分析" in system)
        assert "5000" in analysis_user
        client.post(f"/api/mock-interviews/{created['id']}/abandon")
        repeat = client.post(f"/api/mock-interviews/{created['id']}/repeat")
        assert repeat.status_code == 201, repeat.text
        assert repeat.json()["mock_interview"]["materials_in_questions"] is True
        wait_for(client, repeat.json()["mock_interview"]["id"], {"in_progress"})
        client.post(f"/api/mock-interviews/{repeat.json()['mock_interview']['id']}/abandon")
        # Without materials the switch has nothing to act on and is stored off.
        plain = client.post(
            "/api/mock-interviews",
            json={"resume_id": resume["id"], "question_count": 3, "materials_in_questions": True},
        )
        assert plain.status_code == 201, plain.text
        assert plain.json()["mock_interview"]["materials_in_questions"] is False
        assert detail["status"] == "in_progress"


def mark_indexed(app, dataset_id: str, rag_file_id: int) -> None:
    from linkresume.modules.datasets.models import UserDatasetRagSync

    with app.state.session_factory() as db:
        dataset = db.get(UserDataset, int(dataset_id))
        db.add(UserDatasetRagSync(
            dataset_id=dataset.id, user_id=dataset.user_id, status="ready",
            content_revision=dataset.content_revision, synced_revision=dataset.content_revision,
            rag_file_id=rag_file_id, attempt_count=0,
        ))
        db.commit()


@pytest.mark.parametrize("rag_fails", [False, True])
def test_fact_check_uses_rag_for_indexed_materials(rag_fails: bool) -> None:
    from tests.fakes import FakeLinkRag

    storage = FakeStorage()
    gateway = ScriptedGateway()
    rag = FakeLinkRag()
    app = build_app(gateway, storage=storage, linkrag=rag)
    with TestClient(app) as client:
        register(client, "mock-rag@example.test")
        # The local text never mentions 5000, so only RAG can supply the quote.
        dataset_id = seed_dataset(app, "mock-rag@example.test", storage, "# 性能\n订单系统做过重构。")
        mark_indexed(app, dataset_id, 7001)
        rag.recall_hits = {7001: "订单系统重构后 QPS 从 2000 提升到 5000。"}
        if rag_fails:
            rag.fail = {"recall"}
        resume = create_resume(client, app)
        created = client.post(
            "/api/mock-interviews",
            json={"resume_id": resume["id"], "question_count": 3, "follow_up_enabled": False, "material_ids": [dataset_id]},
        ).json()["mock_interview"]
        detail = wait_for(client, created["id"], {"in_progress"})
        assert rag.recall_calls == []  # question generation never touches materials by default
        answer(client, created["id"], detail["questions"][0]["id"], "QPS 从 2000 提升到 10000")
        client.post(f"/api/mock-interviews/{created['id']}/finish")
        fact = wait_for(client, created["id"], {"completed"})["report"]["fact_check"]
    assert fact["status"] == "completed"
    (item,) = fact["items"]
    if rag_fails:
        # Fallback: the in-memory text lacks the quote, so the verdict is downgraded.
        assert item["verdict"] == "not_found"
    else:
        assert rag.recall_calls[0]["file_ids"] == [7001]
        assert item["verdict"] == "conflict"
        assert item["source"]["dataset_id"] == dataset_id
        assert item["source"]["title"] == "项目复盘.md"


def test_material_read_failure_skips_fact_check_only() -> None:
    storage = FakeStorage()
    app = build_app(ScriptedGateway(), storage=storage)
    with TestClient(app) as client:
        register(client, "mock-material-fail@example.test")
        dataset_id = seed_dataset(app, "mock-material-fail@example.test", storage, "# 性能\nQPS 5000")
        resume = create_resume(client, app)
        created = client.post(
            "/api/mock-interviews",
            json={"resume_id": resume["id"], "question_count": 3, "follow_up_enabled": False, "material_ids": [dataset_id]},
        ).json()["mock_interview"]
        detail = wait_for(client, created["id"], {"in_progress"})
        storage.objects.clear()
        answer(client, created["id"], detail["questions"][0]["id"], "用火焰图定位热点")
        client.post(f"/api/mock-interviews/{created['id']}/finish")
        report = wait_for(client, created["id"], {"completed"})["report"]
        assert report["fact_check"]["status"] == "failed"


def test_repeat_reuses_analysis_and_avoids_previous_topics_then_delete() -> None:
    gateway = ScriptedGateway()
    app = build_app(gateway)
    with TestClient(app) as client:
        register(client, "mock-repeat@example.test")
        created = start_interview(client, app)
        wait_for(client, created["id"], {"in_progress"})
        client.post(f"/api/mock-interviews/{created['id']}/abandon")
        analysis_calls = sum("正在为一场模拟面试做背景分析" in system for system in gateway.systems)
        repeated = client.post(f"/api/mock-interviews/{created['id']}/repeat")
        assert repeated.status_code == 201
        repeat_detail = wait_for(client, repeated.json()["mock_interview"]["id"], {"in_progress"})
        assert repeat_detail["repeat_of_id"] == created["id"]
        assert sum("正在为一场模拟面试做背景分析" in system for system in gateway.systems) == analysis_calls
        assert "考察点0" in [system for system in gateway.systems if "制定面试计划" in system][-1]
        client.post(f"/api/mock-interviews/{repeat_detail['id']}/abandon")
        assert client.delete(f"/api/mock-interviews/{created['id']}").json() == {"deleted": True}
        assert client.get(f"/api/mock-interviews/{created['id']}").status_code == 404
        assert client.get(f"/api/mock-interviews/{repeat_detail['id']}").json()["mock_interview"]["repeat_of_id"] is None
    with app.state.session_factory() as db:
        remaining = {row.interview_id for row in db.scalars(select(MockInterviewQuestion))}
        assert all(isinstance(item, int) for item in remaining)


def test_list_pagination() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-page@example.test")
        ids = []
        for _ in range(3):
            created = start_interview(client, app)
            wait_for(client, created["id"], {"in_progress"})
            client.post(f"/api/mock-interviews/{created['id']}/abandon")
            ids.append(created["id"])
        first = client.get("/api/mock-interviews?limit=2").json()
        assert len(first["items"]) == 2 and first["next_cursor"]
        second = client.get(f"/api/mock-interviews?limit=2&cursor={first['next_cursor']}").json()
        listed = [item["id"] for item in first["items"] + second["items"]]
        assert sorted(listed) == sorted(ids) and len(set(listed)) == 3
        assert second["next_cursor"] is None


def _row(app, public_id: str) -> MockInterview:
    with app.state.session_factory() as db:
        row = db.scalar(select(MockInterview).where(MockInterview.public_id == public_id))
        db.expunge(row)
        return row


def test_superseded_task_cannot_write_or_fail_the_retried_run() -> None:
    app = build_app(ScriptedGateway())
    runner_module = __import__("linkresume.application.mock_interviews.service", fromlist=["x"])
    with TestClient(app) as client:
        register(client, "mock-supersede@example.test")
        created = start_interview(client, app, follow_up_enabled=False)
        detail = wait_for(client, created["id"], {"in_progress"})
        answer(client, created["id"], detail["questions"][0]["id"], "用火焰图定位热点")
        client.post(f"/api/mock-interviews/{created['id']}/finish")
        wait_for(client, created["id"], {"completed"})
        row = _row(app, created["id"])
        runner = app.state.mock_interview_runner
        stale = "0" * 32
        # Put the interview back into evaluation owned by a *different* token.
        with app.state.session_factory() as db:
            live = db.get(MockInterview, row.id)
            live.status, live.task_token, live.active_user_id = "evaluating", "f" * 32, live.user_id
            db.commit()
        # The stale task's failure and report writes must both be ignored.
        runner._with_db(lambda db: runner._fail(db, row.id, "evaluating", stale, "LLM_UNAVAILABLE"))
        runner._with_db(lambda db: runner._store_report(db, row.id, stale, {"total_score": 1}, {}, runner_module._Usage()))
        after = _row(app, created["id"])
        assert after.status == "evaluating" and after.task_token == "f" * 32
        assert after.error_code is None


def test_heartbeat_renews_lease_only_for_the_owning_task() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-heartbeat@example.test")
        created = start_interview(client, app)
        wait_for(client, created["id"], {"in_progress"})
        row = _row(app, created["id"])
        runner = app.state.mock_interview_runner
        with app.state.session_factory() as db:
            live = db.get(MockInterview, row.id)
            live.status, live.task_token = "preparing", "a" * 32
            live.active_user_id = live.user_id
            live.task_lease_until = utc_now().replace(year=2020)
            db.commit()
        assert runner._with_db(lambda db: runner._heartbeat_sync(db, row.id, "preparing", "b" * 32)) is False
        assert runner._with_db(lambda db: runner._heartbeat_sync(db, row.id, "preparing", "a" * 32)) is True
        # The renewed lease is no longer stale, so a read does not fail it.
        assert client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]["status"] == "preparing"


def test_evaluation_runs_even_if_client_drops_the_final_turn() -> None:
    gateway = ScriptedGateway()
    gateway.turn_headers = [
        {"action": "next_question", "depth_level": 2},
        {"action": "finish", "depth_level": 2},
    ]
    app = build_app(gateway)
    with TestClient(app) as client:
        register(client, "mock-drop@example.test")
        created = start_interview(client, app, follow_up_enabled=False, question_count=3)
        detail = wait_for(client, created["id"], {"in_progress"})
        # Answer the last planned topic directly so the next turn finishes.
        with app.state.session_factory() as db:
            question = db.get(MockInterviewQuestion, int(detail["questions"][0]["id"]))
            question.plan_index = 3
            db.commit()
        runner = app.state.mock_interview_runner
        client.post(
            f"/api/mock-interviews/{created['id']}/answers",
            json={"question_id": detail["questions"][0]["id"], "answer": "用火焰图定位热点"},
            headers={"Idempotency-Key": uuid4().hex},
        )
        del runner
        assert wait_for(client, created["id"], {"completed"})["report"] is not None


def test_turn_stream_always_ends_with_a_terminal_event() -> None:
    gateway = ScriptedGateway()
    app = build_app(gateway)
    with TestClient(app) as client:
        register(client, "mock-terminal@example.test")
        created = start_interview(client, app)
        detail = wait_for(client, created["id"], {"in_progress"})
        runner = app.state.mock_interview_runner
        original = runner._store_turn

        def explode(*args, **kwargs):
            raise RuntimeError("simulated database outage")

        runner._store_turn = explode
        try:
            response = answer(client, created["id"], detail["questions"][0]["id"], "我的回答")
        finally:
            runner._store_turn = original
        names = [name for name, _ in sse_events(response.text)]
        assert names[0] == "answer.accepted"
        assert names[-1] == "interviewer.failed"
        assert sse_events(response.text)[-1][1]["error"] == "MOCK_INTERVIEW_TURN_FAILED"
        assert client.get(f"/api/mock-interviews/{created['id']}").json()["mock_interview"]["needs_reply"] is True


def test_repeat_keeps_job_context_after_application_is_deleted() -> None:
    app = build_app(ScriptedGateway())
    with TestClient(app) as client:
        register(client, "mock-repeat-job@example.test")
        application = create_pending_application(client, "示例科技")
        resume = create_resume(client, app)
        created = client.post(
            "/api/mock-interviews",
            json={"job_application_id": application["id"], "resume_id": resume["id"], "question_count": 3},
        ).json()["mock_interview"]
        wait_for(client, created["id"], {"in_progress"})
        client.post(f"/api/mock-interviews/{created['id']}/abandon")
        with app.state.session_factory() as db:
            db.execute(
                MockInterview.__table__.update()
                .where(MockInterview.public_id == created["id"])
                .values(job_application_id=None)
            )
            db.commit()
        repeated = client.post(f"/api/mock-interviews/{created['id']}/repeat").json()["mock_interview"]
        repeated_row = _row(app, repeated["id"])
        assert repeated_row.job_snapshot_json["description"] == "负责虚构业务的后端系统设计与开发。"


def test_desktop_text_interview_flow_keeps_ownership_channel_and_idempotency() -> None:
    from linkresume.modules.identity.models import User
    from linkresume.modules.identity.session_service import prepare_session
    from linkresume.core.security import session_key
    from linkresume.core.security import create_access_token

    gateway = ScriptedGateway()
    gateway.turn_headers = [{"action": "next_question", "depth_level": 2}, {"action": "follow_up", "depth_level": 3, "probe_quote": "我用火焰图定位热点", "probe_gap": "缺少数据验证"}]
    app = build_app(gateway)
    with TestClient(app) as client:
        assert client.get('/api/mock-interviews').status_code == 401
        register(client, 'desktop-practice@example.test')
        resume = create_resume(client, app)
        uid = int(client.get('/api/auth/me').json()['user']['id'])
        with app.state.session_factory() as db:
            user = db.get(User, uid)
            credentials = prepare_session(user, app.state.settings, channel='desktop')
            app.state.redis.hset(session_key(credentials.sid), mapping={'uid': str(uid), 'channel': 'desktop'})
            stranger = User(wechat_openid='mock-desktop-stranger', nickname='虚构用户')
            db.add(stranger)
            db.commit()
            other = prepare_session(stranger, app.state.settings, channel='desktop')
            app.state.redis.hset(session_key(other.sid), mapping={'uid': str(stranger.id), 'channel': 'desktop'})
        headers = {'Authorization': 'Bearer ' + credentials.access_token}
        assert client.get('/api/mock-interviews', headers=headers).status_code == 401  # mixed Cookie/Bearer
        client.cookies.clear()
        client.headers.update(headers)
        wrong = create_access_token(uid, credentials.sid, app.state.settings, 'miniprogram')
        assert client.get('/api/mock-interviews', headers={'Authorization': 'Bearer ' + wrong}).status_code == 401
        assert client.get('/api/datasets').status_code == 200
        # Desktop may probe speech and start voice interviews; this fixture has no speech routes configured.
        assert client.get('/api/mock-interviews/speech-capability').status_code == 200
        voice = client.post('/api/mock-interviews', json={'resume_id':resume['id'], 'answer_mode':'voice'})
        assert voice.status_code == 503 and voice.json()['error'] == 'MOCK_INTERVIEW_SPEECH_UNAVAILABLE', voice.text
        created = client.post('/api/mock-interviews', json={'resume_id':resume['id'], 'question_count':3})
        assert created.status_code == 201, created.text
        identity = created.json()['mock_interview']['id']
        path = '/api/mock-interviews/' + identity
        other_headers = {'Authorization':'Bearer ' + other.access_token}
        assert client.get(path, headers=other_headers).status_code == 404
        assert client.post(path + '/finish', headers=other_headers).status_code == 404
        ready = wait_for(client, identity, {'in_progress'})
        question = ready['current_question_id']
        key = str(uuid4())
        result = answer(client, identity, question, '我用火焰图定位热点，也对比过本地缓存。', key)
        assert result.status_code == 200
        assert any(name == 'interviewer.turn' for name, _ in sse_events(result.text))
        assert answer(client, identity, question, '我用火焰图定位热点，也对比过本地缓存。', key).status_code == 200
        detail = client.get(path).json()['mock_interview']
        assert len(detail['questions']) == 2
        assert client.post(path + '/finish').status_code == 200
        complete = wait_for(client, identity, {'completed'})
        assert complete['report']['total_score'] == complete['total_score']
        assert client.post(path + '/transcripts:correct').status_code == 403
        repeat = client.post(path + '/repeat')
        assert repeat.status_code == 201, repeat.text
        repeat_id = repeat.json()['mock_interview']['id']
        wait_for(client, repeat_id, {'in_progress'})
        assert client.post('/api/mock-interviews/' + repeat_id + '/abandon').status_code == 200
        assert client.delete(path).status_code == 200
        assert client.get(path).status_code == 404
