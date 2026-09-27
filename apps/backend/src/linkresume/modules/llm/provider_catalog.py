from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from linkresume.modules.llm.models import LLMProvider, LLMProviderModel

CATALOG_REQUEST_FAILED = "LLM_PROVIDER_CATALOG_REQUEST_FAILED"
CATALOG_INVALID = "LLM_PROVIDER_CATALOG_INVALID"

MAX_DISPLAY_NAME = 128
MAX_MODALITIES = 64
HTTP_SUCCESS = 200
HTTP_REDIRECT = 300

# The catalog payload is owned by the vendor, so every optional field is read
# defensively: an unknown or differently named field degrades to "not reported"
# instead of failing the whole sync.
REASONING_FLAG_KEYS = ("reasoning", "supports_reasoning", "reasoning_supported")
MODALITY_KEYS = ("input_modalities", "inputModalities")
PRICE_KEYS = {
    "input_price_per_million": ("input",),
    "output_price_per_million": ("output",),
    "cache_read_price_per_million": ("cache_read", "cacheRead"),
    "cache_write_price_per_million": ("cache_write", "cacheWrite"),
}


class ProviderCatalogError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ProviderCatalogEntry:
    model_id: str
    display_name: str | None
    context_length: int | None
    max_output: int | None
    input_modalities: str | None
    supports_reasoning: bool
    input_price_per_million: Decimal | None
    output_price_per_million: Decimal | None
    cache_read_price_per_million: Decimal | None
    cache_write_price_per_million: Decimal | None


def _text(value: object, *, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    return normalized[:limit]


def _count(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float) and value.is_integer():
        return int(value) if value >= 0 else None
    return None


def _price(value: object) -> Decimal | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not amount.is_finite() or amount < 0:
        return None
    return amount


def _modalities(entry: dict[str, Any]) -> str | None:
    for key in MODALITY_KEYS:
        raw = entry.get(key)
        if isinstance(raw, list):
            names = [name.strip().lower() for name in raw if isinstance(name, str)]
        elif isinstance(raw, str):
            # The vendor reports the same list as a comma-separated string in
            # some responses; reading only the list form silently dropped every
            # modality, which made vision models look text-only downstream.
            names = [part.strip().lower() for part in raw.split(",")]
        else:
            continue
        joined = ",".join(sorted({name for name in names if name}))
        if joined:
            return joined[:MAX_MODALITIES]
    return None


def _supports_reasoning(entry: dict[str, Any]) -> bool:
    for key in REASONING_FLAG_KEYS:
        if entry.get(key) is True:
            return True
    features = entry.get("features")
    if isinstance(features, list):
        return any(
            isinstance(feature, str) and feature.strip().lower() == "reasoning"
            for feature in features
        )
    return False


def _pricing(entry: dict[str, Any]) -> dict[str, Decimal | None]:
    pricing = entry.get("pricing")
    source = pricing if isinstance(pricing, dict) else {}
    resolved: dict[str, Decimal | None] = {}
    for field, keys in PRICE_KEYS.items():
        value: object = None
        for key in keys:
            if key in source:
                value = source[key]
                break
        resolved[field] = _price(value)
    return resolved


def parse_provider_catalog(payload: object) -> tuple[ProviderCatalogEntry, ...]:
    """Turn a vendor catalog response body into normalized entries."""
    if not isinstance(payload, dict):
        raise ProviderCatalogError(CATALOG_INVALID)
    if payload.get("success") is False:
        raise ProviderCatalogError(CATALOG_INVALID)
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise ProviderCatalogError(CATALOG_INVALID)

    entries: dict[str, ProviderCatalogEntry] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        model_id = _text(row.get("model_id"), limit=128)
        if model_id is None:
            continue
        # Collapse ids that differ only by case: the unique key on
        # (provider_id, model_id) is case-insensitive, so a vendor catalog that
        # lists one model in two spellings would otherwise abort the whole sync
        # with a duplicate-key error.
        entries[model_id.casefold()] = ProviderCatalogEntry(
            model_id=model_id,
            display_name=_text(row.get("model_name"), limit=MAX_DISPLAY_NAME),
            context_length=_count(row.get("context_length")),
            max_output=_count(row.get("max_output")),
            input_modalities=_modalities(row),
            supports_reasoning=_supports_reasoning(row),
            **_pricing(row),
        )

    if not entries:
        raise ProviderCatalogError(CATALOG_INVALID)
    return tuple(
        entry
        for _, entry in sorted(entries.items(), key=lambda pair: pair[1].model_id)
    )


async def fetch_provider_catalog(
    *,
    catalog_url: str,
    api_key: str,
    timeout_seconds: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[ProviderCatalogEntry, ...]:
    """Read and normalize one provider catalog; never touches the database."""
    try:
        async with httpx.AsyncClient(
            timeout=timeout_seconds,
            transport=transport,
            headers={"Authorization": f"Bearer {api_key}"},
        ) as client:
            response = await client.get(catalog_url)
    except httpx.HTTPError as error:
        raise ProviderCatalogError(CATALOG_REQUEST_FAILED) from error
    if not HTTP_SUCCESS <= response.status_code < HTTP_REDIRECT:
        raise ProviderCatalogError(CATALOG_REQUEST_FAILED)
    try:
        payload = response.json()
    except (ValueError, json.JSONDecodeError) as error:
        raise ProviderCatalogError(CATALOG_INVALID) from error
    return parse_provider_catalog(payload)


def replace_provider_catalog(
    db: Session,
    provider: LLMProvider,
    entries: Iterable[ProviderCatalogEntry],
    *,
    synced_at: datetime,
) -> int:
    """Atomically replace one provider's catalog snapshot with a fresh read."""
    rows = list(entries)
    db.execute(
        delete(LLMProviderModel).where(LLMProviderModel.provider_id == provider.id)
    )
    if rows:
        db.execute(
            insert(LLMProviderModel),
            [
                {
                    "provider_id": provider.id,
                    "model_id": entry.model_id,
                    "display_name": entry.display_name,
                    "context_length": entry.context_length,
                    "max_output": entry.max_output,
                    "input_modalities": entry.input_modalities,
                    "supports_reasoning": entry.supports_reasoning,
                    "input_price_per_million": entry.input_price_per_million,
                    "output_price_per_million": entry.output_price_per_million,
                    "cache_read_price_per_million": entry.cache_read_price_per_million,
                    "cache_write_price_per_million": entry.cache_write_price_per_million,
                    "synced_at": synced_at,
                }
                for entry in rows
            ],
        )
    return len(rows)
