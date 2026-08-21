import asyncio
from collections.abc import AsyncIterator
from decimal import Decimal

from cryptography.fernet import Fernet
import pytest
from pydantic import BaseModel
from sqlalchemy import select

import linkcv.models  # noqa: F401
from linkcv.core.database import Base, build_engine, build_session_factory
from linkcv.modules.identity.models import User
from linkcv.modules.llm.crypto import CredentialCipher
from linkcv.modules.llm.gateway import (
    GatewayError,
    GatewayResult,
    GatewayStreamEvent,
    GatewayUsage,
)
from linkcv.modules.llm.models import (
    LLMCallLog,
    LLMCapabilityBinding,
    LLMModelConfig,
)
from linkcv.modules.llm.schemas import ChatMessage
from linkcv.modules.llm.service import LLMError, LLMService

TEST_USER_ID = 1


class FakeGateway:
    def __init__(self) -> None:
        self.complete_results: dict[str, GatewayResult | GatewayError] = {}
        self.stream_results: dict[
            str,
            list[GatewayStreamEvent] | GatewayError | AsyncIterator[GatewayStreamEvent],
        ] = {}
        self.calls: list[tuple[str, str | None]] = []
        self.response_formats: list[type[BaseModel] | None] = []

    async def complete(
        self,
        *,
        model,
        messages,
        api_base,
        api_key,
        response_format=None,
    ):
        del messages, api_base
        self.calls.append((model, api_key))
        self.response_formats.append(response_format)
        result = self.complete_results[model]
        if isinstance(result, GatewayError):
            raise result
        return result

    async def start_stream(self, *, model, messages, api_base, api_key):
        del messages, api_base
        self.calls.append((model, api_key))
        result = self.stream_results[model]
        if isinstance(result, GatewayError):
            raise result
        if hasattr(result, "__anext__"):
            return result

        async def events():
            for event in result:
                yield event

        return events()


@pytest.fixture
def service_context():
    engine = build_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    sessions = build_session_factory(engine)
    with sessions() as db:
        db.add(
            User(
                email="zhangsan@example.invalid",
                password_hash="fictional",
                nickname="张三",
            )
        )
        db.add(LLMCapabilityBinding(capability="chat"))
        db.commit()
    gateway = FakeGateway()
    key = Fernet.generate_key().decode("ascii")
    service = LLMService(sessions, gateway, CredentialCipher(f"test:{key}"))
    return service, gateway, sessions


def add_candidate(
    sessions,
    service: LLMService,
    model: str,
    *,
    current: bool = False,
    with_key: bool = True,
) -> int:
    with sessions() as db:
        config = LLMModelConfig(
            capability="chat",
            adapter="deepseek",
            model_call_name=model,
            model_name=f"deepseek/{model}",
            encrypted_api_key=(
                service.encrypt_credential(f"{model}-key") if with_key else None
            ),
            enabled=current,
            priority=100,
            config_version=1,
        )
        db.add(config)
        db.flush()
        if current:
            binding = db.get(LLMCapabilityBinding, "chat")
            assert binding is not None
            binding.model_config_id = config.id
        db.commit()
        return config.id


def success(content: str = "ok") -> GatewayResult:
    return GatewayResult(
        content=content,
        usage=GatewayUsage(1_000_000, 500_000),
        input_price_per_million=Decimal("1.5"),
        output_price_per_million=Decimal("2"),
    )


class StructuredPayload(BaseModel):
    answer: str


def test_chat_uses_only_bound_model_and_records_cost(service_context) -> None:
    service, gateway, sessions = service_context
    current_id = add_candidate(sessions, service, "current", current=True)
    add_candidate(sessions, service, "backup")
    gateway.complete_results["deepseek/current"] = success("统一结果")
    gateway.complete_results["deepseek/backup"] = success("不应使用")

    result = asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="虚构请求")],
            source="manual_acceptance",
        )
    )

    assert result.content == "统一结果"
    assert [model for model, _key in gateway.calls] == ["deepseek/current"]
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log is not None
        assert log.source == "manual_acceptance"
        assert log.model_config_id == current_id
        assert log.adapter == "deepseek"
        assert log.model_call_name == "current"
        assert log.status == "succeeded"
        assert log.metering_status == "complete"
        assert log.estimated_cost == Decimal("2.5000000000")


