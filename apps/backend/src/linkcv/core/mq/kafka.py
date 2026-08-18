import asyncio

from aiokafka import AIOKafkaProducer

from linkcv.core.mq.message import DatasetParseMessage, DocumentParseTaskMessage
from linkcv.core.mq.publisher import MQPublishError


class KafkaPublisher:
    def __init__(
        self,
        *,
        bootstrap_servers: str,
        topic: str,
        confirm_timeout_seconds: float,
    ) -> None:
        self._bootstrap_servers = bootstrap_servers
        self._topic = topic
        self._confirm_timeout_seconds = confirm_timeout_seconds
        self._producer: AIOKafkaProducer | None = None
        self._started = False
        self._lock = asyncio.Lock()

    async def _ensure_started(self) -> AIOKafkaProducer:
        if self._started and self._producer is not None:
            return self._producer
        async with self._lock:
            if self._started and self._producer is not None:
                return self._producer
            producer = AIOKafkaProducer(
                bootstrap_servers=self._bootstrap_servers,
                acks="all",
                enable_idempotence=True,
            )
            try:
                await producer.start()
            except Exception:
                try:
                    await producer.stop()
                except Exception:
                    pass
                raise
            self._producer = producer
            self._started = True
            return producer

    async def publish(self, message: DocumentParseTaskMessage) -> None:
        try:
            producer = await self._ensure_started()
            await asyncio.wait_for(
                producer.send_and_wait(
                    self._topic,
                    value=message.body(),
                    key=(
                        message.payload.parse_task_id.encode("ascii")
                        if isinstance(message, DatasetParseMessage)
                        else message.payload.import_id.encode("ascii")
                    ),
                ),
                timeout=self._confirm_timeout_seconds,
            )
        except Exception as error:
            raise MQPublishError("Kafka did not confirm the message") from error

    async def close(self) -> None:
        async with self._lock:
            if self._started and self._producer is not None:
                await self._producer.stop()
            self._started = False
            self._producer = None
