import copy
import json

import pytest

from drawoffer.modules.agent.intent_schemas import intent_probe_messages
from drawoffer.modules.agent.systemone_intent import IntentDecisionError, decision_from_answers, request_for_intent
from drawoffer.modules.llm.schemas import ChatMessage


def request_with(contexts):
    state = {"request": "测试", "authorized_contexts": contexts}
    return request_for_intent([ChatMessage(role="user", content=json.dumps(state, ensure_ascii=False))])


def native_answers(payload, actions=("diagnose", "interview"), purpose="none", slots=None):
    """Build a fully answered, confident native response; `slots` places actions explicitly."""
    answers = {}
    for key, question in payload["questions"].items():
        if question["type"] == "choice":
            value = "none" if key.startswith(("task_", "context_")) else "d0" if key.startswith("dependencies_") else purpose
            answers[key] = {"type": "choice", "choice": value, "confidence": 0.95}
        else:
            answers[key] = {"type": "noul", "noul": 0.0}
    for slot, action in (slots or dict(enumerate(actions))).items():
        answers[f"task_{slot}"]["choice"] = action
    return {"answers": answers}


def probe():
    return request_for_intent(intent_probe_messages())


def probe_answers(actions=("diagnose", "interview"), purpose="none"):
    """Confident native answers for the fixed intent probe request."""
    payload, _ = probe()
    return native_answers(payload, actions, purpose)


def test_questions_do_not_ask_for_derivable_or_equivalent_answers():
    payload, _ = probe()
    assert "mode" not in payload["questions"] and "goal_count" not in payload["questions"]
    # Only a resume is authorized: its access is derived, so there is nothing to choose.
    assert not any(key.startswith("context_") for key in payload["questions"])
    assert "resume_switch" not in payload["questions"]


@pytest.mark.parametrize("contexts,options", [
    ([{"type": "resume", "id": "1"}, {"type": "job", "id": "7"}], {"none", "ref_0"}),
    ([{"type": "resume", "id": "1"}, {"type": "job", "id": "7"}, {"type": "dataset", "id": "9"}], {"none", "ref_0", "ref_1", "all"}),
])
def test_context_question_never_offers_equivalent_choices(contexts, options):
    payload, _ = request_with(contexts)
    assert set(payload["questions"]["context_0"]["criteria"]) == options


def test_resume_switch_is_only_asked_when_an_editor_background_exists():
    payload, _ = request_with([{"type": "resume", "id": "1", "presentation": "implicit"}])
    assert payload["questions"]["resume_switch"]["type"] == "noul"
    payload, _ = request_with([{"type": "resume", "id": "1", "presentation": "mention"}])
    assert "resume_switch" not in payload["questions"]


def test_native_plan_preserves_order_dependencies_and_non_resume_refs():
    payload, refs = request_with([{"type": "resume", "id": "1"}, {"type": "job", "id": "7"}])
    value = native_answers(payload, ("diagnose", "edit", "interview"))
    value["answers"]["context_2"]["choice"] = "ref_0"
    value["answers"]["dependencies_2"]["choice"] = "d3"
    decision = decision_from_answers(value, refs)
    assert [task.workflow for task in decision.tasks] == ["resume_diagnosis", "resume_edit", "interview_guide"]
    assert [task.output for task in decision.tasks] == ["advice", "proposal", "advice"]
    assert decision.tasks[2].depends_on == ["intent_1", "intent_2"]
    assert [ref.id for ref in decision.tasks[2].context_refs] == ["7"]
    assert decision.tasks[0].context_refs == []  # resume access is derived by the server, not chosen
    assert decision.resume_switch is False


@pytest.mark.parametrize("purpose,actions,mode", [
    ("resume_identity", (), "clarify"),
    ("resume_identity", ("diagnose", "interview"), "clarify"),
    ("none", (), "conversation"),
    ("none", ("diagnose", "interview"), "plan"),
])
def test_processing_mode_is_derived_from_the_answers(purpose, actions, mode):
    payload, refs = probe()
    decision = decision_from_answers(native_answers(payload, actions, purpose), refs)
    assert decision.mode == mode
    assert (decision.tasks == []) == (mode != "plan")


def test_slot_gaps_are_compacted_instead_of_contradicting():
    payload, refs = probe()
    value = native_answers(payload, slots={1: "diagnose", 3: "interview"})
    value["answers"]["dependencies_3"]["choice"] = "d2"  # depends on slot 1
    decision = decision_from_answers(value, refs)
    assert [(task.id, task.workflow) for task in decision.tasks] == [
        ("intent_1", "resume_diagnosis"), ("intent_2", "interview_guide")]
    assert decision.tasks[1].depends_on == ["intent_1"]


def test_dependencies_on_empty_slots_are_dropped():
    payload, refs = probe()
    value = native_answers(payload, slots={1: "diagnose", 2: "interview"})
    value["answers"]["dependencies_2"]["choice"] = "d3"  # slots 0 (empty) and 1
    assert decision_from_answers(value, refs).tasks[1].depends_on == ["intent_1"]


