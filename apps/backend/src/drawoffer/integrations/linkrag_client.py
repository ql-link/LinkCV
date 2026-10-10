"""LinkRag ``/api/v1/apps`` client: per-user default dataset, files and recall.

LinkRag maps ``X-App-User-Id`` to a shadow user inside this product's
namespace, so every call names the DrawOffer user it acts for. Credentials,
Markdown bodies and recall queries are never logged; every failure becomes a
``LinkRagError`` carrying the HTTP status (0 for transport errors) and a stable
reason so callers decide between retrying and falling back.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1/apps"
RESPONSE_MAX_BYTES = 2 * 1024 * 1024
MAX_RECALL_FILE_IDS = 100
MAX_RECALL_QUERY_CHARS = 2000


class LinkRagError(Exception):
    def __init__(self, status: int, reason: str) -> None:
        super().__init__(f"{status}:{reason}")
        self.status = status
        self.reason = reason

    @property
    def not_found(self) -> bool:
        return self.status == 404


@dataclass(frozen=True)
class RagFileStatus:
    file_id: int
    # ``parse_success`` / ``parse_failed`` / ``parsing`` / ``parse_waiting``.
    frontend_status: str | None

    @property
    def ready(self) -> bool:
        return self.frontend_status == "parse_success"

    @property
    def failed(self) -> bool:
        return self.frontend_status == "parse_failed"


@dataclass(frozen=True)
class RagHit:
    file_id: int
    chunk_id: str
    score: float
    content: str


class LinkRagClient:
    def __init__(
        self,
        *,
        base_url: str,
        client_id: str,
        client_secret: str,
        timeout_seconds: float,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 5.0)),
            transport=transport,
            headers={"Authorization": f"Bearer {client_id}.{client_secret}"},
        )

    def close(self) -> None:
        self._client.close()

    def ensure_default_dataset(self, user_id: int) -> int:
        data = self._request("PUT", "/datasets/default", user_id)
        return _int_field(data, "id")

    def upload_markdown(
        self, user_id: int, *, filename: str, markdown: str, external_ref: str
    ) -> int:
        data = self._request(
            "POST",
            "/files",
            user_id,
            files={"file": (filename, markdown.encode("utf-8"), "text/markdown")},
            data={"externalRef": external_ref},
        )
        return _int_field(data, "id")

    def file_status(self, user_id: int, file_id: int) -> RagFileStatus:
        data = self._request("GET", f"/files/{int(file_id)}", user_id)
        status = data.get("frontendStatus") if isinstance(data, dict) else None
        return RagFileStatus(file_id=int(file_id), frontend_status=status if isinstance(status, str) else None)

    def delete_file(self, user_id: int, file_id: int) -> None:
        """Delete a RAG file; an already missing file counts as deleted."""
        try:
            self._request("DELETE", f"/files/{int(file_id)}", user_id)
        except LinkRagError as error:
            if not error.not_found:
                raise

    def recall(
        self, user_id: int, *, query: str, file_ids: list[int], top_k: int
    ) -> list[RagHit]:
        ids = list(dict.fromkeys(int(item) for item in file_ids))[:MAX_RECALL_FILE_IDS]
        if not ids or not query.strip():
            return []
        data = self._request(
            "POST",
            "/recall",
            user_id,
            json={
                "query": query[:MAX_RECALL_QUERY_CHARS],
                "fileIds": ids,
                "topK": max(1, min(int(top_k), 50)),
            },
        )
        hits = data.get("hits") if isinstance(data, dict) else None
        if not isinstance(hits, list):
            raise LinkRagError(502, "LINKRAG_RESPONSE_INVALID")
        results: list[RagHit] = []
        for hit in hits:
            try:
                results.append(
                    RagHit(
                        file_id=int(hit["fileId"]),
                        chunk_id=str(hit["chunkId"]),
                        score=float(hit.get("score") or 0.0),
                        content=str(hit["content"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        return results

    def _request(self, method: str, path: str, user_id: int, **kwargs: Any) -> Any:
        try:
            with self._client.stream(
                method,
                f"{API_PREFIX}{path}",
                headers={"X-App-User-Id": str(int(user_id))},
                **kwargs,
            ) as response:
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > RESPONSE_MAX_BYTES:
                        raise LinkRagError(502, "LINKRAG_RESPONSE_TOO_LARGE")
                status = response.status_code
        except httpx.TimeoutException as error:
            raise LinkRagError(0, "LINKRAG_TIMEOUT") from error
        except httpx.HTTPError as error:
            raise LinkRagError(0, "LINKRAG_UNAVAILABLE") from error
        payload: Any = None
        if body:
            try:
                payload = json.loads(bytes(body))
            except ValueError:
                payload = None
        if not 200 <= status < 300:
            reason = "LINKRAG_HTTP_ERROR"
            if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
                raw = payload["data"].get("reason")
                if isinstance(raw, str) and raw.isascii() and len(raw) <= 48:
                    reason = raw
            logger.warning(
                "linkrag request failed",
                extra={"summary": f"method={method} status={status} reason={reason}"},
            )
            raise LinkRagError(status, reason)
        if not isinstance(payload, dict):
            if method == "DELETE":
                return None
            raise LinkRagError(502, "LINKRAG_RESPONSE_INVALID")
        return payload.get("data")


def _int_field(data: Any, name: str) -> int:
    value = data.get(name) if isinstance(data, dict) else None
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise LinkRagError(502, "LINKRAG_RESPONSE_INVALID") from error


def build_linkrag_client(settings, *, timeout_seconds: float) -> LinkRagClient | None:
    """Client for the configured LinkRag app, or None to stay on local matching.

    Enabled without credentials (LinkRag app not registered yet) degrades with
    a warning instead of failing startup, so deploys never depend on LinkRag.
    """
    if not settings.linkrag_enabled:
        return None
    if not settings.linkrag_configured:
        logger.warning(
            "LinkRag credentials are missing; dataset recall uses local matching",
            extra={"dependency": "linkrag", "error_code": "LINKRAG_NOT_CONFIGURED"},
        )
        return None
    return LinkRagClient(
        base_url=settings.linkrag_base_url,
        client_id=str(settings.linkrag_client_id),
        client_secret=settings.linkrag_client_secret.get_secret_value(),
        timeout_seconds=timeout_seconds,
    )
