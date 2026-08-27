import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from aiokafka.structs import TopicPartition

from linkcv.core.config import Settings
from linkcv.core.mq.message import DatasetParseMessage, ResumeImportMessage
from linkcv.workers.document_parse_consumer import (
    _handle_kafka_message,
    _handle_rabbit_message,
)
from linkcv.workers.resume_import_worker import (
    WorkerDependencyUnavailable,
    WorkerTaskRetryable,
)


def settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        jwt_secret="resume-import-consumer-test-secret-with-32-bytes",
        mq_consume_max_retries=2,
        mq_consume_retry_backoff_seconds=0.001,
    )


def message_body() -> bytes:
    return ResumeImportMessage.create(import_id=42, template_id=7).body()


def rabbit_incoming(*, retries: int = 0):
    return SimpleNamespace(
        body=message_body(),
        headers={"x-linkcv-pipeline-version": "v2", "x-linkcv-retry": retries},
        content_type="application/json",
        message_id="message-42",
        type="RESUME_IMPORT_TASK",
        ack=AsyncMock(),
        nack=AsyncMock(),
    )


def dataset_processor():
    return SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())


def test_rabbit_success_acks_original_message() -> None:
    processor = SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())
    incoming = rabbit_incoming()

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=SimpleNamespace(publish=AsyncMock()),
            incoming=incoming,
            settings=settings(),
        )
    )

    incoming.ack.assert_awaited_once()
    incoming.nack.assert_not_awaited()


def test_rabbit_body_identity_is_authoritative_over_observability_header() -> None:
    processor = SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())
    incoming = rabbit_incoming()
    incoming.headers["x-linkcv-pipeline-version"] = "v1"

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=SimpleNamespace(publish=AsyncMock()),
            incoming=incoming,
            settings=settings(),
        )
    )

    processor.process.assert_awaited_once_with(import_id=42, template_id=7)
    incoming.ack.assert_awaited_once()


def test_rabbit_dispatches_dataset_message_to_dataset_processor() -> None:
    resume = SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())
    dataset = dataset_processor()
    incoming = rabbit_incoming()
    incoming.body = DatasetParseMessage.create(parse_task_id=84).body()
    incoming.type = "DATASET_PARSE_TASK"

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=resume,
            dataset_processor=dataset,
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=SimpleNamespace(publish=AsyncMock()),
            incoming=incoming,
            settings=settings(),
        )
    )

    resume.process.assert_not_awaited()
    dataset.process.assert_awaited_once_with(parse_task_id=84)
    incoming.ack.assert_awaited_once()


@pytest.mark.parametrize(
    "mutation",
    [
        "missing_pipeline_version",
        "v1_pipeline_version",
        "unknown_pipeline_version",
        "unknown_payload_field",
    ],
)
def test_rabbit_rejects_non_v2_messages_before_processor(
    mutation: str,
) -> None:
    body = json.loads(message_body())
    if mutation == "missing_pipeline_version":
        del body["pipeline_version"]
    elif mutation == "v1_pipeline_version":
        body["pipeline_version"] = "v1"
    elif mutation == "unknown_pipeline_version":
        body["pipeline_version"] = "v3"
    else:
        body["payload"]["unexpected"] = "must be rejected"
    encoded = json.dumps(body).encode("utf-8")
    resume = SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())
    incoming = rabbit_incoming()
    incoming.body = encoded
    incoming.headers["x-custom-header"] = "preserve-me"
    dead_letter_exchange = SimpleNamespace(publish=AsyncMock(return_value=True))

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=resume,
            dataset_processor=dataset_processor(),
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=dead_letter_exchange,
            incoming=incoming,
            settings=settings(),
        )
    )

    resume.process.assert_not_awaited()
    dead_letter_exchange.publish.assert_awaited_once()
    outbound = dead_letter_exchange.publish.await_args.args[0]
    assert outbound.body == encoded
    assert outbound.headers == incoming.headers
    incoming.ack.assert_awaited_once()
    incoming.nack.assert_not_awaited()


