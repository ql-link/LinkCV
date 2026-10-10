import asyncio
import base64
import io
import json
from datetime import datetime, timezone
from decimal import Decimal

from cryptography.fernet import Fernet
import pytest
from pydantic import BaseModel
from PIL import Image
from sqlalchemy import select

import linkresume.models  # noqa: F401
from linkresume.core.database import Base, build_engine, build_session_factory
from linkresume.modules.identity.models import User
from linkresume.modules.llm.crypto import CredentialCipher
from linkresume.modules.llm.gateway import GatewayError, GatewayResult, GatewayStreamEvent, GatewayUsage
from linkresume.modules.llm.models import LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute, get_use_case_route
from linkresume.modules.llm.resolver import JOB_IMAGE_EXTRACTION, JOB_TEXT_EXTRACTION, validation_fingerprint
from linkresume.modules.llm.schemas import ChatMessage
from linkresume.modules.llm.service import LLMError, LLMService
from linkresume.modules.speech.gateway import RecognitionEvent


class FakeGateway:
    def __init__(self):
        self.result = GatewayResult(content="OK", usage=GatewayUsage(100, 20))
        self.calls = []

    async def complete(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.result, list):
            result = self.result.pop(0)
            if isinstance(result, Exception):
                raise result
            return result
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    async def start_stream(self, **kwargs):
        self.calls.append(kwargs)
        result = self.result.pop(0)
        async def events():
            for item in result:
                if isinstance(item, Exception):
                    raise item
                yield item
        return events()


@pytest.fixture
def context():
    engine = build_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    sessions = build_session_factory(engine)
    gateway = FakeGateway()
    cipher = CredentialCipher(f"test:{Fernet.generate_key().decode('ascii')}")
    service = LLMService(sessions, gateway, cipher)
    with sessions() as db:
        db.add(User(email="person@example.invalid", password_hash="fictional", nickname="用户"))
        connection = LLMProviderConnection(provider_code="aihubmix", name="测试", credential_ciphertext=service.encrypt_credential(json.dumps({"api_key": "fictional-key"})), settings_json={}, is_enabled=True, runtime_config_version=1)
        model = LLMModel(display_name="测试模型")
        db.add_all([connection, model]); db.flush()
        route = LLMModelRoute(model_id=model.id, connection_id=connection.id, target_kind="model", invoke_target="vendor/model", origin="manual", is_enabled=True, is_target_available=True, pricing_json={"currency": "USD", "input_per_million": "1", "output_per_million": "2"})
        db.add(route); db.flush()
        binding = LLMUseCaseRoute(use_case=JOB_TEXT_EXTRACTION, route_id=route.id, protocol_code="openai_chat", priority=100, is_enabled=True, validated_at=datetime.now(timezone.utc))
        db.add(binding); db.flush()
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()
    yield service, gateway, sessions
    engine.dispose()


class Answer(BaseModel):
    answer: str


def bind_intent(sessions):
    from linkresume.modules.llm.resolver import ASSISTANT_INTENT
    with sessions() as db:
        route = db.get(LLMModelRoute, 1)
        connection = db.get(LLMProviderConnection, route.connection_id)
        binding = LLMUseCaseRoute(use_case=ASSISTANT_INTENT, route_id=route.id,
                                  protocol_code="openai_chat", priority=100, is_enabled=True,
                                  validated_at=datetime.now(timezone.utc))
        db.add(binding); db.flush()
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()