def test_structured_chat_uses_current_and_validates_response(service_context) -> None:
    service, gateway, sessions = service_context
    add_candidate(sessions, service, "current", current=True)
    add_candidate(sessions, service, "backup")
    gateway.complete_results["deepseek/current"] = success('{"answer":"有效"}')

    result = asyncio.run(
        service.structured_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="结构化请求")],
            source="fictional_module",
            response_model=StructuredPayload,
        )
    )

    assert result.value.answer == "有效"
    assert [model for model, _key in gateway.calls] == ["deepseek/current"]
    assert gateway.response_formats == [StructuredPayload]


@pytest.mark.parametrize("content", ["not-json", '{"wrong":"shape"}'])
def test_invalid_structured_response_fails_without_backup(
    service_context,
    content: str,
) -> None:
    service, gateway, sessions = service_context
    current_id = add_candidate(sessions, service, "current", current=True)
    add_candidate(sessions, service, "backup")
    gateway.complete_results["deepseek/current"] = success(content)

    with pytest.raises(LLMError) as captured:
        asyncio.run(
            service.structured_chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="非法响应")],
                source="fictional_module",
                response_model=StructuredPayload,
            )
        )

    assert captured.value.code == "LLM_RESPONSE_INVALID"
    assert [model for model, _key in gateway.calls] == ["deepseek/current"]
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log is not None
        assert log.model_config_id == current_id
        assert log.status == "failed"
        assert log.error_code == "LLM_RESPONSE_INVALID"


def test_current_failure_never_calls_saved_backup(service_context) -> None:
    service, gateway, sessions = service_context
    current_id = add_candidate(sessions, service, "current", current=True)
    add_candidate(sessions, service, "backup")
    gateway.complete_results["deepseek/current"] = GatewayError(
        code="LLM_UNAVAILABLE",
        may_have_reached_provider=True,
    )

    with pytest.raises(LLMError) as captured:
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="失败不切换")],
                source="fictional_module",
            )
        )

    assert captured.value.code == "LLM_UNAVAILABLE"
    assert [model for model, _key in gateway.calls] == ["deepseek/current"]
    with sessions() as db:
        logs = db.scalars(select(LLMCallLog)).all()
        assert len(logs) == 1
        assert logs[0].model_config_id == current_id
        assert logs[0].status == "failed"


def test_unconfigured_chat_does_not_select_saved_candidates(service_context) -> None:
    service, gateway, sessions = service_context
    add_candidate(sessions, service, "candidate-a")
    add_candidate(sessions, service, "candidate-b")

    with pytest.raises(LLMError) as captured:
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="尚未启用")],
                source="fictional_module",
            )
        )

    assert captured.value.code == "LLM_CHAT_NOT_CONFIGURED"
    assert gateway.calls == []
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log is not None
        assert log.status == "failed"
        assert log.model_config_id is None


def test_missing_or_unreadable_key_stops_before_gateway(service_context) -> None:
    service, gateway, sessions = service_context
    config_id = add_candidate(
        sessions,
        service,
        "current",
        current=True,
        with_key=False,
    )

    with pytest.raises(LLMError) as missing:
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="缺少密钥")],
                source="fictional_module",
            )
        )
    assert missing.value.code == "LLM_CREDENTIALS_UNAVAILABLE"
    assert gateway.calls == []

    with sessions() as db:
        config = db.get(LLMModelConfig, config_id)
        assert config is not None
        config.encrypted_api_key = "v1:missing:invalid"
        db.commit()
    with pytest.raises(LLMError) as unreadable:
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="不可解密")],
                source="fictional_module",
            )
        )
    assert unreadable.value.code == "LLM_CREDENTIALS_UNAVAILABLE"
    assert gateway.calls == []


