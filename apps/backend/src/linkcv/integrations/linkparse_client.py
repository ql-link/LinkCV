from __future__ import annotations

import json
import logging
import re
import statistics
from dataclasses import dataclass
from time import monotonic
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentPdfLayout,
    DocumentMarkdownResult,
    PdfLayoutBlock,
    PdfLayoutQuality,
)
from linkcv.domain.import_warnings import ImportWarning

logger = logging.getLogger(__name__)

# Public adapter aliases keep the wire-facing names discoverable without
# coupling callers to the internal ``document_conversion`` module.
LinkParsePdfLayout = DocumentPdfLayout
LinkParsePdfLayoutBlock = PdfLayoutBlock
LinkParsePdfLayoutQuality = PdfLayoutQuality
LayoutBlock = PdfLayoutBlock


# Warnings in the layout envelope describe bounded inference/recovery that is
# still safe when the quality status is ``passed``.  A newly introduced
# warning is intentionally not accepted until this allowlist is updated;
# otherwise a producer could silently weaken the import contract.
PDF_LAYOUT_WARNING_WHITELIST = frozenset(
    {
        "bbox_recovered",
        "continuation_inferred",
        "heading_inferred",
        "ocr_applied",
        "ocr_used",
        "role_inferred",
        "row_inferred",
        "row_role_recovered",
        "visual_role_inferred",
    }
)


class PdfLayoutContractError(ValueError):
    """The upstream PDF layout cannot be consumed losslessly."""


_ORDERED_MARKER_RE = re.compile(
    r"^\s*(?P<number>[0-9]{1,5})"
    r"(?:(?:\.[ \t]+)|(?:[、．\)）][ \t]*))(?P<body>.*)$"
)
_BULLET_MARKER_RE = re.compile(r"^\s*(?:[-*+•])[ \t]+(?P<body>.*)$")
_HEADING_MARKER_RE = re.compile(r"^\s*(?P<hashes>#{1,6})[ \t]+(?P<body>.*)$")


class LinkParseWordMeta(BaseModel):
    # Word metadata is an informational compatibility envelope; the strict
    # loss checks below map the counters we know about, while newer producer
    # counters must not make DOCX conversion fail closed unexpectedly.
    model_config = ConfigDict(extra="ignore")

    omitted_image_count: int = Field(default=0, ge=0)
    table_failure_count: int | None = Field(default=None, ge=0)
    markdown_table_count: int | None = Field(default=None, ge=0)
    rag_text_table_count: int | None = Field(default=None, ge=0)
    formula_count: int | None = Field(default=None, ge=0)
    comment_removed_count: int | None = Field(default=None, ge=0)
    mammoth_warning_count: int | None = Field(default=None, ge=0)


class LinkParsePdfMeta(BaseModel):
    # The LinkParse PDF envelope carries producer metadata in addition to the
    # strict nested layout contract (pipeline, OCR page summaries, and
    # provenance flags).  Keep that compatibility metadata opaque; only the
    # layout/blocks/quality DTOs below are an extra-forbid trust boundary.
    model_config = ConfigDict(extra="ignore")

    layout: DocumentPdfLayout | None = None


class LinkParseMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    page_count: int = Field(ge=1, le=50)
    duration_ms: int = Field(ge=0)
    word: LinkParseWordMeta | None = None
    pdf: LinkParsePdfMeta | None = None


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
        character == "\ufffd" or (ord(character) < 32 and character not in {"\n", "\t"})
        for character in markdown
    )
    ratio = suspicious / max(1, len(markdown))
    if ratio > 0.03:
        return "invalid"
    if len(effective) < 120 or ratio > 0.005:
        return "low"
    return "good"


def _layout_contract_error() -> PdfLayoutContractError:
    # Keep the exception message free of upstream text.  It may be surfaced
    # by a caller or included in an exception chain, and layout blocks are
    # user resume content.
    return PdfLayoutContractError("invalid PDF layout contract")


