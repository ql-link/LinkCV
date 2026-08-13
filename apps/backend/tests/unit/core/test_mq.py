import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from linkcv.core.mq.kafka import KafkaPublisher
from linkcv.core.mq.message import ResumeImportMessage
from linkcv.core.mq.publisher import MQPublishError
from linkcv.core.mq.rabbitmq import RabbitMQPublisher


def test_resume_import_message_uses_canonical_string_identifiers() -> None:
    message = ResumeImportMessage.create(import_id=42, template_id=7)

    body = json.loads(message.body())
    assert body["mq_type"] == "RESUME_IMPORT_TASK"
    assert body["mq_name"] == "tolink.cv.resume_import"
    assert body["payload"]["import_id"] == "42"
    assert body["payload"]["template_id"] == "7"


@pytest.mark.parametrize("value", ["", "0", "01", "-1", " 1", "1.0"])
def test_resume_import_message_rejects_noncanonical_identifiers(value: str) -> None:
    with pytest.raises(ValidationError):
        ResumeImportMessage(
            payload={"import_id": value, "template_id": "1"}
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("mq_type", "OTHER_TASK"),
        ("mq_name", "other.resume_import"),
    ],
)
def test_resume_import_message_rejects_wrong_envelope_identity(
    field: str,
    value: str,
) -> None:
    payload = {
        "mq_type": "RESUME_IMPORT_TASK",
        "mq_name": "tolink.cv.resume_import",
        "payload": {"import_id": "42", "template_id": "7"},
    }
    payload[field] = value

    with pytest.raises(ValidationError):
        ResumeImportMessage.model_validate(payload)


def test_kafka_publish_uses_import_id_as_partition_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer = SimpleNamespace(
        start=AsyncMock(),
        send_and_wait=AsyncMock(return_value=object()),
        stop=AsyncMock(),
    )
    constructor = lambda **_kwargs: producer
    monkeypatch.setattr("linkcv.core.mq.kafka.AIOKafkaProducer", constructor)
    publisher = KafkaPublisher(
        bootstrap_servers="broker:9092",
        topic="resume-import",
        confirm_timeout_seconds=1,
    )
    message = ResumeImportMessage.create(import_id=42, template_id=7)

    async def exercise() -> None:
        await publisher.publish_resume_import(message)
        await publisher.close()

    asyncio.run(exercise())

    producer.send_and_wait.assert_awaited_once_with(
        "resume-import",
        value=message.body(),
        key=b"42",
    )
    producer.stop.assert_awaited_once()


def test_kafka_publish_wraps_broker_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    producer = SimpleNamespace(
        start=AsyncMock(side_effect=OSError("unavailable")),
        send_and_wait=AsyncMock(),
        stop=AsyncMock(),
    )
    monkeypatch.setattr(
        "linkcv.core.mq.kafka.AIOKafkaProducer", lambda **_kwargs: producer
    )
    publisher = KafkaPublisher(
        bootstrap_servers="broker:9092",
        topic="resume-import",
        confirm_timeout_seconds=1,
    )

    with pytest.raises(MQPublishError, match="Kafka did not confirm"):
        asyncio.run(
            publisher.publish_resume_import(
                ResumeImportMessage.create(import_id=42, template_id=7)
            )
        )

    producer.stop.assert_awaited_once()


def test_kafka_concurrent_first_publish_starts_only_one_producer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producers = []

    def constructor(**_kwargs):
        producer = SimpleNamespace(
            start=AsyncMock(),
            send_and_wait=AsyncMock(return_value=object()),
            stop=AsyncMock(),
        )
        producers.append(producer)
        return producer

    monkeypatch.setattr("linkcv.core.mq.kafka.AIOKafkaProducer", constructor)
    publisher = KafkaPublisher(
        bootstrap_servers="broker:9092",
        topic="resume-import",
        confirm_timeout_seconds=1,
    )
    first = ResumeImportMessage.create(import_id=41, template_id=7)
    second = ResumeImportMessage.create(import_id=42, template_id=7)

    async def exercise() -> None:
        await asyncio.gather(
            publisher.publish_resume_import(first),
            publisher.publish_resume_import(second),
        )
        await publisher.close()

    asyncio.run(exercise())

    assert len(producers) == 1
    producers[0].start.assert_awaited_once()
    assert producers[0].send_and_wait.await_count == 2
    producers[0].stop.assert_awaited_once()


def test_rabbitmq_publish_uses_fixed_routing_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exchange = SimpleNamespace(name="resume-import", publish=AsyncMock(return_value=True))
    dead_letter_exchange = SimpleNamespace(name="resume-import.DLX")
    queue = SimpleNamespace(bind=AsyncMock())
    dead_letter_queue = SimpleNamespace(bind=AsyncMock())
    channel = SimpleNamespace(
        is_closed=False,
        close=AsyncMock(),
        declare_exchange=AsyncMock(
            side_effect=[exchange, dead_letter_exchange]
        ),
        declare_queue=AsyncMock(side_effect=[queue, dead_letter_queue]),
    )
    connection = SimpleNamespace(
        is_closed=False,
        channel=AsyncMock(return_value=channel),
        close=AsyncMock(),
    )
    monkeypatch.setattr(
        "linkcv.core.mq.rabbitmq.aio_pika.connect_robust",
        AsyncMock(return_value=connection),
    )
    publisher = RabbitMQPublisher(
        url="amqp://guest:guest@rabbitmq/",
        exchange_name="resume-import",
        queue_name="resume-import-worker",
        routing_key="resume.import",
        confirm_timeout_seconds=1,
    )

    asyncio.run(
        publisher.publish_resume_import(
            ResumeImportMessage.create(import_id=42, template_id=7)
        )
    )

    exchange.publish.assert_awaited_once()
    assert exchange.publish.await_args.kwargs == {
        "routing_key": "resume.import",
        "mandatory": True,
        "timeout": 1,
    }
    queue.bind.assert_awaited_once_with(exchange, routing_key="resume.import")