@pytest.mark.parametrize(
    "usage,input_price,output_price,expected_status,has_cost",
    [
        (GatewayUsage(10, 2), Decimal("1"), Decimal("2"), "complete", True),
        (GatewayUsage(10, 2), Decimal("1"), None, "partial", False),
        (GatewayUsage(None, None), None, None, "unknown", False),
    ],
)
def test_metering_uses_only_gateway_catalog_prices(
    service_context,
    usage: GatewayUsage,
    input_price: Decimal | None,
    output_price: Decimal | None,
    expected_status: str,
    has_cost: bool,
) -> None:
    service, gateway, sessions = service_context
    add_candidate(sessions, service, "current", current=True)
    gateway.complete_results["deepseek/current"] = GatewayResult(
        content="ok",
        usage=usage,
        input_price_per_million=input_price,
        output_price_per_million=output_price,
    )

    result = asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="计量")],
            source="fictional_module",
        )
    )
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == result.call_id))
        assert log is not None
        assert log.metering_status == expected_status
        assert (log.estimated_cost is not None) is has_cost


def test_connection_test_uses_target_without_changing_binding(service_context) -> None:
    service, gateway, sessions = service_context
    current_id = add_candidate(sessions, service, "current", current=True)
    target_id = add_candidate(sessions, service, "target")
    gateway.complete_results["deepseek/target"] = success()

    call_id = asyncio.run(service.test_config(TEST_USER_ID, target_id))

    assert [model for model, _key in gateway.calls] == ["deepseek/target"]
    with sessions() as db:
        binding = db.get(LLMCapabilityBinding, "chat")
        assert binding is not None
        assert binding.model_config_id == current_id
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log is not None
        assert log.source == "connection_test"
        assert log.model_config_id == target_id


def test_stream_failure_after_delta_does_not_switch(service_context) -> None:
    service, gateway, sessions = service_context
    add_candidate(sessions, service, "current", current=True)
    add_candidate(sessions, service, "backup")

    async def failed_stream():
        yield GatewayStreamEvent(type="delta", content="部分")
        raise GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=True,
            usage=GatewayUsage(7, 3),
            input_price_per_million=Decimal("1.5"),
            output_price_per_million=Decimal("2"),
        )

    gateway.stream_results["deepseek/current"] = failed_stream()

    async def consume():
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="流中失败")],
            source="fictional_module",
        )
        return stream.call_id, [event async for event in stream.events]

    call_id, events = asyncio.run(consume())

    assert [event.type for event in events] == ["delta", "error"]
    assert [model for model, _key in gateway.calls] == ["deepseek/current"]
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log is not None
        assert log.status == "failed"
        assert log.error_code == "LLM_UNAVAILABLE"
        assert log.metering_status == "partial"


def test_stream_success_and_close_before_iteration_finalize_correctly(
    service_context,
) -> None:
    service, gateway, sessions = service_context
    add_candidate(sessions, service, "current", current=True)
    gateway.stream_results["deepseek/current"] = [
        GatewayStreamEvent(type="delta", content="前"),
        GatewayStreamEvent(type="done", usage=GatewayUsage(1, 1)),
    ]

    async def run_both():
        first = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="完成")],
            source="fictional_module",
        )
        events = [event async for event in first.events]
        second = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="关闭")],
            source="fictional_module",
        )
        await second.events.aclose()
        return first.call_id, events, second.call_id

    success_id, events, cancelled_id = asyncio.run(run_both())
    assert [event.type for event in events] == ["delta", "done"]
    with sessions() as db:
        statuses = {
            log.call_id: log.status for log in db.scalars(select(LLMCallLog)).all()
        }
        assert statuses[success_id] == "succeeded"
        assert statuses[cancelled_id] == "cancelled"