def _validate_pdf_layout(
    layout: DocumentPdfLayout,
    *,
    page_count: int,
) -> list[PdfLayoutBlock]:
    """Validate cross-block invariants and return source-order blocks."""

    quality = layout.quality
    if quality.status != "passed":
        raise _layout_contract_error()
    blocks = list(layout.blocks)
    if not blocks or quality.heading_count < 1:
        raise _layout_contract_error()
    if quality.source_line_count != len(blocks):
        raise _layout_contract_error()
    if quality.output_block_count != len(blocks):
        raise _layout_contract_error()
    heading_count = sum(block.role == "heading" for block in blocks)
    if quality.heading_count != heading_count or heading_count < 1:
        raise _layout_contract_error()
    row_ids = {block.row_id for block in blocks if block.row_id is not None}
    if quality.row_group_count != len(row_ids):
        raise _layout_contract_error()
    if any(warning not in PDF_LAYOUT_WARNING_WHITELIST for warning in quality.warnings):
        raise _layout_contract_error()

    block_ids = [block.block_id for block in blocks]
    if len(block_ids) != len(set(block_ids)):
        raise _layout_contract_error()
    source_orders = [block.source_order for block in blocks]
    if source_orders != list(range(len(blocks))):
        raise _layout_contract_error()
    by_id = {block.block_id: block for block in blocks}
    median_height_by_page: dict[int, float] = {}
    for source_page in {block.source_page for block in blocks}:
        heights = [
            block.bbox[3] - block.bbox[1]
            for block in blocks
            if block.source_page == source_page
        ]
        median_height_by_page[source_page] = statistics.median(heights)
    for index, block in enumerate(blocks):
        if block.source_page > page_count:
            raise _layout_contract_error()
        if index and block.source_page < blocks[index - 1].source_page:
            raise _layout_contract_error()
        if block.continuation_of is None:
            continue
        target = by_id.get(block.continuation_of)
        if target is None:
            raise _layout_contract_error()
        if index == 0 or target.block_id != blocks[index - 1].block_id:
            raise _layout_contract_error()
        if (
            target.role != block.role
            or target.heading_level != block.heading_level
            or target.role == "heading"
            or target.row_id is not None
            or block.row_id is not None
        ):
            raise _layout_contract_error()
        target_x0, target_y0, _target_x1, target_y1 = target.bbox
        block_x0, block_y0, _block_x1, _block_y1 = block.bbox
        if target.source_page != block.source_page:
            if (
                block.source_page != target.source_page + 1
                or target.role
                not in {"ordered_list_item", "bullet_list_item"}
                or target_y1 < 0.88
                or block_y0 > 0.12
                or abs(block_x0 - target_x0) > 0.04 + 1e-6
            ):
                raise _layout_contract_error()
            continue
        target_height = target_y1 - target_y0
        allowed_gap = (
            max(
                target_height,
                median_height_by_page[block.source_page],
            )
            * 0.55
        )
        if block_y0 < target_y0 or block_y0 - target_y1 > allowed_gap + 1e-6:
            raise _layout_contract_error()
        if abs(target_x0 - block_x0) > 0.04 + 1e-6:
            raise _layout_contract_error()

    # A row id is a visual relationship, not a free grouping label. Every
    # member must be adjacent in source order, on one page, and have a
    # strictly overlapping vertical interval. A one-block row is valid and
    # carries the producer's explicit row identity without inventing a peer.
    positions_by_row: dict[str, list[int]] = {}
    for index, block in enumerate(blocks):
        if block.row_id is not None:
            positions_by_row.setdefault(block.row_id, []).append(index)
    for positions in positions_by_row.values():
        if positions != list(range(positions[0], positions[-1] + 1)):
            raise _layout_contract_error()
        members = [blocks[index] for index in positions]
        if len({member.source_page for member in members}) != 1:
            raise _layout_contract_error()
        for left, right in zip(members, members[1:]):
            left_x0, left_y0, left_x1, left_y1 = left.bbox
            right_x0, right_y0, right_x1, right_y1 = right.bbox
            vertical_overlap = max(
                0.0,
                min(left_y1, right_y1) - max(left_y0, right_y0),
            )
            minimum_height = min(left_y1 - left_y0, right_y1 - right_y0)
            if vertical_overlap / minimum_height < 0.24:
                raise _layout_contract_error()
            center_delta = abs((left_y0 + left_y1) - (right_y0 + right_y1))
            if center_delta > median_height_by_page[left.source_page] * 0.45 + 1e-6:
                raise _layout_contract_error()
            if right_x0 <= left_x0:
                raise _layout_contract_error()
            horizontal_overlap = max(0.0, min(left_x1, right_x1) - right_x0)
            if horizontal_overlap > min(left_x1 - left_x0, right_x1 - right_x0) * 0.18:
                raise _layout_contract_error()

    # Bind source order to physical reading order. Row members are one visual
    # unit ordered left-to-right above; all other units must move down the page.
    visual_units: list[tuple[int, float]] = []
    emitted_rows: set[str] = set()
    for block in blocks:
        if block.row_id is None:
            visual_units.append((block.source_page, block.bbox[1]))
            continue
        if block.row_id in emitted_rows:
            continue
        emitted_rows.add(block.row_id)
        positions = positions_by_row[block.row_id]
        members = [blocks[index] for index in positions]
        visual_units.append(
            (members[0].source_page, min(member.bbox[1] for member in members))
        )
    for previous, current in zip(visual_units, visual_units[1:]):
        previous_page, previous_top = previous
        current_page, current_top = current
        if current_page < previous_page:
            raise _layout_contract_error()
        if current_page == previous_page and current_top + 1e-6 < previous_top:
            raise _layout_contract_error()
    return blocks


