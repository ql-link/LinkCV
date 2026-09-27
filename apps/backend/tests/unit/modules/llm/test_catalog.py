import asyncio

import httpx
import pytest

from linkresume.modules.llm.catalog import fetch_catalog


def test_aihubmix_catalog_uses_provider_ids_and_simple_price():
    async def handler(request):
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
