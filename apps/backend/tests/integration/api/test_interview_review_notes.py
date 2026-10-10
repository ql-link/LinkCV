from uuid import uuid4

from fastapi.testclient import TestClient

from drawoffer.application.interviews.review_service import question_key
from tests.integration.api.test_interviews import (
    FakeStorage,
    build_app,
    create_application,
    create_job,
    register,
    session_payload,
)


def new_session(client: TestClient) -> dict:
    application = create_application(client, create_job(client, "示例笔记公司"))
    created = client.post(
        f"/api/job-applications/{application['id']}/interview-sessions", json=session_payload(str(uuid4()))
    )
    assert created.status_code == 201, created.text
    return created.json()["session"]


def put_note(client, session_id, **payload):
    return client.put(f"/api/interview-sessions/{session_id}/review-notes", json=payload)


def test_notes_are_keyed_by_normalized_question_and_listed_on_the_session():
    with TestClient(build_app(FakeStorage())) as client:
        register(client, "notes-owner@example.test")
        session = new_session(client)
        created = put_note(client, session["id"], question_text="如何保证接口幂等？", verdict="improve", note=" 补充去重表 ")
        assert created.status_code == 200, created.text
        note = created.json()["note"]
        assert note["note"] == "补充去重表" and note["verdict"] == "improve" and note["lock_version"] == 1
        # Same question with different punctuation and spacing is the same anchor.
        assert note["question_key"] == question_key("如何保证 接口幂等")

        stale = put_note(client, session["id"], question_text="如何保证接口幂等", verdict="good", note="x")
        assert stale.status_code == 409
        updated = put_note(client, session["id"], question_text="如何保证接口幂等", verdict="good", note="答得不错",
                           lock_version=1)
        assert updated.status_code == 200, updated.text
        assert updated.json()["note"]["lock_version"] == 2

        listed = client.get(f"/api/interview-sessions/{session['id']}").json()["session"]["review_question_notes"]
        assert [(item["verdict"], item["note"]) for item in listed] == [("good", "答得不错")]

        cleared = put_note(client, session["id"], question_text="如何保证接口幂等", verdict=None, note="  ", lock_version=2)
        assert cleared.status_code == 204
        assert client.get(f"/api/interview-sessions/{session['id']}").json()["session"]["review_question_notes"] == []


def test_notes_can_be_deleted_and_are_private():
    app = build_app(FakeStorage())
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, "notes-a@example.test")
        register(other, "notes-b@example.test")
        session = new_session(owner)
        note = put_note(owner, session["id"], question_text="自我介绍", note="太长了").json()["note"]
        assert put_note(other, session["id"], question_text="自我介绍", note="x").status_code == 404
        assert other.delete(f"/api/interview-sessions/{session['id']}/review-notes/{note['id']}").status_code == 404
        assert put_note(owner, session["id"], question_text="   ", note="x").status_code == 400
        assert put_note(owner, session["id"], question_text="题", note="长" * 2001).status_code == 400
        deleted = owner.delete(f"/api/interview-sessions/{session['id']}/review-notes/{note['id']}")
        assert deleted.status_code == 204
        assert owner.delete(f"/api/interview-sessions/{session['id']}/review-notes/{note['id']}").status_code == 404


def test_deleting_a_session_removes_its_notes():
    with TestClient(build_app(FakeStorage())) as client:
        register(client, "notes-delete@example.test")
        session = new_session(client)
        put_note(client, session["id"], question_text="项目难点", note="补数据")
        assert client.delete(f"/api/interview-sessions/{session['id']}").status_code == 200
        assert client.get(f"/api/interview-sessions/{session['id']}").status_code == 404
