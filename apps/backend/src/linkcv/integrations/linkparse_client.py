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


class LinkParseWordMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    omitted_image_count: int = Field(default=0, ge=0)
    table_failure_count: int | None = Field(default=None, ge=0)
    markdown_table_count: int | None = Field(default=None, ge=0)
    rag_text_table_count: int | None = Field(default=None, ge=0)
    formula_count: int | None = Field(default=None, ge=0)
    comment_removed_count: int | None = Field(default=None, ge=0)
    mammoth_warning_count: int | None = Field(default=None, ge=0)


class LinkParseMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    page_count: int = Field(ge=1, le=50)
    duration_ms: int = Field(ge=0)
    word: LinkParseWordMeta | None = None


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
    detected_type: Literal["text_pdf", "scanned_pdf", "mixed_pdf", "docx"]
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
    if (
        status_code == 401
        or (status_code == 503 and code == "ENGINE_UNAVAILABLE")
        or (status_code == 429 and code == "CONCURRENCY_LIMIT_REACHED")
    ):
        return DocumentConversionFailure(503, "DOCUMENT_CONVERSION_UNAVAILABLE")
    if status_code == 413 and code in {"FILE_TOO_LARGE", "PDF_TOO_MANY_PAGES"}:
        return DocumentConversionFailure(413, "IMPORT_FILE_TOO_LARGE")
    if status_code == 415 and code == "UNSUPPORTED_FILE_TYPE":
        return DocumentConversionFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
    if status_code == 422 and code in {
        "PDF_RENDER_FAILED",
        "WORD_PARSE_FAILED",
        "INVALID_WORD_DOCUMENT",
    }:
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
        return await self._parse_with_logging(
            filename=filename,
            content=content,
            operation_id=operation_id,
            deadline_monotonic=deadline_monotonic,
            content_type="application/pdf",
            source_format="pdf",
            expected_detected_types={"text_pdf", "scanned_pdf", "mixed_pdf"},
        )

    async def parse_docx(
        self,
        *,
        filename: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
    ) -> DocumentMarkdownResult:
        return await self._parse_with_logging(
            filename=filename,
            content=content,
            operation_id=operation_id,
            deadline_monotonic=deadline_monotonic,
            content_type=(
                "application/vnd.openxmlformats-officedocument."
                "wordprocessingml.document"
            ),
            source_format="docx",
            expected_detected_types={"docx"},
        )

    async def _parse_with_logging(
        self,
        *,
        filename: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
        content_type: str,
        source_format: Literal["pdf", "docx"],
        expected_detected_types: set[str],
    ) -> DocumentMarkdownResult:
        started = monotonic()
        logger.info(
            "LinkParse request started",
            extra={
                "dependency": "linkparse",
                "operation_id": operation_id,
                "source_format": source_format,
            },
        )
        try:
            result, word_meta = await self._parse_document(
                filename=filename,
                content=content,
                operation_id=operation_id,
                deadline_monotonic=deadline_monotonic,
                content_type=content_type,
                source_format=source_format,
                expected_detected_types=expected_detected_types,
            )
        except DocumentConversionFailure as error:
            logger.warning(
                "LinkParse request failed",
                extra={
                    "dependency": "linkparse",
                    "operation_id": operation_id,
                    "source_format": source_format,
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
                "source_format": source_format,
                "duration_ms": round((monotonic() - started) * 1000),
                "word_meta": word_meta,
                "summary": (
                    f"parser={result.parser};pages={result.page_count or 0};"
                    f"ocr={str(result.ocr_applied).lower()}"
                ),
            },
        )
        return result

    async def _parse_document(
        self,
        *,
        filename: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
        content_type: str,
        source_format: Literal["pdf", "docx"],
        expected_detected_types: set[str],
    ) -> tuple[DocumentMarkdownResult, dict[str, int] | None]:
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
                    files={"file": (filename, content, content_type)},
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
            or parsed.detected_type not in expected_detected_types
        ):
            raise DocumentConversionFailure(502, "DOCUMENT_CONVERSION_FAILED")

        markdown = normalize_markdown(parsed.outputs.markdown)
        if len(markdown.encode("utf-8")) > self._markdown_max_bytes:
            raise DocumentConversionFailure(413, "IMPORT_FILE_TOO_LARGE")
        quality = markdown_quality(markdown)
        if quality == "invalid":
            raise DocumentConversionFailure(422, "IMPORT_CONTENT_INVALID")
        warnings: list[str] = []
        if source_format == "pdf":
            if parsed.detected_type in {"scanned_pdf", "mixed_pdf"}:
                warnings.append(ImportWarning.PDF_OCR_APPLIED.value)
            if quality == "low":
                warnings.append(ImportWarning.PDF_LOW_TEXT_QUALITY.value)
        elif parsed.meta.word is not None and parsed.meta.word.omitted_image_count > 0:
            warnings.append(ImportWarning.DOCX_EMBEDDED_IMAGES_OMITTED.value)
        return (
            DocumentMarkdownResult(
                markdown=markdown,
                source_file_name=filename,
                source_format=source_format,
                parser=parsed.engine,
                parser_version="linkparse-v0.2.0",
                page_count=parsed.meta.page_count,
                ocr_applied=(
                    parsed.detected_type != "text_pdf" if source_format == "pdf" else False
                ),
                warnings=warnings,
            ),
            (
                parsed.meta.word.model_dump(exclude_none=True)
                if parsed.meta.word is not None
                else None
            ),
        )
