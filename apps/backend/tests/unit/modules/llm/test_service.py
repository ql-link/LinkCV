import asyncio
from collections.abc import AsyncIterator, Sequence
from datetime import datetime, timezone
from decimal import Decimal
import logging

from cryptography.fernet import Fernet
import pytest
from sqlalchemy import select

import linkcv.models  # noqa: F401
import linkcv.modules.llm.service as llm_service_module
from linkcv.core.database import Base, build_engine, build_session_factory
from linkcv.modules.identity.models import User
from linkcv.modules.llm.crypto import CredentialCipher
from linkcv.modules.llm.gateway import (
    GatewayError,
    GatewayResult,
    GatewayStreamEvent,
    GatewayUsage,
)
from linkcv.modules.llm.models import LLMCallLog, LLMModelConfig
from linkcv.modules.llm.schemas import ChatMessage
from linkcv.modules.llm.service import LLMError, LLMService

TEST_USER_ID = 1


class FakeGateway:
    def __init__(self) -> None:
        self.complete_results: dict[str, GatewayResult | GatewayError] = {}
        self.stream_results: dict[
            str, list[GatewayStreamEvent] | GatewayError | AsyncIterator[GatewayStreamEvent]
        ] = {}
        self.calls: list[tuple[str, str | None]] = []

    async def complete(self, *, model, messages, api_base, api_key):
        del messages, api_base
        self.calls.append((model, api_key))
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
        user = User(
            email="zhangsan@example.invalid",
            password_hash="fictional",
            nickname="张三",
        )
        db.add(user)
        db.commit()
        assert user.id == TEST_USER_ID
    gateway = FakeGateway()
    key = Fernet.generate_key().decode("ascii")
    service = LLMService(sessions, gateway, CredentialCipher(f"test:{key}"))
    return service, gateway, sessions


def add_config(sessions, service, model: str, priority: int, **prices) -> int:
    with sessions() as db:
        config = LLMModelConfig(
            model_name=model,
            encrypted_api_key=service.encrypt_credential(f"{model}-key"),
            enabled=True,
            priority=priority,
            **prices,
        )
        db.add(config)
        db.commit()
        return config.id


def success(content: str = "ok") -> GatewayResult:
    return GatewayResult(
        content=content,
        usage=GatewayUsage(1_000_000, 500_000),
        input_price_per_million=Decimal("1.5"),
        output_price_per_million=Decimal("2"),
    )


def test_chat_returns_unified_result_and_cost_snapshot(service_context) -> None:
    service, gateway, sessions = service_context
    config_id = add_config(sessions, service, "primary", 10)
    gateway.complete_results["primary"] = success("统一结果")

    result = asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="虚构请求")],
        )
    )

    assert result.content == "统一结果"
    assert result.usage.input_tokens == 1_000_000
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == result.call_id))
        assert log is not None
        assert log.status == "succeeded"
        assert log.model_config_id == config_id
        assert log.metering_status == "complete"
        assert log.estimated_cost == Decimal("2.5000000000")


def test_switchable_failure_uses_backup_with_one_log(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "primary", 10)
    backup_id = add_config(sessions, service, "backup", 20)
    gateway.complete_results["primary"] = GatewayError(
        switchable=True, may_have_reached_provider=False
    )
    gateway.complete_results["backup"] = success()

    result = asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="使用备用")],
        )
    )

    assert [model for model, _key in gateway.calls] == ["primary", "backup"]
    with sessions() as db:
        logs = db.scalars(select(LLMCallLog)).all()
        assert len(logs) == 1
        assert logs[0].call_id == result.call_id
        assert logs[0].model_config_id == backup_id
        assert logs[0].status == "succeeded"


def test_ambiguous_failure_marks_successful_backup_metering_partial(
    service_context,
) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "primary", 10)
    add_config(sessions, service, "backup", 20)
    gateway.complete_results["primary"] = GatewayError(
        switchable=True, may_have_reached_provider=True
    )
    gateway.complete_results["backup"] = success()

    result = asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="可能产生前次成本")],
        )
    )

    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == result.call_id))
        assert log.metering_status == "partial"
        assert log.estimated_cost is None


