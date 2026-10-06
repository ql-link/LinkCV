"""Adapter contract cases; model classification itself is verified by the live harness."""
import json
from pathlib import Path

import pytest

from linkresume.modules.agent.intent_schemas import INTENT_ROUTING_RULES
from linkresume.modules.agent.systemone_intent import ACTIONS, decision_from_answers, request_for_intent
from linkresume.modules.llm.schemas import ChatMessage
from tests.unit.modules.agent.test_systemone_intent import native_answers

CASES = json.loads((Path(__file__).parents[3] / 'fixtures/intent_routing_cases.json').read_text())


@pytest.mark.parametrize('case', CASES, ids=lambda case: case['id'])
def test_routing_case_preserves_input_and_maps_only_expected_contract(case):
    state = {key:value for key,value in case.items() if key not in {'id','expected'}}
    state.setdefault('authorized_contexts', [])
    payload, refs = request_for_intent([ChatMessage(role='user',content=json.dumps(state,ensure_ascii=False))])
    assert json.loads(payload['state']) == state
    assert INTENT_ROUTING_RULES in payload['questions']['mode']['instructions']
    expected = case['expected']
    answer = native_answers(actions=expected['actions'], mode=expected['mode'])
    answer['answers']['clarification_purpose']['choice'] = expected['purposes'][0] if expected['purposes'] else 'none'
    answer['answers']['resume_identity_conflict']['noul'] = int(expected.get('identity_conflict',False))
    for index in range(len(expected['actions'])):
        answer['answers'][f'context_{index}']['choice'] = 'ref_0' if refs else 'none'
    decision = decision_from_answers(answer, refs)
    assert decision.mode == expected['mode']
    assert decision.clarification_purposes == expected['purposes']
    assert decision.resume_identity_conflict == expected.get('identity_conflict',False)
    assert [(t.workflow,t.output) for t in decision.tasks] == [ACTIONS[a][:2] for a in expected['actions']]
    assert all(ref.id == '1' for task in decision.tasks for ref in task.context_refs)
