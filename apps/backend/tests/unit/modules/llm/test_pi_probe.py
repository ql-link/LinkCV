import asyncio
import json

import httpx

from drawoffer.core.config import Settings
from drawoffer.modules.llm.pi_probe import PiProbeCoordinator
from drawoffer.modules.llm.resolver import RoutePlan
from drawoffer.modules.llm.service import AgentRuntimeModel


def test_coordinator_requires_matching_backend_and_pi_tool_evidence():
    settings = Settings(pi_service_token="unit-pi-service-token")
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer unit-pi-service-token"
        payload = json.loads(request.content)
        assert payload["model"] == {
            "provider": "aihubmix", "api": "openai-completions", "id": "3",
            "name": "fictional-model", "apiKey": "fictional-provider-key",
            "baseUrl": "https://aihubmix.com/v1",
        }
        return httpx.Response(200, json={"ok": True, "runId": payload["runId"], "toolCallId": "tool-probe", "usage": {"inputTokens": 8, "outputTokens": 3}})
    coordinator = PiProbeCoordinator(settings, transport=httpx.MockTransport(handler))
    plan = RoutePlan(use_case="assistant_conversation", route_id=3, model_id=1, display_name="fictional-model", provider_code="aihubmix", connection_id=2, runtime_config_version=1, target_kind="model", invoke_target="fictional-model", protocol_code="openai_chat", settings={}, credential_ciphertext="encrypted-fixture", pricing=None, selection_source="probe")
    config = AgentRuntimeModel(plan=plan, api_key="fictional-provider-key", base_url="https://aihubmix.com/v1")
    usage = asyncio.run(coordinator.run_probe(config, "fictional-provider-key"))
    assert usage.input_tokens == 8
    assert usage.output_tokens == 3