def test_rabbit_retry_exhaustion_confirms_dlt_before_ack() -> None:
    processor = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerTaskRetryable("temporary")),
        mark_retry_exhausted=Mock(),
    )
    incoming = rabbit_incoming(retries=2)
    dead_letter_exchange = SimpleNamespace(publish=AsyncMock(return_value=True))

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=dead_letter_exchange,
            incoming=incoming,
            settings=settings(),
        )
    )

    processor.mark_retry_exhausted.assert_called_once_with(42)
    assert dead_letter_exchange.publish.await_args.kwargs["routing_key"] == (
        "resume.import.v2.DLT"
    )
    outbound = dead_letter_exchange.publish.await_args.args[0]
    assert outbound.body == incoming.body
    assert outbound.headers == incoming.headers
    incoming.ack.assert_awaited_once()
    incoming.nack.assert_not_awaited()


def test_rabbit_dataset_retry_exhaustion_defers_terminal_state_to_lease_recovery() -> None:
    resume = SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())
    dataset = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerTaskRetryable("temporary")),
        mark_retry_exhausted=Mock(),
    )
    incoming = rabbit_incoming(retries=2)
    incoming.body = DatasetParseMessage.create(parse_task_id=84).body()
    incoming.type = "DATASET_PARSE_TASK"
    dead_letter_exchange = SimpleNamespace(publish=AsyncMock(return_value=True))

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=resume,
            dataset_processor=dataset,
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=dead_letter_exchange,
            incoming=incoming,
            settings=settings(),
        )
    )

    dataset.mark_retry_exhausted.assert_not_called()
    incoming.ack.assert_awaited_once()
    incoming.nack.assert_not_awaited()


def test_rabbit_terminal_state_write_failure_retains_original_message() -> None:
    processor = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerTaskRetryable("temporary")),
        mark_retry_exhausted=Mock(side_effect=WorkerDependencyUnavailable("database")),
    )
    incoming = rabbit_incoming(retries=2)
    dead_letter_exchange = SimpleNamespace(publish=AsyncMock(return_value=True))

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=dead_letter_exchange,
            incoming=incoming,
            settings=settings(),
        )
    )

    dead_letter_exchange.publish.assert_awaited_once()
    processor.mark_retry_exhausted.assert_called_once_with(42)
    incoming.ack.assert_not_awaited()
    incoming.nack.assert_awaited_once_with(requeue=True)


def test_rabbit_retry_logs_safe_attempt_and_stage(caplog) -> None:
    processor = SimpleNamespace(
        process=AsyncMock(
            side_effect=WorkerTaskRetryable(
                "stable-code",
                stage="resume_structuring",
                exception_type="StructuringModelError",
            )
        ),
        mark_retry_exhausted=Mock(),
    )
    incoming = rabbit_incoming(retries=0)
    exchange = SimpleNamespace(publish=AsyncMock(return_value=True))

    with caplog.at_level("WARNING"):
        asyncio.run(
            _handle_rabbit_message(
                resume_processor=processor,
                dataset_processor=dataset_processor(),
                exchange=exchange,
                dead_letter_exchange=SimpleNamespace(publish=AsyncMock()),
                incoming=incoming,
                settings=settings(),
            )
        )

    retry = next(
        record
        for record in caplog.records
        if record.message == "document parse retry scheduled"
    )
    assert retry.task_id == 42
    assert retry.source == "resume"
    assert retry.attempt == 2
    assert retry.failure_stage == "resume_structuring"
    assert retry.exception_type == "StructuringModelError"
    assert retry.pipeline_version == "v2"
    assert retry.source == "resume"
    assert retry.vendor == "rabbitmq"
    assert retry.route == "resume.import.v2"
    assert retry.message_id
    republished = exchange.publish.await_args.args[0]
    assert republished.body == incoming.body
    assert republished.headers == {
        "x-linkcv-pipeline-version": "v2",
        "x-linkcv-retry": 1,
    }
    assert "stable-code" not in caplog.text


