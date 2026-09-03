"""One-time, deterministic conversion from the retired resume contracts.

This module is migration tooling, not a runtime compatibility layer.  It
preserves user-visible content while removing layout-only TipTap containers;
rows that cannot be represented without guessing fail the cutover.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Iterable

from markdown_it import MarkdownIt

from linkcv.domain.resume.models import (
    ALL_SEMANTIC_KINDS,
    CanonicalResumeDocument,
    Contact,
    EntryFields,
    Identity,
    InlineIcon,
    InlineMedia,
    InlineStyle,
    ListBlock,
    ListItem,
    MediaBlock,
    MediaReference,
    ParagraphBlock,
    PresentationSettings,
    ResumeEntry,
    ResumePresentation,
    ResumeSection,
    RowBlock,
    RowCell,
    SemanticLabels,
    SimpleContentBlock,
    TemplateAvatar,
    TemplateDefinition,
    TemplateRegion,
    TemplateSlot,
    TemplateTokens,
    TextRun,
    TextValue,
)
from linkcv.domain.resume_document import (
    ResumeDocument,
    RichText,
    rich_text_to_markdown,
)
from linkcv.domain.resume_style import ResumePresentation as LegacyPresentation


class LegacyCutoverError(ValueError):
    """A legacy row cannot be converted without losing visible information."""


def _id(kind: str, *parts: object) -> str:
    digest = hashlib.sha256("\x1f".join(map(str, parts)).encode()).hexdigest()[:24]
    return f"node_{kind[:8]}{digest}"


def _style(
    *, color: str | None = None, size: float | None = None, highlight: str | None = None
) -> InlineStyle:
    return InlineStyle(color=color, font_size_pt=size, highlight_color=highlight)


def _text_run(
    text: str,
    *,
    marks: Iterable[str] = (),
    href: str | None = None,
    style: InlineStyle | None = None,
) -> TextRun:
    return TextRun(
        inline_type="text",
        text=text,
        marks=list(dict.fromkeys(marks)),
        href=href,
        style=style or _style(),
    )


def _inline_media(attrs: dict[str, Any]) -> InlineMedia:
    return InlineMedia(
        inline_type="media",
        node_id=_id("inline", attrs.get("src"), attrs.get("alt")),
        source_refs=[],
        media_kind="inline_image",
        src=str(attrs["src"]),
        alt=attrs.get("alt"),
        width=float(attrs.get("width", 72)),
        width_unit="px",
        height_px=float(attrs["height"]) if attrs.get("height") is not None else None,
        align=None,
        system_fallback=False,
    )


_INLINE_ICON_NAMES: frozenset[str] = frozenset(
    {
        "Mail",
        "Phone",
        "MapPin",
        "Globe",
        "Github",
        "Linkedin",
        "GraduationCap",
        "Briefcase",
        "Award",
        "Star",
        "Calendar",
        "Code2",
    }
)
_INLINE_ICON_MARKER = re.compile(r":icon\[(?P<name>[A-Za-z0-9]+)\]:")


def _icon(name: str) -> InlineIcon:
    return InlineIcon(inline_type="icon", name=name)  # type: ignore[arg-type]


def _icon_marker(name: object) -> str:
    return f":icon[{name}]:"


_SECTION_ICON_MARKER = re.compile(
    r"\A[ \t]*:icon\[(?P<name>[A-Za-z0-9]+)\]:[ \t]*(?P<title>.*)\Z",
)


def _section_title(
    display_title: str | None,
    *parts: object,
) -> tuple[TextValue | None, InlineIcon | None]:
    """Project a legacy section title marker into canonical title fields.

    Only a line-leading, allow-listed marker has section-heading semantics.
    Other marker-looking text remains the title verbatim and is handled by the
    regular inline Markdown conversion when it occurs in body content.
    """

    if not display_title:
        return None, None
    match = _SECTION_ICON_MARKER.fullmatch(display_title)
    if match is None or match.group("name") not in _INLINE_ICON_NAMES:
        return _text_value("title", display_title, *parts), None
    title = match.group("title").strip()
    return (
        _text_value("title", title, *parts) if title else None,
        _icon(match.group("name")),
    )


def _append_marked_text(
    result: list[TextRun | InlineIcon | InlineMedia],
    value: str,
    *,
    marks: Iterable[str] = (),
    href: str | None = None,
    style: InlineStyle | None = None,
) -> None:
    """Split legal Markdown icon markers while retaining surrounding metadata."""

    cursor = 0
    for match in _INLINE_ICON_MARKER.finditer(value):
        name = match.group("name")
        if name not in _INLINE_ICON_NAMES:
            continue
        if match.start() > cursor:
            result.append(
                _text_run(
                    value[cursor : match.start()],
                    marks=marks,
                    href=href,
                    style=style,
                )
            )
        result.append(_icon(name))
        cursor = match.end()
    if cursor < len(value):
        result.append(
            _text_run(value[cursor:], marks=marks, href=href, style=style)
        )


def _tiptap_inline(
    nodes: list[dict[str, Any]],
) -> list[TextRun | InlineIcon | InlineMedia]:
    result: list[TextRun | InlineIcon | InlineMedia] = []
    for node in nodes:
        node_type = node.get("type")
        if node_type == "text":
            marks: list[str] = []
            href = None
            color = size = highlight = None
            for mark in node.get("marks", []):
                mark_type = mark.get("type")
                attrs = mark.get("attrs") or {}
                if mark_type in {"bold", "italic", "underline", "strike", "code"}:
                    marks.append(mark_type)
                elif mark_type == "link":
                    href = attrs.get("href")
                elif mark_type == "textStyle":
                    color = attrs.get("color")
                    raw_size = attrs.get("fontSize")
                    size = (
                        float(raw_size.removesuffix("pt"))
                        if isinstance(raw_size, str)
                        else None
                    )
                elif mark_type == "highlight":
                    highlight = attrs.get("color")
            _append_marked_text(
                result,
                str(node["text"]),
                marks=marks,
                href=href,
                style=_style(color=color, size=size, highlight=highlight),
            )
        elif node_type == "inlineImage":
            result.append(_inline_media(node.get("attrs") or {}))
        elif node_type in {"hardBreak"}:
            result.append(_text_run("\n"))
        elif node_type == "inlineIcon":
            name = (node.get("attrs") or {}).get("name")
            if isinstance(name, str) and name in _INLINE_ICON_NAMES:
                result.append(_icon(name))
            else:
                # Unknown or incomplete historical nodes are ordinary text,
                # never silently discarded.
                result.append(_text_run(_icon_marker(name or "")))
        elif node_type == "resumeBlockAnchor":
            # Anchors are layout metadata and have no user-visible text.
            continue
        else:
            raise LegacyCutoverError(f"unsupported inline TipTap node: {node_type}")
    return result


def _tiptap_blocks(
    root: dict[str, Any], *, seed: str
) -> list[SimpleContentBlock | RowBlock]:
    blocks: list[SimpleContentBlock | RowBlock] = []

    def row_from_node(node: dict[str, Any], path: str) -> RowBlock:
        node_type = node.get("type")
        row_kind = {
            "resumeRow": "pair",
            "resumeMetaRow": "meta",
            "resumeTrioRow": "trio",
        }.get(node_type)
        if row_kind is None:
            raise LegacyCutoverError(f"unsupported row TipTap node: {node_type}")
        expected = {"pair": 2, "meta": 4, "trio": 3}[row_kind]
        content = node.get("content") or []
        if len(content) != expected:
            raise LegacyCutoverError(
                f"{node_type} requires exactly {expected} direct paragraph cells"
            )

        width: float | None = None
        if row_kind == "pair":
            raw_width = (node.get("attrs") or {}).get("leftWidth", 50)
            if isinstance(raw_width, bool) or not isinstance(raw_width, (int, float)):
                raise LegacyCutoverError("resumeRow leftWidth must be numeric")
            width = float(raw_width)
            if not 30 <= width <= 80:
                raise LegacyCutoverError(
                    "resumeRow leftWidth must be between 30 and 80"
                )

        cells: list[RowCell] = []
        for index, child in enumerate(content):
            if child.get("type") not in {
                "paragraph",
                "heading",
                "blockquote",
                "codeBlock",
            }:
                raise LegacyCutoverError(
                    f"{node_type} cell {index} must be a direct text block"
                )
            parsed = _tiptap_blocks(
                {"type": "doc", "content": [child]},
                seed=f"{seed}:{path}:cell:{index}",
            )
            if len(parsed) != 1 or isinstance(parsed[0], RowBlock):
                raise LegacyCutoverError(
                    f"{node_type} cell {index} is an ambiguous container"
                )
            cells.append(
                RowCell(
                    node_id=_id("cell", seed, path, index),
                    source_refs=[],
                    blocks=parsed,
                )
            )
        return RowBlock(
            node_id=_id("row", seed, path),
            source_refs=[],
            block_type="row",
            row_kind=row_kind,
            cells=cells,
            left_width_percent=width,
        )

    def visit(node: dict[str, Any], path: str) -> None:
        node_type = node.get("type")
        content = node.get("content") or []
        if node_type in {"resumeRow", "resumeMetaRow", "resumeTrioRow"}:
            blocks.append(row_from_node(node, path))
            return
        if node_type in {
            "doc",
            "resumeColumn",
            "resumeColumns",
        }:
            for index, child in enumerate(content):
                visit(child, f"{path}.{index}")
            return
        if node_type in {"paragraph", "heading", "blockquote", "codeBlock"}:
            runs = _tiptap_inline(content)
            if runs:
                blocks.append(
                    ParagraphBlock(
                        node_id=_id("paragraph", seed, path),
                        block_type="paragraph",
                        runs=runs,
                        source_refs=[],
                    )
                )
            return
        if node_type in {"bulletList", "orderedList"}:
            items: list[ListItem] = []
            for index, item in enumerate(content):
                if item.get("type") != "listItem":
                    raise LegacyCutoverError("list contains a non-listItem node")
                runs: list[TextRun | InlineIcon | InlineMedia] = []
                for child in item.get("content") or []:
                    if child.get("type") in {"bulletList", "orderedList"}:
                        raise LegacyCutoverError(
                            "nested lists cannot be represented losslessly"
                        )
                    runs.extend(_tiptap_inline(child.get("content") or []))
                if not runs:
                    raise LegacyCutoverError("empty list item cannot be migrated")
                items.append(
                    ListItem(
                        node_id=_id("listitem", seed, path, index),
                        source_refs=[],
                        runs=runs,
                    )
                )
            blocks.append(
                ListBlock(
                    node_id=_id("list", seed, path),
                    block_type="ordered_list"
                    if node_type == "orderedList"
                    else "bullet_list",
                    start=int((node.get("attrs") or {}).get("start", 1))
                    if node_type == "orderedList"
                    else None,
                    items=items,
                )
            )
            return
        if node_type in {"resumeImage", "avatarImage"}:
            attrs = node.get("attrs") or {}
            if node_type == "avatarImage":
                return
            blocks.append(
                MediaBlock(
                    node_id=_id("media", seed, path),
                    source_refs=[],
                    block_type="media",
                    media_kind="resume_image",
                    src=str(attrs["src"]),
                    alt=attrs.get("alt"),
                    width=float(attrs.get("width", 55)),
                    width_unit=attrs.get("widthUnit", "%"),
                    height_px=None,
                    align=attrs.get("align", "center"),
                    system_fallback=False,
                )
            )
            return
        if node_type == "horizontalRule":
            return
        raise LegacyCutoverError(f"unsupported block TipTap node: {node_type}")

    visit(root, "root")
    return blocks


def _markdown_simple_blocks(
    markdown: str, *, seed: str
) -> list[ParagraphBlock | ListBlock | MediaBlock]:
    tokens = MarkdownIt("commonmark").parse(markdown)
    blocks: list[ParagraphBlock | ListBlock | MediaBlock] = []

    def inline_runs(token) -> list[TextRun | InlineIcon | InlineMedia]:
        result: list[TextRun | InlineIcon | InlineMedia] = []
        marks: list[str] = []
        href: str | None = None
        for child in token.children or []:
            if child.type in {"strong_open", "em_open", "s_open"}:
                marks.append(
                    {"strong_open": "bold", "em_open": "italic", "s_open": "strike"}[
                        child.type
                    ]
                )
            elif child.type in {"strong_close", "em_close", "s_close"}:
                mark = {
                    "strong_close": "bold",
                    "em_close": "italic",
                    "s_close": "strike",
                }[child.type]
                if mark in marks:
                    marks.remove(mark)
            elif child.type == "link_open":
                href = child.attrGet("href")
            elif child.type == "link_close":
                href = None
            elif child.type in {"text", "code_inline"} and child.content:
                active = [*marks, *(["code"] if child.type == "code_inline" else [])]
                _append_marked_text(
                    result,
                    child.content,
                    marks=active,
                    href=href,
                )
            elif child.type in {"softbreak", "hardbreak"}:
                result.append(_text_run("\n", marks=marks, href=href))
            elif child.type == "image":
                result.append(
                    _inline_media(
                        {"src": child.attrGet("src"), "alt": child.content or None}
                    )
                )
            elif child.type == "html_inline":
                raise LegacyCutoverError("inline HTML cannot be migrated losslessly")
        return result

    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.type in {"paragraph_open", "heading_open", "blockquote_open"}:
            inline = tokens[index + 1] if index + 1 < len(tokens) else None
            runs = (
                inline_runs(inline)
                if inline is not None and inline.type == "inline"
                else []
            )
            if runs:
                blocks.append(
                    ParagraphBlock(
                        node_id=_id("paragraph", seed, index),
                        source_refs=[],
                        block_type="paragraph",
                        runs=runs,
                    )
                )
            index += 1
        elif token.type in {"bullet_list_open", "ordered_list_open"}:
            ordered = token.type == "ordered_list_open"
            items: list[ListItem] = []
            depth = 1
            cursor = index + 1
            while cursor < len(tokens) and depth:
                current = tokens[cursor]
                if current.type == token.type:
                    depth += 1
                    if depth > 1:
                        raise LegacyCutoverError(
                            "nested markdown lists cannot be represented losslessly"
                        )
                elif current.type == token.type.replace("open", "close"):
                    depth -= 1
                elif depth == 1 and current.type == "inline" and current.content:
                    runs = inline_runs(current)
                    if runs:
                        items.append(
                            ListItem(
                                node_id=_id("listitem", seed, index, len(items)),
                                source_refs=[],
                                runs=runs,
                            )
                        )
                cursor += 1
            if items:
                start = int(token.attrGet("start") or 1) if ordered else None
                blocks.append(
                    ListBlock(
                        node_id=_id("list", seed, index),
                        block_type="ordered_list" if ordered else "bullet_list",
                        start=start,
                        items=items,
                    )
                )
            index = cursor - 1
        elif token.type in {"fence", "code_block"} and token.content:
            blocks.append(
                ParagraphBlock(
                    node_id=_id("paragraph", seed, index),
                    source_refs=[],
                    block_type="paragraph",
                    runs=[_text_run(token.content, marks=["code"])],
                )
            )
        elif token.type in {"html_block"}:
            raise LegacyCutoverError("HTML rich text cannot be migrated losslessly")
        index += 1
    return blocks


_PAIR_LEFT = re.compile(r"^left(?:\s+(\d+(?:\.\d+)?))?$")


def _contains_raw_marker(value: str) -> bool:
    """Detect only line-level retired containers, not colons in prose."""

    return any(
        re.match(r"^:{3,4}(?:\s|$)", line.strip()) is not None
        for line in value.splitlines()
    )


def _markdown_marker(line: str) -> tuple[str, str | float | None] | None:
    """Classify one complete-line legacy container marker.

    The old editor exported these markers on their own lines.  Treating any
    other line containing ``:::`` as an error prevents a marker from silently
    becoming user-visible paragraph text during cutover.
    """

    value = line.strip()
    if value == "::::":
        return ("quad-close", None)
    if value.startswith("::::"):
        rest = value[4:].strip()
        if rest in {"sidebar", "main", "meta", "trio"}:
            return ("quad-open", rest)
        return ("invalid", rest)
    if value == ":::":
        return ("triple-close", None)
    if value.startswith(":::"):
        rest = value[3:].strip()
        if rest == "right":
            return ("triple-right", None)
        match = _PAIR_LEFT.fullmatch(rest)
        if match:
            raw_width = match.group(1)
            return ("triple-left", float(raw_width) if raw_width else 70.0)
        return ("invalid", rest)
    return None


def _row_from_markdown_cells(
    *,
    row_kind: str,
    cells: list[list[SimpleContentBlock]],
    seed: str,
    path: str,
    left_width_percent: float | None = None,
) -> RowBlock:
    expected = {"pair": 2, "meta": 4, "trio": 3}[row_kind]
    if len(cells) != expected:
        raise LegacyCutoverError(
            f"{row_kind} markdown rows require exactly {expected} cells"
        )
    if row_kind == "pair" and (
        left_width_percent is None or not 30 <= left_width_percent <= 80
    ):
        raise LegacyCutoverError("pair row width must be between 30 and 80")
    if row_kind != "pair" and left_width_percent is not None:
        raise LegacyCutoverError("fixed-cardinality rows cannot declare a width")

    normalized_cells: list[list[ParagraphBlock]] = []
    for index, cell in enumerate(cells):
        if not cell or any(not isinstance(block, ParagraphBlock) for block in cell):
            raise LegacyCutoverError(
                f"{row_kind} markdown row cell {index} must contain only text paragraphs"
            )
        paragraphs = [block for block in cell if isinstance(block, ParagraphBlock)]
        if len(paragraphs) == 1:
            normalized_cells.append(paragraphs)
            continue
        runs: list[TextRun | InlineIcon | InlineMedia] = []
        for paragraph_index, paragraph in enumerate(paragraphs):
            if paragraph_index:
                runs.append(_text_run("\n"))
            runs.extend(paragraph.runs)
        normalized_cells.append([
            ParagraphBlock(
                node_id=paragraphs[0].node_id,
                source_refs=list(dict.fromkeys(
                    source_ref
                    for paragraph in paragraphs
                    for source_ref in paragraph.source_refs
                )),
                block_type="paragraph",
                runs=runs,
            )
        ])

    return RowBlock(
        node_id=_id("row", seed, path),
        source_refs=[],
        block_type="row",
        row_kind=row_kind,  # type: ignore[arg-type]
        cells=[
            RowCell(
                node_id=_id("cell", seed, path, index),
                source_refs=[],
                blocks=cell,
            )
            for index, cell in enumerate(normalized_cells)
        ],
        left_width_percent=left_width_percent,
    )


def _markdown_blocks(
    markdown: str, *, seed: str
) -> list[SimpleContentBlock | RowBlock]:
    """Parse Markdown while consuming the retired row/page containers.

    ``MarkdownIt`` intentionally has no knowledge of the retired ``:::``
    syntax, so parsing it first would preserve the markers as paragraphs.  A
    small line-oriented pass handles only the old, unambiguous containers and
    delegates all ordinary Markdown to the existing strict parser.
    """

    lines = markdown.splitlines()
    row_path_occurrences: dict[str, int] = {}

    def next_row_path(base: str) -> str:
        occurrence = row_path_occurrences.get(base, 0)
        row_path_occurrences[base] = occurrence + 1
        return base if occurrence == 0 else f"{base}.{occurrence}"

    def parse_range(
        start: int,
        *,
        closing: str | None,
        path: str,
        allow_containers: bool = True,
    ) -> tuple[list[SimpleContentBlock | RowBlock], int]:
        result: list[SimpleContentBlock | RowBlock] = []
        plain: list[str] = []

        def flush_plain() -> None:
            if not plain:
                return
            result.extend(
                _markdown_simple_blocks(
                    "\n".join(plain), seed=f"{seed}:{path}:{len(result)}"
                )
            )
            plain.clear()

        index = start
        while index < len(lines):
            marker = _markdown_marker(lines[index])
            if marker is None:
                plain.append(lines[index])
                index += 1
                continue
            marker_kind, marker_value = marker
            if marker_kind == closing:
                flush_plain()
                return result, index + 1
            if marker_kind in {"triple-close", "quad-close"}:
                raise LegacyCutoverError("unmatched legacy container close marker")
            if marker_kind == "invalid":
                raise LegacyCutoverError(
                    f"unsupported or ambiguous legacy marker: {marker_value}"
                )
            if not allow_containers:
                raise LegacyCutoverError("nested legacy containers are ambiguous")

            flush_plain()
            if marker_kind == "triple-left":
                row_path = next_row_path(f"{path}.pair")
                left, after_left = parse_range(
                    index + 1,
                    closing="triple-close",
                    path=f"{row_path}.left",
                    allow_containers=False,
                )
                right_open = after_left
                while right_open < len(lines) and not lines[right_open].strip():
                    right_open += 1
                right_marker = (
                    _markdown_marker(lines[right_open])
                    if right_open < len(lines)
                    else None
                )
                if right_marker != ("triple-right", None):
                    raise LegacyCutoverError(
                        "pair row must contain an unambiguous right cell"
                    )
                right, after_right = parse_range(
                    right_open + 1,
                    closing="triple-close",
                    path=f"{row_path}.right",
                    allow_containers=False,
                )
                result.append(
                    _row_from_markdown_cells(
                        row_kind="pair",
                        cells=[left, right],
                        seed=seed,
                        path=row_path,
                        left_width_percent=float(marker_value),
                    )
                )
                index = after_right
                continue

            if marker_kind == "triple-right":
                raise LegacyCutoverError("pair row right cell has no left cell")

            # Quad containers are either page-level wrappers (which disappear)
            # or fixed-cardinality section rows.  Keep their body line-based:
            # accepting arbitrary paragraph grouping here would make the cell
            # boundaries impossible to recover deterministically.
            if marker_kind == "quad-open":
                quad_kind = str(marker_value)
                close = index + 1
                while close < len(lines) and lines[close].strip() != "::::":
                    if quad_kind in {"meta", "trio"}:
                        nested = _markdown_marker(lines[close])
                        if nested is not None:
                            raise LegacyCutoverError(
                                "nested or incomplete quad legacy container"
                            )
                    close += 1
                if close >= len(lines):
                    raise LegacyCutoverError("legacy quad container is incomplete")
                body_lines = lines[index + 1 : close]
                if quad_kind in {"sidebar", "main"}:
                    inner, _ = parse_range(
                        index + 1,
                        closing="quad-close",
                        path=f"{path}.{quad_kind}",
                    )
                    result.extend(inner)
                else:
                    row_path = next_row_path(f"{path}.{quad_kind}")
                    expected = {"meta": 4, "trio": 3}[quad_kind]
                    while body_lines and not body_lines[0].strip():
                        body_lines.pop(0)
                    while body_lines and not body_lines[-1].strip():
                        body_lines.pop()
                    if len(body_lines) != expected:
                        raise LegacyCutoverError(
                            f"{quad_kind} row requires exactly {expected} cell lines"
                        )
                    cells: list[list[SimpleContentBlock]] = []
                    for cell_index, cell_line in enumerate(body_lines):
                        cells.append(
                            _markdown_simple_blocks(
                                cell_line,
                                seed=f"{seed}:{row_path}:cell:{cell_index}",
                            )
                        )
                    result.append(
                        _row_from_markdown_cells(
                            row_kind=quad_kind,
                            cells=cells,
                            seed=seed,
                            path=row_path,
                        )
                    )
                index = close + 1
                continue

            raise LegacyCutoverError(f"unhandled legacy marker: {marker_kind}")

        if closing is not None:
            raise LegacyCutoverError("legacy container is incomplete")
        flush_plain()
        return result, index

    parsed, end = parse_range(0, closing=None, path="root")
    if end != len(lines):
        raise LegacyCutoverError("legacy Markdown parser did not consume input")
    return parsed


def rich_text_blocks(
    value: RichText | None, *, seed: str
) -> list[SimpleContentBlock | RowBlock]:
    if value is None:
        return []
    if value.format == "tiptap-json":
        assert isinstance(value.content, dict)
        return _tiptap_blocks(value.content, seed=seed)
    return _markdown_blocks(rich_text_to_markdown(value), seed=seed)


def _block_plain_text(block: SimpleContentBlock | RowBlock) -> str:
    if isinstance(block, ParagraphBlock):
        return "".join(run.text for run in block.runs if isinstance(run, TextRun))
    return ""


def _block_marker(
    block: SimpleContentBlock | RowBlock,
) -> tuple[str, str | float | None] | None:
    if not isinstance(block, ParagraphBlock):
        return None
    return _markdown_marker(_block_plain_text(block).strip())


def _unique_source_refs(blocks: Iterable[object]) -> list[str]:
    refs: list[str] = []
    for block in blocks:
        values = getattr(block, "source_refs", [])
        for value in values:
            if value not in refs:
                refs.append(value)
    return refs


def _recomposed_row(
    *,
    row_kind: str,
    cells: list[list[SimpleContentBlock]],
    opener: ParagraphBlock,
    closers: list[ParagraphBlock],
    seed: str,
    width: float | None = None,
    cell_ids: list[str | None] | None = None,
) -> RowBlock:
    expected = {"pair": 2, "meta": 4, "trio": 3}[row_kind]
    if len(cells) != expected:
        raise LegacyCutoverError(
            f"flattened {row_kind} row requires exactly {expected} cells"
        )
    if row_kind == "pair" and (width is None or not 30 <= width <= 80):
        raise LegacyCutoverError("flattened pair row width is not recoverable")
    if row_kind != "pair" and width is not None:
        raise LegacyCutoverError("fixed row unexpectedly declares a width")
    ids = cell_ids or [None] * expected
    row_id = opener.node_id
    return RowBlock(
        node_id=row_id,
        source_refs=_unique_source_refs(
            [opener, *closers, *[item for cell in cells for item in cell]]
        ),
        block_type="row",
        row_kind=row_kind,  # type: ignore[arg-type]
        cells=[
            RowCell(
                node_id=ids[index] or _id("cell", seed, opener.node_id, index),
                source_refs=_unique_source_refs(cell),
                blocks=cell,
            )
            for index, cell in enumerate(cells)
        ],
        left_width_percent=width,
    )


_COLLAPSED_PAIR = re.compile(
    r"\A[ \t]*::: left(?:[ \t]+(?P<width>\d+(?:\.\d+)?))?[ \t]*\n"
    r"(?P<left>.*?)\n[ \t]*:::[ \t]*\n(?:[ \t]*\n)*"
    r"(?P<right_open>[ \t]*::: right[ \t]*)\n"
    r"(?P<right>.*?)\n[ \t]*:::[ \t]*\Z",
    re.DOTALL,
)
_COLLAPSED_FIXED = re.compile(
    r"\A[ \t]*::::[ \t]+(?P<kind>meta|trio)[ \t]*\n"
    r"(?P<body>.*?)\n[ \t]*::::[ \t]*\Z",
    re.DOTALL,
)
_COLLAPSED_FIXED_IMPLICIT_CLOSE = re.compile(
    r"\A[ \t]*::::[ \t]+(?P<kind>meta|trio)[ \t]*\n"
    r"(?P<body>.*)\Z",
    re.DOTALL,
)


def _combined_paragraph_runs(
    blocks: list[ParagraphBlock],
) -> tuple[
    str,
    list[tuple[int, int, TextRun]],
    list[tuple[int, int, ParagraphBlock]],
]:
    """Join persisted collapsed paragraphs without flattening inline marks.

    0047 inherited a historical Markdown adapter that sometimes placed an
    opener, cell text, and closer in one ParagraphBlock.  Some pair rows were
    split across two or three such paragraphs.  The synthetic newline between
    source paragraphs is visible structure, so keep it as an ordinary neutral
    TextRun while retaining every original run's marks, link and style.
    """

    text_parts: list[str] = []
    run_spans: list[tuple[int, int, TextRun]] = []
    block_spans: list[tuple[int, int, ParagraphBlock]] = []
    cursor = 0
    for index, block in enumerate(blocks):
        if index:
            separator = _text_run("\n")
            text_parts.append(separator.text)
            run_spans.append((cursor, cursor + 1, separator))
            cursor += 1
        block_start = cursor
        for run in block.runs:
            if not isinstance(run, TextRun):
                raise LegacyCutoverError("collapsed legacy row contains inline media")
            start = cursor
            cursor += len(run.text)
            text_parts.append(run.text)
            run_spans.append((start, cursor, run))
        block_spans.append((block_start, cursor, block))
    return "".join(text_parts), run_spans, block_spans


def _slice_combined_runs(
    run_spans: list[tuple[int, int, TextRun]],
    *,
    start: int,
    end: int,
) -> list[TextRun]:
    runs: list[TextRun] = []
    for run_start, run_end, run in run_spans:
        overlap_start = max(start, run_start)
        overlap_end = min(end, run_end)
        if overlap_start >= overlap_end:
            continue
        value = run.text[overlap_start - run_start : overlap_end - run_start]
        if value:
            runs.append(run.model_copy(update={"text": value}))
    return runs


def _blocks_for_span(
    block_spans: list[tuple[int, int, ParagraphBlock]],
    *,
    start: int,
    end: int,
) -> list[ParagraphBlock]:
    return [
        block
        for block_start, block_end, block in block_spans
        if block_start < end and block_end > start
    ]


def _collapsed_row(blocks: list[ParagraphBlock], *, seed: str) -> RowBlock | None:
    """Recover one exact row collapsed into one or more paragraphs.

    Returning ``None`` means the prefix is not a complete supported row yet;
    callers may append another adjacent paragraph.  Once a regex matches, any
    nested marker, invalid width or ambiguous fixed-cell count fails closed.
    """

    text, run_spans, block_spans = _combined_paragraph_runs(blocks)
    pair = _COLLAPSED_PAIR.fullmatch(text)
    if pair is not None:
        left_text = pair.group("left")
        right_text = pair.group("right")
        if _contains_raw_marker(left_text) or _contains_raw_marker(right_text):
            raise LegacyCutoverError("nested collapsed pair row container")
        width = float(pair.group("width") or 70)
        if not 30 <= width <= 80:
            raise LegacyCutoverError("collapsed pair row width is not recoverable")
        spans = [pair.span("left"), pair.span("right")]
        cells: list[RowCell] = []
        for cell_index, (start, end) in enumerate(spans):
            source_blocks = _blocks_for_span(
                block_spans,
                start=start,
                end=end,
            )
            paragraph = ParagraphBlock(
                node_id=_id(
                    "paragraph",
                    seed,
                    blocks[0].node_id,
                    "collapsed",
                    cell_index,
                ),
                source_refs=_unique_source_refs(source_blocks),
                block_type="paragraph",
                runs=_slice_combined_runs(
                    run_spans,
                    start=start,
                    end=end,
                ),
            )
            if cell_index == 1:
                right_open = pair.start("right_open")
                right_sources = [
                    block
                    for block_start, block_end, block in block_spans
                    if block_start <= right_open < block_end
                ]
                cell_id = (
                    right_sources[0].node_id
                    if len(right_sources) == 1
                    else _id("cell", seed, blocks[0].node_id, cell_index)
                )
            else:
                cell_id = _id("cell", seed, blocks[0].node_id, cell_index)
            cells.append(
                RowCell(
                    node_id=cell_id,
                    source_refs=_unique_source_refs(source_blocks),
                    blocks=[paragraph],
                )
            )
        return RowBlock(
            node_id=blocks[0].node_id,
            source_refs=_unique_source_refs(blocks),
            block_type="row",
            row_kind="pair",
            cells=cells,
            left_width_percent=width,
        )

    fixed = _COLLAPSED_FIXED.fullmatch(text)
    if fixed is None:
        # One historical editor path collapsed a fixed row into a paragraph
        # but discarded only its final ``::::`` line.  The paragraph boundary
        # is a safe implicit close solely because meta/trio have fixed cell
        # counts; pair rows never receive this recovery.
        fixed = _COLLAPSED_FIXED_IMPLICIT_CLOSE.fullmatch(text)
    if fixed is None:
        return None
    body = fixed.group("body")
    if _contains_raw_marker(body):
        raise LegacyCutoverError("nested collapsed fixed row container")
    kind = fixed.group("kind")
    expected = {"meta": 4, "trio": 3}[kind]
    lines = body.split("\n")
    if len(lines) != expected or any(not line for line in lines):
        raise LegacyCutoverError(f"collapsed {kind} row has ambiguous cell count")
    body_start = fixed.start("body")
    offset = 0
    cells = []
    for cell_index, line in enumerate(lines):
        start = body_start + offset
        end = start + len(line)
        source_blocks = _blocks_for_span(block_spans, start=start, end=end)
        paragraph = ParagraphBlock(
            node_id=_id(
                "paragraph",
                seed,
                blocks[0].node_id,
                "collapsed",
                cell_index,
            ),
            source_refs=_unique_source_refs(source_blocks),
            block_type="paragraph",
            runs=_slice_combined_runs(run_spans, start=start, end=end),
        )
        cells.append(
            RowCell(
                node_id=_id("cell", seed, blocks[0].node_id, cell_index),
                source_refs=_unique_source_refs(source_blocks),
                blocks=[paragraph],
            )
        )
        offset += len(line) + 1
    return RowBlock(
        node_id=blocks[0].node_id,
        source_refs=_unique_source_refs(blocks),
        block_type="row",
        row_kind=kind,  # type: ignore[arg-type]
        cells=cells,
        left_width_percent=None,
    )


def recompose_flattened_rows(
    blocks: list[SimpleContentBlock | RowBlock], *, seed: str
) -> list[SimpleContentBlock | RowBlock]:
    """Restore row structures that 0046 flattened into ParagraphBlocks.

    The parser accepts only the exact line-level legacy containers.  A nested,
    incomplete or non-cardinality-preserving container fails before migration
    writes; ordinary blocks and already-canonical rows retain their identities.
    """

    def parse_sequence(
        sequence: list[SimpleContentBlock | RowBlock],
        path: str,
    ) -> list[SimpleContentBlock | RowBlock]:
        result: list[SimpleContentBlock | RowBlock] = []
        index = 0
        while index < len(sequence):
            block = sequence[index]
            marker = _block_marker(block)
            text = _block_plain_text(block)
            if isinstance(block, ParagraphBlock) and _contains_raw_marker(text):
                collapsed_blocks: list[ParagraphBlock] = []
                collapsed: RowBlock | None = None
                for candidate in sequence[index:]:
                    if not isinstance(candidate, ParagraphBlock):
                        break
                    collapsed_blocks.append(candidate)
                    collapsed = _collapsed_row(
                        collapsed_blocks,
                        seed=f"{seed}:{path}:{index}",
                    )
                    if collapsed is not None:
                        break
                if collapsed is not None:
                    result.append(collapsed)
                    index += len(collapsed_blocks)
                    continue
            if marker is None:
                if _contains_raw_marker(text):
                    parsed = rich_text_blocks(
                        RichText(format="markdown", content=text),
                        seed=f"{seed}:{path}:{index}",
                    )
                    if _contains_raw_marker(
                        "\n".join(_block_plain_text(item) for item in parsed)
                    ):
                        raise LegacyCutoverError(
                            "raw legacy row marker survived recomposition"
                        )
                    result.extend(parsed)
                else:
                    result.append(block)
                index += 1
                continue
            kind, value = marker
            if kind in {"invalid", "triple-close", "triple-right", "quad-close"}:
                raise LegacyCutoverError("unmatched or ambiguous flattened row marker")
            if kind == "triple-left":
                if not isinstance(block, ParagraphBlock):
                    raise LegacyCutoverError("pair opener is not a paragraph")
                left_end = index + 1
                while left_end < len(sequence) and _block_marker(
                    sequence[left_end]
                ) != (
                    "triple-close",
                    None,
                ):
                    if _contains_raw_marker(_block_plain_text(sequence[left_end])):
                        raise LegacyCutoverError("nested pair row container")
                    if isinstance(sequence[left_end], RowBlock):
                        raise LegacyCutoverError("nested pair row container")
                    left_end += 1
                if left_end >= len(sequence):
                    raise LegacyCutoverError("flattened pair row is incomplete")
                right_open = left_end + 1
                while (
                    right_open < len(sequence)
                    and not _block_plain_text(sequence[right_open]).strip()
                ):
                    right_open += 1
                if right_open >= len(sequence) or _block_marker(
                    sequence[right_open]
                ) != (
                    "triple-right",
                    None,
                ):
                    raise LegacyCutoverError("flattened pair row has no right opener")
                right_end = right_open + 1
                while right_end < len(sequence) and _block_marker(
                    sequence[right_end]
                ) != (
                    "triple-close",
                    None,
                ):
                    if _contains_raw_marker(_block_plain_text(sequence[right_end])):
                        raise LegacyCutoverError("nested pair row container")
                    if isinstance(sequence[right_end], RowBlock):
                        raise LegacyCutoverError("nested pair row container")
                    right_end += 1
                if right_end >= len(sequence):
                    raise LegacyCutoverError("flattened pair row is incomplete")
                left_body = sequence[index + 1 : left_end]
                right_body = sequence[right_open + 1 : right_end]
                if any(
                    not isinstance(item, (ParagraphBlock, ListBlock, MediaBlock))
                    for item in [*left_body, *right_body]
                ):
                    raise LegacyCutoverError(
                        "flattened pair row contains an unsupported block"
                    )
                left_close = sequence[left_end]
                right_close = sequence[right_end]
                assert isinstance(left_close, ParagraphBlock)
                assert isinstance(right_close, ParagraphBlock)
                result.append(
                    _recomposed_row(
                        row_kind="pair",
                        cells=[left_body, right_body],  # type: ignore[list-item]
                        opener=block,
                        closers=[left_close, right_close],
                        seed=f"{seed}:{path}:{index}",
                        width=float(value) if isinstance(value, (int, float)) else None,
                        cell_ids=[None, right_close.node_id],
                    )
                )
                index = right_end + 1
                continue
            if kind == "triple-right":
                raise LegacyCutoverError("pair right opener has no left opener")
            if kind == "quad-open":
                if not isinstance(block, ParagraphBlock):
                    raise LegacyCutoverError("quad opener is not a paragraph")
                quad_kind = str(value)
                close = index + 1
                while close < len(sequence) and _block_marker(sequence[close]) != (
                    "quad-close",
                    None,
                ):
                    nested = _block_marker(sequence[close])
                    if nested is not None and nested[0].startswith("quad"):
                        raise LegacyCutoverError("nested or ambiguous quad container")
                    close += 1
                if close >= len(sequence):
                    raise LegacyCutoverError("flattened quad container is incomplete")
                body = sequence[index + 1 : close]
                close_block = sequence[close]
                assert isinstance(close_block, ParagraphBlock)
                if quad_kind in {"sidebar", "main"}:
                    result.extend(parse_sequence(body, f"{path}.{quad_kind}"))
                else:
                    expected = {"meta": 4, "trio": 3}.get(quad_kind)
                    if expected is None or len(body) != expected:
                        raise LegacyCutoverError(
                            f"flattened {quad_kind} row has ambiguous cell count"
                        )
                    if any(
                        not isinstance(item, (ParagraphBlock, ListBlock, MediaBlock))
                        for item in body
                    ):
                        raise LegacyCutoverError(
                            "flattened fixed row contains an unsupported block"
                        )
                    result.append(
                        _recomposed_row(
                            row_kind=quad_kind,
                            cells=[[item] for item in body],  # type: ignore[list-item]
                            opener=block,
                            closers=[close_block],
                            seed=f"{seed}:{path}:{index}",
                        )
                    )
                index = close + 1
                continue
            raise LegacyCutoverError("unsupported flattened row marker")
        return result

    result = parse_sequence(blocks, "root")
    if _contains_raw_marker("\n".join(_block_plain_text(block) for block in result)):
        raise LegacyCutoverError("raw legacy row marker survived recomposition")
    return result


def _text_value(kind: str, value: str | None, *parts: object) -> TextValue | None:
    if not value:
        return None
    return TextValue(node_id=_id(kind, *parts), source_refs=[], value=value)


def convert_legacy_template(
    style: LegacyPresentation, *, template_key: str
) -> TemplateDefinition:
    regions = [
        TemplateRegion(region_id=item.id, region_kind=item.kind, order=item.order)
        for item in style.manifest.regions
    ]
    slots: list[TemplateSlot] = []
    for item in style.manifest.slots:
        accepts = [
            "identity" if kind in {"basics", "avatar"} else kind
            for kind in item.accepts
        ]
        accepts = list(dict.fromkeys(accepts))
        if item.fallback:
            accepts = sorted(ALL_SEMANTIC_KINDS)
        slots.append(
            TemplateSlot(
                slot_id=item.id,
                region_id=item.region_id,
                accepts=accepts,
                universal_fallback=item.fallback,
                order=item.order,
            )
        )
    avatar_slots = [item for item in style.manifest.slots if "avatar" in item.accepts]
    if len(avatar_slots) > 1:
        avatar_regions = {item.region_id for item in avatar_slots}
        if len(avatar_regions) != 1:
            raise LegacyCutoverError("legacy template has ambiguous avatar regions")
    if avatar_slots:
        avatar_region_id = avatar_slots[0].region_id
    else:
        identity_regions = {
            item.region_id
            for item in style.manifest.slots
            if any(kind in {"basics", "identity"} for kind in item.accepts)
        }
        if len(identity_regions) != 1:
            raise LegacyCutoverError(
                "legacy template has no uniquely recoverable avatar region"
            )
        avatar_region_id = next(iter(identity_regions))
    legacy_avatar = style.manifest.avatar
    return TemplateDefinition(
        schema_version="template-definition.v1",
        template_key=template_key,
        semantic_labels=SemanticLabels(
            profile="个人简介",
            work="工作经历",
            education="教育经历",
            project="项目经历",
            skills="专业技能",
            activity="实践经历",
            interests="兴趣爱好",
            certificates="证书",
            awards="荣誉奖项",
            languages="语言能力",
        ),
        regions=regions,
        slots=slots,
        tokens=TemplateTokens(
            font_family=style.font_family,
            font_size_pt=style.font_size,
            line_height=style.line_height,
            accent_color=style.accent_color,
            # The two historical fields remain populated for old readers.  The
            # four explicit values below are the lossless source of truth for
            # new readers and are deliberately not normalized.
            page_margin_mm=style.page.margin_left_mm,
            vertical_page_margin_mm=style.page.margin_top_mm,
            page_margin_top_mm=style.page.margin_top_mm,
            page_margin_right_mm=style.page.margin_right_mm,
            page_margin_bottom_mm=style.page.margin_bottom_mm,
            page_margin_left_mm=style.page.margin_left_mm,
        ),
        avatar=TemplateAvatar(
            visibility=legacy_avatar.visibility,
            fallback_asset=legacy_avatar.fallback_asset,
            size_px=legacy_avatar.size,
            region_id=avatar_region_id,
        ),
    )


def presentation_for_legacy(
    style: LegacyPresentation, template: TemplateDefinition
) -> ResumePresentation:
    settings = PresentationSettings(
        smart_one_page=style.smart_one_page,
        line_height=style.line_height,
        accent_color=style.accent_color,
        page_margin_mm=template.tokens.page_margin_mm,
        vertical_page_margin_mm=template.tokens.vertical_page_margin_mm,
        page_margin_top_mm=style.page.margin_top_mm,
        page_margin_right_mm=style.page.margin_right_mm,
        page_margin_bottom_mm=style.page.margin_bottom_mm,
        page_margin_left_mm=style.page.margin_left_mm,
        avatar_size_px=template.avatar.size_px
        if template.avatar.visibility == "show"
        else None,
    )
    return ResumePresentation(
        schema_version="resume-presentation.v1",
        portable=settings,
        template_scoped={template.template_key: settings},
        template_snapshot=template,
    )


def convert_legacy_document(document: ResumeDocument) -> CanonicalResumeDocument:
    basics = document.basics
    contacts: list[Contact] = []
    for kind, value in (
        ("email", basics.email),
        ("phone", basics.phone),
        ("location", basics.location),
    ):
        if value:
            contacts.append(
                Contact(
                    node_id=_id("contact", kind, value),
                    source_refs=[],
                    contact_kind=kind,
                    value=value,
                    label=None,
                )
            )
    for link in basics.links:
        contacts.append(
            Contact(
                node_id=_id("contact", link.id),
                source_refs=[],
                contact_kind="website",
                value=link.url,
                label=link.label or None,
            )
        )
    avatar = None
    if basics.photo:
        avatar = MediaReference(
            node_id=_id("avatar", basics.photo),
            source_refs=[],
            media_kind="avatar",
            src=basics.photo,
            alt="简历头像",
            width=None,
            width_unit=None,
            height_px=None,
            align=None,
            system_fallback=False,
        )
    identity = Identity(
        node_id=_id("identity", "basics"),
        name=_text_value("name", basics.name, "basics"),
        headline=_text_value("headline", basics.headline, "basics"),
        contacts=contacts,
        avatar=avatar,
    )

    sections: list[ResumeSection] = []
    custom_by_id = {item.id: item for item in document.sections.custom_sections}
    collections = {
        "work_experiences": document.sections.work_experiences,
        "educations": document.sections.educations,
        "projects": document.sections.projects,
        "skills": document.sections.skills,
        "certificates": document.sections.certificates,
        "awards": document.sections.awards,
        "languages": document.sections.languages,
    }
    kind_map = {
        "work": "work",
        "education": "education",
        "project": "project",
        "skills": "skills",
        "certificates": "certificates",
        "awards": "awards",
        "languages": "languages",
        "profile": "profile",
        "activity": "activity",
        "interests": "interests",
        "custom": "custom",
    }
    for section_index, semantic in enumerate(document.semantic_sections):
        if semantic.semantic_kind == "basics":
            if basics.summary is not None:
                title, title_icon = _section_title(
                    semantic.display_title,
                    semantic.id,
                )
                sections.append(
                    ResumeSection(
                        node_id=_id("section", semantic.id),
                        source_refs=[],
                        semantic_kind="profile",
                        title=title,
                        title_icon=title_icon,
                        entries=[],
                        blocks=rich_text_blocks(basics.summary, seed=semantic.id),
                    )
                )
            continue
        raw_items = list(collections.get(semantic.content_key, []))
        if semantic.content_key == "custom_sections":
            raw_section = custom_by_id.get(semantic.custom_section_id or "")
            raw_items = list(raw_section.items) if raw_section else []
        entries: list[ResumeEntry] = []
        section_blocks: list[SimpleContentBlock | RowBlock] = []
        for item_index, item in enumerate(raw_items):
            seed = getattr(item, "id", f"{semantic.id}-{item_index}")
            fields = EntryFields(
                name=_text_value(
                    "field",
                    getattr(item, "name", None) or getattr(item, "title", None),
                    seed,
                    "name",
                ),
                organization=_text_value(
                    "field",
                    getattr(item, "organization", None)
                    or getattr(item, "institution", None)
                    or getattr(item, "issuer", None)
                    or getattr(item, "awarder", None),
                    seed,
                    "organization",
                ),
                role=_text_value(
                    "field",
                    getattr(item, "position", None)
                    or getattr(item, "role", None)
                    or getattr(item, "fluency", None),
                    seed,
                    "role",
                ),
                location=_text_value(
                    "field", getattr(item, "location", None), seed, "location"
                ),
                start_date=_text_value(
                    "field", getattr(item, "start_date", None), seed, "start"
                ),
                end_date=_text_value(
                    "field",
                    getattr(item, "end_date", None)
                    or ("至今" if getattr(item, "current", False) else None),
                    seed,
                    "end",
                ),
                url=_text_value("field", getattr(item, "url", None), seed, "url"),
                degree=_text_value(
                    "field", getattr(item, "study_type", None), seed, "degree"
                ),
                major=_text_value("field", getattr(item, "area", None), seed, "major"),
            )
            blocks = rich_text_blocks(
                getattr(item, "summary", None) or getattr(item, "content", None),
                seed=seed,
            )
            for highlight in getattr(item, "highlights", []):
                blocks.extend(rich_text_blocks(highlight.content, seed=highlight.id))
            extras = [
                getattr(item, "score", None),
                getattr(item, "level", None),
                getattr(item, "subtitle", None),
            ]
            keywords = getattr(item, "keywords", [])
            extras.extend(keywords)
            for extra_index, extra in enumerate(value for value in extras if value):
                blocks.append(
                    ParagraphBlock(
                        node_id=_id("paragraph", seed, "extra", extra_index),
                        source_refs=[],
                        block_type="paragraph",
                        runs=[_text_run(str(extra))],
                    )
                )
            entries.append(
                ResumeEntry(
                    node_id=_id("entry", seed),
                    source_refs=[],
                    fields=fields,
                    blocks=blocks,
                )
            )
        title, title_icon = _section_title(
            semantic.display_title,
            semantic.id,
        )
        sections.append(
            ResumeSection(
                node_id=_id("section", semantic.id, section_index),
                source_refs=[],
                semantic_kind=kind_map.get(semantic.semantic_kind, "custom"),
                title=title,
                title_icon=title_icon,
                entries=entries,
                blocks=section_blocks,
            )
        )
    return CanonicalResumeDocument(
        schema_version="canonical-resume.v1",
        document_id=_id("document", "legacy"),
        identity=identity,
        sections=sections,
        source_dispositions=[],
    )


def blank_canonical_document(*, seed: str) -> CanonicalResumeDocument:
    return CanonicalResumeDocument(
        schema_version="canonical-resume.v1",
        document_id=_id("document", "template", seed),
        identity=Identity(
            node_id=_id("identity", "template", seed),
            name=None,
            headline=None,
            contacts=[],
            avatar=None,
        ),
        sections=[],
        source_dispositions=[],
    )


__all__ = [
    "LegacyCutoverError",
    "blank_canonical_document",
    "convert_legacy_document",
    "convert_legacy_template",
    "presentation_for_legacy",
    "rich_text_blocks",
]
