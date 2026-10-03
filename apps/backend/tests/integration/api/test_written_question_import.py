import base64
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from linkresume.application.interviews.written_import_service import ExtractedQuestion, ExtractedQuestions
from linkresume.modules.llm.resolver import JOB_IMAGE_EXTRACTION, JOB_TEXT_EXTRACTION
from tests.integration.api.test_interviews import (
    FakeStorage,
    build_app,
    create_application,
    create_job,
    create_pending_application,
    fixture_datetime,
    register,
    session_payload,
)


class FakeStructuredLLM:
    def __init__(self, questions: list[str]) -> None:
        self.questions = questions
        self.calls: list[dict] = []

    async def structured_chat(self, user_id, messages, *, source, response_model, use_case):
        self.calls.append({"messages": messages, "source": source, "use_case": use_case})
        return SimpleNamespace(value=ExtractedQuestions(
            questions=[ExtractedQuestion(text=item) for item in self.questions]
        ))


def written_session(client: TestClient) -> dict:
    pending = create_pending_application(client, "示例笔试公司")
    staged = client.post(f"/api/job-applications/{pending['id']}/stages", json={
        "client_request_id": str(uuid4()), "stage_type": "written_test",
        "base_lock_version": pending["lock_version"],
    })
    assert staged.status_code == 200, staged.text
    application = staged.json()["application"]
    created = client.post(f"/api/job-applications/{application['id']}/interview-sessions", json={
        "client_request_id": str(uuid4()),
        "application_stage_id": application["current_stage"]["id"],
        "stage_type": "other", "round_no": None, "stage_label": "笔试",
        "start_at": fixture_datetime(3, 12).isoformat(), "end_at": fixture_datetime(3, 14).isoformat(),
        "timezone": "Asia/Shanghai", "mode": "video",
    })
    assert created.status_code == 201, created.text
    return created.json()["session"]


def png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def extract(client, session_id, **kwargs):
    return client.post(f"/api/interview-sessions/{session_id}/written-questions:extract", **kwargs)


def test_pasted_text_is_split_into_a_numbered_preview_without_saving():
    app = build_app(FakeStorage())
    llm = FakeStructuredLLM(["1. 实现 LRU 缓存", "实现 LRU 缓存", "选择正确的说法\nA. 甲\nB. 乙"])
    app.state.llm_service = llm
    with TestClient(app) as client:
        register(client, "written-text@example.test")
        session = written_session(client)
        response = extract(client, session["id"], data={"source": "text", "text": "一、实现 LRU 缓存 二、选择题"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert [item["text"] for item in body["questions"]] == ["实现 LRU 缓存", "选择正确的说法\nA. 甲\nB. 乙"]
        assert body["markdown"] == "1. 实现 LRU 缓存\n\n2. 选择正确的说法\n   A. 甲\n   B. 乙"
        assert llm.calls[0]["use_case"] == JOB_TEXT_EXTRACTION
        detail = client.get(f"/api/interview-sessions/{session['id']}").json()["session"]
        assert detail["questions_markdown"] is None


def test_screenshots_use_the_vision_route_and_are_limited():
    app = build_app(FakeStorage())
    llm = FakeStructuredLLM(["设计一个短链服务"])
    app.state.llm_service = llm
    with TestClient(app) as client:
        register(client, "written-image@example.test")
        session = written_session(client)
        image = ("q.png", png_bytes(), "image/png")
        ok = extract(client, session["id"], data={"source": "images"}, files=[("files", image), ("files", image)])
        assert ok.status_code == 200, ok.text
        assert llm.calls[0]["use_case"] == JOB_IMAGE_EXTRACTION
        parts = llm.calls[0]["messages"][1].content
        assert sum(1 for part in parts if getattr(part, "type", "") == "image_url") == 2
        too_many = extract(client, session["id"], data={"source": "images"}, files=[("files", image)] * 6)
        assert too_many.status_code == 400
        broken = extract(client, session["id"], data={"source": "images"}, files=[("files", ("q.png", b"nope", "image/png"))])
        assert broken.status_code == 400
        assert broken.json()["error"] == "INTERVIEW_IMPORT_IMAGE_INVALID"


def test_only_owned_written_sessions_can_import_and_empty_results_are_rejected():
    app = build_app(FakeStorage())
    app.state.llm_service = FakeStructuredLLM([])
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "written-owner@example.test")
        register(other, "written-other@example.test")
        session = written_session(owner)
        assert extract(other, session["id"], data={"source": "text", "text": "题目"}).status_code == 404
        empty = extract(owner, session["id"], data={"source": "text", "text": "没有题目的说明文字"})
        assert empty.status_code == 422
        assert extract(owner, session["id"], data={"source": "text", "text": "  "}).status_code == 400
        assert extract(owner, session["id"], data={"source": "text", "text": "题" * 20_001}).status_code == 400
        assert extract(owner, session["id"], data={"source": "dataset", "dataset_id": "999"}).status_code == 404

        application = create_application(owner, create_job(owner, "示例面试公司"))
        interview = owner.post(
            f"/api/job-applications/{application['id']}/interview-sessions", json=session_payload(str(uuid4()))
        ).json()["session"]
        not_written = extract(owner, interview["id"], data={"source": "text", "text": "题目"})
        assert not_written.status_code == 400
