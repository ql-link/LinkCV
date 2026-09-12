"""Deterministic source layout intermediate representation.

The import pipeline deliberately keeps the text returned by the document
converter separate from the semantic decisions made by a model.  This module
owns the former: it performs only small, deterministic formatting cleanups
and assigns stable source identifiers to the resulting blocks.

``SectionIR`` used to expose only a list of heading-sized fragments.  It is
kept as an alias of :class:`SourceLayoutIR` (and the old ``preamble`` /
``sections`` compatibility fields remain) so callers can migrate without a
flag day.  New code should use ``blocks`` and ``deterministic_discards``.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Literal

from markdown_it import MarkdownIt
from pydantic import BaseModel, ConfigDict, Field, model_validator

from linkcv.domain.import_warnings import ImportWarning

SECTION_ALIASES = {
    "work": {"工作经历", "工作经验", "职业经历", "任职经历", "实习经历", "experience"},
    "education": {"教育经历", "教育背景", "学历", "education"},
    "project": {"项目经历", "项目经验", "个人项目", "开源经历及个人作品", "projects"},
    "skills": {"专业技能", "技能清单", "技术栈", "skills"},
}

SOURCE_ID_PATTERN = re.compile(r"^src_[0-9]+_[a-z0-9]+$")

# Only these entities are known to be inserted by the document conversion
# chain as spacing artefacts.  In particular, do not call html.unescape:
# entities in a user's actual resume are content, not parser noise.
_SPACE_ENTITY_RE = re.compile(r"(?:&#x20;|&#32;|&nbsp;)", re.IGNORECASE)
_EMPTY_ENTITY_RE = re.compile(r"^(?:&#x20;|&#32;|&nbsp;)+$", re.IGNORECASE)

_ORDERED_MARKER_RE = re.compile(
    r"^(?P<indent>[ \t]*)(?P<number>[0-9]{1,5})"
    r"(?P<marker>[、．.\)）])(?P<space>[ \t]*)(?P<text>.*)$"
)
_COMMONMARK_ORDERED_RE = re.compile(
    r"^(?P<indent>[ \t]*)(?P<number>[0-9]{1,5})\. (?P<text>.*)$"
)
_BULLET_MARKER_RE = re.compile(r"^(?P<indent>[ \t]*)(?P<marker>[-*+•])(?P<space>[ \t]+)(?P<text>.*)$")
_DIVIDER_RE = re.compile(r"^\s*(?:---+|\*\*\*+|___+)\s*$")
_HEADING_RE = re.compile(r"^(?P<indent>\s{0,3})(?P<hashes>#{1,3})[ \t]+(?P<text>.+?)\s*$")

# LinkParse emits a small number of page/provenance markers.  Keep this
# intentionally narrow: a normal Markdown horizontal rule is a real source
# block and must not disappear.
_LINKPARSE_PAGE_RE = re.compile(
    r"^\s*(?:"
    r"<!--\s*(?:linkparse\s*[:_-]?\s*)?(?:page\s*(?:break|separator)?|page[-_ ]?\d+)[^>]*-->"
    r"|\[\[\s*(?:linkparse\s*[:_-]?\s*)?page[-_ ]?(?:break|separator|\d+)[^\]]*\]\]"
    r"|---\s*(?:page\s+\d+|第\s*\d+\s*页)\s*---"
    r")\s*$",
    re.IGNORECASE,
)
_LINKPARSE_PROVENANCE_RE = re.compile(
    r"^\s*(?:<!--\s*linkparse\s*[:_-]|\[//\]:\s*#\s*\(\s*linkparse\b)[^\n]*$",
    re.IGNORECASE,
)


class SourceSpan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_order(self) -> "SourceSpan":
        if self.end_line < self.start_line:
            raise ValueError("source span is reversed")
        return self


class SourceList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["ordered", "bullet"]
    start: int = Field(default=1, ge=1, le=10_000)
    index: int = Field(default=1, ge=1, le=10_000)
    depth: int = Field(default=0, ge=0, le=32)


class DiscardRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(pattern=SOURCE_ID_PATTERN.pattern)
    ordinal: int = Field(ge=0)
    source_span: SourceSpan
    reason_code: Literal[
        "whitespace_only",
        "linkparse_page_separator",
        "linkparse_provenance_marker",
        "empty_entity_spacer",
    ]

    @property
    def start_line(self) -> int:
        return self.source_span.start_line

    @property
    def end_line(self) -> int:
        return self.source_span.end_line


class SourceBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(pattern=SOURCE_ID_PATTERN.pattern)
    ordinal: int = Field(ge=0)
    block_type: Literal[
        "heading",
        "paragraph",
        "ordered_list_item",
        "bullet_list_item",
        "divider",
    ]
    markdown: str = Field(max_length=20_000)
    parent_section_id: str | None = Field(default=None, pattern=SOURCE_ID_PATTERN.pattern)
    heading_level: Literal[1, 2, 3] | None = None
    source_span: SourceSpan
    list: SourceList | None = None

    @model_validator(mode="after")
    def validate_shape(self) -> "SourceBlock":
        is_list = self.block_type in {"ordered_list_item", "bullet_list_item"}
        if is_list != (self.list is not None):
            raise ValueError("source list metadata must match block type")
        if self.block_type == "heading" and self.heading_level is None:
            raise ValueError("heading block requires heading_level")
        if self.block_type != "heading" and self.heading_level is not None:
            raise ValueError("non-heading block cannot have heading_level")
        if self.block_type == "heading" and self.parent_section_id == self.source_id:
            raise ValueError("heading cannot parent itself")
        return self

    @property
    def start_line(self) -> int:
        return self.source_span.start_line

    @property
    def end_line(self) -> int:
        return self.source_span.end_line


class SectionFragment(BaseModel):
    """Compatibility view retained for pre-canonical import callers."""

    model_config = ConfigDict(extra="forbid")

    id: str
    heading: str | None = None
    normalized_kind: Literal["work", "education", "project", "projects", "skills"] | None = None
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    markdown: str


class SourceLayoutIR(BaseModel):
    """Strict, ordered representation of converter output.

    The compatibility fields are intentionally not used for composition;
    they only let older worker adapters keep reading the old fragment view
    while they are migrated to ``blocks``.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1"] = "1"
    source_format: Literal["md", "docx", "pdf"] = "md"
    blocks: list[SourceBlock] = Field(default_factory=list, max_length=5_000)
    deterministic_discards: list[DiscardRecord] = Field(default_factory=list, max_length=5_000)
    warnings: list[str] = Field(default_factory=list, max_length=100)

    # Old SectionIR fields.  They are a read-only compatibility view in new
    # code and are ignored by the source closure checks.
    preamble: SectionFragment | None = None
    sections: list[SectionFragment] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def validate_closure(self) -> "SourceLayoutIR":
        records = [*self.blocks, *self.deterministic_discards]
        ids = [record.source_id for record in records]
        if len(ids) != len(set(ids)):
            raise ValueError("source ids must be unique across blocks and discards")
        ordinals = [record.ordinal for record in records]
        if len(ordinals) != len(set(ordinals)):
            raise ValueError("source ordinals must be unique across blocks and discards")
        block_by_id = {block.source_id: block for block in self.blocks}
        for block in self.blocks:
            if block.parent_section_id is not None:
                parent = block_by_id.get(block.parent_section_id)
                if parent is None or parent.block_type != "heading":
                    raise ValueError("source block parent must reference a heading")
                if parent.ordinal >= block.ordinal:
                    raise ValueError("source block parent must appear earlier")
        return self

    @property
    def source_blocks(self) -> list[SourceBlock]:
        return self.blocks

    @property
    def source_ids(self) -> set[str]:
        return {record.source_id for record in [*self.blocks, *self.deterministic_discards]}


