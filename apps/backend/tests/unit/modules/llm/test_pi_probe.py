import asyncio
import json
from decimal import Decimal

import httpx

from linkresume.core.config import Settings
from linkresume.modules.llm.pi_probe import PiProbeCoordinator
from linkresume.modules.llm.service import ModelDefinition, RuntimeModelConfig

DEFINITION = ModelDefinition(
    model_id="z-ai/glm-4.6",
    display_name="GLM 4.6",
    reasoning=True,
    input_modalities=("text",),
    context_window=200_000,
    max_output=32_768,
    input_price_per_million=Decimal("0.6"),
    output_price_per_million=Decimal("2.2"),
    cache_read_price_per_million=None,
    cache_write_price_per_million=None,
)


def test_coordinator_requires_matching_backend_and_pi_tool_evidence() -> None:
    settings = Settings(
        pi_service_token="unit-pi-service-token",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer unit-pi-service-token"
        payload = json.loads(request.content)
        model = payload["model"]
        assert model["providerId"] == "7"
        assert model["name"] == "z-ai/glm-4.6"
        assert model["api"] == "openai-completions"
        assert model["apiKey"] == "fictional-provider-key"
        assert model["baseUrl"] == "https://api.example.invalid/v1"
        # Pi builds its own model instance, so it needs the capability snapshot.
        assert model["definition"] == {
            "model_id": "z-ai/glm-4.6",
            "display_name": "GLM 4.6",
            "reasoning": True,
            "input_modalities": ["text"],
            "context_window": 200_000,
            "max_output": 32_768,
            "input_price_per_million": 0.6,
            "output_price_per_million": 2.2,
            "cache_read_price_per_million": None,
            "cache_write_price_per_million": None,
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
        id=11,
        capability="pi_agent",
        provider_id=7,
        provider_name="虚构聚合网关",
        model_call_name="z-ai/glm-4.6",
        api_base="https://api.example.invalid/v1",
        encrypted_api_key="encrypted-fixture",
        config_version=1,
        definition=DEFINITION,
    )

    usage = asyncio.run(
        coordinator.run_probe(config, "fictional-provider-key")
    )
    assert usage.input_tokens == 8
    assert usage.output_tokens == 3