@dataclass(frozen=True)
class _LayoutUnit:
    source_order: int
    role: str
    heading_level: int | None
    text: str
    row_id: str | None


def _strip_heading_marker(text: str) -> str:
    match = _HEADING_MARKER_RE.match(text)
    return match.group("body").strip() if match else text.strip()


def _strip_ordered_marker(text: str) -> tuple[int | None, str]:
    match = _ORDERED_MARKER_RE.match(text)
    if not match:
        return None, text.strip()
    return int(match.group("number")), match.group("body").strip()


def _strip_bullet_marker(text: str) -> str:
    match = _BULLET_MARKER_RE.match(text)
    return match.group("body").strip() if match else text.strip()


def _layout_units(blocks: list[PdfLayoutBlock]) -> list[_LayoutUnit]:
    """Collapse continuation chains and visual rows exactly once."""

    by_id = {block.block_id: block for block in blocks}
    root_by_id: dict[str, str] = {}
    text_by_root: dict[str, str] = {}
    continuation_ids: set[str] = set()
    row_by_root: dict[str, str | None] = {}
    for block in blocks:
        if block.continuation_of is None:
            root = block.block_id
            text_by_root[root] = block.text.strip()
            row_by_root[root] = block.row_id
        else:
            target_root = root_by_id.get(block.continuation_of)
            if target_root is None:
                raise _layout_contract_error()
            root = target_root
            current_row = row_by_root.get(root)
            if (
                current_row is not None
                and block.row_id is not None
                and current_row != block.row_id
            ):
                raise _layout_contract_error()
            if current_row is None and block.row_id is not None:
                row_by_root[root] = block.row_id
            text_by_root[root] += block.join_with + block.text.strip()
            continuation_ids.add(block.block_id)
        root_by_id[block.block_id] = root

    root_blocks = [block for block in blocks if block.block_id not in continuation_ids]
    roots_by_row: dict[str, list[str]] = {}
    for block in root_blocks:
        row_id = row_by_root.get(block.block_id)
        if row_id is not None:
            roots_by_row.setdefault(row_id, []).append(block.block_id)

    units: list[_LayoutUnit] = []
    emitted_rows: set[str] = set()
    for block in root_blocks:
        root = block.block_id
        row_id = row_by_root.get(root)
        if row_id is not None:
            if row_id in emitted_rows:
                continue
            emitted_rows.add(row_id)
            members = [by_id[member_id] for member_id in roots_by_row[row_id]]
            roles = {member.role for member in members}
            levels = {member.heading_level for member in members}
            if len(roles) != 1 or len(levels) != 1:
                raise _layout_contract_error()
            text = " ｜ ".join(text_by_root[member.block_id] for member in members)
            units.append(
                _LayoutUnit(
                    source_order=members[0].source_order,
                    role=members[0].role,
                    heading_level=members[0].heading_level,
                    text=text,
                    row_id=row_id,
                )
            )
            continue
        units.append(
            _LayoutUnit(
                source_order=block.source_order,
                role=block.role,
                heading_level=block.heading_level,
                text=text_by_root[root],
                row_id=None,
            )
        )

    # Every input block must be represented by either its own logical unit or
    # the continuation/row unit that owns it. The explicit count check keeps
    # a future renderer change from silently dropping a physical line.
    consumed_ids = set(continuation_ids)
    for unit in units:
        for block in root_blocks:
            if block.source_order == unit.source_order:
                consumed_ids.add(block.block_id)
                if unit.row_id is not None:
                    consumed_ids.update(roots_by_row[unit.row_id])
                break
    if consumed_ids != set(by_id):
        raise _layout_contract_error()
    return sorted(units, key=lambda unit: unit.source_order)


