import asyncio
from collections.abc import AsyncIterator
from decimal import Decimal

from cryptography.fernet import Fernet
import pytest
from pydantic import BaseModel
from sqlalchemy import select

import linkresume.models  # noqa: F401
from linkresume.core.database import Base, build_engine, build_session_factory, utc_now
from linkresume.modules.identity.models import User
from linkresume.modules.llm.crypto import CredentialCipher
from linkresume.modules.llm.gateway import (
    GatewayError,
    GatewayResult,
    GatewayStreamEvent,
    GatewayUsage,
)
from linkresume.modules.llm.models import (
    LLMCallLog,
    LLMCapabilityBinding,
    LLMModelConfig,
    LLMProvider,
    LLMProviderModel,
)
from linkresume.modules.llm.schemas import ChatMessage
from linkresume.modules.llm.service import LLMError, LLMService

TEST_USER_ID = 1
GATEWAY_BASE_URL = "https://gateway.example.invalid/v1"
CATALOG_URL = "https://catalog.example.invalid/api/v1/models"


class FakeGateway:
    def __init__(self) -> None:
        self.complete_results: dict[str, GatewayResult | GatewayError] = {}
        self.stream_results: dict[
            str,
            list[GatewayStreamEvent] | GatewayError | AsyncIterator[GatewayStreamEvent],
        ] = {}
        self.calls: list[tuple[str, str]] = []
        self.base_urls: list[str] = []
        self.message_batches: list[tuple[ChatMessage, ...]] = []

    async def complete(self, *, model, messages, api_base, api_key):
        self.calls.append((model, api_key))
        self.base_urls.append(api_base)
        self.message_batches.append(tuple(messages))
        result = self.complete_results[model]
        if isinstance(result, GatewayError):
            raise result
        return result

    async def start_stream(self, *, model, messages, api_base, api_key):
        del messages
        self.calls.append((model, api_key))
        self.base_urls.append(api_base)
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
        for capability in ("chat", "pi_agent"):
            db.add(LLMCapabilityBinding(capability=capability))
        db.commit()
    gateway = FakeGateway()
    key = Fernet.generate_key().decode("ascii")
    service = LLMService(sessions, gateway, CredentialCipher(f"test:{key}"))
    return service, gateway, sessions


