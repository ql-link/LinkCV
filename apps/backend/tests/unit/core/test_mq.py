import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, call

import pytest
from pydantic import ValidationError

from linkcv.core.mq.kafka import KafkaPublisher
from linkcv.core.mq.message import DatasetParseMessage, ResumeImportMessage
from linkcv.core.mq.publisher import MQPublishError
from linkcv.core.mq.rabbitmq import RabbitMQPublisher


def test_resume_import_message_uses_canonical_string_identifiers() -> None:
    message = ResumeImportMessage.create(import_id=42, template_id=7)

    body = json.loads(message.body())
    assert body["mq_type"] == "RESUME_IMPORT_TASK"
    assert body["pipeline_version"] == "v2"
    assert body["mq_name"] == "tolink.cv.resume_import.v2"
    assert body["payload"]["import_id"] == "42"
    assert body["payload"]["template_id"] == "7"


def test_dataset_parse_message_uses_shared_envelope_and_canonical_id() -> None:
    message = DatasetParseMessage.create(parse_task_id=42)

    body = json.loads(message.body())
    assert body["mq_type"] == "DATASET_PARSE_TASK"
    assert body["pipeline_version"] == "v2"
    assert body["mq_name"] == "tolink.cv.resume_import.v2"
    assert body["payload"]["parse_task_id"] == "42"


def test_message_requires_pipeline_version() -> None:
    with pytest.raises(ValidationError):
        ResumeImportMessage.model_validate(
            {
                "mq_type": "RESUME_IMPORT_TASK",
                "mq_name": "tolink.cv.resume_import.v2",
                "payload": {"import_id": "42", "template_id": "7"},
            }
        )