def _render_layout_markdown(blocks: list[PdfLayoutBlock]) -> str:
    units = _layout_units(blocks)
    segments: list[tuple[str, list[str]]] = []
    ordered_number = 0
    previous_list_role: str | None = None
    for unit in units:
        if unit.role == "heading":
            if unit.heading_level not in {1, 2}:
                raise _layout_contract_error()
            line = f"{'#' * unit.heading_level} {_strip_heading_marker(unit.text)}"
            segments.append(("text", [line]))
            previous_list_role = None
            continue
        if unit.role == "ordered_list_item":
            explicit_number, body = _strip_ordered_marker(unit.text)
            if explicit_number is not None:
                ordered_number = explicit_number
            elif previous_list_role == "ordered_list_item":
                ordered_number += 1
            else:
                ordered_number = 1
            line = f"{ordered_number}. {body}"
            if segments and segments[-1][0] == "ordered_list_item":
                segments[-1][1].append(line)
            else:
                segments.append(("ordered_list_item", [line]))
            previous_list_role = "ordered_list_item"
            continue
        if unit.role == "bullet_list_item":
            line = f"- {_strip_bullet_marker(unit.text)}"
            if segments and segments[-1][0] == "bullet_list_item":
                segments[-1][1].append(line)
            else:
                segments.append(("bullet_list_item", [line]))
            previous_list_role = "bullet_list_item"
            continue
        line = unit.text.strip()
        if not line:
            raise _layout_contract_error()
        segments.append(("text", [line]))
        previous_list_role = None
    return normalize_markdown(
        "\n\n".join("\n".join(lines) for _kind, lines in segments)
    )


def _markdown_layout_key(markdown: str) -> tuple[str, ...]:
    """Compare semantic Markdown while tolerating harmless blank-line style."""

    key: list[str] = []
    for raw_line in normalize_markdown(markdown).splitlines():
        line = raw_line.strip()
        if not line:
            continue
        heading = _HEADING_MARKER_RE.match(line)
        if heading:
            key.append(f"{heading.group('hashes')} {heading.group('body').strip()}")
            continue
        ordered = _ORDERED_MARKER_RE.match(line)
        if ordered:
            key.append(
                f"{int(ordered.group('number'))}. {ordered.group('body').strip()}"
            )
            continue
        bullet = _BULLET_MARKER_RE.match(line)
        if bullet:
            key.append(f"- {bullet.group('body').strip()}")
            continue
        key.append(line)
    return tuple(key)


def rebuild_pdf_layout_markdown(
    layout: DocumentPdfLayout,
    *,
    page_count: int,
    output_markdown: str,
) -> str:
    """Validate layout, rebuild visible Markdown, and verify producer output."""

    blocks = _validate_pdf_layout(layout, page_count=page_count)
    rebuilt = _render_layout_markdown(blocks)
    if _markdown_layout_key(rebuilt) != _markdown_layout_key(output_markdown):
        raise _layout_contract_error()
    return rebuilt


def _validation_error_is_pdf_layout(error: ValidationError) -> bool:
    """Identify nested layout errors without hiding unrelated envelope errors."""

    return any(
        tuple(entry.get("loc", ()))[:3] == ("meta", "pdf", "layout")
        for entry in error.errors(include_url=False, include_context=False)
    )


