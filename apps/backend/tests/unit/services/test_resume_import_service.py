import asyncio
from threading import Event
from time import monotonic

import pytest

from linkcv.services.resume_import_service import ResumeImportService


class BlockingStorage:
    def __init__(self) -> None:
        self.started = Event()
        self.release = Event()
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def upload(self, object_name: str, data: bytes, _content_type: str) -> None:
        self.started.set()
        assert self.release.wait(timeout=2)
        self.objects[object_name] = data

    def delete(self, object_name: str) -> None:
        self.deleted.append(object_name)
        self.objects.pop(object_name, None)


class UnexpectedConverter:
    async def convert(self, **_kwargs):
        raise AssertionError("conversion must not start after cancellation")


class UnexpectedStructuringClient:
    async def extract(self, **_kwargs):
        raise AssertionError("structuring must not start after cancellation")


def test_cancellation_waits_for_upload_before_compensating() -> None:
    storage = BlockingStorage()
    service = ResumeImportService(
        document_converter=UnexpectedConverter(),
        structuring_client=UnexpectedStructuringClient(),
        storage=storage,
        max_structuring_bytes=1024,
        structuring_timeout_seconds=30,
    )

    async def exercise() -> None:
        async def assert_lease() -> None:
            return None

        task = asyncio.create_task(
            service.import_resume(
                db=object(),  # type: ignore[arg-type]
                user_id=7,
                filename="resume.md",
                content_type="text/markdown",
                content=b"# Zhang San",
                title=None,
                operation_id="00000000-0000-4000-8000-000000000001",
                deadline_monotonic=monotonic() + 60,
                assert_lease=assert_lease,
            )
        )
        assert await asyncio.to_thread(storage.started.wait, 1)

        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()

        storage.release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())

    assert storage.objects == {}
    assert len(storage.deleted) == 1