def test_non_switchable_failure_does_not_call_backup(service_context) -> None:
    service, gateway, sessions = service_context
    primary_id = add_config(sessions, service, "primary", 10)
    add_config(sessions, service, "backup", 20)
    gateway.complete_results["primary"] = GatewayError(
        switchable=False, may_have_reached_provider=False
    )

    with pytest.raises(LLMError) as error:
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="不可切换")],
            )
        )

    assert error.value.code == "LLM_REQUEST_REJECTED"
    assert [model for model, _key in gateway.calls] == ["primary"]
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "failed"
        assert log.model_config_id == primary_id


def test_all_switchable_candidates_fail_with_one_log(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "primary", 10)
    backup_id = add_config(sessions, service, "backup", 20)
    gateway.complete_results["primary"] = GatewayError(
        switchable=True, may_have_reached_provider=False
    )
    gateway.complete_results["backup"] = GatewayError(
        switchable=True, may_have_reached_provider=False
    )

    with pytest.raises(LLMError) as error:
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="全部失败")],
            )
        )

    assert error.value.code == "LLM_UNAVAILABLE"
    with sessions() as db:
        logs = db.scalars(select(LLMCallLog)).all()
        assert len(logs) == 1
        assert logs[0].model_config_id == backup_id
        assert logs[0].error_code == "LLM_UNAVAILABLE"


def test_no_enabled_model_fails_without_gateway_request(service_context) -> None:
    service, gateway, sessions = service_context

    with pytest.raises(LLMError) as error:
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="没有模型")],
            )
        )

    assert error.value.code == "NO_AVAILABLE_LLM_MODEL"
    assert gateway.calls == []
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "failed"
        assert log.model_config_id is None


def test_no_enabled_model_stream_fails_without_gateway_request(
    service_context,
) -> None:
    service, gateway, sessions = service_context

    with pytest.raises(LLMError) as error:
        asyncio.run(
            service.stream_chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="没有流式模型")],
            )
        )

    assert error.value.code == "NO_AVAILABLE_LLM_MODEL"
    assert gateway.calls == []
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "failed"
        assert log.model_config_id is None


def test_stream_returns_deltas_and_finalizes_usage(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "stream-model", 10)
    gateway.stream_results["stream-model"] = [
        GatewayStreamEvent(type="delta", content="前"),
        GatewayStreamEvent(type="delta", content="后"),
        GatewayStreamEvent(
            type="done",
            usage=GatewayUsage(12, 8),
            input_price_per_million=Decimal("1"),
            output_price_per_million=Decimal("2"),
        ),
    ]

    async def consume():
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="流式")],
        )
        return stream.call_id, [event async for event in stream.events]

    call_id, events = asyncio.run(consume())

    assert [event.type for event in events] == ["delta", "delta", "done"]
    assert {event.call_id for event in events} == {call_id}
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log.status == "succeeded"
        assert log.input_tokens == 12
        assert log.output_tokens == 8


def test_stream_failure_after_delta_does_not_switch_model(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "primary", 10)
    add_config(sessions, service, "backup", 20)

    async def failed_stream():
        yield GatewayStreamEvent(type="delta", content="部分")
        raise GatewayError(
            switchable=True,
            may_have_reached_provider=True,
            usage=GatewayUsage(7, 3),
            input_price_per_million=Decimal("1.5"),
            output_price_per_million=Decimal("2"),
        )

    gateway.stream_results["primary"] = failed_stream()
    gateway.stream_results["backup"] = [
        GatewayStreamEvent(type="done", usage=GatewayUsage(1, 1))
    ]

    async def consume():
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="流中失败")],
        )
        return stream.call_id, [event async for event in stream.events]

    call_id, events = asyncio.run(consume())

    assert [event.type for event in events] == ["delta", "error"]
    assert [model for model, _key in gateway.calls] == ["primary"]
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log.status == "failed"
        assert log.error_code == "LLM_REQUEST_REJECTED"
        assert log.metering_status == "partial"
        assert log.input_tokens == 7
        assert log.output_tokens == 3
        assert log.input_price_per_million == Decimal("1.50000000")
        assert log.output_price_per_million == Decimal("2.00000000")
        assert log.estimated_cost is None


