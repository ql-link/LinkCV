import asyncio
import json

import httpx

from linkcv.core.config import Settings
from linkcv.modules.llm.pi_probe import PiProbeCoordinator
from linkcv.modules.llm.service import RuntimeModelConfig


def test_coordinator_requires_matching_backend_and_pi_tool_evidence() -> None:
    settings = Settings(
        pi_service_token="unit-pi-service-token",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer unit-pi-service-token"
        payload = json.loads(request.content)
        assert payload["model"] == {
            "adapter": "deepseek",
            "id": "1",
            "name": "fictional-model",
            "apiKey": "fictional-provider-key",
            "baseUrl": "https://api.example.invalid/v1",
        }
        assert "proxyUrl" not in payload
        assert "proxyToken" not in payload
        return httpx.Response(
            200,
            json={
                "ok": True,
                "runId": payload["runId"],
                "toolCallId": "tool-probe",
                "usage": {"inputTokens": 8, "outputTokens": 3},
            },
        )

    coordinator = PiProbeCoordinator(
        settings,
        transport=httpx.MockTransport(handler),
    )
    config = RuntimeModelConfig(
        id=1,
        capability="pi_agent",
        adapter="deepseek",
        model_call_name="fictional-model",
        model_name="deepseek/fictional-model",
        api_base="https://api.example.invalid/v1",
        encrypted_api_key="encrypted-fixture",
        config_version=1,
    )

    usage = asyncio.run(
        coordinator.run_probe(config, "fictional-provider-key")
    )
    assert usage.input_tokens == 8
    assert usage.output_tokens == 3