@pytest.mark.parametrize("change", ["foreign_context", "unknown_action", "missing", "nan", "bad_dependency"])
def test_invalid_native_answers_are_refused(change):
    payload, refs = request_with([{"type": "resume", "id": "1"}, {"type": "job", "id": "7"}])
    value = copy.deepcopy(native_answers(payload))
    answers = value["answers"]
    if change == "foreign_context": answers["context_0"]["choice"] = "ref_99"
    if change == "unknown_action": answers["task_0"]["choice"] = "delete_user"
    if change == "missing": del answers["task_0"]
    if change == "nan": answers["overflow"]["noul"] = float("nan")
    if change == "bad_dependency": answers["dependencies_1"]["choice"] = "d9"
    with pytest.raises((ValueError, KeyError)):
        decision_from_answers(value, refs)


def test_overflow_and_unsupported_goal_require_clarification():
    payload, refs = probe()
    value = native_answers(payload)
    value["answers"]["overflow"]["noul"] = 1
    assert decision_from_answers(value, refs).mode == "clarify"
    assert decision_from_answers(native_answers(payload, ("unsupported",)), refs).mode == "clarify"


def test_all_eight_goals_become_tasks_without_truncation():
    payload, refs = probe()
    value = native_answers(payload, ("diagnose",) * 8)
    assert len(decision_from_answers(value, refs).tasks) == 8


@pytest.mark.parametrize("field,value", [("task_0", 0.45), ("clarification_purpose", 0.49), ("dependencies_1", 0.3)])
def test_uncertain_choice_has_distinct_reason(field, value):
    payload, refs = probe()
    value_ = native_answers(payload)
    value_["answers"][field]["confidence"] = value
    with pytest.raises(IntentDecisionError, match="INTENT_UNCERTAIN"):
        decision_from_answers(value_, refs)


def test_doubtful_unused_slot_is_noise_but_doubtful_first_slot_is_not():
    payload, refs = probe()
    value = native_answers(payload)
    value["answers"]["task_5"]["confidence"] = 0.1  # an empty trailing slot
    assert decision_from_answers(value, refs).mode == "plan"


def test_doubtful_material_choice_widens_only_to_other_authorized_materials():
    payload, refs = request_with([{"type": "resume", "id": "1"}, {"type": "job", "id": "7"}, {"type": "dataset", "id": "9"}])
    value = native_answers(payload, ("diagnose", "interview"))
    value["answers"]["context_0"].update(choice="ref_1", confidence=0.45)
    value["answers"]["context_1"]["choice"] = "ref_0"
    decision = decision_from_answers(value, refs)
    assert decision.mode == "plan"
    assert [ref.id for ref in decision.tasks[0].context_refs] == ["7", "9"]
    assert [ref.id for ref in decision.tasks[1].context_refs] == ["7"]


def test_ambiguous_probability_has_distinct_reason():
    payload, refs = probe()
    value = native_answers(payload)
    value["answers"]["overflow"]["noul"] = 0.5
    with pytest.raises(IntentDecisionError, match="INTENT_UNCERTAIN"):
        decision_from_answers(value, refs)


def test_explicit_resume_conflict_is_preserved_for_clarification():
    payload, refs = probe()
    value = native_answers(payload, (), "resume_identity")
    value["answers"]["resume_identity_conflict"]["noul"] = 1
    decision = decision_from_answers(value, refs)
    assert decision.resume_identity_conflict is True
    assert decision.clarification_purposes == ["resume_identity"]


@pytest.mark.parametrize("probability,expected", [(0.0, False), (0.9, True), (0.5, True)])
def test_resume_switch_is_conservative_when_doubtful(probability, expected):
    payload, refs = request_with([{"type": "resume", "id": "1", "presentation": "implicit"}])
    value = native_answers(payload, ("diagnose",))
    value["answers"]["resume_switch"]["noul"] = probability
    assert decision_from_answers(value, refs).resume_switch is expected


def test_a_selected_resume_is_not_reopened_by_unnamed_wording_or_history():
    selected, _ = request_with([{"type": "resume", "id": "1", "presentation": "mention"}])
    background, _ = request_with([{"type": "resume", "id": "1", "presentation": "implicit"}])
    chosen = selected["questions"]["clarification_purpose"]["criteria"]["resume_identity"]
    assert "显式选择" in chosen and "另一份" in chosen
    assert "应当使用显式选择的简历" not in background["questions"]["clarification_purpose"]["criteria"]["resume_identity"]


def test_follow_up_questions_about_a_resume_are_business_tasks_not_chat():
    from drawoffer.modules.agent.intent_schemas import INTENT_ROUTING_RULES, PLANNING_RULES

    for rules in (INTENT_ROUTING_RULES, PLANNING_RULES):
        assert "询问某份简历正文里的具体内容" in rules
        assert "本轮没有再选择" in rules and "不要因为本轮没有 @" in rules
        assert "追问此前 @ 过的岗位" in rules
