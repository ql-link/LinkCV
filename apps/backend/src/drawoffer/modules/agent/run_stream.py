"""Process-local buffering for reconnectable Agent run event streams."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


_KEEPALIVE_SECONDS = 15
_MAX_RETAINED_RUNS = 128


@dataclass
class _BufferedRun:
    events: list[bytes] = field(default_factory=list)
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    completed: bool = False
    task: asyncio.Task[None] | None = None


class AgentRunStreamHub:
    """Keep the Pi stream alive when an individual browser subscriber leaves."""

    def __init__(self) -> None:
        self._runs: dict[str, _BufferedRun] = {}

    def contains(self, run_id: str) -> bool:
        return run_id in self._runs

    def start(self, run_id: str, source: AsyncIterator[bytes]) -> None:
        if run_id in self._runs:
            return
        state = _BufferedRun()
        self._runs[run_id] = state
        state.task = asyncio.create_task(self._consume(run_id, state, source))

    async def subscribe(self, run_id: str) -> AsyncIterator[bytes]:
        state = self._runs[run_id]
        cursor = 0
        while True:
            pending: list[bytes] = []
            timed_out = False
            async with state.condition:
                if cursor >= len(state.events) and not state.completed:
                    try:
                        await asyncio.wait_for(
                            state.condition.wait_for(
                                lambda: cursor < len(state.events) or state.completed
                            ),
                            timeout=_KEEPALIVE_SECONDS,
                        )
                    except TimeoutError:
                        timed_out = True
                if cursor < len(state.events):
                    pending = state.events[cursor:]
                    cursor = len(state.events)
                completed = state.completed
            if timed_out:
                yield b": keep-alive\n\n"
            for event in pending:
                yield event
            if completed and cursor >= len(state.events):
                return

    async def _consume(
        self,
        run_id: str,
        state: _BufferedRun,
        source: AsyncIterator[bytes],
    ) -> None:
        terminal_received = False
        try:
            async for event in source:
                if event.startswith(
                    (b"event: run.completed", b"event: run.failed", b"event: run.cancelled")
                ):
                    terminal_received = True
                async with state.condition:
                    state.events.append(event)
                    state.condition.notify_all()
        except asyncio.CancelledError:
            raise
        except Exception:
            if not terminal_received:
                async with state.condition:
                    state.events.append(
                        (
                            "event: run.failed\n"
                            f'data: {{"runId":"{run_id}",'
                            '"error":"AGENT_STREAM_INCOMPLETE"}\n\n'
                        ).encode()
                    )
                    state.condition.notify_all()
        finally:
            async with state.condition:
                state.completed = True
                state.condition.notify_all()
            self._prune()

    def _prune(self) -> None:
        overflow = len(self._runs) - _MAX_RETAINED_RUNS
        if overflow <= 0:
            return
        completed = [
            run_id for run_id, state in self._runs.items() if state.completed
        ]
        for run_id in completed[:overflow]:
            self._runs.pop(run_id, None)


def get_agent_run_stream_hub(app) -> AgentRunStreamHub:
    hub = getattr(app.state, "agent_run_stream_hub", None)
    if hub is None:
        hub = AgentRunStreamHub()
        app.state.agent_run_stream_hub = hub
    return hub
