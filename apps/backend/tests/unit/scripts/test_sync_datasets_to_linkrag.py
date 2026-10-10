"""The on-demand LinkRag sync command runs locked rounds and can requeue failures."""

import asyncio
import importlib.util
import sys
from pathlib import Path

import pytest

from drawoffer.core.config import Settings
from tests.unit.workers.test_rag_sync_worker import LockRedis

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "sync_datasets_to_linkrag", ROOT / "scripts/release/sync_datasets_to_linkrag.py"
)
assert SPEC is not None and SPEC.loader is not None
script = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = script
SPEC.loader.exec_module(script)


class Service:
    def __init__(self) -> None:
        self.rounds = 0
        self.resets = 0

    def run_once(self) -> int:
        self.rounds += 1
        return 0

    def reset_failed(self) -> int:
        self.resets += 1
        return 2


def test_rounds_and_reset() -> None:
    service = Service()
    assert asyncio.run(script.run(service, LockRedis(), rounds=3, reset_failed=True)) == 3
    assert (service.rounds, service.resets) == (3, 1)


def test_refuses_to_run_when_disabled() -> None:
    with pytest.raises(SystemExit, match="not configured"):
        script.build_service(Settings())  # enabled by default, but no credentials
    with pytest.raises(SystemExit, match="not configured"):
        script.build_service(
            Settings(
                linkrag_enabled=False,
                linkrag_client_id="lr_fictional",
                linkrag_client_secret="fictional-linkrag-secret",
            )
        )
