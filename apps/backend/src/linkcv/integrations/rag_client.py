from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from linkcv.domain.rag import RagMarkdownResult, RagMetadata


class RagServiceError(Exception):
    pass


class RagNotConfiguredError(RagServiceError):
    pass


class RagResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    markdown: str
    page_count: int | None = Field(default=None, ge=1)
    warnings: list[str] = Field(default_factory=list)
    converter_version: str | None = None


class UnconfiguredRagClient:
    async def convert(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> RagMarkdownResult:
        del filename, content_type, content
        raise RagNotConfiguredError("tolink-rag is not configured")


class HttpRagClient:
    """Adapter for the tolink-rag file-to-Markdown HTTP boundary.

    The endpoint and credentials are configuration. Only this class knows the
    provider wire format, so the mapping can be adjusted when the exact
    tolink-rag contract is supplied without changing import business logic.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        convert_path: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._convert_path = "/" + convert_path.lstrip("/")
        self._timeout_seconds = timeout_seconds
        self._transport = transport

    async def convert(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> RagMarkdownResult:
        headers: dict[str, str] = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.post(
                    self._convert_path,
                    headers=headers,
                    files={"file": (filename, content, content_type)},
                )
                response.raise_for_status()
                payload: Any = response.json()
                parsed = RagResponse.model_validate(payload)
        except (httpx.HTTPError, ValueError, ValidationError) as error:
            raise RagServiceError("tolink-rag conversion failed") from error

        return RagMarkdownResult(
            markdown=parsed.markdown,
            metadata=RagMetadata(
                source_file_name=filename,
                source_format=filename.rsplit(".", 1)[-1].lower(),
                page_count=parsed.page_count,
                converter_version=parsed.converter_version or "tolink-rag/http",
            ),
            warnings=parsed.warnings,
        )
