from typing import Protocol

from linkcv.core.mq.message import DocumentParseTaskMessage


class MQPublishError(RuntimeError):
    """The broker did not durably confirm the business message."""


class MQPublisher(Protocol):
    async def publish(self, message: DocumentParseTaskMessage) -> None: ...

    async def close(self) -> None: ...