def test_stream_without_usage_succeeds_with_unknown_metering(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "stream-model", 10)
    gateway.stream_results["stream-model"] = [GatewayStreamEvent(type="done")]

    async def consume():
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="无计量")],
        )
        return stream.call_id, [event async for event in stream.events]

    call_id, events = asyncio.run(consume())

    assert [event.type for event in events] == ["done"]
    assert events[0].usage is None
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log.status == "succeeded"
        assert log.metering_status == "unknown"
        assert log.estimated_cost is None


def test_config_price_is_used_when_gateway_price_is_missing(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(
        sessions,
        service,
        "custom-model",
        10,
        input_price_per_million=Decimal("1.5"),
        output_price_per_million=Decimal("2"),
    )
    gateway.complete_results["custom-model"] = GatewayResult(
        content="ok",
        usage=GatewayUsage(1_000_000, 500_000),
        input_price_per_million=None,
        output_price_per_million=None,
    )

    result = asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="覆盖价格")],
        )
    )

    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == result.call_id))
        assert log.metering_status == "complete"
        assert log.estimated_cost == Decimal("2.5000000000")


def test_unreadable_credential_fails_and_closes_log(
    service_context, caplog
) -> None:
    service, gateway, sessions = service_context
    config_id = add_config(sessions, service, "primary", 10)
    with sessions() as db:
        config = db.get(LLMModelConfig, config_id)
        config.encrypted_api_key = "v1:missing:invalid"
        db.commit()

    with caplog.at_level(logging.WARNING, logger="linkcv.modules.llm.service"):
        with pytest.raises(LLMError) as error:
            asyncio.run(
                service.chat(
                    TEST_USER_ID,
                    [ChatMessage(role="user", content="不可解密")],
                )
            )

    assert error.value.code == "LLM_CREDENTIALS_UNAVAILABLE"
    assert gateway.calls == []
    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "failed"
        assert log.error_code == "LLM_CREDENTIALS_UNAVAILABLE"
    finalized = [
        record
        for record in caplog.records
        if record.getMessage().startswith("LLM call finalized")
    ]
    assert len(finalized) == 1
    assert finalized[0].error_code == "LLM_CREDENTIALS_UNAVAILABLE"
    assert "status=failed" in caplog.text
    assert "error_code=LLM_CREDENTIALS_UNAVAILABLE" in caplog.text
    assert "metering_status=unknown" in caplog.text
    assert "v1:missing:invalid" not in caplog.text
    assert "不可解密" not in caplog.text


def test_old_credential_is_rewrapped_with_active_key(service_context) -> None:
    _service, gateway, sessions = service_context
    old_key = Fernet.generate_key().decode("ascii")
    current_key = Fernet.generate_key().decode("ascii")
    old_cipher = CredentialCipher(f"old:{old_key}")
    with sessions() as db:
        config = LLMModelConfig(
            model_name="rotating-model",
            encrypted_api_key=old_cipher.encrypt("rotating-key"),
            enabled=True,
            priority=10,
        )
        db.add(config)
        db.commit()
        config_id = config.id
    service = LLMService(
        sessions,
        gateway,
        CredentialCipher(f"current:{current_key},old:{old_key}"),
    )
    gateway.complete_results["rotating-model"] = success()

    asyncio.run(
        service.chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="轮换凭据")],
        )
    )

    with sessions() as db:
        config = db.get(LLMModelConfig, config_id)
        assert config.encrypted_api_key.startswith("v1:current:")


