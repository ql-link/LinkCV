from __future__ import annotations

import asyncio
import json
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.application.job_matches import recommendations, service
from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.job_matches.models import JobResumeMatch
from linkresume.modules.llm.gateway import GatewayResult, GatewayUsage
from linkresume.modules.llm.models import (
    LLMModel,
    LLMModelRoute,
    LLMProviderConnection,
    LLMUseCaseRoute,
)
from linkresume.modules.llm.resolver import JOB_MATCH, validation_fingerprint
from linkresume.modules.resumes.models import Resume, ResumeTemplate
from tests.canonical_resume_fixtures import canonical_template_payload
from tests.fakes import FakeRedis
from tests.integration.api.test_interviews import (
    FakeStorage as InterviewFakeStorage,
    create_application,
    register,
)


class FakeStorage(InterviewFakeStorage):
    def delete_prefix(self, prefix: str) -> None:
        for name in self.list_names(prefix):
            self.delete(name)

USAGE = GatewayUsage(input_tokens=10, output_tokens=5)
RESUME_LINE = "熟悉分布式系统设计与调优"
RESUME_TEXTS: dict[int, str] = {}


def reply(**overrides: object) -> dict[str, object]:
    return {
        "requirements": [
            {
                "text": "有分布式系统经验",
                "importance": "must",
                "coverage": "covered",
                "evidence": RESUME_LINE,
                "terms": ["分布式系统", "不在岗位里的词"],
            },
            {
                "text": "熟悉 Go",
                "importance": "important",
                "coverage": "covered",
                "evidence": RESUME_LINE,
                "terms": ["Go"],
            },
            {
                "text": "有 Kubernetes 经验",
                "importance": "must",
                "coverage": "missing",
                "evidence": None,
                "terms": ["Kubernetes"],
            },
            {
                "text": "了解消息队列",
                "importance": "nice",
                "coverage": "partial",
                "evidence": "简历里没有的句子",
                "terms": [],
            },
        ],
        **overrides,
    }


class MatchGateway:
    def __init__(self) -> None:
        self.calls = 0
        self.delay = 0.0
        self.invalid = False
        self.user_messages: list[str] = []

    async def complete(self, *, model, messages, api_base, api_key, protocol_code="openai_chat") -> GatewayResult:
        del model, api_base, api_key
        self.calls += 1
        self.user_messages.append(
            "\n".join(m.content for m in messages if m.role == "user" and isinstance(m.content, str))
        )
        if self.delay:
            await asyncio.sleep(self.delay)
        content = "not json" if self.invalid else json.dumps(reply(), ensure_ascii=False)
        return GatewayResult(content=content, usage=USAGE)


@pytest.fixture
def database_url(tmp_path) -> str:
    return f"sqlite+pysqlite:///{tmp_path / f'match-{uuid4().hex}.db'}"


@pytest.fixture(autouse=True)
def fixed_resume_text(monkeypatch):
    RESUME_TEXTS.clear()
    monkeypatch.setattr(
        service, "resume_markdown", lambda resume: RESUME_TEXTS.get(resume.id, RESUME_LINE)
    )


def build_app(database_url: str, gateway: MatchGateway, *, configure: bool = True):
    app = create_app(
        Settings(
            database_url=database_url,
            jwt_secret="integration-test-secret-with-32-bytes",
            llm_credential_encryption_keys=f"test:{Fernet.generate_key().decode('ascii')}",
        ),
        storage=FakeStorage(),
        redis=FakeRedis(),
        llm_gateway=gateway,
        create_schema=True,
    )
    with app.state.session_factory() as db:
        data, style = canonical_template_payload(key="match-test")
        template = ResumeTemplate(
            key="match-test", name="匹配测试", description="d",
            data_json=data, style_json=style, is_active=1,
        )
        db.add(template)
        db.flush()
        app.state.test_template_id = str(template.id)
        if configure:
            connection = LLMProviderConnection(
                provider_code="aihubmix", name="测试",
                credential_ciphertext=app.state.llm_service.encrypt_credential(
                    json.dumps({"api_key": "fictional-key"})
                ),
                settings_json={}, is_enabled=True, runtime_config_version=1,
            )
            db.add(connection)
            db.flush()
            model = LLMModel(display_name="match-model")
            db.add(model)
            db.flush()
            route = LLMModelRoute(
                model_id=model.id, connection_id=connection.id, target_kind="model",
                invoke_target="match-model", origin="manual", is_enabled=True, is_target_available=True,
            )
            db.add(route)
            db.flush()
            binding = LLMUseCaseRoute(
                use_case=JOB_MATCH, route_id=route.id, protocol_code="openai_chat",
                priority=100, is_enabled=True, validated_at=utc_now(),
            )
            db.add(binding)
            db.flush()
            binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()
    return app


