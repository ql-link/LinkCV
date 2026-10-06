import copy
import pytest
from linkresume.modules.agent.intent_schemas import intent_probe_messages
from linkresume.modules.agent.systemone_intent import request_for_intent, decision_from_answers


def native_answers(actions=("diagnose", "interview"), mode="plan"):
    payload, _ = request_for_intent(intent_probe_messages())
    answers = {}
    for key, question in payload['questions'].items():
        if question['type'] == 'choice':
            value = 'none' if key.startswith(('task_', 'context_')) else 'd0' if key.startswith('dependencies_') else mode
            answers[key] = {'type': 'choice', 'choice': value, 'confidence': 0.95}
        else:
            answers[key] = {'type': 'noul', 'noul': 0.0}
    for index, action in enumerate(actions):
        answers[f'task_{index}']['choice'] = action
        answers[f'context_{index}']['choice'] = 'ref_0'
    answers['goal_count']['choice'] = str(len(actions))
    if mode == 'conversation': answers['goal_count']['choice'] = '0'
    answers['clarification_purpose']['choice'] = 'edit_scope' if mode == 'clarify' else 'none'
    return {'answers': answers}


def test_native_plan_preserves_order_dependencies_and_authorized_refs():
    _, refs = request_for_intent(intent_probe_messages())
    value = native_answers(('diagnose', 'edit', 'interview'))
    value['answers']['dependencies_2']['choice'] = 'd3'
    decision = decision_from_answers(value, refs)
    assert [task.output for task in decision.tasks] == ['advice', 'proposal', 'advice']
    assert decision.tasks[2].depends_on == ['intent_1', 'intent_2']
    assert all(task.context_refs[0].id == '1' for task in decision.tasks)


@pytest.mark.parametrize('mode', ['conversation', 'clarify'])
def test_nonplan_never_creates_business_tasks(mode):
    _, refs = request_for_intent(intent_probe_messages())
    decision = decision_from_answers(native_answers(mode=mode), refs)
    assert decision.mode == mode and decision.tasks == []


@pytest.mark.parametrize('change', ['low_confidence', 'foreign_context', 'unknown_action', 'gap', 'missing', 'nan'])
def test_invalid_native_answers_are_refused(change):
    _, refs = request_for_intent(intent_probe_messages())
    value = copy.deepcopy(native_answers())
    answers = value['answers']
    if change == 'low_confidence': answers['mode']['confidence'] = 0.49
    if change == 'foreign_context': answers['context_0']['choice'] = 'ref_99'
    if change == 'unknown_action': answers['task_0']['choice'] = 'delete_user'
    if change == 'gap': answers['task_0']['choice'] = 'none'
    if change == 'missing': del answers['task_0']
    if change == 'nan': answers['overflow']['noul'] = float('nan')
    with pytest.raises((ValueError, KeyError)):
        decision_from_answers(value, refs)


def test_overflow_and_unsupported_goal_require_clarification():
    _, refs = request_for_intent(intent_probe_messages())
    value = native_answers()
    value['answers']['overflow']['noul'] = 1
    assert decision_from_answers(value, refs).mode == 'clarify'
    value = native_answers(('unsupported',))
    assert decision_from_answers(value, refs).mode == 'clarify'


def test_only_declared_goals_become_tasks():
    _, refs = request_for_intent(intent_probe_messages())
    value = native_answers()
    value['answers']['task_2']['choice'] = 'edit'
    assert len(decision_from_answers(value, refs).tasks) == 2


def test_count_overflow_does_not_truncate_goals():
    _, refs = request_for_intent(intent_probe_messages())
    value = native_answers()
    value['answers']['goal_count']['choice'] = 'overflow'
    assert decision_from_answers(value, refs).mode == 'clarify'


@pytest.mark.parametrize('field,value', [('mode', 0.45), ('goal_count', 0.49)])
def test_uncertain_choice_has_distinct_reason(field, value):
    from linkresume.modules.agent.systemone_intent import IntentDecisionError
    _, refs = request_for_intent(intent_probe_messages())
    payload = native_answers()
    payload['answers'][field]['confidence'] = value
    with pytest.raises(IntentDecisionError, match='INTENT_UNCERTAIN'):
        decision_from_answers(payload, refs)


def test_ambiguous_probability_has_distinct_reason():
    from linkresume.modules.agent.systemone_intent import IntentDecisionError
    _, refs = request_for_intent(intent_probe_messages())
    payload = native_answers()
    payload['answers']['overflow']['noul'] = 0.5
    with pytest.raises(IntentDecisionError, match='INTENT_UNCERTAIN'):
        decision_from_answers(payload, refs)


@pytest.mark.parametrize('mode,count', [('conversation','1'), ('plan','0')])
def test_contradictory_goal_counts_are_not_accepted(mode, count):
    from linkresume.modules.agent.systemone_intent import IntentDecisionError
    _, refs = request_for_intent(intent_probe_messages())
    payload = native_answers(mode=mode)
    payload['answers']['goal_count']['choice'] = count
    with pytest.raises(IntentDecisionError, match='INTENT_DECISION_INCONSISTENT'):
        decision_from_answers(payload, refs)


def test_clarification_does_not_invent_a_missing_purpose():
    from linkresume.modules.agent.systemone_intent import IntentDecisionError
    _, refs = request_for_intent(intent_probe_messages())
    payload = native_answers(mode='clarify')
    payload['answers']['clarification_purpose']['choice'] = 'none'
    with pytest.raises(IntentDecisionError, match='INTENT_DECISION_INCONSISTENT'):
        decision_from_answers(payload, refs)


def test_explicit_resume_conflict_is_preserved_for_clarification():
    _, refs = request_for_intent(intent_probe_messages())
    payload = native_answers(mode='clarify')
    payload['answers']['clarification_purpose']['choice'] = 'resume_identity'
    payload['answers']['resume_identity_conflict']['noul'] = 1
    decision = decision_from_answers(payload, refs)
    assert decision.resume_identity_conflict is True
    assert decision.clarification_purposes == ['resume_identity']
