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
from linkresume.modules.llm.models import LLMCallLog, LLMModel, LLMModelRoute, LLMProviderConnection, LLMUseCaseRoute
from linkresume.modules.llm.resolver import JOB_IMAGE_EXTRACTION, JOB_TEXT_EXTRACTION, validation_fingerprint
from linkresume.modules.llm.schemas import ChatMessage
from linkresume.modules.llm.service import LLMError, LLMService


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
        connection = LLMProviderConnection(provider_code="aihubmix", name="测试", credential_ciphertext=service.encrypt_credential(json.dumps({"api_key": "fictional-key"})), settings_json={}, enabled=True, runtime_config_version=1)
        model = LLMModel(display_name="测试模型")
        db.add_all([connection, model]); db.flush()
        route = LLMModelRoute(model_id=model.id, connection_id=connection.id, target_kind="model", invoke_target="vendor/model", origin="manual", enabled=True, target_available=True, pricing_json={"currency": "USD", "input_per_million": "1", "output_per_million": "2"})
        db.add(route); db.flush()
        binding = LLMUseCaseRoute(use_case=JOB_TEXT_EXTRACTION, route_id=route.id, protocol_code="openai_chat", priority=100, enabled=True, validated_at=datetime.now(timezone.utc))
        db.add(binding); db.flush()
        binding.validated_fingerprint = validation_fingerprint(binding, route, connection)
        db.commit()
    yield service, gateway, sessions
    engine.dispose()


class Answer(BaseModel):
    answer: str


def test_image_probe_sends_provider_compatible_rgb_image(context):
    service, gateway, sessions = context
    with sessions() as db:
        binding = db.get(LLMUseCaseRoute, (JOB_TEXT_EXTRACTION, 1))
        binding.use_case = JOB_IMAGE_EXTRACTION
        db.commit()
    asyncio.run(service.probe_route(user_id=1, use_case=JOB_IMAGE_EXTRACTION, route_id=1))
    image_url = gateway.calls[0]["messages"][0].content[1].image_url.url
    with Image.open(io.BytesIO(base64.b64decode(image_url.split(",", 1)[1]))) as image:
        assert image.mode == "RGB" and min(image.size) > 10


def test_responses_binding_reaches_structured_gateway_and_records_actual_protocol(context):
    service, gateway, sessions = context
    with sessions() as db:
        binding = db.get(LLMUseCaseRoute, (JOB_TEXT_EXTRACTION, 1))
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
            settings_json={}, enabled=True, runtime_config_version=1,
        )
        model = db.get(LLMModel, 1) if same_model else LLMModel(display_name="另一个模型")
        db.add_all([connection, model]); db.flush()
        route = LLMModelRoute(
            model_id=model.id, connection_id=connection.id, target_kind="model",
            invoke_target=f"fallback/model-{priority}", origin="manual", enabled=True,
            target_available=True, pricing_json={"currency": "USD", "input_per_million": "1", "output_per_million": "2"},
        )
        db.add(route); db.flush()
        binding = LLMUseCaseRoute(
            use_case=JOB_TEXT_EXTRACTION, route_id=route.id, protocol_code="openai_chat",
            priority=priority, enabled=True, validated_at=datetime.now(timezone.utc),
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
        db.get(LLMUseCaseRoute, (JOB_TEXT_EXTRACTION, 1)).enabled = False
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