def add_provider(
    sessions,
    service: LLMService,
    *,
    name: str = "虚构聚合网关",
    base_url: str = GATEWAY_BASE_URL,
    key: str = "fictional-provider-key",
    encrypted_api_key: str | None = None,
) -> int:
    with sessions() as db:
        provider = LLMProvider(
            name=name,
            base_url=base_url,
            encrypted_api_key=(
                encrypted_api_key
                if encrypted_api_key is not None
                else service.encrypt_credential(key)
            ),
            model_catalog_url=CATALOG_URL,
            price_sync_status="succeeded",
            version=1,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.add(provider)
        db.commit()
        return provider.id


def add_catalog_entry(
    sessions,
    provider_id: int,
    model_id: str,
    *,
    input_price: Decimal | None = Decimal("1.5"),
    output_price: Decimal | None = Decimal("2"),
    context_length: int | None = 200_000,
    max_output: int | None = 32_768,
    supports_reasoning: bool = False,
    input_modalities: str | None = "text",
) -> None:
    with sessions() as db:
        db.add(
            LLMProviderModel(
                provider_id=provider_id,
                model_id=model_id,
                display_name=model_id,
                context_length=context_length,
                max_output=max_output,
                input_modalities=input_modalities,
                supports_reasoning=supports_reasoning,
                input_price_per_million=input_price,
                output_price_per_million=output_price,
                synced_at=utc_now(),
            )
        )
        db.commit()


def add_candidate(
    sessions,
    service: LLMService,
    model: str,
    *,
    current: bool = False,
    capability: str = "chat",
    provider_id: int | None = None,
    input_price: Decimal | None = Decimal("1.5"),
    output_price: Decimal | None = Decimal("2"),
    catalog: bool = True,
    base_url: str = GATEWAY_BASE_URL,
) -> tuple[int, int]:
    """Create a provider-backed model and optionally bind it to a capability."""
    resolved_provider = (
        provider_id
        if provider_id is not None
        else add_provider(sessions, service, base_url=base_url)
    )
    if catalog:
        add_catalog_entry(
            sessions,
            resolved_provider,
            model,
            input_price=input_price,
            output_price=output_price,
        )
    with sessions() as db:
        config = LLMModelConfig(
            provider_id=resolved_provider,
            model_call_name=model,
            config_version=1,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.add(config)
        db.flush()
        if current:
            binding = db.get(LLMCapabilityBinding, capability)
            assert binding is not None
            binding.model_config_id = config.id
        db.commit()
        return resolved_provider, config.id


def success(content: str = "ok") -> GatewayResult:
    return GatewayResult(
        content=content,
        usage=GatewayUsage(1_000_000, 500_000),
    )


class StructuredPayload(BaseModel):
    answer: str


def test_chat_uses_only_bound_model_and_records_cost(service_context) -> None:
    service, gateway, sessions = service_context
    provider_id, current_id = add_candidate(
        sessions, service, "z-ai/glm-4.6", current=True
    )
    add_candidate(sessions, service, "z-ai/glm-4.5", provider_id=provider_id)
    gateway.complete_results["z-ai/glm-4.6"] = success("统一结果")
    gateway.complete_results["z-ai/glm-4.5"] = success("不应使用")

    result = asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="虚构请求")],
            source="manual_acceptance",
        )
    )

    assert result.content == "统一结果"
    assert [model for model, _key in gateway.calls] == ["z-ai/glm-4.6"]
    # Address and credential come from the provider, never from the model.
    assert gateway.base_urls == [GATEWAY_BASE_URL]
    assert gateway.calls[0][1] == "fictional-provider-key"
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log is not None
        assert log.source == "manual_acceptance"
        assert log.model_config_id == current_id
        assert log.model_name == "z-ai/glm-4.6"
        assert log.status == "succeeded"
        assert log.metering_status == "complete"
        # 1M input at $1.5 + 0.5M output at $2, priced from the synced catalog.
        assert log.estimated_cost == Decimal("2.5000000000")


def test_agent_runtime_model_uses_pi_binding_not_chat_binding(service_context) -> None:
    service, _gateway, sessions = service_context
    add_candidate(sessions, service, "z-ai/glm-4.6", current=True)
    provider_id = add_provider(
        sessions,
        service,
        name="虚构 Agent 网关",
        base_url="https://agent.example.invalid/v1",
        key="fictional-pi-key",
    )
    add_catalog_entry(
        sessions,
        provider_id,
        "moonshotai/kimi-k2",
        context_length=256_000,
        supports_reasoning=True,
        input_modalities="image,text",
    )
    _provider, pi_id = add_candidate(
        sessions,
        service,
        "moonshotai/kimi-k2",
        current=True,
        capability="pi_agent",
        provider_id=provider_id,
        catalog=False,
    )

    runtime = asyncio.run(service.agent_runtime_model())

    assert runtime.id == pi_id
    assert runtime.provider_id == provider_id
    assert runtime.provider_name == "虚构 Agent 网关"
    assert runtime.model_call_name == "moonshotai/kimi-k2"
    assert runtime.api_base == "https://agent.example.invalid/v1"
    assert runtime.api_key == "fictional-pi-key"
    assert runtime.definition.context_window == 256_000
    assert runtime.definition.reasoning is True
    assert runtime.definition.input_modalities == ("image", "text")


def test_model_definition_falls_back_when_the_catalog_entry_disappears(
    service_context,
) -> None:
    service, _gateway, sessions = service_context
    provider_id, _config_id = add_candidate(
        sessions, service, "z-ai/glm-4.6", current=True, capability="pi_agent"
    )
    with sessions() as db:
        for row in db.scalars(select(LLMProviderModel)).all():
            db.delete(row)
        db.commit()

    runtime = asyncio.run(service.agent_runtime_model())

    assert runtime.definition.context_window == 128_000
    assert runtime.definition.max_output == 8_192
    assert runtime.definition.input_price_per_million is None
    assert runtime.definition.input_modalities == ("text",)