@pytest.mark.parametrize('invalid,expected_error', [(False,None), ('unknown_action','LLM_RESPONSE_INVALID'), ('low_confidence','INTENT_UNCERTAIN')])
def test_native_intent_service_maps_decisions_and_records_metering(context, invalid, expected_error):
    from linkresume.modules.agent.intent_schemas import IntentDecision, intent_probe_messages
    from tests.unit.modules.agent.test_systemone_intent import probe_answers
    from linkresume.modules.llm.resolver import ASSISTANT_INTENT
    service, gateway, sessions = context
    bind_intent(sessions)
    with sessions() as db:
        route = db.get(LLMModelRoute, 1)
        route.invoke_target = 'jev-latest'
        binding = get_use_case_route(db, ASSISTANT_INTENT, 1)
        binding.protocol_code = 'system_one'
        binding.validated_fingerprint = validation_fingerprint(binding, route, db.get(LLMProviderConnection, route.connection_id))
        db.commit()
    payload = probe_answers()
    if invalid == 'unknown_action': payload['answers']['task_0']['choice'] = 'delete_user'
    if invalid == 'low_confidence': payload['answers']['task_0']['confidence'] = 0.45
    gateway.result = GatewayResult(content=json.dumps(payload), usage=GatewayUsage(30, 4))
    async def call():
        return await service.structured_chat(1, intent_probe_messages(), source='agent_intent',
            use_case=ASSISTANT_INTENT, response_model=IntentDecision)
    if invalid:
        with pytest.raises(LLMError) as error: asyncio.run(call())
        assert error.value.code == expected_error
        if invalid == 'low_confidence':
            assert error.value.decision_detail == {'field':'task_0','confidence':0.45}
    else:
        result = asyncio.run(call())
        assert [task.workflow for task in result.value.tasks] == ['resume_diagnosis', 'interview_guide']
        asyncio.run(service.probe_route(1, ASSISTANT_INTENT, 1))
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).order_by(LLMCallLog.id.desc()))
        assert log.protocol_code == 'system_one' and log.input_tokens == 30
        assert log.status == ('failed' if invalid else 'succeeded')
        assert log.error_code == expected_error
    wire = json.loads(gateway.calls[0]['messages'][0].content)
    assert 'state' in wire and 'questions' in wire
    assert gateway.calls[0]['protocol_code'] == 'system_one'


def test_intent_call_uses_independent_scene_and_run_log(context):
    from linkresume.modules.agent.intent_schemas import IntentDecision
    from linkresume.modules.agent.models import AgentRun, AgentSession
    from linkresume.modules.llm.resolver import ASSISTANT_INTENT
    service, gateway, sessions = context
    bind_intent(sessions)
    with sessions() as db:
        session = AgentSession(public_id="intent-session", user_id=1, title="测试")
        db.add(session); db.flush()
        run = AgentRun(public_id="intent-run", session_id=session.id,
                       idempotency_key="intent-key", started_at=datetime.now(timezone.utc))
        db.add(run); db.commit()
        run_id = run.id
    gateway.result = GatewayResult(content='{"mode":"conversation"}', usage=GatewayUsage(100, 20))
    result = asyncio.run(service.structured_chat(
        1, [ChatMessage(role="user", content="你好")], source="agent_intent",
        use_case=ASSISTANT_INTENT, response_model=IntentDecision, agent_run_id=run_id,
    ))
    assert result.value.mode == "conversation"
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == result.call_id))
        assert (log.use_case, log.agent_run_id, log.source) == (ASSISTANT_INTENT, run_id, "agent_intent")
        assert log.input_tokens == 100
        assert log.estimated_cost is not None


@pytest.mark.parametrize("content,valid", [
    ('{"ok":true}', False),
    ('{"mode":"conversation"}', False),
    (json.dumps({"mode": "plan", "tasks": [
        {"id": "diagnose", "workflow": "resume_edit", "output": "advice", "label": "诊断"},
        {"id": "interview", "workflow": "interview_guide", "output": "advice", "label": "面试准备"},
    ]}), True),
])
def test_intent_probe_checks_multiple_goals(context, content, valid):
    from linkresume.modules.llm.resolver import ASSISTANT_INTENT
    service, gateway, sessions = context
    bind_intent(sessions)
    gateway.result = GatewayResult(content=content, usage=GatewayUsage(100, 20))
    if valid:
        asyncio.run(service.probe_route(1, ASSISTANT_INTENT, 1))
    else:
        with pytest.raises(LLMError) as error:
            asyncio.run(service.probe_route(1, ASSISTANT_INTENT, 1))
        assert error.value.code == "LLM_RESPONSE_INVALID"

