import asyncio

from linkresume.modules.agent.run_stream import AgentRunStreamHub


def test_subscriber_disconnect_does_not_cancel_run_and_reconnect_replays_events() -> (
    None
):
    async def scenario() -> None:
        release = asyncio.Event()

        async def source():
            yield b"event: run.started\ndata: {}\n\n"
            await release.wait()
            yield b"event: run.completed\ndata: {}\n\n"

        hub = AgentRunStreamHub()
        hub.start("run-1", source())
        first_subscription = hub.subscribe("run-1")
        assert await anext(first_subscription) == b"event: run.started\ndata: {}\n\n"
        await first_subscription.aclose()

        release.set()
        replayed = [event async for event in hub.subscribe("run-1")]

        assert replayed == [
            b"event: run.started\ndata: {}\n\n",
            b"event: run.completed\ndata: {}\n\n",
        ]

    asyncio.run(scenario())
