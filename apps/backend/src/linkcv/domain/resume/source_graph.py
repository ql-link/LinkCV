from __future__ import annotations

from dataclasses import dataclass
import base64
import hashlib
import re
from collections.abc import Mapping
from typing import Literal

from linkcv.domain.resume.models import BoundingBox, SourceGraph, SourceLeaf


SourceLeafKind = Literal["heading", "paragraph", "list_item", "contact", "media"]
SourceListKind = Literal["ordered", "bullet"]


@dataclass(frozen=True, slots=True)
class ParsedSourceBlock:
    """Provider-neutral block accepted by the LinkCV SourceGraph boundary."""

    block_id: str
    page: int
    leaf_kind: SourceLeafKind
    text: str
    # x, y, width, height normalized to the page's 0..1 coordinate space.
    bbox: tuple[float, float, float, float] | None = None
    list_kind: SourceListKind | None = None
    list_ordinal: int | None = None


def source_document_sha256(content: bytes) -> str:
    """Return the stable digest used as the SourceGraph input identity.

    The digest is intentionally calculated before any provider or Markdown
    normalization.  A retry of the same uploaded bytes therefore gets the
    same graph identity, while a different source file cannot accidentally
    reuse a graph merely because its converted text happens to match.
    """

    return hashlib.sha256(content).hexdigest()


def stable_source_id(
    *, source_document_sha256: str, ordinal: int, block: ParsedSourceBlock
) -> str:
    """Create the v1 LinkCV identity; provider ids never escape this boundary."""

    components = (
        "source-id-v1",
        source_document_sha256,
        str(ordinal),
        str(block.page),
        block.block_id,
        block.leaf_kind,
        block.list_kind or "",
        str(block.list_ordinal or ""),
        hashlib.sha256(block.text.encode("utf-8")).hexdigest(),
    )
    digest = hashlib.sha256("\0".join(components).encode("utf-8")).digest()
    token = base64.b32encode(digest).decode("ascii").rstrip("=").lower()
    return f"src_{token}"


def build_source_graph(
    *, source_document_sha256: str, blocks: list[ParsedSourceBlock]
) -> SourceGraph:
    leaves: list[SourceLeaf] = []
    for ordinal, block in enumerate(blocks):
        bbox = (
            BoundingBox(
                x=block.bbox[0],
                y=block.bbox[1],
                width=block.bbox[2],
                height=block.bbox[3],
            )
            if block.bbox is not None
            else None
        )
        leaves.append(
            SourceLeaf(
                source_id=stable_source_id(
                    source_document_sha256=source_document_sha256,
                    ordinal=ordinal,
                    block=block,
                ),
                ordinal=ordinal,
                page=block.page,
                block_id=block.block_id,
                leaf_kind=block.leaf_kind,
                text=block.text,
                bbox=bbox,
                list_kind=block.list_kind,
                list_ordinal=block.list_ordinal,
            )
        )
    return SourceGraph(
        schema_version="source-graph.v1",
        source_document_sha256=source_document_sha256,
        leaves=leaves,
    )


_HEADING_MARKER_RE = re.compile(r"^\s*#{1,3}[ \t]+")
_ORDERED_MARKER_RE = re.compile(r"^\s*[0-9]{1,5}\.\s+")
_BULLET_MARKER_RE = re.compile(r"^\s*[-*+•][ \t]+")
_WHITESPACE_RE = re.compile(r"\s+")


def _field(value: object, name: str, default: object = None) -> object:
    """Read a provider/IR field from either a model or a wire-shaped dict."""

    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def _visible_source_text(block: object) -> str:
    """Extract user-visible text from a ``SourceBlock`` without unescaping it.

    ``SourceLayoutIR`` keeps Markdown syntax because the legacy importer needs
    it for round trips.  SourceGraph has explicit leaf/list fields, so sending
    those syntax markers as text would make an LLM treat ``#`` or ``1.`` as
    user content.  Only deterministic parser markers are removed here; no
    HTML/entity decoding is performed.
    """

    markdown = str(_field(block, "markdown", ""))
    block_type = _field(block, "block_type")
    if block_type == "heading":
        return _HEADING_MARKER_RE.sub("", markdown, count=1).strip()
    if block_type == "ordered_list_item":
        return _ORDERED_MARKER_RE.sub("", markdown, count=1).strip()
    if block_type == "bullet_list_item":
        return _BULLET_MARKER_RE.sub("", markdown, count=1).strip()
    return markdown.strip()


def _layout_visible_text(value: str) -> str:
    value = _HEADING_MARKER_RE.sub("", value, count=1)
    value = _ORDERED_MARKER_RE.sub("", value, count=1)
    value = _BULLET_MARKER_RE.sub("", value, count=1)
    return _WHITESPACE_RE.sub(" ", value).strip().casefold()


def _layout_matches_block(block: object, layout_block: object) -> bool:
    source_text = _layout_visible_text(_visible_source_text(block))
    layout_text = _layout_visible_text(str(_field(layout_block, "text", "")))
    if not source_text or not layout_text:
        return False
    return (
        source_text == layout_text
        or source_text.startswith(layout_text)
        or layout_text.startswith(source_text)
        or layout_text in source_text
    )