@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("request_id,model_id,expected_request,expected_model", [
    ("resp_fictional", "fictional-model", "resp_fictional", "fictional-model"),
    ("r" * 128, "m" * 256, "r" * 128, "m" * 256),
    ("r" * 129, "m" * 257, None, None),
    ("resp_" + "x" * 2048, "fictional-model", None, "fictional-model"),
], ids=["normal", "column-boundary", "over-column-limit", "long-responses-id"])
def test_successful_calls_keep_usage_when_upstream_identifiers_exceed_mysql_columns(
    context, streaming, request_id, model_id, expected_request, expected_model,
):
    service, gateway, sessions = context
    if streaming:
        gateway.result = [[
            GatewayStreamEvent(type="delta", content="OK"),
            GatewayStreamEvent(type="done", usage=GatewayUsage(100, 20),
                               response_model_id=model_id, upstream_request_id=request_id),
        ]]
        async def run():
            stream = await service.stream_chat(1, [ChatMessage(role="user", content="虚构请求")], source="test_call")
            return [event async for event in stream.events]
        events = asyncio.run(run())
        assert events[-1].type == "done" and not any(event.type == "error" for event in events)
    else:
        gateway.result = GatewayResult(content="OK", usage=GatewayUsage(100, 20),
                                       response_model_id=model_id, upstream_request_id=request_id)
        assert asyncio.run(service.chat(1, [ChatMessage(role="user", content="虚构请求")], source="test_call")).content == "OK"
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "succeeded" and log.input_tokens == 100 and log.output_tokens == 20
        assert log.estimated_cost == Decimal("0.00014")
        assert log.upstream_request_id == expected_request and log.response_model_id == expected_model


@pytest.mark.parametrize("transcript,successful", [("虚构测试语音", True), ("", False)])
def test_file_asr_probe_uses_voiced_pcm_and_requires_a_final_transcript(context, transcript, successful):
    service, gateway, sessions = context
    recordings = []
    class SpeechGateway:
        async def recognize(self, target, audio, **kwargs):
            recordings.append(b"".join([frame async for frame in audio]))
            yield RecognitionEvent(transcript, 0, True)
        async def synthesize(self, *args, **kwargs):
            pytest.fail("ASR probe unexpectedly called TTS")
    service._speech_gateway = SpeechGateway()
    with sessions() as db:
        binding = get_use_case_route(db, JOB_TEXT_EXTRACTION, 1)
        binding.use_case = "speech_to_text"
        binding.protocol_code = "openai_asr_file"
        binding.validated_at = None
        binding.validated_fingerprint = None
        db.get(LLMModelRoute, 1).invoke_target = "whisper-large-v3"
        db.commit()
    if successful:
        asyncio.run(service.probe_route(1, "speech_to_text", 1))
    else:
        with pytest.raises(LLMError, match="LLM_RESPONSE_INVALID"):
            asyncio.run(service.probe_route(1, "speech_to_text", 1))
    assert len(recordings) == 1 and len(recordings[0]) > 32000 and any(recordings[0])
    with sessions() as db:
        binding = get_use_case_route(db, "speech_to_text", 1)
        assert (binding.validated_at is not None) is successful
        assert db.scalar(select(LLMCallLog)).status == ("succeeded" if successful else "failed")


def test_image_probe_sends_provider_compatible_rgb_image(context):
    service, gateway, sessions = context
    with sessions() as db:
        binding = get_use_case_route(db, JOB_TEXT_EXTRACTION, 1)
        binding.use_case = JOB_IMAGE_EXTRACTION
        db.commit()
    asyncio.run(service.probe_route(user_id=1, use_case=JOB_IMAGE_EXTRACTION, route_id=1))
    image_url = gateway.calls[0]["messages"][0].content[1].image_url.url
    with Image.open(io.BytesIO(base64.b64decode(image_url.split(",", 1)[1]))) as image:
        assert image.mode == "RGB" and min(image.size) > 10


