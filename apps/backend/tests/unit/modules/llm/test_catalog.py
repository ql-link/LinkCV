import asyncio

import httpx
import pytest

from linkresume.modules.llm.catalog import fetch_catalog
from linkresume.modules.llm.providers import inference_base_url, validate_settings


def test_aihubmix_catalog_uses_provider_ids_and_simple_price():
    async def handler(request):
        assert request.url.host == "aihubmix.com"
        assert request.url.path == "/api/v1/models"
        assert request.headers["authorization"] == "Bearer fictional-key"
        return httpx.Response(200, json={"data": [{"model_id": "vendor/model", "model_name": "示例模型", "vendor": "示例厂商", "pricing": {"input": 1, "output": 2}}]})
    result = asyncio.run(fetch_catalog("aihubmix", "fictional-key", transport=httpx.MockTransport(handler)))
    assert result.models[0].model_id == "vendor/model"
    assert result.models[0].pricing["input_per_million"] == "1"


def test_tiered_price_is_not_reduced_to_flat_cost():
    async def handler(_request):
        return httpx.Response(200, json={"data": [{"model_id": "vendor/model", "pricing": {"input": 1, "output": 2, "tiers": [{"above": 100000}]}}]})
    result = asyncio.run(fetch_catalog("aihubmix", "fictional-key", transport=httpx.MockTransport(handler)))
    assert "input_per_million" not in result.models[0].pricing


def test_catalog_rejects_duplicate_ids():
    async def handler(_request):
        return httpx.Response(200, json={"data": [{"id": "same"}, {"id": "same"}]})
    with pytest.raises(ValueError, match="duplicate"):
        asyncio.run(fetch_catalog("siliconflow", "fictional-key", transport=httpx.MockTransport(handler)))


def test_aihubmix_alternate_endpoint_applies_to_catalog_and_inference():
    async def handler(request):
        assert request.url.host == "api.inferera.com"
        return httpx.Response(200, json={"data": []})

    settings = {"endpoint": "alternate"}
    result = asyncio.run(fetch_catalog(
        "aihubmix", "fictional-key", settings=settings,
        transport=httpx.MockTransport(handler),
    ))
    assert result.models == ()
    assert inference_base_url("aihubmix", settings) == "https://api.inferera.com/v1"


@pytest.mark.parametrize("settings", [
    {"endpoint": "https://example.invalid"},
    {"base_url": "https://example.invalid"},
    {"endpoint": "alternate", "other": True},
])
def test_aihubmix_endpoint_rejects_arbitrary_destinations(settings):
    with pytest.raises(ValueError):
        validate_settings("aihubmix", settings)


@pytest.mark.parametrize("endpoint,base_url", [
    ("primary", "https://aihubmix.com/v1"),
    ("alternate", "https://api.inferera.com/v1"),
])
def test_aihubmix_responses_runtime_preserves_endpoint_and_credentials(endpoint, base_url):
    import json
    from cryptography.fernet import Fernet
    from linkresume.modules.llm.crypto import CredentialCipher
    from linkresume.modules.llm.providers import pi_api, validate_route, validate_use_case_protocol
    from linkresume.modules.llm.resolver import RoutePlan
    from linkresume.modules.llm.service import LLMService

    cipher = CredentialCipher(f"test:{Fernet.generate_key().decode('ascii')}")
    service = LLMService(None, None, cipher)
    plan = RoutePlan(
        use_case="assistant_conversation", route_id=1, model_id=1,
        display_name="fictional-responses-model", provider_code="aihubmix",
        connection_id=1, runtime_config_version=1, target_kind="model",
        invoke_target="fictional-responses-model", protocol_code="openai_responses",
        settings={"endpoint": endpoint},
        credential_ciphertext=cipher.encrypt(json.dumps({"api_key": "fictional-key"})),
        pricing=None, selection_source="default",
    )
    runtime = service.runtime_model_for_plan(plan)
    assert runtime.base_url == base_url
    assert runtime.api_key == "fictional-key"
    assert pi_api(plan.protocol_code) == "openai-responses"
    with pytest.raises(ValueError):
        validate_route("aihubmix", "model", "aliyun_asr_realtime")
    validate_use_case_protocol("resume_structuring", "openai_responses")
