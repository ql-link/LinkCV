from __future__ import annotations

import json
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import func, select

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
from linkresume.modules.resumes.section_review_models import (
    ResumeSectionReview,
    ResumeSectionReviewItem,
)
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


def analyze(client: TestClient, resume_id: str, **overrides: object) -> dict[str, object]:
    response = client.post(f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload(**overrides))
    assert response.status_code == 200, response.text
    return response.json()["review"]


def rewrite_payload(review_id: str, **fields: object) -> dict[str, object]:
    return {
        "section": {"entry_id": "entry-1", "heading": "美团", "lines": LINES},
        "context": CONTEXT,
        "review_id": review_id,
        **fields,
    }


def rewrite_reply(text: str = "按回答重写：负责配送调度服务改造，解决数据一致性问题。") -> dict[str, object]:
    return {"variants": [{"label": "按你的回答", "text": text}], "missing": []}


def item_url(resume_id: str, review: dict, item: dict) -> str:
    return f"/api/resumes/{resume_id}/section-reviews/{review['id']}/items/{item['id']}"


def applied_edit(line_id: str = "li-2") -> dict[str, str]:
    return {"line_id": line_id, "before": LINES[1]["text"], "after": "参与开发限流与熔断组件，负责组件迭代与线上稳定性保障。"}


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


def test_method_reference_uses_writing_method_standard(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push({"inferred_focus": None, "notes": []})
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "method@example.test")
        resume_id = create_resume(client, app)
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:analyze",
            json=analyze_payload(reference={"kind": "method", "method": "star"}),
        )
        unknown = client.post(
            f"/api/resumes/{resume_id}/section-review:analyze",
            json=analyze_payload(reference={"kind": "method", "method": "unknown"}),
        )
    assert response.status_code == 200, response.text
    assert response.json()["reference_label"] == "STAR 法则"
    assert "情境（Situation）" in gateway.user_messages[0]
    assert unknown.status_code == 422
    assert gateway.calls == 1


def test_style_with_optional_job_combines_both(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push({"inferred_focus": None, "notes": []})
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "style-job@example.test")
        resume_id = create_resume(client, app)
        job_id = create_job(client, "虚构科技")
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:analyze",
            json=analyze_payload(reference={"kind": "method", "method": "xyz"}, job_id=job_id),
        )
        doubled = client.post(
            f"/api/resumes/{resume_id}/section-review:analyze",
            json=analyze_payload(reference={"kind": "job", "job_id": job_id}, job_id=job_id),
        )
    assert response.status_code == 200, response.text
    assert response.json()["reference_label"] == "XYZ 公式 · 虚构科技 · 后端开发工程师"
    assert "XYZ 公式" in gateway.user_messages[0]
    assert "虚构科技" in gateway.user_messages[0]
    assert doubled.status_code == 422
    assert gateway.calls == 1


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
    gateway.replies.insert(0, json.dumps(analysis_reply(), ensure_ascii=False))
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "rewrite@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json=rewrite_payload(review["id"], item_kind="ask", line_id="li-2", instruction="写得更有冲击力，但别夸大"),
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [v["id"] for v in body["variants"]] == ["r-a", "r-b"]
    assert body["variants"][1]["risky_terms"] == ["核心成员"]
    assert body["missing"] == ["结果"]
    # Saved as a new request item of the user's, ready to confirm.
    item = body["item"]
    assert item["kind"] == "ask"
    assert item["status"] == "pending"
    assert item["instruction"] == "写得更有冲击力，但别夸大"
    assert item["draft"]["base_text"] == LINES[1]["text"]
    assert [v["id"] for v in item["draft"]["variants"]] == ["r-a", "r-b"]


def test_rewrite_requires_known_line_and_some_input(database_url) -> None:
    gateway = ReviewGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "rewrite-invalid@example.test")
        resume_id = create_resume(client, app)
        section = {"entry_id": "entry-1", "heading": "美团", "lines": LINES}
        target = {"review_id": "1", "item_kind": "ask"}
        unknown = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": section, "line_id": "li-404", "instruction": "改短", **target},
        )
        empty = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": section, "line_id": "li-1", **target},
        )
        both = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": section, "line_id": "li-1", "instruction": "改短", "review_id": "1", "item_id": "1", "item_kind": "ask"},
        )
        neither = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": section, "line_id": "li-1", "instruction": "改短", "review_id": "1"},
        )
        orphan = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": section, "line_id": "li-1", "instruction": "改短", "item_kind": "ask"},
        )
    assert unknown.status_code == 422
    assert empty.status_code == 422
    assert both.status_code == 422
    assert neither.status_code == 422
    assert orphan.status_code == 422
    assert gateway.calls == 0


