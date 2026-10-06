import json
from types import SimpleNamespace

import pytest

from linkresume.modules.agent.intent import intent_input
from linkresume.modules.agent.intent_schemas import IntentDecision, validate_intent_probe


def task(**changes):
    return {"id": "diagnose", "workflow": "resume_edit", "output": "advice", "label": "诊断", **changes}


@pytest.mark.parametrize("tasks", [
    [], [task(workflow="unknown")], [task(output="catalog")],
    [task(depends_on=["later"])], [task(), task()],
    [task(id=f"task_{i}") for i in range(9)],
])
def test_invalid_plans_are_rejected(tasks):
    with pytest.raises(ValueError):
        IntentDecision(mode="plan", tasks=tasks)


def test_multigoal_plan_uses_existing_contract():
    decision = IntentDecision(mode="plan", tasks=[task(), task(
        id="interview", workflow="interview_guide", depends_on=["diagnose"],
    )])
    validate_intent_probe(decision)
    assert decision.tasks[1].depends_on == ["diagnose"]


@pytest.mark.parametrize("payload", [
    {"mode": "conversation", "tasks": [task()]},
    {"mode": "clarify"},
    {"mode": "plan", "tasks": [task()], "clarification_purposes": ["edit_scope"]},
    {"mode": "conversation", "reasoning": "hidden thoughts"},
    {"version": 2, "mode": "conversation"},
])
def test_invalid_decisions_are_rejected(payload):
    with pytest.raises(ValueError):
        IntentDecision.model_validate(payload)


def test_probe_rejects_generic_ok_and_missing_goals():
    with pytest.raises(ValueError):
        validate_intent_probe(IntentDecision(mode="plan", tasks=[task()]))


def test_input_does_not_include_material_bodies_or_locators():
    message = SimpleNamespace(content="诊断张三简历", metadata_json={"contexts": [
        {"type": "resume", "id": "1", "label": "张三简历", "content": "private body", "locator": "private locator"},
    ]})
    history = [SimpleNamespace(role="user", content="x" * 4000)] * 8
    payload = json.loads(intent_input(message, history))
    assert len(payload["history"]) == 4
    assert len(payload["history"][0]["content"]) == 1500
    assert payload["authorized_contexts"] == [{"type": "resume", "id": "1", "label": "张三简历"}]


def test_intent_accepts_chat_and_native_decision_but_not_responses():
    from linkresume.modules.llm.providers import validate_use_case_protocol, validate_route, validate_model_protocol
    validate_use_case_protocol("assistant_intent", "openai_chat")
    validate_use_case_protocol("assistant_intent", "system_one")
    validate_route("aihubmix", "model", "system_one")
    validate_model_protocol("jev-latest", "system_one")
    with pytest.raises(ValueError):
        validate_use_case_protocol("assistant_intent", "openai_responses")
    with pytest.raises(ValueError):
        validate_use_case_protocol("assistant_conversation", "system_one")
    with pytest.raises(ValueError):
        validate_route("deepseek", "model", "system_one")
    with pytest.raises(ValueError):
        validate_model_protocol("jev-latest", "openai_chat")


def test_intent_receives_identity_memory_separately_from_current_grants():
    memory = {"schema_version": 1, "events": [{"memory_ref": "m:1:dataset:7",
        "resource": {"type": "dataset", "id": "7", "label": "虚构资料"}}], "truncated": False}
    message = SimpleNamespace(content="继续刚才的文件", metadata_json={"contexts": []})
    payload = json.loads(intent_input(message, [], memory))
    assert payload["authorized_contexts"] == []
    assert payload["conversation_memory"] == memory
