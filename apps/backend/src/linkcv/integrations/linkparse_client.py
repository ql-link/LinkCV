from __future__ import annotations

import json
import logging
from time import monotonic
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.domain.import_warnings import ImportWarning

logger = logging.getLogger(__name__)


class LinkParseMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    page_count: int = Field(ge=1, le=50)
    duration_ms: int = Field(ge=0)


class LinkParseOutputs(BaseModel):
    model_config = ConfigDict(extra="ignore")

    markdown: str


class LinkParseAsset(BaseModel):
    model_config = ConfigDict(extra="allow")


class LinkParseResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    request_id: str
    filename: str
    engine: str
    detected_type: Literal["text_pdf", "scanned_pdf", "mixed_pdf"]
    outputs: LinkParseOutputs
    assets: list[LinkParseAsset] = Field(default_factory=list)
    meta: LinkParseMeta


def normalize_markdown(markdown: str) -> str:
    lines = [
        line.rstrip()
        for line in markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    ]
    normalized: list[str] = []
    previous_blank = False
    for line in lines:
        if not line:
            if previous_blank:
                continue
            previous_blank = True
        else:
            previous_blank = False
        normalized.append(line)
    return "\n".join(normalized).strip()


def markdown_quality(markdown: str) -> Literal["invalid", "low", "good"]:
    effective = "".join(character for character in markdown if not character.isspace())
    if len(effective) < 20:
        return "invalid"
    suspicious = sum(
        character == "\ufffd"
        or (ord(character) < 32 and character not in {"\n", "\t"})
        for character in markdown
    )
    ratio = suspicious / max(1, len(markdown))
    if ratio > 0.03:
        return "invalid"
    if len(effective) < 120 or ratio > 0.005:
        return "low"
    return "good"


def mapped_failure(status_code: int, code: str | None) -> DocumentConversionFailure:
    if status_code == 401 or (status_code == 503 and code == "ENGINE_UNAVAILABLE"):
        return DocumentConversionFailure(503, "DOCUMENT_CONVERSION_UNAVAILABLE")
    if status_code == 413 and code in {"FILE_TOO_LARGE", "PDF_TOO_MANY_PAGES"}:
        return DocumentConversionFailure(413, "IMPORT_FILE_TOO_LARGE")
    if status_code == 415 and code == "UNSUPPORTED_FILE_TYPE":
        return DocumentConversionFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
    if status_code == 422 and code == "PDF_RENDER_FAILED":
        return DocumentConversionFailure(422, "IMPORT_CONTENT_INVALID")
    return DocumentConversionFailure(502, "DOCUMENT_CONVERSION_FAILED")


class LinkParseClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        parse_path: str,
        timeout_seconds: float,
        response_max_bytes: int,
        markdown_max_bytes: int,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = (api_key or "").strip()
        self._parse_path = "/" + parse_path.lstrip("/")
        self._timeout_seconds = timeout_seconds
        self._response_max_bytes = response_max_bytes
        self._markdown_max_bytes = markdown_max_bytes
        self._transport = transport

    async def parse_pdf(
        self,
        *,
        filename: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
    ) -> DocumentMarkdownResult:
        started = monotonic()
        logger.info(
            "LinkParse request started",
            extra={"dependency": "linkparse", "operation_id": operation_id},
        )
        try:
            result = await self._parse_pdf(
                filename=filename,
                content=content,
                operation_id=operation_id,
                deadline_monotonic=deadline_monotonic,
            )
        except DocumentConversionFailure as error:
            logger.warning(
                "LinkParse request failed",
                extra={
                    "dependency": "linkparse",
                    "operation_id": operation_id,
                    "duration_ms": round((monotonic() - started) * 1000),
                    "error_code": error.code,
                    "exception_type": type(error).__name__,
                },
            )
            raise
        logger.info(
            "LinkParse request completed",
            extra={
                "dependency": "linkparse",
                "operation_id": operation_id,
                "duration_ms": round((monotonic() - started) * 1000),
                "summary": (
                    f"parser={result.parser};pages={result.page_count or 0};"
                    f"ocr={str(result.ocr_applied).lower()}"
                ),
            },
        )
        return result

    async def _parse_pdf(
        self,
        *,
        filename: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
    ) -> DocumentMarkdownResult:
        if not self._base_url or not self._api_key:
            raise DocumentConversionFailure(503, "DOCUMENT_CONVERSION_UNAVAILABLE")
        remaining = deadline_monotonic - monotonic()
        if remaining <= 0:
            raise DocumentConversionFailure(504, "IMPORT_DEADLINE_EXCEEDED")
        request_id = f"resume-import-{operation_id}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "X-Request-ID": request_id,
        }
        form = {
            "engine": "auto",
            "output_formats": "markdown",
            "ocr": "auto",
            "dpi": "200",
            "include_bbox": "false",
            "include_images": "false",
        }
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=min(self._timeout_seconds, remaining),
                transport=self._transport,
            ) as client:
                async with client.stream(
                    "POST",
                    self._parse_path,
                    headers=headers,
                    data=form,
                    files={"file": (filename, content, "application/pdf")},
                ) as response:
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > self._response_max_bytes:
                            raise DocumentConversionFailure(
                                502, "DOCUMENT_CONVERSION_FAILED"
                            )
        except httpx.TimeoutException as error:
            raise DocumentConversionFailure(
                504, "DOCUMENT_CONVERSION_TIMEOUT"
            ) from error
        except httpx.RequestError as error:
            raise DocumentConversionFailure(
                503, "DOCUMENT_CONVERSION_UNAVAILABLE"
            ) from error

        # Authentication is actionable even when an intermediary strips the
        # upstream JSON error envelope.
        if response.status_code == 401:
            raise mapped_failure(response.status_code, None)

        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DocumentConversionFailure(
                502, "DOCUMENT_CONVERSION_FAILED"
            ) from error

        if response.status_code >= 400:
            upstream_code = None
            if isinstance(payload, dict):
                envelope = payload.get("error")
                if isinstance(envelope, dict) and isinstance(envelope.get("code"), str):
                    upstream_code = envelope["code"]
            raise mapped_failure(response.status_code, upstream_code)

        try:
            parsed = LinkParseResponse.model_validate(payload)
        except ValidationError as error:
            raise DocumentConversionFailure(
                502, "DOCUMENT_CONVERSION_FAILED"
            ) from error
        if (
            parsed.request_id != request_id
            or response.headers.get("X-Request-ID") != request_id
            or parsed.assets
        ):
            raise DocumentConversionFailure(502, "DOCUMENT_CONVERSION_FAILED")

        markdown = normalize_markdown(parsed.outputs.markdown)
        if len(markdown.encode("utf-8")) > self._markdown_max_bytes:
            raise DocumentConversionFailure(413, "IMPORT_FILE_TOO_LARGE")
        quality = markdown_quality(markdown)
        if quality == "invalid":
            raise DocumentConversionFailure(422, "IMPORT_CONTENT_INVALID")
        warnings: list[str] = []
        if parsed.detected_type in {"scanned_pdf", "mixed_pdf"}:
            warnings.append(ImportWarning.PDF_OCR_APPLIED.value)
        if quality == "low":
            warnings.append(ImportWarning.PDF_LOW_TEXT_QUALITY.value)
        return DocumentMarkdownResult(
            markdown=markdown,
            source_file_name=filename,
            source_format="pdf",
            parser=parsed.engine,
            parser_version="linkparse-v0.2.0",
            page_count=parsed.meta.page_count,
            ocr_applied=parsed.detected_type != "text_pdf",
            warnings=warnings,
        )
