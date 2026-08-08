import asyncio

import aio_pika
from aio_pika.abc import AbstractRobustConnection

from linkcv.core.mq.message import ResumeImportMessage
from linkcv.core.mq.publisher import MQPublishError


class RabbitMQPublisher:
    def __init__(
        self,
        *,
        url: str,
        exchange_name: str,
        queue_name: str,
        routing_key: str,
        confirm_timeout_seconds: float,
    ) -> None:
        self._url = url
        self._exchange_name = exchange_name
        self._queue_name = queue_name
        self._routing_key = routing_key
        self._confirm_timeout_seconds = confirm_timeout_seconds
        self._connection: AbstractRobustConnection | None = None
        self._channel = None
        self._exchange = None
        self._lock = asyncio.Lock()

    async def _ensure_ready(self):
        if (
            self._exchange is not None
            and self._connection is not None
            and not self._connection.is_closed
        ):
            return self._exchange
        async with self._lock:
            if (
                self._exchange is not None
                and self._connection is not None
                and not self._connection.is_closed
            ):
                return self._exchange
            try:
                self._connection = await aio_pika.connect_robust(self._url)
                self._channel = await self._connection.channel(
                    publisher_confirms=True,
                    on_return_raises=True,
                )
                exchange = await self._channel.declare_exchange(
                    self._exchange_name,
                    aio_pika.ExchangeType.DIRECT,
                    durable=True,
                )
                dead_letter_exchange = await self._channel.declare_exchange(
                    f"{self._exchange_name}.DLX",
                    aio_pika.ExchangeType.DIRECT,
                    durable=True,
                )
                queue = await self._channel.declare_queue(
                    self._queue_name,
                    durable=True,
                    arguments={
                        "x-dead-letter-exchange": dead_letter_exchange.name,
                        "x-dead-letter-routing-key": f"{self._routing_key}.DLT",
                    },
                )
                await queue.bind(exchange, routing_key=self._routing_key)
                dead_letter_queue = await self._channel.declare_queue(
                    f"{self._queue_name}.DLT",
                    durable=True,
                )
                await dead_letter_queue.bind(
                    dead_letter_exchange,
                    routing_key=f"{self._routing_key}.DLT",
                )
                self._exchange = exchange
            except Exception as error:
                await self.close()
                raise MQPublishError("RabbitMQ topology is unavailable") from error
        return self._exchange

    async def publish_resume_import(self, message: ResumeImportMessage) -> None:
        exchange = await self._ensure_ready()
        outbound = aio_pika.Message(
            body=message.body(),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            message_id=str(message.payload.message_id),
            timestamp=message.payload.timestamp,
            type=message.mq_type,
        )
        try:
            confirmed = await exchange.publish(
                outbound,
                routing_key=self._routing_key,
                mandatory=True,
                timeout=self._confirm_timeout_seconds,
            )
        except Exception as error:
            raise MQPublishError("RabbitMQ did not confirm the message") from error
        if confirmed is False:
            raise MQPublishError("RabbitMQ rejected the message")

    async def close(self) -> None:
        self._exchange = None
        if self._channel is not None and not self._channel.is_closed:
            await self._channel.close()
        self._channel = None
        if self._connection is not None and not self._connection.is_closed:
            await self._connection.close()
        self._connection = None
