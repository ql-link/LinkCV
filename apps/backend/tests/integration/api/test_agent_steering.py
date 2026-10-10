from sqlalchemy import select, func
from fastapi.testclient import TestClient
import pytest

from drawoffer.core.database import utc_now
from drawoffer.modules.identity.models import User

from tests.integration.api.test_agent_routes import build_app, register, create_resume, create_active_run, internal_headers
from drawoffer.modules.agent.models import AgentMessage, AgentRun, ResumeChangeProposal
from drawoffer.modules.resumes.models import Resume
from drawoffer.modules.agent.message_scope import request_hash
from drawoffer.modules.agent.schemas import SteeringRequest, MessageCreateRequest


@pytest.mark.parametrize("account_state", ["disabled", "deleting"])
@pytest.mark.parametrize("action,payload", [
    ("steering:activate", {"content": "新请求", "idempotency_key": "owner_guard_1"}),
    ("steering:ack", {"submission_key": "owner_guard_1", "user_sequence_no": 1}),
    ("messages:complete", {"user_sequence_no": 1, "content": "迟到的回复"}),
])
def test_request_scope_callbacks_reject_inactive_owner(account_state, action, payload):
    app = build_app()
    with TestClient(app) as client:
        register(client, "callback-owner@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        with app.state.session_factory() as db:
            owner = db.scalar(select(User).where(User.email == "callback-owner@example.test"))
            if account_state == "disabled":
                owner.status = 0
            else:
                owner.deletion_requested_at = utc_now()
            db.commit()
        response = client.post(f"/internal/agent/runs/{run_id}/{action}",
                               headers={**internal_headers(), "X-Agent-User-Sequence": "1"}, json=payload)
        assert response.status_code == 401
        assert response.json()["error"] == "UNAUTHORIZED"
        with app.state.session_factory() as db:
            assert db.scalar(select(func.count()).select_from(AgentMessage)) == 1


def test_steering_activation_revalidates_target_and_preserves_request_results():
    app = build_app()
    with TestClient(app) as client:
        register(client, "steering-owner@example.test")
        first = create_resume(client, app)
        second = create_resume(client, app, title="张三的第二份测试简历")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id, message_content="第一项工作")
        base = f"/internal/agent/runs/{run_id}"
        source1 = {**internal_headers(), "X-Agent-User-Sequence": "1"}
        plan = client.post(f"{base}/tasks:plan", headers=source1, json={"tasks": [
            {"id": "first", "workflow": "career_planning", "output": "advice", "label": "原任务"},
            {"id": "remaining", "workflow": "career_planning", "output": "advice", "label": "剩余任务"},
        ]})
        assert plan.status_code == 200
        assert client.post(f"{base}/tasks/first:status", headers=source1, json={"status": "running"}).status_code == 200
        assert client.post(f"{base}/tasks/first:status", headers=source1, json={"status": "completed", "result": "已有结论"}).status_code == 200
        completed = client.post(f"{base}/messages:complete", headers=source1, json={"user_sequence_no": 1, "content": "已经完成的回复"})
        assert completed.status_code == 200
        assert completed.json()["sequence_no"] == 2
        payload = {"content": "改为处理另一份简历", "idempotency_key": "steer_target_change_1",
                   "contexts": [{"type": "resume", "id": second["id"], "version": str(second["lock_version"])}],
                   "replace_inherited_resume": True}
        activated = client.post(f"{base}/steering:activate", headers=source1, json=payload)
        assert activated.status_code == 200, activated.text
        assert activated.json()["receipt"]["state"] == "accepted"
        assert activated.json()["receipt"]["user_sequence_no"] == 3
        assert activated.json()["contextMaterials"][0]["id"] == second["id"]
        replay = client.post(f"{base}/steering:activate", headers=source1, json=payload)
        assert replay.status_code == 200
        changed = client.post(f"{base}/steering:activate", headers=source1, json={**payload, "content": "改变正文"})
        assert changed.status_code == 409
        assert changed.json()["error"] == "AGENT_SUBMISSION_CONFLICT"
        for headers in [source1, internal_headers()]:
            stale = client.get(f"{base}/context?resume_id={second['id']}", headers=headers)
            assert stale.status_code == 409
            assert stale.json()["error"] == "AGENT_REQUEST_SCOPE_STALE"
        source3 = {**internal_headers(), "X-Agent-User-Sequence": "3"}
        assert client.get(f"{base}/context?resume_id={first['id']}", headers=source3).status_code == 409
        assert client.get(f"{base}/context?resume_id={second['id']}", headers=source3).status_code == 200
        ack = {"submission_key": payload["idempotency_key"], "user_sequence_no": 3}
        assert client.post(f"{base}/steering:ack", headers=source3, json=ack).json()["state"] == "applied"
        assert client.post(f"{base}/steering:ack", headers=source3, json=ack).json()["state"] == "applied"
        assert client.post(f"{base}/messages:complete", headers=source3, json={"user_sequence_no": 3, "content": "第二个回复"}).status_code == 200
        detail = client.get(f"/api/agent/sessions/{session_id}").json()["session"]["messages"]
        assert [item["content"] for item in detail] == ["第一项工作", "已经完成的回复", payload["content"], "第二个回复"]
        assert [item.get("reply_to_sequence_no") for item in detail] == [None, 1, None, 3]
        assert detail[0]["tasks"][0]["status"] == "completed"
        assert detail[0]["tasks"][1]["status"] == "planned"
        assert detail[0]["tasks"][1]["superseded_by_sequence_no"] == 3
        with app.state.session_factory() as db:
            db.get(Resume, int(second["id"])).lock_version += 1
            db.commit()
        replay_after_change = client.post(f"{base}/steering:activate", headers=source1, json=payload)
        assert replay_after_change.status_code == 200
        assert replay_after_change.json()["receipt"]["state"] == "applied"
        assert replay_after_change.json()["contextMaterials"][0]["version"] == str(second["lock_version"])
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            run.status = "failed"
            db.commit()
        assert client.get(f"/api/agent/runs/{run_id}/steer/{payload['idempotency_key']}").json()["state"] == "applied"
        assert client.get(f"/api/agent/runs/{run_id}/steer/not_received_1").json()["state"] == "not_applied"