# --- saved results -----------------------------------------------------------


def test_analysis_is_saved_and_listed_with_items(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "saved@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        listed = client.get(f"/api/resumes/{resume_id}/section-reviews")

    assert review["unit_id"] == "entry-1"
    assert review["analysis_no"] == 1
    assert review["intent"] == "突出技术深度"
    assert review["context_ids"] == ["entry-2"]
    assert review["base_lines"] == {line["id"]: line["text"] for line in LINES}
    items = review["items"]
    assert [item["kind"] for item in items] == ["missing", "wording", "structure"]
    assert {item["status"] for item in items} == {"todo"}
    assert items[0]["note"]["id"] == "n1" and items[0]["draft"] is None
    # Expression and structure notes come with their candidates already.
    assert items[1]["draft"]["base_text"] == LINES[1]["text"]
    assert items[2]["draft"]["variants"][0]["text"] == "主导配送服务改造。"
    assert items[2]["draft"]["line_id"] == "li-1"
    assert listed.status_code == 200, listed.text
    assert listed.json()["reviews"] == [review]


def test_thin_section_is_saved_without_items(database_url) -> None:
    gateway = ReviewGateway()
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "saved-thin@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id, section={"entry_id": "entry-1", "heading": "", "lines": [{"id": "li-1", "text": "写代码"}]})
    assert review["result"]["too_thin"] is True
    assert review["items"] == []
    assert gateway.calls == 0


def test_reanalysis_keeps_applied_items_and_replaces_the_rest(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    gateway.push({"notes": [{"kind": "wording", "line_id": "li-1", "title": "新的批注", "variants": [{"text": "改造配送调度服务。"}]}]})
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "reanalyze@example.test")
        resume_id = create_resume(client, app)
        first = analyze(client, resume_id)
        wording = first["items"][1]
        applied = client.patch(item_url(resume_id, first, wording), json={"status": "done", "edit": applied_edit()})
        assert applied.status_code == 200, applied.text
        second = analyze(client, resume_id)

    assert second["id"] == first["id"]
    assert second["analysis_no"] == 2
    items = second["items"]
    assert [item["id"] for item in items][0] == wording["id"]
    kept = items[0]
    assert kept["status"] == "done"
    assert kept["edit"] == applied_edit()
    # Its note is kept even though the new analysis reuses the id n1.
    assert kept["note"]["title"] == "「参与…工作」读起来偏弱"
    assert [item["note"]["title"] for item in items[1:]] == ["新的批注"]


def test_rewrite_of_a_note_is_saved_and_survives_listing(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    gateway.push(rewrite_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "rewrite-note@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        missing = review["items"][0]
        answered = client.patch(
            item_url(resume_id, review, missing),
            json={"status": "asking", "answers": ["数据一致性"], "question_index": 1},
        )
        assert answered.status_code == 200, answered.text
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json=rewrite_payload(
                review["id"],
                item_id=missing["id"],
                line_id="li-1",
                answers=[{"question": "最难的是什么？", "answer": "数据一致性"}],
            ),
        )
        listed = client.get(f"/api/resumes/{resume_id}/section-reviews").json()["reviews"][0]

    assert response.status_code == 200, response.text
    item = response.json()["item"]
    assert item["id"] == missing["id"]
    assert item["status"] == "pending"
    assert item["answers"] == ["数据一致性"]
    assert item["question_index"] == 1
    assert item["draft"]["variants"][0]["label"] == "按你的回答"
    assert listed["items"][0] == item


def test_new_draft_replaces_the_unapplied_one(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(rewrite_reply("第一次起草。"))
    gateway.push(rewrite_reply("第二次起草。"))
    app = build_app(database_url, gateway)
    thin = {"entry_id": "entry-1", "heading": "", "lines": [{"id": "li-1", "text": "写代码"}]}
    with TestClient(app) as client:
        register(client, "draft@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id, section=thin)
        prompts = [question["prompt"] for question in review["result"]["draft_questions"]]
        # The second question is left blank, so the request carries only two answers.
        answers = [{"question": prompts[0], "answer": "订单服务"}, {"question": prompts[2], "answer": "下单耗时缩短 30%"}]
        for _ in range(2):
            response = client.post(
                f"/api/resumes/{resume_id}/section-review:rewrite",
                json={**rewrite_payload(review["id"], item_kind="draft", line_id="li-1", answers=answers), "section": thin},
            )
            assert response.status_code == 200, response.text
        items = client.get(f"/api/resumes/{resume_id}/section-reviews").json()["reviews"][0]["items"]

    assert len(items) == 1
    assert items[0]["kind"] == "draft"
    # Saved by question position, so the third answer stays with the third question.
    assert items[0]["answers"] == ["订单服务", "", "下单耗时缩短 30%"]
    assert items[0]["draft"]["variants"][0]["text"] == "第二次起草。"


def test_rewrite_refuses_applied_and_replaced_items(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "rewrite-refused@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        wording, structure = review["items"][1], review["items"][2]
        client.patch(item_url(resume_id, review, wording), json={"status": "done", "edit": applied_edit()})
        applied = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json=rewrite_payload(review["id"], item_id=wording["id"], line_id="li-2", instruction="换一种语气"),
        )
        analyze(client, resume_id)
        replaced = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json=rewrite_payload(review["id"], item_id=structure["id"], line_id="li-1", instruction="换一种语气"),
        )
        other_paragraph = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={**rewrite_payload(review["id"], item_kind="ask", line_id="li-1", instruction="改短"), "section": {"entry_id": "entry-9", "lines": LINES}},
        )

    assert applied.status_code == 409
    assert applied.json()["error"] == "SECTION_REVIEW_ITEM_APPLIED"
    assert replaced.status_code == 404
    assert replaced.json()["error"] == "SECTION_REVIEW_NOT_FOUND"
    assert other_paragraph.status_code == 404
    # Two analyses; none of the refused rewrites reached the model.
    assert gateway.calls == 2


def test_rewrite_refuses_new_items_beyond_the_limit(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "limit@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        with app.state.session_factory() as db:
            owner_id = db.get(ResumeSectionReview, int(review["id"])).user_id
            for _ in range(27):
                db.add(
                    ResumeSectionReviewItem(
                        user_id=owner_id,
                        resume_id=int(resume_id),
                        review_id=int(review["id"]),
                        kind="ask",
                        instruction="虚构要求",
                        status="skipped",
                        answers_json=[],
                    )
                )
            db.commit()
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json=rewrite_payload(review["id"], item_kind="ask", line_id="li-1", instruction="改短"),
        )
    assert response.status_code == 409
    assert response.json()["error"] == "SECTION_REVIEW_ITEM_LIMIT"
    assert gateway.calls == 1


def test_item_updates_follow_the_state_machine(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "patch@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        missing, wording, structure = review["items"]

        def patch(item: dict, body: dict):
            return client.patch(item_url(resume_id, review, item), json=body)

        # Choosing a version, then applying with the before/after text.
        assert patch(wording, {"selected_index": 1}).json()["selected_index"] == 1
        assert patch(wording, {"selected_index": 2}).status_code == 422
        no_edit = patch(wording, {"status": "done"})
        done = patch(wording, {"status": "done", "edit": applied_edit()})
        repeat = patch(wording, {"status": "done", "edit": applied_edit()})
        change_applied = patch(wording, {"selected_index": 0})
        # Undo goes back to pending because the item has candidates.
        undone = patch(wording, {"status": "pending", "edit": None})

        # Answering follow-up questions; a missing note has no candidates to undo to.
        asking = patch(missing, {"status": "asking", "answers": ["灰度切流"], "question_index": 1})
        too_far = patch(missing, {"question_index": 2})
        skipped = patch(structure, {"status": "skipped"})
        revived = patch(structure, {"status": "todo"})
        empty = patch(structure, {})

    assert no_edit.status_code == 409
    assert no_edit.json()["error"] == "SECTION_REVIEW_INVALID_TRANSITION"
    assert done.status_code == 200, done.text
    assert done.json()["edit"] == applied_edit()
    assert repeat.status_code == 200
    assert change_applied.status_code == 409
    assert undone.status_code == 200, undone.text
    assert undone.json()["status"] == "pending"
    assert undone.json()["edit"] is None
    assert asking.json()["status"] == "asking"
    assert asking.json()["answers"] == ["灰度切流"]
    assert too_far.status_code == 409
    assert skipped.json()["status"] == "skipped"
    assert revived.status_code == 409
    assert empty.status_code == 422


def test_saved_results_are_private(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as owner:
        register(owner, "owner@example.test")
        resume_id = create_resume(owner, app)
        review = analyze(owner, resume_id)
        item = review["items"][0]
    with TestClient(app) as other:
        register(other, "other@example.test")
        listed = other.get(f"/api/resumes/{resume_id}/section-reviews")
        patched = other.patch(item_url(resume_id, review, item), json={"status": "skipped"})
        own_resume = create_resume(other, app)
        cross = other.patch(item_url(own_resume, review, item), json={"status": "skipped"})
    assert listed.status_code == 404
    assert listed.json()["error"] == "RESUME_NOT_FOUND"
    assert patched.status_code == 404
    assert cross.status_code == 404
    assert cross.json()["error"] == "SECTION_REVIEW_NOT_FOUND"


def test_failed_analysis_keeps_the_saved_result(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "failed@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        # No reply queued: the model answers garbage twice and the analysis fails.
        failed = client.post(f"/api/resumes/{resume_id}/section-review:analyze", json=analyze_payload())
        listed = client.get(f"/api/resumes/{resume_id}/section-reviews").json()["reviews"]
    assert failed.status_code == 502
    assert listed == [review]


def test_deleting_the_resume_removes_saved_results(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "delete@example.test")
        resume_id = create_resume(client, app)
        analyze(client, resume_id)
        deleted = client.delete(f"/api/resumes/{resume_id}")
    assert deleted.status_code == 200, deleted.text
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(ResumeSectionReview)) == 0
        assert db.scalar(select(func.count()).select_from(ResumeSectionReviewItem)) == 0


def test_rewrite_without_review_id_is_returned_but_not_saved(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(rewrite_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "legacy-rewrite@example.test")
        resume_id = create_resume(client, app)
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json={"section": {"entry_id": "entry-1", "heading": "", "lines": LINES}, "line_id": "li-1", "instruction": "改短"},
        )
    # A client from before saved results keeps working during a rolling release.
    assert response.status_code == 200, response.text
    assert response.json()["item"] is None
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(ResumeSectionReviewItem)) == 0


def test_rewrite_refuses_skipped_items(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "rewrite-skipped@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        wording = review["items"][1]
        client.patch(item_url(resume_id, review, wording), json={"status": "skipped"})
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json=rewrite_payload(review["id"], item_id=wording["id"], line_id="li-2", instruction="换一种语气"),
        )
    assert response.status_code == 409
    assert response.json()["error"] == "SECTION_REVIEW_INVALID_TRANSITION"
    assert gateway.calls == 1


def test_applied_items_do_not_count_toward_the_limit(database_url) -> None:
    gateway = ReviewGateway()
    gateway.push(analysis_reply())
    gateway.push(rewrite_reply())
    app = build_app(database_url, gateway)
    with TestClient(app) as client:
        register(client, "limit-applied@example.test")
        resume_id = create_resume(client, app)
        review = analyze(client, resume_id)
        with app.state.session_factory() as db:
            owner_id = db.get(ResumeSectionReview, int(review["id"])).user_id
            for _ in range(40):
                db.add(
                    ResumeSectionReviewItem(
                        user_id=owner_id,
                        resume_id=int(resume_id),
                        review_id=int(review["id"]),
                        kind="ask",
                        instruction="虚构要求",
                        status="done",
                        answers_json=[],
                        edit_json=applied_edit(),
                    )
                )
            db.commit()
        response = client.post(
            f"/api/resumes/{resume_id}/section-review:rewrite",
            json=rewrite_payload(review["id"], item_kind="ask", line_id="li-1", instruction="改短"),
        )
    assert response.status_code == 200, response.text