def test_rabbit_dlt_failure_retains_original_message() -> None:
    processor = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerTaskRetryable("temporary")),
        mark_retry_exhausted=Mock(),
    )
    incoming = rabbit_incoming(retries=2)

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            exchange=SimpleNamespace(publish=AsyncMock()),
            dead_letter_exchange=SimpleNamespace(
                publish=AsyncMock(side_effect=OSError("broker unavailable"))
            ),
            incoming=incoming,
            settings=settings(),
        )
    )

    incoming.nack.assert_awaited_once_with(requeue=True)
    incoming.ack.assert_not_awaited()
    processor.mark_retry_exhausted.assert_not_called()


def test_rabbit_shared_dependency_failure_does_not_consume_retry_budget() -> None:
    processor = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerDependencyUnavailable("database")),
        mark_retry_exhausted=Mock(),
    )
    incoming = rabbit_incoming(retries=1)
    exchange = SimpleNamespace(publish=AsyncMock())
    dead_letter_exchange = SimpleNamespace(publish=AsyncMock())

    asyncio.run(
        _handle_rabbit_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            exchange=exchange,
            dead_letter_exchange=dead_letter_exchange,
            incoming=incoming,
            settings=settings(),
        )
    )

    incoming.nack.assert_awaited_once_with(requeue=True)
    exchange.publish.assert_not_awaited()
    dead_letter_exchange.publish.assert_not_awaited()
    processor.mark_retry_exhausted.assert_not_called()


def test_kafka_retry_exhaustion_publishes_dlt_before_exact_commit() -> None:
    processor = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerTaskRetryable("temporary")),
        mark_retry_exhausted=Mock(),
    )
    consumer = SimpleNamespace(
        pause=Mock(),
        resume=Mock(),
        commit=AsyncMock(),
    )
    producer = SimpleNamespace(send_and_wait=AsyncMock(return_value=object()))
    incoming = SimpleNamespace(
        topic="tolink.cv.resume_import.v2",
        partition=3,
        offset=17,
        value=message_body(),
        key=b"42",
    )

    asyncio.run(
        _handle_kafka_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            consumer=consumer,
            producer=producer,
            incoming=incoming,
            settings=settings(),
        )
    )

    assert processor.process.await_count == 3
    processor.mark_retry_exhausted.assert_called_once_with(42)
    producer.send_and_wait.assert_awaited_once_with(
        "tolink.cv.resume_import.v2.DLT",
        value=incoming.value,
        key=b"42",
    )
    commit_offsets = consumer.commit.await_args.args[0]
    partition = TopicPartition(incoming.topic, incoming.partition)
    assert commit_offsets[partition].offset == incoming.offset + 1


def test_kafka_dispatches_dataset_v2_message_to_dataset_processor() -> None:
    resume = SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())
    dataset = dataset_processor()
    consumer = SimpleNamespace(commit=AsyncMock())
    producer = SimpleNamespace(send_and_wait=AsyncMock(return_value=object()))
    incoming = SimpleNamespace(
        topic="tolink.cv.resume_import.v2",
        partition=1,
        offset=8,
        value=DatasetParseMessage.create(parse_task_id=84).body(),
        key=b"84",
    )

    asyncio.run(
        _handle_kafka_message(
            resume_processor=resume,
            dataset_processor=dataset,
            consumer=consumer,
            producer=producer,
            incoming=incoming,
            settings=settings(),
        )
    )

    resume.process.assert_not_awaited()
    dataset.process.assert_awaited_once_with(parse_task_id=84)
    producer.send_and_wait.assert_not_awaited()
    consumer.commit.assert_awaited_once()