# New and old type names intentionally point at one strict DTO.  This avoids
# silently accepting a weaker old representation in one half of the import
# pipeline.
SectionIR = SourceLayoutIR
SourceRange = SourceSpan
SourceListMetadata = SourceList


def _normalize_heading(heading: str) -> str | None:
    candidate = heading.strip().lower()
    for kind, aliases in SECTION_ALIASES.items():
        if candidate in {alias.lower() for alias in aliases}:
            return kind
    return None


def _fragment(
    *,
    fragment_id: str,
    lines: list[str],
    start: int,
    end: int,
    heading: str | None,
) -> SectionFragment:
    return SectionFragment(
        id=fragment_id,
        heading=heading,
        normalized_kind=_normalize_heading(heading) if heading else None,
        start_line=start + 1,
        end_line=max(start + 1, end),
        markdown="\n".join(lines[start:end]).strip(),
    )


def _source_id(
    *,
    document_digest: str,
    ordinal: int,
    start_line: int,
    end_line: int,
    markdown: str,
) -> str:
    # Include the normalized document digest as well as the local block
    # fingerprint.  The ordinal prevents equal text at different positions
    # from colliding, while the digest keeps IDs stable for the same input.
    local = hashlib.sha256(
        f"{document_digest}:{ordinal}:{start_line}:{end_line}:{markdown}".encode("utf-8")
    ).hexdigest()[:12]
    return f"src_{ordinal}_{local}"


