import json
from types import SimpleNamespace

from drawoffer.modules.agent.conversation_memory import project_memory


def message(sequence, metadata, role="user"):
    return SimpleNamespace(sequence_no=sequence, role=role, metadata_json=metadata)


def test_memory_keeps_multiple_objects_and_task_outcomes_without_body():
    memory = project_memory([
        message(1, {"contexts": [{"type": "resume", "id": "11", "label": "张三后端简历"}],
                    "agent_tasks": [{"id": "a", "label": "第一段分析", "status": "completed",
                                     "context_refs": [{"type": "resume", "id": "11"}],
                                     "result": "建议说明职责"}]}),
        message(3, {"resume_resolutions": [{"resume_id": "22", "label_at_resolution": "张三产品简历", "source": "memory"}],
                    "agent_tasks": [{"id": "b", "label": "第二段分析", "status": "blocked",
                                     "resolved_refs": [{"type": "resume", "id": "22"}]}]}),
        message(4, {"contexts": [{"type": "resume", "id": "999", "label": "伪造"}]}, "assistant"),
    ])
    assert [item["resource"]["id"] for item in memory["events"]] == ["11", "22"]
    assert memory["events"][1]["tasks"][0]["status"] == "blocked"
    assert memory["events"][0]["tasks"][0]["result"] == "建议说明职责"
    assert "content" not in json.dumps(memory)
    assert "999" not in json.dumps(memory)


def test_memory_budget_keeps_whole_events_and_marks_truncation():
    memory = project_memory([message(index, {"contexts": [{
        "type": "resume", "id": str(index), "label": "示例" * 200,
    }]}) for index in range(1, 42)])
    assert memory["truncated"]
    assert len(json.dumps(memory, ensure_ascii=False)) <= 6000
    assert len({event["resource"]["id"] for event in memory["events"]}) <= 10
    assert memory["events"][-1]["source_sequence_no"] == 41


def test_old_resolved_refs_recover_identity_but_not_assumed_completion():
    memory = project_memory([message(2, {"agent_tasks": [{
        "id": "a", "label": "分析", "status": "failed",
        "resolved_refs": [{"type": "resume", "id": "7"}],
    }]})])
    assert memory["events"][0]["resource"] == {"type": "resume", "id": "7", "label": ""}
    assert memory["events"][0]["tasks"][0]["status"] == "failed"


def test_task_relationship_uses_frozen_target_instead_of_unchanged_background_plan():
    memory = project_memory([message(5, {
        "contexts": [{"type": "resume", "id": "11", "label": "张三后端", "presentation": "implicit"}],
        "resume_resolutions": [{"task_id": "a", "resume_id": "22", "label_at_resolution": "张三产品", "source": "memory"}],
        "agent_tasks": [{"id": "a", "label": "分析第二段", "status": "completed",
                         "context_refs": [{"type": "resume", "id": "11"}],
                         "resolved_refs": [{"type": "resume", "id": "22"}]}],
    })])
    by_id = {event["resource"]["id"]: event for event in memory["events"]}
    assert by_id["11"]["tasks"] == []
    assert by_id["22"]["tasks"][0]["label"] == "分析第二段"


def test_malformed_legacy_metadata_does_not_break_next_turn():
    memory = project_memory([message(1, {"contexts": None, "agent_tasks": {}, "resume_resolutions": "invalid"})])
    assert memory["events"] == []


def test_all_mention_types_have_separate_identity_even_with_same_numeric_id():
    kinds = ["user_profile", "resume", "dataset", "job", "application", "interview"]
    memory = project_memory([message(1, {"contexts": [
        {"type": kind, "id": "7", "label": f"虚构{kind}", "content": "MUST_NOT_COPY_BODY"}
        for kind in kinds
    ]})])
    assert {event["memory_ref"] for event in memory["events"]} == {f"m:1:{kind}:7" for kind in kinds}
    assert "MUST_NOT_COPY_BODY" not in json.dumps(memory)


def test_resource_resolution_recovers_history_and_freezes_task_relationship():
    memory = project_memory([message(3, {
        "contexts": [{"type": "dataset", "id": "1", "label": "虚构旧文件"}],
        "resource_resolutions": [{"type": "dataset", "id": "2", "task_id": "a",
                                  "label_at_resolution": "虚构新文件", "source": "memory"}],
        "agent_tasks": [{"id": "a", "label": "继续文件", "status": "completed",
                         "context_refs": [{"type": "dataset", "id": "1"}],
                         "resolved_refs": [{"type": "dataset", "id": "2"}]}],
    })])
    by_id = {event["resource"]["id"]: event for event in memory["events"]}
    assert by_id["1"]["tasks"] == []
    assert by_id["2"]["source"] == "memory"
    assert by_id["2"]["tasks"][0]["label"] == "继续文件"
    assert project_memory([message(1, {"contexts": [{"type": {}, "id": "1"}]})])["events"] == []


def test_memory_uses_latest_user_request_within_steered_run():
    from sqlalchemy import select
    from fastapi.testclient import TestClient
    from tests.integration.api.test_agent_routes import build_app, register, create_active_run
    from drawoffer.modules.agent.models import AgentMessage, AgentRun
    from drawoffer.modules.agent.conversation_memory import conversation_memory
    app = build_app()
    with TestClient(app) as client:
        register(client, "memory-steered@example.test")
        sid = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        rid = create_active_run(app, sid)
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == rid))
            first = db.scalar(select(AgentMessage).where(AgentMessage.run_id == run.id))
            first.metadata_json = {"contexts": [{"type": "dataset", "id": "7", "label": "虚构首轮文件"}]}
            db.add(AgentMessage(session_id=run.session_id, run_id=run.id, sequence_no=3,
                                role="user", content="继续文件", metadata_json={}))
            db.commit()
            assert conversation_memory(db, run)["events"][0]["memory_ref"] == "m:1:dataset:7"
