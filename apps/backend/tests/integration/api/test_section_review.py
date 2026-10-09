from __future__ import annotations

import json
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.main import create_app
from linkresume.modules.llm.gateway import GatewayResult, GatewayUsage
from linkresume.modules.llm.models import (
    LLMModel,
    LLMModelRoute,
    LLMProviderConnection,
    LLMUseCaseRoute,
)
from linkresume.modules.llm.resolver import SECTION_REVIEW, validation_fingerprint
from linkresume.modules.resumes.models import ResumeTemplate
from tests.canonical_resume_fixtures import canonical_template_payload
from tests.fakes import FakeRedis
from tests.integration.api.test_interviews import FakeStorage, create_job, register

USAGE = GatewayUsage(input_tokens=10, output_tokens=5)

LINES = [
    {"id": "li-1", "text": "负责配送调度服务的 Go 微服务改造，拆分单体模块。"},
    {"id": "li-2", "text": "参与限流熔断组件的开发和维护工作，保障系统稳定。"},
]
CONTEXT = [{"id": "entry-2", "label": "项目 · 分布式任务调度平台", "text": "负责调度核心模块设计。"}]


class ReviewGateway:
    def __init__(self) -> None:
        self.calls = 0
        self.user_messages: list[str] = []
        self.replies: list[str] = []

    def push(self, value: object) -> None:
        self.replies.append(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))

    async def complete(self, *, model, messages, api_base, api_key, protocol_code="openai_chat") -> GatewayResult:
        del model, api_base, api_key, protocol_code
        self.calls += 1
        self.user_messages.append(
            "\n".join(m.content for m in messages if m.role == "user" and isinstance(m.content, str))
        )
        content = self.replies.pop(0) if self.replies else "not json"
        return GatewayResult(content=content, usage=USAGE)


@pytest.fixture
def database_url(tmp_path) -> str:
    return f"sqlite+pysqlite:///{tmp_path / f'section-review-{uuid4().hex}.db'}"


def build_app(database_url: str, gateway: ReviewGateway, *, configure: bool = True):
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
        template_data, template_style = canonical_template_payload(key="section-review-test")
        template = ResumeTemplate(
            key="section-review-test",
            name="段落精修测试模板",
            description="段落精修集成测试使用的模板",
            data_json=template_data,
            style_json=template_style,
            is_active=1,
        )
        db.add(template)
        db.commit()
        app.state.test_template_id = str(template.id)
        if configure:
            connection = LLMProviderConnection(
                provider_code="aihubmix",
                name="测试",
                credential_ciphertext=app.state.llm_service.encrypt_credential(
                    json.dumps({"api_key": "fictional-key"})
                ),
                settings_json={},
                is_enabled=True,
                runtime_config_version=1,
            )
            db.add(connection)
            db.flush()
            model = LLMModel(display_name="review-model")
            db.add(model)
            db.flush()
            route = LLMModelRoute(
                model_id=model.id,
                connection_id=connection.id,
                target_kind="model",
                invoke_target="review-model",
                origin="manual",
                is_enabled=True,
                is_target_available=True,
            )
            db.add(route)
            db.flush()
            binding = LLMUseCaseRoute(
                use_case=SECTION_REVIEW,
                route_id=route.id,
                protocol_code="openai_chat",
                priority=100,
                is_enabled=True,
                validated_at=utc_now(),
            )
            db.add(binding)
            db.flush()
            binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
            db.commit()
    return app


def create_resume(client: TestClient, app) -> str:
    response = client.post(
        "/api/resumes",
        json={"title": "段落精修简历", "template_id": app.state.test_template_id},
    )
    assert response.status_code == 201, response.text
    return response.json()["resume"]["id"]


def analyze_payload(**overrides: object) -> dict[str, object]:
    return {
        "section": {"entry_id": "entry-1", "heading": "美团 · 后端开发工程师", "lines": LINES},
        "context": CONTEXT,
        "intent": "突出技术深度",
        "reference": {"kind": "general"},
        **overrides,
    }