def _replace_known_entities(line: str) -> str:
    return _SPACE_ENTITY_RE.sub(" ", line)


def clean_source_markdown(markdown: str) -> str:
    """Apply only the import-safe deterministic text cleanups.

    This helper deliberately does not HTML-unescape arbitrary entities.  It
    is public so a converter adapter and tests can use the same rule as IR
    construction.
    """

    value = unicodedata.normalize("NFC", markdown).replace("\r\n", "\n").replace("\r", "\n")
    lines = [_replace_known_entities(line).rstrip() for line in value.split("\n")]
    return "\n".join(lines).strip()


def _indent_depth(indent: str) -> int:
    width = len(indent.expandtabs(4))
    return 0 if width == 0 else max(1, (width + 3) // 4)


def _normalize_repeated_prefix(line: str) -> str:
    """Remove only adjacent, visibly repeated list markers."""

    # ``- - text`` is a common conversion artefact.  Whitespace after each
    # marker is required so values such as ``-1°C`` remain ordinary text.
    bullet = re.match(r"^(?P<indent>[ \t]*)(?P<marker>[-*+•])\s+(?P<rest>.*)$", line)
    if bullet:
        indent, marker, rest = bullet.group("indent", "marker", "rest")
        while True:
            repeated = re.match(rf"^(?:{re.escape(marker)})\s+(?P<tail>.*)$", rest)
            if not repeated:
                break
            rest = repeated.group("tail")
        return f"{indent}{marker} {rest}"

    ordered = re.match(
        r"^(?P<indent>[ \t]*)(?P<number>[0-9]{1,5})(?P<marker>[、．.\)）])\s+(?P<rest>.*)$",
        line,
    )
    if ordered:
        indent, number, marker, rest = ordered.group("indent", "number", "marker", "rest")
        while True:
            repeated = re.match(
                rf"^(?:{re.escape(number)}[、．.\)）])\s+(?P<tail>.*)$", rest
            )
            if not repeated:
                break
            rest = repeated.group("tail")
        return f"{indent}{number}{marker} {rest}"
    return line


def _ordered_match(line: str) -> re.Match[str] | None:
    match = _ORDERED_MARKER_RE.match(line) or _COMMONMARK_ORDERED_RE.match(line)
    # A dot without a following space is normally a decimal/version token,
    # not a Markdown list marker (``2024.10`` must remain a paragraph).
    if (
        match
        and match.groupdict().get("marker") == "."
        and not match.groupdict().get("space")
    ):
        return None
    return match


def _bullet_match(line: str) -> re.Match[str] | None:
    return _BULLET_MARKER_RE.match(line)


def _heading_match(line: str) -> re.Match[str] | None:
    return _HEADING_RE.match(line)


def _build_blocks(markdown: str) -> tuple[list[SourceBlock], list[DiscardRecord]]:
    value = unicodedata.normalize("NFC", markdown).replace("\r\n", "\n").replace("\r", "\n")
    original_lines = value.split("\n")
    lines = [_replace_known_entities(line).rstrip() for line in original_lines]
    digest = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:12]

    blocks: list[SourceBlock] = []
    discards: list[DiscardRecord] = []
    heading_stack: list[tuple[int, str]] = []
    ordinal = 0
    index = 0
    list_state: dict[tuple[str, int, str | None], tuple[int, int]] = {}

    def add_discard(start: int, end: int, reason: str) -> None:
        nonlocal ordinal
        span = SourceSpan(start_line=start + 1, end_line=end)
        source_id = _source_id(
            document_digest=digest,
            ordinal=ordinal,
            start_line=span.start_line,
            end_line=span.end_line,
            markdown="",
        )
        discards.append(
            DiscardRecord(
                source_id=source_id,
                ordinal=ordinal,
                source_span=span,
                reason_code=reason,  # type: ignore[arg-type]
            )
        )
        ordinal += 1

    def add_block(
        *,
        start: int,
        end: int,
        block_type: Literal[
            "heading", "paragraph", "ordered_list_item", "bullet_list_item", "divider"
        ],
        block_markdown: str,
        parent_id: str | None,
        heading_level: Literal[1, 2, 3] | None = None,
        list_meta: SourceList | None = None,
    ) -> SourceBlock:
        nonlocal ordinal
        span = SourceSpan(start_line=start + 1, end_line=end)
        source_id = _source_id(
            document_digest=digest,
            ordinal=ordinal,
            start_line=span.start_line,
            end_line=span.end_line,
            markdown=block_markdown,
        )
        block = SourceBlock(
            source_id=source_id,
            ordinal=ordinal,
            block_type=block_type,
            markdown=block_markdown,
            parent_section_id=parent_id,
            heading_level=heading_level,
            source_span=span,
            list=list_meta,
        )
        blocks.append(block)
        ordinal += 1
        return block

    while index < len(lines):
        line = lines[index]
        stripped_original = original_lines[index].strip()
        stripped = line.strip()
        if not stripped:
            reason = "empty_entity_spacer" if _EMPTY_ENTITY_RE.fullmatch(stripped_original) else "whitespace_only"
            add_discard(index, index + 1, reason)
            index += 1
            list_state.clear()
            continue
        if _LINKPARSE_PAGE_RE.fullmatch(line):
            add_discard(index, index + 1, "linkparse_page_separator")
            index += 1
            list_state.clear()
            continue
        if _LINKPARSE_PROVENANCE_RE.fullmatch(line):
            add_discard(index, index + 1, "linkparse_provenance_marker")
            index += 1
            list_state.clear()
            continue

        heading = _heading_match(line)
        if heading:
            level = len(heading.group("hashes"))
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            parent_id = heading_stack[-1][1] if heading_stack else None
            block = add_block(
                start=index,
                end=index + 1,
                block_type="heading",
                block_markdown=line.strip(),
                parent_id=parent_id,
                heading_level=level,  # type: ignore[arg-type]
            )
            heading_stack.append((level, block.source_id))
            index += 1
            list_state.clear()
            continue

        normalized_line = _normalize_repeated_prefix(line)
        ordered = _ordered_match(normalized_line)
        bullet = _bullet_match(normalized_line)
        if ordered or bullet:
            if ordered:
                number = int(ordered.group("number"))
                indent = ordered.group("indent")
                depth = _indent_depth(indent)
                key = ("ordered", depth, heading_stack[-1][1] if heading_stack else None)
                previous = list_state.get(key)
                if previous is None or number != previous[1] + 1:
                    start_number = number
                else:
                    start_number = previous[0]
                list_state[key] = (start_number, number)
                list_meta = SourceList(
                    kind="ordered", start=start_number, index=number, depth=depth
                )
                block_type: Literal["ordered_list_item", "bullet_list_item"] = "ordered_list_item"
            else:
                indent = bullet.group("indent")
                depth = _indent_depth(indent)
                key = ("bullet", depth, heading_stack[-1][1] if heading_stack else None)
                previous = list_state.get(key)
                bullet_index = 1 if previous is None else previous[1] + 1
                list_state[key] = (1, bullet_index)
                list_meta = SourceList(kind="bullet", start=1, index=bullet_index, depth=depth)
                block_type = "bullet_list_item"
            # Canonicalize all list markers to CommonMark while keeping the
            # source indentation needed for nested list reconstruction.
            indent = ordered.group("indent") if ordered else bullet.group("indent")  # type: ignore[union-attr]
            text = ordered.group("text") if ordered else bullet.group("text")  # type: ignore[union-attr]
            marker = f"{list_meta.index}." if ordered else "-"
            canonical = f"{indent}{marker} {text.strip()}"
            add_block(
                start=index,
                end=index + 1,
                block_type=block_type,
                block_markdown=canonical,
                parent_id=heading_stack[-1][1] if heading_stack else None,
                list_meta=list_meta,
            )
            index += 1
            continue

        if _DIVIDER_RE.fullmatch(stripped):
            add_block(
                start=index,
                end=index + 1,
                block_type="divider",
                block_markdown=stripped,
                parent_id=heading_stack[-1][1] if heading_stack else None,
            )
            index += 1
            list_state.clear()
            continue

        # A paragraph may span physical lines.  Stop before any source-level
        # structure so each heading/list/divider can retain its own mapping.
        start = index
        paragraph_lines = [lines[index].strip()]
        index += 1
        while index < len(lines):
            candidate = lines[index]
            if (
                not candidate.strip()
                or _LINKPARSE_PAGE_RE.fullmatch(candidate)
                or _LINKPARSE_PROVENANCE_RE.fullmatch(candidate)
                or _heading_match(candidate)
                or _ordered_match(_normalize_repeated_prefix(candidate))
                or _bullet_match(_normalize_repeated_prefix(candidate))
                or _DIVIDER_RE.fullmatch(candidate.strip())
            ):
                break
            paragraph_lines.append(candidate.rstrip())
            index += 1
        add_block(
            start=start,
            end=index,
            block_type="paragraph",
            block_markdown="\n".join(paragraph_lines).strip(),
            parent_id=heading_stack[-1][1] if heading_stack else None,
        )
        list_state.clear()

    return blocks, discards