def test_agent_model_summary_reads_pi_binding_without_decrypting_credentials(
    service_context,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _gateway, sessions = service_context
    provider_id = add_provider(
        sessions,
        service,
        name="虚构不透明网关",
        encrypted_api_key="v1:fake:not-a-real-secret",
    )
    _provider, _config_id = add_candidate(
        sessions,
        service,
        "fictional-agent-model",
        current=True,
        capability="pi_agent",
        provider_id=provider_id,
    )

    def fail_if_decrypted(_envelope: str):
        raise AssertionError("model summary must not decrypt credentials")

    monkeypatch.setattr(service._cipher, "decrypt", fail_if_decrypted)

    summary = asyncio.run(service.agent_model_summary())

    assert summary.provider == "虚构不透明网关"
    assert summary.name == "fictional-agent-model"


def test_agent_model_summary_reports_missing_pi_binding(service_context) -> None:
    service, _gateway, _sessions = service_context

    with pytest.raises(LLMError) as captured:
        asyncio.run(service.agent_model_summary())

    assert captured.value.code == "LLM_MODEL_NOT_CONFIGURED"


@pytest.mark.parametrize(
    "content",
    [
        '{"answer":"有效"}',
        '```json\n{"answer":"有效"}\n```',
        '结果如下：\n{"answer":"有效"}',
    ],
)
def test_structured_chat_uses_current_and_validates_local_json(
    service_context,
    content: str,
) -> None:
    service, gateway, sessions = service_context
    add_candidate(sessions, service, "z-ai/glm-4.6", current=True)
    gateway.complete_results["z-ai/glm-4.6"] = success(content)

    result = asyncio.run(
        service.structured_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="结构化请求")],
            source="fictional_module",
            response_model=StructuredPayload,
        )
    )

    assert result.value.answer == "有效"
    assert [model for model, _key in gateway.calls] == ["z-ai/glm-4.6"]
    assert len(gateway.message_batches) == 1
    instruction, original = gateway.message_batches[0]
    assert instruction.role == "system"
    assert "只返回一个" in instruction.content
    assert '"answer"' in instruction.content
    assert original == ChatMessage(role="user", content="结构化请求")


@pytest.mark.parametrize(
    "content",
    [
        "not-json",
        '{"wrong":"shape"}',
        '{"answer":"第一个"}\n{"answer":"第二个"}',
        '{"answer":"重复"}\n{"answer":"重复"}',
    ],
)
def test_invalid_structured_response_fails_without_backup(
    service_context,
    content: str,
) -> None:
    service, gateway, sessions = service_context
    provider_id, current_id = add_candidate(
        sessions, service, "z-ai/glm-4.6", current=True
    )
    add_candidate(sessions, service, "z-ai/glm-4.5", provider_id=provider_id)
    gateway.complete_results["z-ai/glm-4.6"] = success(content)

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
    assert [model for model, _key in gateway.calls] == ["z-ai/glm-4.6"]
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log is not None
        assert log.model_config_id == current_id
        assert log.status == "failed"
        assert log.error_code == "LLM_RESPONSE_INVALID"


