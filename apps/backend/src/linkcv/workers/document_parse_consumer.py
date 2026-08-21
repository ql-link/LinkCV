import asyncio
import logging

import aio_pika
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.structs import OffsetAndMetadata, TopicPartition
from pydantic import ValidationError

from linkcv.core.config import Settings
from linkcv.core.mq.message import (
    ResumeImportMessage,
    document_parse_task_message_adapter,
)
from linkcv.workers.dataset_parse_worker import DatasetParseProcessor
from linkcv.workers.resume_import_worker import (
    ResumeImportProcessor,
    WorkerDependencyUnavailable,
)

logger = logging.getLogger(__name__)


async def _process_message(
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    body: bytes,
) -> None:
    message = document_parse_task_message_adapter.validate_json(body)
    if isinstance(message, ResumeImportMessage):
        await resume_processor.process(
            import_id=int(message.payload.import_id),
            template_id=int(message.payload.template_id),
        )
    else:
        await dataset_processor.process(
            parse_task_id=int(message.payload.parse_task_id)
        )


def _task_from_body(body: bytes) -> tuple[str, int] | None:
    try:
        message = document_parse_task_message_adapter.validate_json(body)
    except ValidationError:
        return None
    if isinstance(message, ResumeImportMessage):
        return "resume", int(message.payload.import_id)
    return "dataset", int(message.payload.parse_task_id)


def _mark_retry_exhausted(
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    body: bytes,
) -> None:
    task = _task_from_body(body)
    if task is None:
        return
    task_type, task_id = task
    try:
        if task_type == "resume":
            resume_processor.mark_retry_exhausted(task_id)
        else:
            dataset_processor.mark_retry_exhausted(task_id)
    except WorkerDependencyUnavailable:
        logger.warning(
            "document parse retry exhausted but failure state could not be saved",
            extra={"parse_task_id": task_id, "source_type": task_type},
            exc_info=True,
        )


async def _publish_rabbit_dlt(
    *,
    dead_letter_exchange,
    incoming,
    settings: Settings,
) -> None:
    confirmed = await dead_letter_exchange.publish(
        aio_pika.Message(
            body=incoming.body,
            headers=dict(incoming.headers),
            content_type=incoming.content_type or "application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            message_id=incoming.message_id,
            type=incoming.type,
        ),
        routing_key=f"{settings.rabbitmq_routing_key}.DLT",
        mandatory=True,
        timeout=settings.mq_publish_confirm_timeout_seconds,
    )
    if confirmed is False:
        raise RuntimeError("RabbitMQ rejected the dead-letter message")


async def _dead_letter_rabbit(
    *,
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    dead_letter_exchange,
    incoming,
    settings: Settings,
    mark_failed: bool,
) -> None:
    try:
        await _publish_rabbit_dlt(
            dead_letter_exchange=dead_letter_exchange,
            incoming=incoming,
            settings=settings,
        )
    except Exception:
        logger.exception("document parse DLT publish failed; original retained")
        await asyncio.sleep(settings.mq_consume_retry_backoff_seconds)
        await incoming.nack(requeue=True)
        return
    if mark_failed:
        _mark_retry_exhausted(
            resume_processor,
            dataset_processor,
            incoming.body,
        )
    await incoming.ack()


async def _handle_rabbit_message(
    *,
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    exchange,
    dead_letter_exchange,
    incoming,
    settings: Settings,
) -> None:
    try:
        await _process_message(resume_processor, dataset_processor, incoming.body)
    except WorkerDependencyUnavailable:
        await asyncio.sleep(settings.mq_consume_retry_backoff_seconds)
        await incoming.nack(requeue=True)
    except ValidationError:
        logger.warning("invalid document parse message sent to DLT")
        await _dead_letter_rabbit(
            resume_processor=resume_processor,
            dataset_processor=dataset_processor,
            dead_letter_exchange=dead_letter_exchange,
            incoming=incoming,
            settings=settings,
            mark_failed=False,
        )
    except Exception:
        retries = int(incoming.headers.get("x-linkcv-retry", 0))
        if retries >= settings.mq_consume_max_retries:
            logger.exception("document parse message sent to DLT")
            await _dead_letter_rabbit(
                resume_processor=resume_processor,
                dataset_processor=dataset_processor,
                dead_letter_exchange=dead_letter_exchange,
                incoming=incoming,
                settings=settings,
                mark_failed=True,
            )
            return
        headers = dict(incoming.headers)
        headers["x-linkcv-retry"] = retries + 1
        try:
            confirmed = await exchange.publish(
                aio_pika.Message(
                    body=incoming.body,
                    headers=headers,
                    content_type="application/json",
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                    message_id=incoming.message_id,
                    type=incoming.type,
                ),
                routing_key=settings.rabbitmq_routing_key,
                mandatory=True,
                timeout=settings.mq_publish_confirm_timeout_seconds,
            )
        except Exception:
            await asyncio.sleep(settings.mq_consume_retry_backoff_seconds)
            await incoming.nack(requeue=True)
        else:
            if confirmed is False:
                await asyncio.sleep(settings.mq_consume_retry_backoff_seconds)
                await incoming.nack(requeue=True)
            else:
                await incoming.ack()
    else:
        await incoming.ack()