def test_waiting_input_is_not_a_database_message_and_private_run_is_hidden(monkeypatch):
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as stranger:
        register(owner, "steering-private@example.test")
        resume = create_resume(owner, app)
        session_id = owner.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        async def admit(_app, _run, *, payload=None, key=None):
            return {"run_id": run_id, "submission_key": payload["idempotency_key"] if payload else key, "state": "waiting"}
        monkeypatch.setattr("drawoffer.modules.agent.routes.pi_steering_request", admit)
        payload = {"content": "等待插入", "idempotency_key": "waiting_input_1",
                   "contexts": [{"type": "resume", "id": resume["id"], "version": str(resume["lock_version"])}]}
        admitted = owner.post(f"/api/agent/runs/{run_id}/steer", json=payload)
        assert admitted.status_code == 202
        with app.state.session_factory() as db:
            assert db.scalar(select(func.count(AgentMessage.id))) == 1

        register(stranger, "steering-stranger@example.test")
        assert stranger.post(f"/api/agent/runs/{run_id}/steer", json=payload).status_code == 404
        assert stranger.get(f"/api/agent/runs/{run_id}/steer/waiting_input_1").status_code == 404
        invalid = {**payload, "contexts": [{"type": "resume", "id": resume["id"], "version": "999"}]}
        rejected = owner.post(f"/internal/agent/runs/{run_id}/steering:activate", headers=internal_headers(), json=invalid)
        assert rejected.status_code == 409
        with app.state.session_factory() as db:
            assert db.scalar(select(func.count(AgentMessage.id))) == 1