def analysis_reply() -> dict[str, object]:
    return {
        "inferred_focus": "技术深度",
        "notes": [
            {
                "kind": "missing",
                "line_id": "li-1",
                "quote": "拆分单体模块",
                "title": "只写了做了什么，没写难点和结果",
                "detail": "回答两个问题，AI 用你的原话组装。",
                "questions": [
                    {"prompt": "这次改造里，最难解决的是什么？", "options": ["数据一致性", "灰度切流"]},
                    {"prompt": "结果如何？"},
                ],
            },
            {
                "kind": "wording",
                "line_id": "li-2",
                "quote": "这句不在原文里",
                "title": "「参与…工作」读起来偏弱",
                "detail": "只调整措辞。",
                "variants": [
                    {"label": "稳妥", "text": "参与开发限流与熔断组件，负责组件迭代与线上稳定性保障。", "risky_terms": []},
                    {"label": "更有冲击力", "text": "作为核心成员开发限流与熔断组件。", "risky_terms": ["核心成员", "不在文中"]},
                ],
            },
            {
                "kind": "structure",
                "line_id": "li-1",
                "title": "和调度平台讲的是同一件事",
                "proposal": {"context_id": "entry-2", "summary": "各讲一个侧面", "line_id": "li-1", "text": "主导配送服务改造。"},
            },
            {"kind": "wording", "line_id": "li-404", "title": "锚点不存在", "variants": [{"text": "x"}]},
            {
                "kind": "structure",
                "line_id": "li-1",
                "title": "引用了未发送的上下文",
                "proposal": {"context_id": "entry-9", "line_id": "li-1", "text": "x"},
            },
            {"kind": "missing", "line_id": "li-2", "title": "没有追问的缺信息批注"},
        ],
    }


def test_analyze_returns_anchored_notes_and_drops_invalid_ones(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "review@example.test")
        resume_id = create_resume(client, app)

        response = client.post(f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reference_label"] == "通用写作标准"
    assert body["too_thin"] is False
    # The user already gave a direction, so the model's guess is not surfaced.
    assert body["inferred_focus"] is None
    notes = body["notes"]
    assert [note["kind"] for note in notes] == ["missing", "wording", "structure"]
    assert [note["id"] for note in notes] == ["n1", "n2", "n3"]
    assert notes[0]["quote"] == "拆分单体模块"
    assert [q["id"] for q in notes[0]["questions"]] == ["n1-q1", "n1-q2"]
    assert notes[1]["quote"] == ""
    assert notes[1]["variants"][1]["risky_terms"] == ["核心成员"]
    assert notes[2]["proposal"]["context_id"] == "entry-2"
    assert "&lt;" not in gateway.user_messages[0]
    assert '<data name="context">' in gateway.user_messages[0]


def test_one_malformed_note_does_not_fail_the_whole_analysis(database_url) -> None:
    reply = analysis_reply()
    reply["notes"] = [
        {"kind": "style", "line_id": "li-1", "title": "未知类型"},
        {"kind": "wording", "line_id": "li-2", "title": "超" * 300, "variants": [{"text": "x"}]},
        *reply["notes"][:1],
    ]
    gateway = ReviewGateway()
    gateway.push(reply)
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "lenient@example.test")
        resume_id = create_resume(client, app)
        response = client.post(f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload())

    assert response.status_code == 200, response.text
    assert [note["kind"] for note in response.json()["notes"]] == ["missing"]
    assert len(gateway.user_messages) == 1


def test_analyze_surfaces_inferred_focus_without_intent(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "focus@example.test")
        resume_id = create_resume(client, app)
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:analyze",
            json=analyze_payload(intent=None),
        )
    assert response.status_code == 200, response.text
    assert response.json()["inferred_focus"] == "技术深度"