def test_responses_binding_reaches_structured_gateway_and_records_actual_protocol(context):
    service, gateway, sessions = context
    with sessions() as db:
        binding = get_use_case_route(db, JOB_TEXT_EXTRACTION, 1)
        binding.protocol_code = "openai_responses"
        binding.validated_fingerprint = validation_fingerprint(binding, db.get(LLMModelRoute, 1), db.get(LLMProviderConnection, 1))
        db.commit()
    gateway.result = GatewayResult(content='{"answer":"OK"}', usage=GatewayUsage(3, 1))
    result = asyncio.run(service.structured_chat(1, [ChatMessage(role="user", content="虚构请求")], source="test_call", response_model=Answer))
    assert result.value.answer == "OK" and gateway.calls[0]["protocol_code"] == "openai_responses"
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.protocol_code == "openai_responses" and log.status == "succeeded" and log.output_tokens == 1


def add_route(sessions, service, *, same_model=True, priority=200):
    with sessions() as db:
        connection = LLMProviderConnection(
            provider_code="deepseek", name=f"备用-{priority}",
            credential_ciphertext=service.encrypt_credential(json.dumps({"api_key": "fictional-fallback"})),
            settings_json={}, is_enabled=True, runtime_config_version=1,
        )
        model = db.get(LLMModel, 1) if same_model else LLMModel(display_name="另一个模型")
        db.add_all([connection, model]); db.flush()
        route = LLMModelRoute(
            model_id=model.id, connection_id=connection.id, target_kind="model",
            invoke_target=f"fallback/model-{priority}", origin="manual", is_enabled=True,
            is_target_available=True, pricing_json={"currency": "USD", "input_per_million": "1", "output_per_million": "2"},
        )
        db.add(route); db.flush()
        binding = LLMUseCaseRoute(
            use_case=JOB_TEXT_EXTRACTION, route_id=route.id, protocol_code="openai_chat",
            priority=priority, is_enabled=True, validated_at=datetime.now(timezone.utc),
        )
        db.add(binding); db.flush()
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        route_id = route.id
        db.commit()
    return route_id


def test_resolves_route_and_records_price_snapshot(context):
    service, gateway, sessions = context
    result = asyncio.run(service.chat(1, [ChatMessage(role="user", content="hello")], source="test_call"))
    assert result.content == "OK"
    assert gateway.calls[0]["model"] == "vendor/model"
    assert gateway.calls[0]["api_key"] == "fictional-key"
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "succeeded"
        assert log.route_id == 1
        assert log.estimated_cost == Decimal("0.00014")
        assert log.cost_currency == "USD"


def test_structured_error_keeps_tokens_and_cost(context):
    service, gateway, sessions = context
    gateway.result = GatewayResult(content="not JSON", usage=GatewayUsage(100, 20))
    with pytest.raises(LLMError, match="LLM_RESPONSE_INVALID"):
        asyncio.run(service.structured_chat(1, [ChatMessage(role="user", content="hello")], source="test_call", response_model=Answer))
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "failed"
        assert log.input_tokens == 100
        assert log.estimated_cost == Decimal("0.00014")


def test_inactive_binding_never_calls_gateway(context):
    service, gateway, sessions = context
    with sessions() as db:
        get_use_case_route(db, JOB_TEXT_EXTRACTION, 1).is_enabled = False
        db.commit()
    with pytest.raises(LLMError, match="LLM_MODEL_NOT_CONFIGURED"):
        asyncio.run(service.chat(1, [ChatMessage(role="user", content="hello")], source="test_call"))
    assert not gateway.calls


def test_gateway_failure_creates_failed_call_log(context):
    service, gateway, sessions = context
    gateway.result = GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True)
    with pytest.raises(LLMError):
        asyncio.run(service.chat(1, [ChatMessage(role="user", content="hello")], source="test_call"))
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "failed"
        assert log.error_code == "LLM_UNAVAILABLE"