def build_source_layout_ir(
    markdown: str,
    *,
    source_format: Literal["md", "docx", "pdf"] = "md",
) -> SourceLayoutIR:
    """Build the strict source IR and its compatibility fragment view."""

    normalized = clean_source_markdown(markdown)
    lines = normalized.splitlines()
    blocks, discards = _build_blocks(markdown)
    tokens = MarkdownIt("commonmark", {"html": False}).parse(normalized)
    headings: list[tuple[int, str]] = []
    for token_index, token in enumerate(tokens):
        if (
            token.type != "heading_open"
            or token.tag not in {"h1", "h2", "h3"}
            or token.map is None
        ):
            continue
        inline = tokens[token_index + 1] if token_index + 1 < len(tokens) else None
        heading = inline.content.strip() if inline and inline.type == "inline" else ""
        headings.append((token.map[0], heading))

    warnings: list[str] = []
    if not headings:
        if normalized.strip():
            sections = [
                _fragment(
                    fragment_id="section-1",
                    lines=lines,
                    start=0,
                    end=len(lines),
                    heading=None,
                )
            ]
        else:
            sections = []
        warnings.append(ImportWarning.DOCUMENT_HEADING_STRUCTURE_MISSING.value)
        return SourceLayoutIR(
            source_format=source_format,
            blocks=blocks,
            deterministic_discards=discards,
            warnings=warnings,
            sections=sections,
        )

    preamble = None
    if headings[0][0] > 0 and any(line.strip() for line in lines[: headings[0][0]]):
        preamble = _fragment(
            fragment_id="preamble",
            lines=lines,
            start=0,
            end=headings[0][0],
            heading=None,
        )

    sections: list[SectionFragment] = []
    for section_index, (start, heading) in enumerate(headings):
        end = headings[section_index + 1][0] if section_index + 1 < len(headings) else len(lines)
        sections.append(
            _fragment(
                fragment_id=f"section-{section_index + 1}",
                lines=lines,
                start=start,
                end=end,
                heading=heading,
            )
        )
    return SourceLayoutIR(
        source_format=source_format,
        blocks=blocks,
        deterministic_discards=discards,
        warnings=warnings,
        preamble=preamble,
        sections=sections,
    )


def build_section_ir(
    markdown: str,
    *,
    source_format: Literal["md", "docx", "pdf"] = "md",
) -> SectionIR:
    """Backward-compatible name for :func:`build_source_layout_ir`."""

    return build_source_layout_ir(markdown, source_format=source_format)


__all__ = [
    "DiscardRecord",
    "SectionFragment",
    "SectionIR",
    "SourceBlock",
    "SourceLayoutIR",
    "SourceList",
    "SourceListMetadata",
    "SourceRange",
    "SourceSpan",
    "build_section_ir",
    "build_source_layout_ir",
    "clean_source_markdown",
]