def create_resume(client: TestClient, app, title: str = "我的简历") -> dict[str, object]:
    response = client.post(
        "/api/resumes", json={"title": title, "template_id": app.state.test_template_id}
    )
    assert response.status_code == 201, response.text
    return response.json()["resume"]


def create_job(
    client: TestClient,
    title: str = "后端开发工程师",
    description: str = "负责分布式系统开发，需要 Kubernetes 经验，熟悉 Go",
    skills: list[str] | None = None,
) -> str:
    response = client.post(
        "/api/job-descriptions",
        json={
            "job_title": title, "company_name": "虚构科技", "description": description,
            "skills": skills or [], "source_type": "manual",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["job_description"]["id"]


def match_url(job_id: str) -> str:
    return f"/api/job-descriptions/{job_id}/match"


def analyze(client: TestClient, job_id: str, resume_id: str):
    return client.post(f"{match_url(job_id)}:analyze", json={"resume_id": resume_id})


def settle(client: TestClient, *, timeout: float = 10.0) -> dict[str, object]:
    deadline = time.time() + timeout
    while True:
        body = client.get("/api/job-matches/recommendations").json()
        if body["pending_count"] == 0:
            return body
        assert time.time() < deadline, body
        time.sleep(0.05)


def rows(app) -> list[JobResumeMatch]:
    with app.state.session_factory() as db:
        return list(db.scalars(select(JobResumeMatch)))


def test_analyze_scores_caches_and_goes_stale_when_the_resume_changes(database_url) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "match@example.com")
        resume = create_resume(client, app)
        job_id = create_job(client)

        assert client.get(match_url(job_id), params={"resume_id": resume["id"]}).json() == {"match": None}

        response = analyze(client, job_id, resume["id"])
        assert response.status_code == 200, response.text
        match = response.json()["match"]
        # (3×1 + 2×1 + 3×0 + 1×0) / 9: the partial claim has no real quotation.
        assert match["status"] == "ready" and match["score"] == 56
        assert match["stale"] is False
        assert match["headline"] == "有 Kubernetes 经验"
        assert match["hits"] == ["有分布式系统经验", "熟悉 Go"]
        assert match["gaps"] == ["有 Kubernetes 经验", "了解消息队列"]
        assert match["highlights"] == {
            "covered": ["分布式系统", "Go"],
            "missing": ["Kubernetes"],
        }
        assert "后端开发工程师" in gateway.user_messages[0] and RESUME_LINE in gateway.user_messages[0]

        again = analyze(client, job_id, resume["id"])
        assert again.status_code == 200 and again.json()["match"]["score"] == 56
        assert gateway.calls == 1

        RESUME_TEXTS[int(resume["id"])] = RESUME_LINE + "，主导过消息系统重构"
        stale = client.get(match_url(job_id), params={"resume_id": resume["id"]}).json()["match"]
        assert stale["stale"] is True and stale["score"] == 56

        fresh = analyze(client, job_id, resume["id"]).json()["match"]
        assert fresh["stale"] is False
        assert gateway.calls == 2


def test_analyze_validates_inputs_and_reports_failures(database_url) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client, TestClient(app) as other:
        register(client, "match-errors@example.com")
        register(other, "match-other@example.com")
        resume = create_resume(client, app)
        job_id = create_job(client)
        empty_job = create_job(client, description="")

        assert analyze(client, "999999", resume["id"]).status_code == 404
        assert analyze(client, job_id, "999999").status_code == 404
        # Another user's job and resume are indistinguishable from missing ones.
        assert analyze(other, job_id, resume["id"]).status_code == 404
        other_resume = create_resume(other, app, "别人的简历")
        assert analyze(client, job_id, other_resume["id"]).status_code == 404
        assert client.get(match_url(job_id), params={"resume_id": other_resume["id"]}).status_code == 404

        blank = analyze(client, empty_job, resume["id"])
        assert blank.status_code == 400 and blank.json()["error"] == "JOB_MATCH_NO_DESCRIPTION"

        gateway.invalid = True
        failed = analyze(client, job_id, resume["id"])
        assert failed.status_code == 502 and failed.json()["error"] == "LLM_RESPONSE_INVALID"
        assert gateway.calls == 2  # one retry on an invalid structure
        state = client.get(match_url(job_id), params={"resume_id": resume["id"]}).json()["match"]
        assert state["status"] == "failed" and state["score"] is None
        assert state["error_code"] == "LLM_RESPONSE_INVALID"

        gateway.invalid = False
        assert analyze(client, job_id, resume["id"]).json()["match"]["status"] == "ready"


def test_analysis_requires_a_configured_model(database_url) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway, configure=False)
    with TestClient(app) as client:
        register(client, "match-unconfigured@example.com")
        resume = create_resume(client, app)
        job_id = create_job(client)
        response = analyze(client, job_id, resume["id"])
        assert response.status_code == 503
        assert response.json()["error"] == "LLM_MODEL_NOT_CONFIGURED"
        assert gateway.calls == 0 and rows(app) == []
        body = client.post("/api/job-matches/recommendations:ensure").json()
        assert body["state"] == "unavailable" and rows(app) == []


