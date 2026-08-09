from typing import Protocol

from linkcv.core.mq.message import ResumeImportMessage


class MQPublishError(RuntimeError):
    """The broker did not durably confirm the business message."""


class MQPublisher(Protocol):
    async def publish_resume_import(self, message: ResumeImportMessage) -> None: ...

    async def close(self) -> None: ...