def test_failure_switches_only_within_selected_logical_model(context):
    service, gateway, sessions = context
    other_model_route_id = add_route(sessions, service, same_model=False, priority=150)
    fallback_route_id = add_route(sessions, service, priority=200)
    gateway.result = [
        GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True),
        GatewayResult(content="from backup", usage=GatewayUsage(2, 3)),
    ]
    result = asyncio.run(service.chat(1, [ChatMessage(role="user", content="hello")], source="test_call"))
    assert result.content == "from backup"
    assert [call["model"] for call in gateway.calls] == ["vendor/model", "fallback/model-200"]
    with sessions() as db:
        logs = db.scalars(select(LLMCallLog).order_by(LLMCallLog.id)).all()
        assert [(log.route_id, log.status, log.selection_source) for log in logs] == [
            (1, "failed", "default"), (fallback_route_id, "succeeded", "fallback"),
        ]
        assert all(log.route_id != other_model_route_id for log in logs)


def test_request_rejection_does_not_switch_route(context):
    service, gateway, sessions = context
    add_route(sessions, service)
    gateway.result = GatewayError(code="LLM_REQUEST_REJECTED", may_have_reached_provider=True)
    with pytest.raises(LLMError, match="LLM_REQUEST_REJECTED"):
        asyncio.run(service.chat(1, [ChatMessage(role="user", content="hello")], source="test_call"))
    assert len(gateway.calls) == 1


def test_stream_switches_before_output_but_not_after_output(context):
    service, gateway, sessions = context
    add_route(sessions, service)
    gateway.result = [
        [GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True)],
        [GatewayStreamEvent(type="delta", content="ok"), GatewayStreamEvent(type="done", usage=GatewayUsage(1, 1))],
    ]
    async def run():
        stream = await service.stream_chat(1, [ChatMessage(role="user", content="hello")], source="test_call")
        return [event async for event in stream.events]
    events = asyncio.run(run())
    assert [(event.type, event.content) for event in events] == [("delta", "ok"), ("done", None)]
    assert len(gateway.calls) == 2

    gateway.calls.clear()
    gateway.result = [[GatewayStreamEvent(type="delta", content="partial"),
                       GatewayError(code="LLM_UNAVAILABLE", may_have_reached_provider=True)]]
    events = asyncio.run(run())
    assert [event.type for event in events] == ["delta", "error"]
    assert len(gateway.calls) == 1


@pytest.mark.parametrize("protocol", ["system_one", "openai_chat"])
def test_autofill_routes_use_bounded_decisions_and_accounted_calls(context, protocol):
    from linkresume.modules.browser_extension.decisions import decision_messages
    from linkresume.modules.browser_extension.schemas import FieldDecision, PageField
    service, gateway, sessions = context
    with sessions() as db:
        binding = get_use_case_route(db, JOB_TEXT_EXTRACTION, 1)
        binding.use_case = "browser_autofill"
        binding.protocol_code = protocol
        route = db.get(LLMModelRoute, 1)
        connection = db.get(LLMProviderConnection, route.connection_id)
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()
    native = {"answers": {"slot": {"choice": "education.school", "probabilities": {"education.school": 0.95, "none": 0.05}}}}
    generic = {"choice": "education.school", "prob": 0.95, "ranked": [["education.school", 0.95]]}
    gateway.result = GatewayResult(content=json.dumps(native if protocol == "system_one" else generic), usage=GatewayUsage(12, 3))
    result = asyncio.run(service.structured_chat(1, decision_messages(PageField(uid="one", label="毕业院校", kind="input:text")), source="browser_autofill", response_model=FieldDecision, use_case="browser_autofill"))
    assert result.value.choice == "education.school" and result.value.prob == 0.95
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.use_case == "browser_autofill" and log.status == "succeeded" and log.input_tokens == 12
    asyncio.run(service.probe_route(user_id=1, use_case="browser_autofill", route_id=1))