def mapped_failure(status_code: int, code: str | None) -> DocumentConversionFailure:
    if (
        status_code == 401
        or (status_code == 503 and code == "ENGINE_UNAVAILABLE")
        or (status_code == 429 and code == "CONCURRENCY_LIMIT_REACHED")
    ):
        return DocumentConversionFailure(503, "DOCUMENT_CONVERSION_UNAVAILABLE")
    if status_code == 413 and code in {"FILE_TOO_LARGE", "PDF_TOO_MANY_PAGES"}:
        return DocumentConversionFailure(413, "IMPORT_FILE_TOO_LARGE")
    if status_code == 413 and code == "LAYOUT_RESOURCE_LIMIT":
        return DocumentConversionFailure(422, "RESUME_LAYOUT_UNSUPPORTED")
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
        require_layout: bool = False,
    ) -> DocumentMarkdownResult:
        return await self._parse_with_logging(
            filename=filename,
            content=content,
            operation_id=operation_id,
            deadline_monotonic=deadline_monotonic,
            content_type="application/pdf",
            source_format="pdf",
            expected_detected_types={"text_pdf", "scanned_pdf", "mixed_pdf"},
            require_pdf_layout=require_layout,
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
            require_pdf_layout=False,
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
        require_pdf_layout: bool,
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
                require_pdf_layout=require_pdf_layout,
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
        require_pdf_layout: bool,
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
            "output_formats": "markdown",
            "include_bbox": "false",
            "include_images": "false",
        }
        if source_format == "pdf" and require_pdf_layout:
            # Layout is a PDF-only opt-in. DOCX deliberately keeps the old
            # Markdown contract, and non-resume PDF consumers must also stay
            # on the legacy response path unless they explicitly require it.
            form["include_layout"] = "true"
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

        payload_for_validation = payload
        if source_format == "pdf" and not require_pdf_layout:
            # Layout is outside the legacy PDF contract. Ignore it even if a
            # newer LinkParse producer happens to include it, so Dataset and
            # other generic document consumers cannot inherit resume-only
            # validation failures through a shared converter.
            if isinstance(payload, dict) and isinstance(payload.get("meta"), dict):
                meta = payload["meta"]
                if isinstance(meta.get("pdf"), dict) and "layout" in meta["pdf"]:
                    payload_for_validation = dict(payload)
                    copied_meta = dict(meta)
                    copied_pdf = dict(meta["pdf"])
                    copied_pdf.pop("layout", None)
                    copied_meta["pdf"] = copied_pdf
                    payload_for_validation["meta"] = copied_meta
        try:
            parsed = LinkParseResponse.model_validate(payload_for_validation)
        except ValidationError as error:
            if (
                source_format == "pdf"
                and require_pdf_layout
                and _validation_error_is_pdf_layout(error)
            ):
                raise DocumentConversionFailure(
                    422, "RESUME_LAYOUT_UNSUPPORTED"
                ) from error
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
        layout_schema_version: int | None = None
        if source_format == "pdf" and require_pdf_layout:
            layout = parsed.meta.pdf.layout if parsed.meta.pdf is not None else None
            if layout is None:
                raise DocumentConversionFailure(422, "RESUME_LAYOUT_UNSUPPORTED")
            try:
                markdown = rebuild_pdf_layout_markdown(
                    layout,
                    page_count=parsed.meta.page_count,
                    output_markdown=markdown,
                )
            except PdfLayoutContractError as error:
                raise DocumentConversionFailure(
                    422, "RESUME_LAYOUT_UNSUPPORTED"
                ) from error
            layout_schema_version = layout.schema_version
        warnings: list[str] = []
        if source_format == "pdf":
            if parsed.detected_type in {"scanned_pdf", "mixed_pdf"}:
                warnings.append(ImportWarning.PDF_OCR_APPLIED.value)
            if quality == "low":
                warnings.append(ImportWarning.PDF_LOW_TEXT_QUALITY.value)
        elif parsed.meta.word is not None:
            if parsed.meta.word.omitted_image_count > 0:
                warnings.append(ImportWarning.DOCX_EMBEDDED_IMAGES_OMITTED.value)
            if any(
                (count or 0) > 0
                for count in (
                    parsed.meta.word.table_failure_count,
                    parsed.meta.word.markdown_table_count,
                    parsed.meta.word.rag_text_table_count,
                )
            ):
                warnings.append(ImportWarning.DOCX_TABLE_CONTENT_PRESENT.value)
        return (
            DocumentMarkdownResult(
                markdown=markdown,
                source_file_name=filename,
                source_format=source_format,
                parser=parsed.engine,
                parser_version="linkparse-v0.2.0",
                page_count=parsed.meta.page_count,
                detected_type=parsed.detected_type,
                ocr_applied=(
                    parsed.detected_type != "text_pdf"
                    if source_format == "pdf"
                    else False
                ),
                warnings=warnings,
                layout_applied=source_format == "pdf" and require_pdf_layout,
                layout_schema_version=layout_schema_version,
            ),
            (
                parsed.meta.word.model_dump(exclude_none=True)
                if parsed.meta.word is not None
                else None
            ),
        )