def test_waiting_replay_keeps_admission_after_reference_changes(monkeypatch):
    app = build_app()
    with TestClient(app) as client:
        register(client, "waiting-replay@example.test")
        resume = create_resume(client, app)
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        received = {}
        async def admit(_app, _run, *, payload=None, key=None):
            if payload:
                key = payload["idempotency_key"]
                received[key] = {"run_id": run_id, "submission_key": key, "state": "waiting",
                                 "request_hash": request_hash(SteeringRequest.model_validate(payload))}
            return received.get(key, {"run_id": run_id, "submission_key": key, "state": "unknown"})
        monkeypatch.setattr("drawoffer.modules.agent.routes.pi_steering_request", admit)
        payload = {"content": "等待插入", "idempotency_key": "waiting_replay_1",
                   "contexts": [{"type": "resume", "id": resume["id"], "version": str(resume["lock_version"])}]}
        assert client.post(f"/api/agent/runs/{run_id}/steer", json=payload).status_code == 202
        with app.state.session_factory() as db:
            db.get(Resume, int(resume["id"])).lock_version += 1
            db.commit()
        replay = client.post(f"/api/agent/runs/{run_id}/steer", json=payload)
        assert replay.status_code == 202
        assert replay.json()["state"] == "waiting"
        assert "request_hash" not in replay.json()
        conflict = client.post(f"/api/agent/runs/{run_id}/steer", json={**payload, "content": "改写冻结正文"})
        assert conflict.status_code == 409
        assert conflict.json()["error"] == "AGENT_SUBMISSION_CONFLICT"


def test_ordinary_submission_receipt_and_body_conflict_are_owner_scoped():
    app = build_app()
    with TestClient(app) as client, TestClient(app) as stranger:
        register(client, "ordinary-receipt@example.test")
        session_id = client.post("/api/agent/sessions", json={}).json()["session"]["id"]
        run_id = create_active_run(app, session_id)
        payload = {"content": "正式请求", "idempotency_key": "ordinary_receipt_1"}
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            run.idempotency_key = payload["idempotency_key"]
            run.status = "succeeded"
            message = db.scalar(select(AgentMessage).where(AgentMessage.run_id == run.id))
            message.metadata_json = {"submission": {"key": run.idempotency_key,
                "hash": request_hash(MessageCreateRequest.model_validate(payload)), "mode": "follow_up"}}
            db.commit()
        receipt = client.get(f"/api/agent/sessions/{session_id}/submissions/ordinary_receipt_1")
        assert receipt.status_code == 200
        assert receipt.json()["state"] == "applied"
        assert receipt.json()["user_sequence_no"] == 1
        replay = client.post(f"/api/agent/sessions/{session_id}/messages", json=payload)
        assert replay.status_code == 200
        conflict = client.post(f"/api/agent/sessions/{session_id}/messages", json={**payload, "content": "不同请求"})
        assert conflict.status_code == 409
        assert conflict.json()["error"] == "AGENT_SUBMISSION_CONFLICT"
        register(stranger, "receipt-stranger@example.test")
        assert stranger.get(f"/api/agent/sessions/{session_id}/submissions/ordinary_receipt_1").status_code == 404