def test_lease_blocks_duplicates_and_expired_lease_can_be_taken_over(database_url) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "match-lease@example.com")
        resume = create_resume(client, app)
        job_id = create_job(client)
        assert analyze(client, job_id, resume["id"]).status_code == 200
        with app.state.session_factory() as db:
            row = db.scalar(select(JobResumeMatch))
            row.status, row.score, row.result_json = "pending", None, None
            row.lease_token, row.lease_until = "held", utc_now() + timedelta(minutes=2)
            db.commit()

        busy = analyze(client, job_id, resume["id"])
        assert busy.status_code == 409 and busy.json()["error"] == "JOB_MATCH_IN_PROGRESS"
        pending = client.get(match_url(job_id), params={"resume_id": resume["id"]}).json()["match"]
        assert pending["status"] == "pending"

        with app.state.session_factory() as db:
            row = db.scalar(select(JobResumeMatch))
            row.lease_until = utc_now() - timedelta(minutes=1)
            db.commit()
        interrupted = client.get(match_url(job_id), params={"resume_id": resume["id"]}).json()["match"]
        assert interrupted["status"] == "failed" and interrupted["error_code"] == "JOB_MATCH_INTERRUPTED"
        assert analyze(client, job_id, resume["id"]).json()["match"]["status"] == "ready"


def test_recommendations_rank_saved_jobs_for_the_latest_resume(database_url) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "match-home@example.com")
        assert client.get("/api/job-matches/recommendations").json()["state"] == "no_resume"
        old = create_resume(client, app, "旧简历")
        latest = create_resume(client, app, "最新简历")
        with app.state.session_factory() as db:
            db.get(Resume, int(old["id"])).updated_at = utc_now() - timedelta(days=3)
            db.commit()
        assert client.get("/api/job-matches/recommendations").json()["state"] == "no_jobs"

        job_ids = [create_job(client, title=f"岗位{index}") for index in range(3)]
        application = create_application(client, job_ids[0])
        before = client.get("/api/job-matches/recommendations").json()
        assert before["state"] == "idle" and before["can_compute"] is True
        assert before["resume"] == {"id": latest["id"], "title": "最新简历"}

        started = client.post("/api/job-matches/recommendations:ensure").json()
        assert started["state"] in {"computing", "ready"}
        done = settle(client)
        assert done["state"] == "ready" and done["can_compute"] is False
        assert len(done["items"]) == 3
        scores = [item["score"] for item in done["items"]]
        assert scores == sorted(scores, reverse=True)
        statuses = {item["job_id"]: item["application_status"] for item in done["items"]}
        assert statuses[job_ids[0]] == "一面" and statuses[job_ids[1]] == "待投递"
        assert gateway.calls == 3 and application["id"]

        client.post("/api/job-matches/recommendations:ensure")
        assert gateway.calls == 3  # nothing left to compute