@pytest.mark.parametrize(
    "mutation",
    [
        "missing_pipeline_version",
        "v1_pipeline_version",
        "unknown_pipeline_version",
        "unknown_payload_field",
    ],
)
def test_kafka_rejects_non_v2_messages_before_processor(mutation: str) -> None:
    body = json.loads(message_body())
    if mutation == "missing_pipeline_version":
        del body["pipeline_version"]
    elif mutation == "v1_pipeline_version":
        body["pipeline_version"] = "v1"
    elif mutation == "unknown_pipeline_version":
        body["pipeline_version"] = "v3"
    else:
        body["payload"]["unexpected"] = "must be rejected"
    encoded = json.dumps(body).encode("utf-8")
    resume = SimpleNamespace(process=AsyncMock(), mark_retry_exhausted=Mock())
    consumer = SimpleNamespace(commit=AsyncMock())
    producer = SimpleNamespace(send_and_wait=AsyncMock(return_value=object()))
    incoming = SimpleNamespace(
        topic="tolink.cv.resume_import.v2",
        partition=0,
        offset=3,
        value=encoded,
        key=b"42",
    )

    asyncio.run(
        _handle_kafka_message(
            resume_processor=resume,
            dataset_processor=dataset_processor(),
            consumer=consumer,
            producer=producer,
            incoming=incoming,
            settings=settings(),
        )
    )

    resume.process.assert_not_awaited()
    producer.send_and_wait.assert_awaited_once_with(
        "tolink.cv.resume_import.v2.DLT",
        value=encoded,
        key=b"42",
    )
    consumer.commit.assert_awaited_once()


def test_kafka_terminal_state_write_failure_does_not_commit_offset() -> None:
    processor = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerTaskRetryable("temporary")),
        mark_retry_exhausted=Mock(side_effect=WorkerDependencyUnavailable("database")),
    )
    consumer = SimpleNamespace(
        pause=Mock(),
        resume=Mock(),
        seek=Mock(),
        commit=AsyncMock(),
    )
    producer = SimpleNamespace(send_and_wait=AsyncMock(return_value=object()))
    incoming = SimpleNamespace(
        topic="tolink.cv.resume_import.v2",
        partition=3,
        offset=17,
        value=message_body(),
        key=b"42",
    )

    asyncio.run(
        _handle_kafka_message(
            resume_processor=processor,
            dataset_processor=dataset_processor(),
            consumer=consumer,
            producer=producer,
            incoming=incoming,
            settings=settings(),
        )
    )

    assert processor.process.await_count == 3
    processor.mark_retry_exhausted.assert_called_once_with(42)
    producer.send_and_wait.assert_awaited_once_with(
        "tolink.cv.resume_import.v2.DLT",
        value=incoming.value,
        key=b"42",
    )
    consumer.seek.assert_called_once_with(
        TopicPartition(incoming.topic, incoming.partition),
        incoming.offset,
    )
    consumer.commit.assert_not_awaited()


def test_kafka_dlt_failure_does_not_commit_offset() -> None:
    processor = SimpleNamespace(
        process=AsyncMock(side_effect=WorkerTaskRetryable("temporary")),
        mark_retry_exhausted=Mock(),
    )
    consumer = SimpleNamespace(
        pause=Mock(),
        resume=Mock(),
        commit=AsyncMock(),
    )
    producer = SimpleNamespace(
        send_and_wait=AsyncMock(side_effect=OSError("broker unavailable"))
    )
    incoming = SimpleNamespace(
        topic="tolink.cv.resume_import.v2",
        partition=0,
        offset=5,
        value=message_body(),
        key=b"42",
    )

    try:
        asyncio.run(
            _handle_kafka_message(
                resume_processor=processor,
                dataset_processor=dataset_processor(),
                consumer=consumer,
                producer=producer,
                incoming=incoming,
                settings=settings(),
            )
        )
    except OSError:
        pass
    else:
        raise AssertionError("DLT publish failure must remain visible to the consumer")

    consumer.commit.assert_not_awaited()
    processor.mark_retry_exhausted.assert_not_called()