def test_inserted_proposal_revision_keeps_prior_proposal_until_replacement():
    from datetime import timedelta
    from uuid import uuid4
    from drawoffer.core.database import utc_now
    from drawoffer.modules.agent.message_scope import register_proposal, source_sequence_no
    from drawoffer.modules.agent.service import supersede_revision_source

    app = build_app()
    with TestClient(app) as client:
        register(client, 'inserted-revision@example.test')
        resume = create_resume(client, app)
        session_id = client.post('/api/agent/sessions', json={}).json()['session']['id']
        run_id = create_active_run(app, session_id)
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            original = ResumeChangeProposal(public_id=str(uuid4()), run_id=run.id, call_key='original',
                user_id=1, resume_id=int(resume['id']), base_lock_version=resume['lock_version'],
                proposed_data_json=resume['data'], proposed_style_json=resume['style'], summary='旧提案',
                status='pending', expires_at=utc_now()+timedelta(days=1))
            db.add(original); db.flush()
            register_proposal(db, run, original.public_id)
            db.commit()
            original_id = original.public_id
        activated = client.post(f'/internal/agent/runs/{run_id}/steering:activate', headers=internal_headers(),
            json={'content':'继续调整旧提案', 'idempotency_key':'inserted_revision_1', 'revision_proposal_id':original_id})
        assert activated.status_code == 200, activated.text
        assert activated.json()['revisionProposal']['summary'] == '旧提案'
        assert activated.json()['contextMaterials'][0]['id'] == resume['id']
        source = activated.json()['receipt']['user_sequence_no']
        assert source == 2
        assert client.get(f'/api/agent/proposals?session_id={session_id}').json()['proposals'][0]['status'] == 'pending'
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            replacement = ResumeChangeProposal(public_id=str(uuid4()), run_id=run.id, call_key='replacement',
                user_id=1, resume_id=int(resume['id']), base_lock_version=resume['lock_version'],
                proposed_data_json=resume['data'], proposed_style_json=resume['style'], summary='替代提案',
                status='pending', expires_at=utc_now()+timedelta(days=1))
            db.add(replacement); db.flush()
            token = source_sequence_no.set(source)
            try:
                supersede_revision_source(db, run, replacement)
                db.commit()
            finally:
                source_sequence_no.reset(token)
            replacement_id = replacement.public_id
        proposals = client.get(f'/api/agent/proposals?session_id={session_id}&include_history=true').json()['proposals']
        by_id = {item['id']: item for item in proposals}
        assert by_id[original_id]['source_user_sequence_no'] == 1
        assert by_id[original_id]['superseded_by'] == replacement_id
        assert by_id[replacement_id]['source_user_sequence_no'] == 2


def test_inserted_request_resolves_memory_into_its_own_task_and_rejects_old_source():
    from tests.integration.api.test_agent_routes import generic_memory_fixture, generic_memory_run
    app = build_app()
    with TestClient(app) as client:
        refs = generic_memory_fixture(app, client)
        run_id, base = generic_memory_run(app, client, refs)
        headers = {**internal_headers(), "X-Agent-User-Sequence": "3"}
        activated = client.post(f"{base}/steering:activate", headers=headers, json={
            "content": "继续刚才的文件", "idempotency_key": "memory_inserted_1",
        })
        assert activated.status_code == 200, activated.text
        result = activated.json()
        source = result["receipt"]["user_sequence_no"]
        dataset = next(item for item in refs if item["type"] == "dataset")
        ref = f"m:1:dataset:{dataset['id']}"
        assert any(item["memory_ref"] == ref for item in result["conversationMemory"]["events"])
        current = {**internal_headers(), "X-Agent-User-Sequence": str(source)}
        assert client.post(f"{base}/tasks:plan", headers=current, json={"tasks": [{
            "id": "next", "workflow": "material_lookup", "output": "advice", "label": "查看文件", "context_refs": [],
        }]}).status_code == 200
        assert client.post(f"{base}/tasks/next:status", headers=current, json={"status": "running"}).status_code == 200
        payload = {"memory_ref": ref, "relation": "continuation", "referring_text": "继续刚才的文件"}
        stale = client.post(f"{base}/resources:resolve-reference", headers=headers, json=payload)
        assert stale.status_code == 409
        assert stale.json()["error"] == "AGENT_REQUEST_SCOPE_STALE"
        read = client.post(f"{base}/resources:resolve-reference", headers=current, json=payload)
        assert read.status_code == 200, read.text
        assert "MEMORY_FILE_MARKER" in read.json()["materials"][0]["content"]["dataset_markdown"]
        with app.state.session_factory() as db:
            run = db.scalar(select(AgentRun).where(AgentRun.public_id == run_id))
            message = db.scalar(select(AgentMessage).where(AgentMessage.run_id == run.id, AgentMessage.sequence_no == source))
            assert message.metadata_json["resource_resolutions"][0]["task_id"] == "next"