@pytest.mark.parametrize(
    "payload",
    [
        {
            "mq_type": "RESUME_IMPORT_TASK",
            "mq_name": "tolink.cv.resume_import.v2",
            "pipeline_version": "v2",
            "payload": {"import_id": "42", "template_id": "7", "extra": True},
        },
        {
            "mq_type": "RESUME_IMPORT_TASK",
            "mq_name": "tolink.cv.resume_import.v2",
            "pipeline_version": "v2",
            "payload": {"import_id": "42", "template_id": "7"},
            "extra": True,
        },
    ],
)
def test_message_rejects_unknown_envelope_or_payload_fields(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        ResumeImportMessage.model_validate(payload)


def test_dataset_message_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        DatasetParseMessage.model_validate(
            {
                "mq_type": "DATASET_PARSE_TASK",
                "mq_name": "tolink.cv.resume_import.v2",
                "pipeline_version": "v2",
                "payload": {"parse_task_id": "42", "unexpected": True},
            }
        )


@pytest.mark.parametrize("value", ["", "0", "01", "-1", " 1", "1.0"])
def test_resume_import_message_rejects_noncanonical_identifiers(value: str) -> None:
    with pytest.raises(ValidationError):
        ResumeImportMessage(
            pipeline_version="v2",
            mq_name="tolink.cv.resume_import.v2",
            payload={"import_id": value, "template_id": "1"},
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("mq_type", "OTHER_TASK"),
        ("mq_name", "other.resume_import"),
        ("pipeline_version", "v1"),
    ],
)
def test_resume_import_message_rejects_wrong_envelope_identity(
    field: str,
    value: str,
) -> None:
    payload = {
        "mq_type": "RESUME_IMPORT_TASK",
        "mq_name": "tolink.cv.resume_import.v2",
        "pipeline_version": "v2",
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

    def constructor(**_kwargs):
        return producer

    monkeypatch.setattr("linkcv.core.mq.kafka.AIOKafkaProducer", constructor)
    publisher = KafkaPublisher(
        bootstrap_servers="broker:9092",
        topic="tolink.cv.resume_import.v2",
        confirm_timeout_seconds=1,
    )
    message = ResumeImportMessage.create(import_id=42, template_id=7)

    async def exercise() -> None:
        await publisher.publish(message)
        await publisher.close()

    asyncio.run(exercise())

    producer.send_and_wait.assert_awaited_once_with(
        "tolink.cv.resume_import.v2",
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

    def constructor(**_kwargs):
        return producer

    monkeypatch.setattr("linkcv.core.mq.kafka.AIOKafkaProducer", constructor)
    publisher = KafkaPublisher(
        bootstrap_servers="broker:9092",
        topic="tolink.cv.resume_import.v2",
        confirm_timeout_seconds=1,
    )

    with pytest.raises(MQPublishError, match="Kafka did not confirm"):
        asyncio.run(
            publisher.publish(ResumeImportMessage.create(import_id=42, template_id=7))
        )

    producer.stop.assert_awaited_once()


def test_kafka_publish_uses_dataset_task_id_as_partition_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    producer = SimpleNamespace(
        start=AsyncMock(),
        send_and_wait=AsyncMock(return_value=object()),
        stop=AsyncMock(),
    )

    def constructor(**_kwargs):
        return producer

    monkeypatch.setattr("linkcv.core.mq.kafka.AIOKafkaProducer", constructor)
    publisher = KafkaPublisher(
        bootstrap_servers="broker:9092",
        topic="tolink.cv.resume_import.v2",
        confirm_timeout_seconds=1,
    )
    message = DatasetParseMessage.create(parse_task_id=84)

    asyncio.run(publisher.publish(message))

    producer.send_and_wait.assert_awaited_once_with(
        "tolink.cv.resume_import.v2",
        value=message.body(),
        key=b"84",
    )


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
        topic="tolink.cv.resume_import.v2",
        confirm_timeout_seconds=1,
    )
    first = ResumeImportMessage.create(import_id=41, template_id=7)
    second = ResumeImportMessage.create(import_id=42, template_id=7)

    async def exercise() -> None:
        await asyncio.gather(
            publisher.publish(first),
            publisher.publish(second),
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
    exchange = SimpleNamespace(
        name="tolink.cv.resume_import.v2", publish=AsyncMock(return_value=True)
    )
    dead_letter_exchange = SimpleNamespace(name="tolink.cv.resume_import.v2.DLX")
    queue = SimpleNamespace(bind=AsyncMock())
    dead_letter_queue = SimpleNamespace(bind=AsyncMock())
    channel = SimpleNamespace(
        is_closed=False,
        close=AsyncMock(),
        declare_exchange=AsyncMock(side_effect=[exchange, dead_letter_exchange]),
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
        exchange_name="tolink.cv.resume_import.v2",
        queue_name="linkcv.resume_import.worker.v2",
        routing_key="resume.import.v2",
        confirm_timeout_seconds=1,
    )
    message = ResumeImportMessage.create(import_id=42, template_id=7)

    asyncio.run(publisher.publish(message))

    exchange.publish.assert_awaited_once()
    assert exchange.publish.await_args.kwargs == {
        "routing_key": "resume.import.v2",
        "mandatory": True,
        "timeout": 1,
    }
    outbound = exchange.publish.await_args.args[0]
    assert outbound.body == message.body()
    assert outbound.headers == {"x-linkcv-pipeline-version": "v2"}
    channel.declare_exchange.assert_has_awaits(
        [
            call("tolink.cv.resume_import.v2", "direct", durable=True),
            call("tolink.cv.resume_import.v2.DLX", "direct", durable=True),
        ]
    )
    channel.declare_queue.assert_has_awaits(
        [
            call(
                "linkcv.resume_import.worker.v2",
                durable=True,
                arguments={
                    "x-dead-letter-exchange": "tolink.cv.resume_import.v2.DLX",
                    "x-dead-letter-routing-key": "resume.import.v2.DLT",
                },
            ),
            call("linkcv.resume_import.worker.v2.DLT", durable=True),
        ]
    )
    queue.bind.assert_awaited_once_with(exchange, routing_key="resume.import.v2")
    dead_letter_queue.bind.assert_awaited_once_with(
        dead_letter_exchange,
        routing_key="resume.import.v2.DLT",
    )
