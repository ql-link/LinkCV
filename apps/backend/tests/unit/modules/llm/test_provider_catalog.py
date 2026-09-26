import asyncio
from decimal import Decimal

import httpx
import pytest

from linkresume.modules.llm.provider_catalog import (
    CATALOG_INVALID,
    CATALOG_REQUEST_FAILED,
    ProviderCatalogError,
    fetch_provider_catalog,
    parse_provider_catalog,
)

CATALOG_URL = "https://catalog.example.invalid/api/v1/models"


def _payload(*rows: dict[str, object]) -> dict[str, object]:
    return {"success": True, "message": "", "data": list(rows)}


def test_parse_keeps_every_reported_field() -> None:
    entries = parse_provider_catalog(
        _payload(
            {
                "model_id": "z-ai/glm-4.6",
                "model_name": "GLM 4.6",
                "context_length": 200000,
                "max_output": 32768,
                "input_modalities": ["Text", "image", "text"],
                "reasoning": True,
                "pricing": {
                    "input": 0.6,
                    "output": 2.2,
                    "cache_read": 0.11,
                    "cache_write": 0.22,
                },
            }
        )
    )

    assert len(entries) == 1
    entry = entries[0]
    assert entry.model_id == "z-ai/glm-4.6"
    assert entry.display_name == "GLM 4.6"
    assert entry.context_length == 200000
    assert entry.max_output == 32768
    assert entry.input_modalities == "image,text"
    assert entry.supports_reasoning is True
    assert entry.input_price_per_million == Decimal("0.6")
    assert entry.output_price_per_million == Decimal("2.2")
    assert entry.cache_read_price_per_million == Decimal("0.11")
    assert entry.cache_write_price_per_million == Decimal("0.22")


def test_parse_degrades_when_optional_fields_are_absent_or_odd() -> None:
    entries = parse_provider_catalog(
        _payload(
            {"model_id": "moonshotai/kimi-k2"},
            {"model_id": "deepseek/deepseek-chat", "pricing": {"input": -1}},
            {"model_id": "openai/gpt-5", "features": ["reasoning", "tools"]},
        )
    )

    by_id = {entry.model_id: entry for entry in entries}
    assert by_id["moonshotai/kimi-k2"].display_name is None
    assert by_id["moonshotai/kimi-k2"].context_length is None
    assert by_id["moonshotai/kimi-k2"].input_modalities is None
    assert by_id["moonshotai/kimi-k2"].supports_reasoning is False
    # A negative price is treated as "not reported" instead of failing the sync.
    assert by_id["deepseek/deepseek-chat"].input_price_per_million is None
    assert by_id["openai/gpt-5"].supports_reasoning is True


def test_parse_skips_rows_without_an_identifier_and_keeps_the_last_duplicate() -> None:
    entries = parse_provider_catalog(
        _payload(
            {"model_name": "no identifier"},
            {"model_id": "z-ai/glm-4.6", "model_name": "first"},
            {"model_id": "z-ai/glm-4.6", "model_name": "second"},
        )
    )

    assert len(entries) == 1
    assert entries[0].display_name == "second"


def test_parse_collapses_ids_that_differ_only_by_case() -> None:
    # aihubmix lists some models in several spellings. The unique key on
    # (provider_id, model_id) is case-insensitive, so keeping both spellings
    # used to abort the whole sync with a duplicate-key error.
    entries = parse_provider_catalog(
        _payload(
            {"model_id": "DeepSeek-V3", "model_name": "first"},
            {"model_id": "deepseek-v3", "model_name": "second"},
            {"model_id": "DeepSeek-v3", "model_name": "third"},
            {"model_id": "DeepSeek-OCR"},
        )
    )

    assert [entry.model_id for entry in entries] == ["DeepSeek-OCR", "DeepSeek-v3"]
    assert entries[1].display_name == "third"


def test_parse_reads_modalities_reported_as_a_comma_separated_string() -> None:
    # The vendor sends the list form in some responses and a comma-separated
    # string in others; dropping the string form made every vision model look
    # text-only downstream.
    entries = parse_provider_catalog(
        _payload(
            {"model_id": "gpt-5", "input_modalities": "text,image"},
            {"model_id": "qwen3-vl-plus", "input_modalities": "text, image ,video"},
            {"model_id": "deepseek-v3", "input_modalities": ""},
        )
    )

    by_id = {entry.model_id: entry for entry in entries}
    assert by_id["gpt-5"].input_modalities == "image,text"
    assert by_id["qwen3-vl-plus"].input_modalities == "image,text,video"
    assert by_id["deepseek-v3"].input_modalities is None


@pytest.mark.parametrize(
    "payload",
    [
        ["not", "a", "mapping"],
        {"success": False, "message": "unauthorized"},
        {"success": True, "data": []},
        {"success": True, "data": [{"model_name": "missing identifier"}]},
        {"success": True},
    ],
)
def test_parse_rejects_payloads_it_cannot_trust(payload: object) -> None:
    with pytest.raises(ProviderCatalogError) as caught:
        parse_provider_catalog(payload)
    assert caught.value.code == CATALOG_INVALID


def test_fetch_sends_the_provider_credential() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json=_payload({"model_id": "z-ai/glm-4.6"}))

    entries = asyncio.run(
        fetch_provider_catalog(
            catalog_url=CATALOG_URL,
            api_key="fictional-key",
            timeout_seconds=5.0,
            transport=httpx.MockTransport(handler),
        )
    )

    assert captured["url"] == CATALOG_URL
    assert captured["authorization"] == "Bearer fictional-key"
    assert [entry.model_id for entry in entries] == ["z-ai/glm-4.6"]


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (lambda: httpx.Response(500, text="boom"), CATALOG_REQUEST_FAILED),
        (lambda: httpx.Response(200, text="not json"), CATALOG_INVALID),
        (lambda: httpx.Response(200, json={"success": True, "data": []}), CATALOG_INVALID),
    ],
)
def test_fetch_maps_unusable_responses_to_stable_codes(response, code: str) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return response()

    with pytest.raises(ProviderCatalogError) as caught:
        asyncio.run(
            fetch_provider_catalog(
                catalog_url=CATALOG_URL,
                api_key="fictional-key",
                timeout_seconds=5.0,
                transport=httpx.MockTransport(handler),
            )
        )
    assert caught.value.code == code


def test_fetch_maps_transport_failures_to_request_failed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderCatalogError) as caught:
        asyncio.run(
            fetch_provider_catalog(
                catalog_url=CATALOG_URL,
                api_key="fictional-key",
                timeout_seconds=5.0,
                transport=httpx.MockTransport(handler),
            )
        )
    assert caught.value.code == CATALOG_REQUEST_FAILED
