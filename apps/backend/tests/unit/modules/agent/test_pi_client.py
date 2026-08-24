import asyncio
from types import SimpleNamespace

import pytest

from linkcv.modules.agent.pi_client import _finalize, cancel_pi_run, check_pi_readiness


class Result:
    def one_or_none(self):
        return SimpleNamespace(status="cancelled"), SimpleNamespace()


class FinalizeSession:
    def __init__(self) -> None:
        self.statements: list[object] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, statement):
        self.statements.append(statement)
        return Result()


def test_finalize_locks_run_before_checking_terminal_state() -> None:
    db = FinalizeSession()
    app = SimpleNamespace(
        state=SimpleNamespace(session_factory=lambda: db)
    )

    _finalize(app, "run-public-id", "succeeded", error_code=None)

    assert len(db.statements) == 1
    assert getattr(db.statements[0], "_for_update_arg", None) is not None


def test_cancel_and_readiness_use_their_own_pi_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []

    class Response:
        status_code = 200

        @staticmethod
        def json() -> dict[str, bool]:
            return {"ready": True}

    class HttpClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url: str, **_kwargs):
            calls.append(("POST", url))
            return Response()

        async def get(self, url: str, **_kwargs):
            calls.append(("GET", url))
            return Response()

    monkeypatch.setattr(
        "linkcv.modules.agent.pi_client.httpx.AsyncClient",
        lambda **_kwargs: HttpClient(),
    )
    app = SimpleNamespace(
        state=SimpleNamespace(
            settings=SimpleNamespace(
                agent_enabled=True,
                pi_service_base_url="http://pi:8010",
                pi_service_token=SimpleNamespace(
                    get_secret_value=lambda: "service-token"
                ),
            )
        )
    )

    asyncio.run(cancel_pi_run(app, "run-1"))
    asyncio.run(check_pi_readiness(app))

    assert calls == [
        ("POST", "http://pi:8010/internal/agent/runs/run-1/cancel"),
        ("GET", "http://pi:8010/internal/agent/readiness"),
    ]