def test_ensure_never_computes_the_same_job_twice_at_once(database_url) -> None:
    gateway = MatchGateway()
    gateway.delay = 0.4
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "match-dedupe@example.com")
        create_resume(client, app)
        for index in range(2):
            create_job(client, title=f"岗位{index}")
        first = client.post("/api/job-matches/recommendations:ensure").json()
        assert first["state"] == "computing" and first["pending_count"] == 2
        second = client.post("/api/job-matches/recommendations:ensure").json()
        assert second["state"] == "computing"
        settle(client)
        assert gateway.calls == 2


def test_only_the_top_candidates_are_analyzed_within_the_budget(database_url, monkeypatch) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway)
    monkeypatch.setattr(recommendations, "AUTO_BUDGET", 4)
    with TestClient(app) as client:
        register(client, "match-budget@example.com")
        create_resume(client, app)
        for index in range(8):
            create_job(client, title=f"岗位{index}")
        client.post("/api/job-matches/recommendations:ensure")
        settle(client)
        assert gateway.calls == 4  # budget (4) is below the candidate limit (5)
        client.post("/api/job-matches/recommendations:ensure")
        settle(client)
        assert gateway.calls == 4


def test_failed_automatic_analysis_stops_after_two_attempts(database_url) -> None:
    gateway = MatchGateway()
    gateway.invalid = True
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "match-failure@example.com")
        resume = create_resume(client, app)
        job_id = create_job(client)
        for _ in range(3):
            client.post("/api/job-matches/recommendations:ensure")
            settle(client)
        assert gateway.calls == 4  # two attempts × (call + one structural retry)
        body = client.get("/api/job-matches/recommendations").json()
        assert body["state"] == "unavailable" and body["items"] == []

        gateway.invalid = False
        manual = analyze(client, job_id, resume["id"])
        assert manual.status_code == 200 and manual.json()["match"]["status"] == "ready"
        assert client.get("/api/job-matches/recommendations").json()["state"] == "ready"


def test_recommendations_are_scoped_to_the_user(database_url) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "match-owner@example.com")
        register(other, "match-stranger@example.com")
        create_resume(owner, app)
        create_job(owner)
        owner.post("/api/job-matches/recommendations:ensure")
        settle(owner)
        assert len(owner.get("/api/job-matches/recommendations").json()["items"]) == 1
        stranger = other.get("/api/job-matches/recommendations").json()
        assert stranger["state"] == "no_resume" and stranger["items"] == []


def test_deleting_a_job_or_resume_removes_its_matches(database_url) -> None:
    gateway = MatchGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "match-delete@example.com")
        keep, drop = create_resume(client, app, "保留"), create_resume(client, app, "删除")
        job_a, job_b = create_job(client, title="A"), create_job(client, title="B")
        for job_id in (job_a, job_b):
            for resume in (keep, drop):
                assert analyze(client, job_id, resume["id"]).status_code == 200
        assert len(rows(app)) == 4

        assert client.delete(f"/api/resumes/{drop['id']}").status_code == 200
        assert {row.resume_id for row in rows(app)} == {int(keep["id"])}

        assert client.delete(f"/api/job-descriptions/{job_a}").status_code == 200
        assert [row.job_description_id for row in rows(app)] == [int(job_b)]