def _layout_geometry(
    layout_blocks: list[object],
) -> tuple[int, tuple[float, float, float, float] | None, str | None]:
    """Join one or more physical lines into one safe source-block geometry."""

    if not layout_blocks:
        return 1, None, None
    first = layout_blocks[0]
    try:
        page = int(_field(first, "source_page", 1))
    except (TypeError, ValueError):
        page = 1
    # A SourceLeaf has one page/bbox.  For a paragraph crossing a page break,
    # retain the first physical line's geometry rather than inventing a
    # cross-page rectangle.  Same-page lines are safely unioned.
    same_page: list[object] = []
    for item in layout_blocks:
        try:
            item_page = int(_field(item, "source_page", page))
        except (TypeError, ValueError):
            item_page = page
        if item_page == page:
            same_page.append(item)
    try:
        boxes = [
            tuple(float(value) for value in _field(item, "bbox", ()))
            for item in same_page
        ]
        if not boxes or any(len(box) != 4 for box in boxes):
            raise ValueError
        x0 = min(box[0] for box in boxes)
        y0 = min(box[1] for box in boxes)
        x1 = max(box[2] for box in boxes)
        y1 = max(box[3] for box in boxes)
        bbox = (x0, y0, x1 - x0, y1 - y0)
    except (TypeError, ValueError):
        bbox = None
    block_ids = [str(_field(item, "block_id", "")) for item in layout_blocks]
    block_id = (
        block_ids[0]
        if len(block_ids) == 1
        else (
            "joined-"
            + hashlib.sha256("|".join(block_ids).encode("utf-8")).hexdigest()[:32]
        )
    )
    return page, bbox, block_id


def build_source_graph_from_layout_ir(
    source_ir: object,
    *,
    source_document_sha256: str,
    layout_hints: list[object] | tuple[object, ...] | None = None,
) -> SourceGraph:
    """Build a v1 graph from the deterministic ``SourceLayoutIR`` view.

    The function deliberately accepts the IR structurally rather than
    importing its class.  This keeps the resume contract package independent
    from the parser compatibility layer while still giving the service a
    single, deterministic bridge into the new runtime.

    Whitespace/page/provenance discards are parser metadata, not identifiable
    content leaves, and are consequently not sent to the model.  Every
    actual source block remains one graph leaf in ordinal order.
    """

    blocks = sorted(
        list(_field(source_ir, "blocks", ())),
        key=lambda value: int(_field(value, "ordinal", 0)),
    )
    safe_layout = list(layout_hints or ())
    # Hints are advisory.  Keep only monotonically ordered provider blocks;
    # callers already apply the strict PdfLayoutBlock validator, but this
    # structural check also protects lightweight fakes.
    if safe_layout:
        try:
            source_orders = [int(_field(item, "source_order")) for item in safe_layout]
            block_ids = [str(_field(item, "block_id")) for item in safe_layout]
            if (
                any(not block_id or block_id == "None" for block_id in block_ids)
                or source_orders != list(range(len(safe_layout)))
                or len(block_ids) != len(set(block_ids))
            ):
                safe_layout = []
        except (TypeError, ValueError):
            safe_layout = []
    parsed: list[ParsedSourceBlock] = []
    layout_cursor = 0
    for block in blocks:
        block_type = _field(block, "block_type")
        if block_type == "heading":
            leaf_kind: SourceLeafKind = "heading"
        elif block_type in {"ordered_list_item", "bullet_list_item"}:
            leaf_kind = "list_item"
        else:
            # The v1 graph has no decorative-divider kind.  Treat dividers as
            # ordinary paragraphs so their source is still closed and visible.
            leaf_kind = "paragraph"
        metadata = _field(block, "list")
        matched_layout: list[object] = []
        if safe_layout:
            # One IR block may represent multiple physical PDF lines.  Match
            # from the previous cursor and consume only contiguous text that
            # still belongs to this source block.  A mismatch leaves the
            # source block without geometry rather than attaching another
            # block's coordinates.
            candidate_index = next(
                (
                    index
                    for index in range(layout_cursor, len(safe_layout))
                    if _layout_matches_block(block, safe_layout[index])
                ),
                None,
            )
            if candidate_index is not None:
                matched_layout = [safe_layout[candidate_index]]
                layout_cursor = candidate_index + 1
                while layout_cursor < len(safe_layout):
                    candidate = safe_layout[layout_cursor]
                    if _layout_matches_block(block, candidate):
                        matched_layout.append(candidate)
                        layout_cursor += 1
                        continue
                    # A subsequent heading/list block starts the next source
                    # block.  Do not greedily consume it into a paragraph.
                    break
        page, bbox, layout_block_id = _layout_geometry(matched_layout)
        parsed.append(
            ParsedSourceBlock(
                # Keep the parser's provider-local identity only as an
                # internal block handle.  It never escapes as source_id.
                block_id=layout_block_id
                or str(_field(block, "source_id", "source-block")),
                page=page,
                leaf_kind=leaf_kind,
                text=_visible_source_text(block),
                bbox=bbox,
                list_kind=(
                    "ordered" if _field(metadata, "kind") == "ordered" else "bullet"
                )
                if metadata is not None
                else None,
                list_ordinal=(
                    int(_field(metadata, "index")) if metadata is not None else None
                ),
            )
        )
    return build_source_graph(
        source_document_sha256=source_document_sha256,
        blocks=parsed,
    )


# Short aliases make the bridge discoverable to callers migrating from the
# old ``SectionIR`` name without creating a second graph implementation.
build_source_graph_from_ir = build_source_graph_from_layout_ir
build_source_graph_for_import = build_source_graph_from_layout_ir
