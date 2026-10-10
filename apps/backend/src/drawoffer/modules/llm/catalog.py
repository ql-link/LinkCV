"""Provider-owned model catalogs. A missing optional catalog never disables routes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from drawoffer.modules.llm.providers import aihubmix_base_url, validate_settings
from drawoffer.modules.llm.pricing import catalog_pricing

CATALOG_URLS = {
    "aihubmix": "https://aihubmix.com/api/v1/models",
    "siliconflow": "https://api.siliconflow.cn/v1/models",
}


@dataclass(frozen=True)
class CatalogModel:
    model_id: str
    name: str
    developer: str | None
    metadata: dict[str, Any]
    pricing: dict[str, Any] | None


@dataclass(frozen=True)
class CatalogResult:
    models: tuple[CatalogModel, ...] | None  # None means HTTP 304
    etag: str | None


def _pricing(provider_code: str, item: dict[str, Any]) -> dict[str, Any] | None:
    return catalog_pricing(item) if provider_code == "aihubmix" else None


async def fetch_catalog(
    provider_code: str,
    api_key: str,
    *,
    settings: dict[str, Any] | None = None,
    etag: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> CatalogResult:
    url = CATALOG_URLS.get(provider_code)
    if url is None:
        raise ValueError("provider catalog not supported")
    validated_settings = validate_settings(provider_code, settings)
    if provider_code == "aihubmix":
        url = f"{aihubmix_base_url(validated_settings)}/api/v1/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    if etag and provider_code == "aihubmix":
        headers["If-None-Match"] = etag
    async with httpx.AsyncClient(timeout=30, transport=transport) as client:
        response = await client.get(url, headers=headers)
    if response.status_code == 304:
        return CatalogResult(models=None, etag=etag)
    response.raise_for_status()
    body = response.json()
    items = body.get("data") if isinstance(body, dict) else None
    if not isinstance(items, list):
        raise ValueError("invalid provider catalog")
    models: list[CatalogModel] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("invalid provider model")
        model_id = item.get("model_id" if provider_code == "aihubmix" else "id")
        if not isinstance(model_id, str) or not model_id or len(model_id) > 256:
            raise ValueError("invalid provider model ID")
        if model_id in seen:
            raise ValueError("duplicate provider model ID")
        seen.add(model_id)
        name = item.get("model_name") if provider_code == "aihubmix" else None
        developer = item.get("vendor") if provider_code == "aihubmix" else None
        models.append(CatalogModel(
            model_id=model_id,
            name=name if isinstance(name, str) and name.strip() else model_id,
            developer=developer if isinstance(developer, str) and developer.strip() else None,
            metadata=item,
            pricing=_pricing(provider_code, item),
        ))
    return CatalogResult(models=tuple(models), etag=response.headers.get("etag"))