def test_stream_cancellation_closes_pending_log(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "cancel-model", 10)
    first_delta = asyncio.Event()

    async def blocked_stream():
        yield GatewayStreamEvent(type="delta", content="部分")
        first_delta.set()
        await asyncio.Event().wait()

    gateway.stream_results["cancel-model"] = blocked_stream()

    async def cancel_after_delta():
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="取消")],
        )

        async def consume():
            async for _event in stream.events:
                pass

        task = asyncio.create_task(consume())
        await first_delta.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return stream.call_id

    call_id = asyncio.run(cancel_after_delta())
    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log.status == "cancelled"
        assert log.metering_status == "unknown"


def test_chat_cancellation_closes_pending_log(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "cancel-chat-model", 10)
    request_started = asyncio.Event()

    async def blocked_complete(**_kwargs):
        request_started.set()
        await asyncio.Event().wait()

    gateway.complete = blocked_complete

    async def cancel_request() -> None:
        task = asyncio.create_task(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="取消普通调用")],
            )
        )
        await request_started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_request())

    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "cancelled"


def test_stream_setup_cancellation_closes_pending_log(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "cancel-stream-setup", 10)
    request_started = asyncio.Event()

    async def blocked_start_stream(**_kwargs):
        request_started.set()
        await asyncio.Event().wait()

    gateway.start_stream = blocked_start_stream

    async def cancel_request() -> None:
        task = asyncio.create_task(
            service.stream_chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="取消流式连接")],
            )
        )
        await request_started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_request())

    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "cancelled"


def test_connection_test_cancellation_closes_pending_log(service_context) -> None:
    service, gateway, sessions = service_context
    config_id = add_config(sessions, service, "cancel-connection-test", 10)
    request_started = asyncio.Event()

    async def blocked_complete(**_kwargs):
        request_started.set()
        await asyncio.Event().wait()

    gateway.complete = blocked_complete

    async def cancel_request() -> None:
        task = asyncio.create_task(
            service.test_config(
                TEST_USER_ID,
                config_id,
            )
        )
        await request_started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_request())

    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        assert log.status == "cancelled"


def test_stream_closed_before_first_event_is_cancelled(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "close-before-event", 10)
    gateway.stream_results["close-before-event"] = [
        GatewayStreamEvent(type="done", usage=GatewayUsage(1, 1))
    ]

    async def close_before_iteration() -> str:
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="首事件前关闭")],
        )
        await stream.events.aclose()
        return stream.call_id

    call_id = asyncio.run(close_before_iteration())

    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log.status == "cancelled"


def test_stream_close_after_done_does_not_overwrite_success(service_context) -> None:
    service, gateway, sessions = service_context
    add_config(sessions, service, "close-after-done", 10)
    gateway.stream_results["close-after-done"] = [
        GatewayStreamEvent(type="done", usage=GatewayUsage(1, 1))
    ]

    async def close_after_done() -> str:
        stream = await service.stream_chat(
            TEST_USER_ID,
            [ChatMessage(role="user", content="完成后关闭")],
        )
        event = await anext(stream.events)
        assert event.type == "done"
        await stream.events.aclose()
        return stream.call_id

    call_id = asyncio.run(close_after_done())

    with sessions() as db:
        log = db.scalar(select(LLMCallLog).where(LLMCallLog.call_id == call_id))
        assert log.status == "succeeded"


def test_call_log_creation_uses_explicit_utc_time(
    service_context, monkeypatch
) -> None:
    service, _gateway, sessions = service_context
    fixed = datetime(2026, 7, 26, 13, 45, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(llm_service_module, "utc_now", lambda: fixed)

    with pytest.raises(LLMError):
        asyncio.run(
            service.chat(
                TEST_USER_ID,
                [ChatMessage(role="user", content="UTC 调用时间")],
            )
        )

    with sessions() as db:
        log = db.scalar(select(LLMCallLog))
        created_at = log.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        assert created_at == fixed