def test_thin_section_returns_draft_questions_without_model_call(database_url) -> None:
    gateway = ReviewGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "thin@example.test")
        resume_id = create_resume(client, app)
        payload = analyze_payload(
            section={"entry_id": "entry-1", "heading": "美团", "lines": [{"id": "li-1", "text": "后端开发"}]}
        )
        response = client.post(f"/api/resumes/{resume_id}/section-review:analyze", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["too_thin"] is True
    assert len(body["draft_questions"]) == 3
    assert body["notes"] == []
    assert gateway.calls == 0


def test_other_users_resume_and_job_are_not_found(database_url) -> None:
    gateway = ReviewGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "owner@example.test")
        resume_id = create_resume(owner, app)
        job_id = create_job(owner, "虚构科技")
        register(other, "other@example.test")
        own_resume = create_resume(other, app)
        response = other.post(f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload())
        assert response.status_code == 404
        assert response.json()["error"] == "RESUME_NOT_FOUND"
        response = other.post(
            f"/api/resumes/{own_resume}/section-review:analyze",
            json=analyze_payload(reference={"kind": "job", "job_id": job_id}),
        )
        assert response.status_code == 404
        assert response.json()["error"] == "JOB_NOT_FOUND"
    assert gateway.calls == 0


def test_job_reference_uses_owned_job_label(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push({"inferred_focus": None, "notes": []})
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "job@example.test")
        resume_id = create_resume(client, app)
        job_id = create_job(client, "虚构科技")
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:analyze",
            json=analyze_payload(reference={"kind": "job", "job_id": job_id}),
        )
    assert response.status_code == 200, response.text
    assert response.json()["reference_label"] == "虚构科技 · 后端开发工程师"
    assert "虚构科技" in gateway.user_messages[0]


@pytest.mark.parametrize(
    "overrides",
    [
        {"section": {"entry_id": "e", "lines": [{"id": f"l{i}", "text": "x"} for i in range(21)]}},
        {"section": {"entry_id": "e", "lines": [{"id": "l", "text": "x"}, {"id": "l", "text": "y"}]}},
        {"context": [{"id": f"c{i}", "text": "x"} for i in range(7)]},
        {"intent": "长" * 301},
    ],
)
def test_oversized_requests_are_rejected(database_url, overrides) -> None:
    gateway = ReviewGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, f"limit-{uuid4().hex[:8]}@example.test")
        resume_id = create_resume(client, app)
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload(**overrides)
        )
    assert response.status_code == 422
    assert gateway.calls == 0


def test_unconfigured_use_case_returns_503(database_url) -> None:
    gateway = ReviewGateway()
    app = build_app(database_url, gateway, configure=False)
    with TestClient(app) as client:
        register(client, "unconfigured@example.test")
        resume_id = create_resume(client, app)
        response = client.post(f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload())
    assert response.status_code == 503
    assert response.json()["error"] == "LLM_MODEL_NOT_CONFIGURED"


def test_invalid_structure_twice_returns_502(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push("not json")
    gateway.push("still not json")
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "invalid@example.test")
        resume_id = create_resume(client, app)
        response = client.post(f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload())
    assert response.status_code == 502
    assert response.json()["error"] == "LLM_RESPONSE_INVALID"
    assert gateway.calls == 2


def test_rewrite_returns_variants_and_missing_labels(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(
        {
            "variants": [
                {"label": "稳妥", "text": "参与开发限流与熔断组件，负责组件迭代与线上稳定性保障。"},
                {"label": "更有冲击力", "text": "作为核心成员开发限流与熔断组件。", "risky_terms": ["核心成员"]},
                {"label": "多余", "text": "第三个版本会被截掉。"},
            ],
            "missing": ["结果", "结果"],
        }
    )
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "rewrite@example.test")
        resume_id = create_resume(client, app)
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={
                "section": {"entry_id": "entry-1", "heading": "美团", "lines": LINES},
                "context": CONTEXT,
                "line_id": "li-2",
                "instruction": "写得更有冲击力，但别夸大",
            },
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [v["id"] for v in body["variants"]] == ["r-a", "r-b"]
    assert body["variants"][1]["risky_terms"] == ["核心成员"]
    assert body["missing"] == ["结果"]


def test_rewrite_requires_known_line_and_some_input(database_url) -> None:
    gateway = ReviewGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "rewrite-invalid@example.test")
        resume_id = create_resume(client, app)
        section = {"entry_id": "entry-1", "heading": "美团", "lines": LINES}
        unknown = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": section, "line_id": "li-404", "instruction": "改短"},
        )
        empty = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": section, "line_id": "li-1"},
        )
    assert unknown.status_code == 422
    assert empty.status_code == 422
    assert gateway.calls == 0
