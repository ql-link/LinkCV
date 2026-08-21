import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

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
        headers={"x-linkcv-retry": retries},
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
        "resume.import.DLT"
    )
    incoming.ack.assert_awaited_once()
    incoming.nack.assert_not_awaited()


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
        topic="tolink.cv.resume_import",
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
        "tolink.cv.resume_import.DLT",
        value=incoming.value,
        key=b"42",
    )
    commit_offsets = consumer.commit.await_args.args[0]
    partition = TopicPartition(incoming.topic, incoming.partition)
    assert commit_offsets[partition].offset == incoming.offset + 1


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
        topic="tolink.cv.resume_import",
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