async def run_rabbitmq_consumer(
    *,
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    settings: Settings,
) -> None:
    if settings.rabbitmq_url is None:
        raise ValueError("RABBITMQ_URL is required")
    connection = await aio_pika.connect_robust(settings.rabbitmq_url.get_secret_value())
    async with connection:
        channel = await connection.channel(
            publisher_confirms=True,
            on_return_raises=True,
        )
        await channel.set_qos(prefetch_count=settings.resume_import_worker_concurrency)
        exchange = await channel.declare_exchange(
            settings.rabbitmq_exchange_name,
            aio_pika.ExchangeType.DIRECT,
            durable=True,
        )
        dead_letter_exchange = await channel.declare_exchange(
            f"{settings.rabbitmq_exchange_name}.DLX",
            aio_pika.ExchangeType.DIRECT,
            durable=True,
        )
        queue = await channel.declare_queue(
            settings.rabbitmq_queue,
            durable=True,
            arguments={
                "x-dead-letter-exchange": dead_letter_exchange.name,
                "x-dead-letter-routing-key": (f"{settings.rabbitmq_routing_key}.DLT"),
            },
        )
        await queue.bind(exchange, routing_key=settings.rabbitmq_routing_key)
        dead_letter_queue = await channel.declare_queue(
            f"{settings.rabbitmq_queue}.DLT",
            durable=True,
        )
        await dead_letter_queue.bind(
            dead_letter_exchange,
            routing_key=f"{settings.rabbitmq_routing_key}.DLT",
        )
        async with queue.iterator() as iterator:
            async with asyncio.TaskGroup() as task_group:
                async for incoming in iterator:
                    task_group.create_task(
                        _handle_rabbit_message(
                            resume_processor=resume_processor,
                            dataset_processor=dataset_processor,
                            exchange=exchange,
                            dead_letter_exchange=dead_letter_exchange,
                            incoming=incoming,
                            settings=settings,
                        )
                    )


async def _handle_kafka_message(
    *,
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    consumer,
    producer,
    incoming,
    settings: Settings,
) -> None:
    partition = TopicPartition(incoming.topic, incoming.partition)
    attempts = 0
    while True:
        try:
            await _process_message(
                resume_processor,
                dataset_processor,
                incoming.value,
            )
        except WorkerDependencyUnavailable:
            consumer.pause(partition)
            await asyncio.sleep(settings.mq_consume_retry_backoff_seconds)
            consumer.resume(partition)
            continue
        except ValidationError:
            logger.warning("invalid document parse Kafka message sent to DLT")
            await producer.send_and_wait(
                f"{settings.kafka_topic}.DLT",
                value=incoming.value,
                key=incoming.key,
            )
        except Exception as error:
            attempts += 1
            if attempts <= settings.mq_consume_max_retries:
                await asyncio.sleep(settings.mq_consume_retry_backoff_seconds)
                continue
            logger.error(
                "document parse Kafka message sent to DLT",
                exc_info=error,
            )
            await producer.send_and_wait(
                f"{settings.kafka_topic}.DLT",
                value=incoming.value,
                key=incoming.key,
            )
            _mark_retry_exhausted(
                resume_processor,
                dataset_processor,
                incoming.value,
            )
        await consumer.commit({partition: OffsetAndMetadata(incoming.offset + 1, "")})
        return


async def run_kafka_consumer(
    *,
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    settings: Settings,
) -> None:
    if not settings.kafka_bootstrap_servers:
        raise ValueError("KAFKA_BOOTSTRAP_SERVERS is required")
    consumer = AIOKafkaConsumer(
        settings.kafka_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=settings.kafka_consumer_group,
        enable_auto_commit=False,
    )
    producer = AIOKafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap_servers,
        acks="all",
        enable_idempotence=True,
    )
    await consumer.start()
    try:
        await producer.start()
        try:
            while True:
                incoming = await consumer.getone()
                await _handle_kafka_message(
                    resume_processor=resume_processor,
                    dataset_processor=dataset_processor,
                    consumer=consumer,
                    producer=producer,
                    incoming=incoming,
                    settings=settings,
                )
        finally:
            await producer.stop()
    finally:
        await consumer.stop()


async def run_consumer(
    *,
    resume_processor: ResumeImportProcessor,
    dataset_processor: DatasetParseProcessor,
    settings: Settings,
) -> None:
    if settings.mq_vendor == "kafka":
        await run_kafka_consumer(
            resume_processor=resume_processor,
            dataset_processor=dataset_processor,
            settings=settings,
        )
    else:
        await run_rabbitmq_consumer(
            resume_processor=resume_processor,
            dataset_processor=dataset_processor,
            settings=settings,
        )
