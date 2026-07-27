import asyncio

import pytest

from linkcv.services.import_admission import (
    ImportAdmissionController,
    ImportAdmissionRejected,
)


def test_import_admission_rejects_user_concurrency_and_minute_quota() -> None:
    async def exercise() -> None:
        controller = ImportAdmissionController(
            requests_per_minute=1,
            global_concurrency=2,
            user_concurrency=1,
        )
        async with controller.acquire(1):
            with pytest.raises(ImportAdmissionRejected):
                async with controller.acquire(1):
                    pass
        with pytest.raises(ImportAdmissionRejected):
            async with controller.acquire(1):
                pass

    asyncio.run(exercise())


def test_import_admission_rejects_global_concurrency() -> None:
    async def exercise() -> None:
        controller = ImportAdmissionController(
            requests_per_minute=3,
            global_concurrency=1,
            user_concurrency=1,
        )
        async with controller.acquire(1):
            with pytest.raises(ImportAdmissionRejected):
                async with controller.acquire(2):
                    pass

    asyncio.run(exercise())