def test_current_failure_never_calls_saved_backup(service_context) -> None:
    service, gateway, sessions = service_context
    provider_id, current_id = add_candidate(
        sessions, service, "z-ai/glm-4.6", current=True
    )
    add_candidate(sessions, service, "z-ai/glm-4.5", provider_id=provider_id)
    gateway.complete_results["z-ai/glm-4.6"] = GatewayError(
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
    assert [model for model, _key in gateway.calls] == ["z-ai/glm-4.6"]
    with sessions() as db:
        logs = db.scalars(select(LLMCallLog)).all()
        assert len(logs) == 1
        assert logs[0].model_config_id == current_id
        assert logs[0].status == "failed"


def test_unconfigured_chat_does_not_select_saved_candidates(service_context) -> None:
    service, gateway, sessions = service_context
    provider_id, _first = add_candidate(sessions, service, "z-ai/glm-4.6")
    add_candidate(sessions, service, "z-ai/glm-4.5", provider_id=provider_id)

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


def test_unreadable_provider_credential_stops_before_gateway(service_context) -> None:
    service, gateway, sessions = service_context
    provider_id = add_provider(
        sessions, service, encrypted_api_key="v1:missing:invalid"
    )
    add_candidate(
        sessions, service, "z-ai/glm-4.6", current=True, provider_id=provider_id
    )

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
    "input_price,output_price,usage,expected_status,has_cost",
    [
        (Decimal("1"), Decimal("2"), GatewayUsage(10, 2), "complete", True),
        (Decimal("1"), None, GatewayUsage(10, 2), "partial", False),
        (None, None, GatewayUsage(10, 2), "partial", False),
        # Prices are known but the provider reported no tokens.
        (Decimal("1"), Decimal("2"), GatewayUsage(None, None), "partial", False),
    ],
)
def test_metering_uses_only_the_synced_catalog_prices(
    service_context,
    input_price: Decimal | None,
    output_price: Decimal | None,
    usage: GatewayUsage,
    expected_status: str,
    has_cost: bool,
) -> None:
    service, gateway, sessions = service_context
    add_candidate(
        sessions,
        service,
        "z-ai/glm-4.6",
        current=True,
        input_price=input_price,
        output_price=output_price,
    )
    gateway.complete_results["z-ai/glm-4.6"] = GatewayResult(
        content="ok",
        usage=usage,
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


def test_failed_call_still_records_the_usage_it_already_paid_for(
    service_context,
) -> None:
    service, gateway, sessions = service_context
    add_candidate(sessions, service, "z-ai/glm-4.6", current=True)
    gateway.complete_results["z-ai/glm-4.6"] = GatewayError(
        code="LLM_TIMEOUT",
        may_have_reached_provider=True,
        usage=GatewayUsage(1_000_000, 500_000),
    )

    with pytest.raises(LLMError):
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="超时")],
                source="fictional_module",
            )
        )

    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log is not None
        assert log.status == "failed"
        assert log.metering_status == "partial"
        assert log.input_tokens == 1_000_000
        assert log.estimated_cost is None


def test_connection_test_uses_target_without_changing_binding(service_context) -> None:
    service, gateway, sessions = service_context
    provider_id, current_id = add_candidate(
        sessions, service, "z-ai/glm-4.6", current=True
    )
    _provider, target_id = add_candidate(
        sessions, service, "z-ai/glm-4.5", provider_id=provider_id
    )
    gateway.complete_results["z-ai/glm-4.5"] = success()

    call_id = asyncio.run(service.test_config(TEST_USER_ID, target_id))

    assert [model for model, _key in gateway.calls] == ["z-ai/glm-4.5"]
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
    add_candidate(sessions, service, "z-ai/glm-4.6", current=True)

    async def failed_stream():
        yield GatewayStreamEvent(type="delta", content="部分")
        raise GatewayError(
            code="LLM_UNAVAILABLE",
            may_have_reached_provider=True,
            usage=GatewayUsage(7, 3),
        )

    gateway.stream_results["z-ai/glm-4.6"] = failed_stream()

    async def consume():
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="流中失败")],
            source="fictional_module",
        )
        return stream.call_id, [event async for event in stream.events]

    call_id, events = asyncio.run(consume())

    assert [event.type for event in events] == ["delta", "error"]
    assert [model for model, _key in gateway.calls] == ["z-ai/glm-4.6"]
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
    add_candidate(sessions, service, "z-ai/glm-4.6", current=True)
    gateway.stream_results["z-ai/glm-4.6"] = [
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
