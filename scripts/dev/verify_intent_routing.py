"""Opt-in live acceptance with fictional inputs; never fetches or modifies user resources."""
import argparse
import asyncio
import json
from pathlib import Path

from linkresume.core.config import load_settings
from linkresume.core.database import build_engine, build_session_factory
from linkresume.modules.agent.intent_schemas import INTENT_POLICY, IntentDecision
from linkresume.modules.agent.systemone_intent import ACTIONS
from linkresume.modules.llm.crypto import CredentialCipher
from linkresume.modules.llm.gateway import LiteLLMGateway
from linkresume.modules.llm.resolver import ASSISTANT_INTENT
from linkresume.modules.llm.schemas import ChatMessage
from linkresume.modules.llm.service import LLMError, LLMService


async def verify(args, cases):
    settings = load_settings()
    if settings.app_environment.lower() == 'production':
        raise SystemExit('Acceptance is only available outside production')
    engine = build_engine(settings.sqlalchemy_url)
    service = LLMService(build_session_factory(engine),LiteLLMGateway(timeout_seconds=10),
                         CredentialCipher(settings.llm_credential_encryption_keys))
    results = []
    try:
        for case in cases:
            state = {key:value for key,value in case.items() if key not in {'id','expected'}}
            state.setdefault('authorized_contexts',[])
            expected = case['expected']
            try:
                async with asyncio.timeout(10):
                    reply = await service.structured_chat(None,[ChatMessage(role='system',content=INTENT_POLICY),
                        ChatMessage(role='user',content=json.dumps(state,ensure_ascii=False))],
                        source='intent_acceptance',use_case=ASSISTANT_INTENT,response_model=IntentDecision)
                value = reply.value
                passed = (value.mode == expected['mode']
                    and [(t.workflow,t.output) for t in value.tasks] == [ACTIONS[a][:2] for a in expected['actions']]
                    and set(value.clarification_purposes) == set(expected['purposes'])
                    and value.resume_identity_conflict == expected.get('identity_conflict',False)
                    and all([(ref.type,ref.id) for ref in t.context_refs] == [('resume','1')] if state['authorized_contexts']
                            else not t.context_refs for t in value.tasks))
                row = {'case':case['id'],'passed':passed,'call_id':reply.call_id,'decision':value.model_dump(mode='json')}
            except (LLMError,TimeoutError) as error:
                row = {'case':case['id'],'passed':False,'reason':getattr(error,'code','INTENT_TIMEOUT'),'call_id':getattr(error,'call_id',None)}
                if getattr(error,'decision_detail',None):
                    row['decision_detail'] = error.decision_detail
            results.append(row)
            print(json.dumps(row,ensure_ascii=False),flush=True)
        if args.output:
            Path(args.output).write_text(json.dumps(results,ensure_ascii=False,indent=2))
    finally:
        engine.dispose()
    return all(row['passed'] for row in results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true',help='Allow real calls to the configured Dev intent model')
    parser.add_argument('--case',action='append',default=[],help='Case id; can be repeated to limit calls')
    parser.add_argument('--output',help='Optional safe result JSON file')
    args = parser.parse_args()
    cases = json.loads((Path(__file__).resolve().parents[2] / 'apps/backend/tests/fixtures/intent_routing_cases.json').read_text())
    unknown = set(args.case) - {case['id'] for case in cases}
    if unknown:
        parser.error('Unknown case ids: ' + ', '.join(sorted(unknown)))
    if args.case:
        cases = [case for case in cases if case['id'] in args.case]
    if not args.live:
        print(json.dumps([{'case':c['id'],'expected':c['expected']} for c in cases],ensure_ascii=False,indent=2))
    else:
        raise SystemExit(0 if asyncio.run(verify(args,cases)) else 1)
