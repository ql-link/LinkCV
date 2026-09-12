"""Canonical composition for source-faithful resume imports.

This module is the boundary between untrusted source text plus model layout
decisions and the existing :class:`ResumeDocument` contract.  It never uses
model-produced text: every visible character is copied from a validated
``SourceBlock`` (apart from deterministic Markdown layout markers and the
fixed block anchor).  The resulting document uses only ``custom_sections`` so
the persisted semantic order remains the source order rather than the legacy
typed-section order.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re
from typing import Iterable, Literal, Sequence

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from linkcv.domain.resume_document import (
    CustomItem,
    CustomSection,
    ResumeBasics,
    ResumeDocument,
    ResumeSections,
    RichText,
    SemanticSection,
    SourceRef,
)
from linkcv.domain.resume_extraction import (
    LayoutGroup,
    ResumeExtractionDraft,
    StructureDecision,
)
from linkcv.domain.section_ir import SourceBlock, SourceLayoutIR, SourceList


class ResumeImportCompositionError(ValueError):
    """A source mapping/layout cannot be composed without losing content."""

    def __init__(self, message: str, *, code: str = "RESUME_STRUCTURE_INVALID") -> None:
        super().__init__(message)
        self.code = code


class ImportLayoutRecipe(BaseModel):
    """Deterministic content layout selected from template context."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("key", "template_key"),
    )
    renderer: Literal["flow", "columns"] = Field(
        validation_alias=AliasChoices("renderer", "renderer_key"),
    )
    contact_mode: Literal["inline", "stacked"] = "inline"
    contact_separator: str = Field(default="  ·  ", max_length=40)
    entry_header_mode: Literal["left_right", "stacked"] = "stacked"
    list_output: Literal["commonmark"] = "commonmark"

    @property
    def template_key(self) -> str:
        return self.key

    @property
    def renderer_key(self) -> str:
        return self.renderer


CLASSIC_TECHNICAL_RECIPE = ImportLayoutRecipe(
    key="classic-technical-cn",
    renderer="flow",
    contact_mode="inline",
    contact_separator="  ·  ",
    entry_header_mode="left_right",
    list_output="commonmark",
)


def recipe_for_template(
    template_key: str | None = None,
    *,
    renderer: Literal["flow", "columns"] = "flow",
) -> ImportLayoutRecipe:
    """Return a recipe without inspecting template example content."""

    key = (template_key or "classic-technical-cn").strip() or "classic-technical-cn"
    if key == "classic-technical-cn":
        return CLASSIC_TECHNICAL_RECIPE.model_copy()
    if renderer == "columns":
        return ImportLayoutRecipe(
            key=key,
            renderer="columns",
            contact_mode="inline",
            contact_separator="  ·  ",
            entry_header_mode="left_right",
            list_output="commonmark",
        )
    return ImportLayoutRecipe(
        key=key,
        renderer="flow",
        contact_mode="inline",
        contact_separator="  ·  ",
        entry_header_mode="stacked",
        list_output="commonmark",
    )


get_import_layout_recipe = recipe_for_template


@dataclass(frozen=True)
class CanonicalImportResult:
    document: ResumeDocument
    accepted_source_ids: tuple[str, ...]
    discarded_source_ids: tuple[str, ...]
    warnings: tuple[str, ...] = ()


def _stable_id(prefix: str, *values: str) -> str:
    digest = hashlib.sha256("|".join(values).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def _decision_values(extraction: ResumeExtractionDraft) -> tuple[list[StructureDecision], list[LayoutGroup]]:
    try:
        return extraction.decisions, extraction.groups
    except AttributeError as error:
        raise ResumeImportCompositionError("structure result is not a source mapping") from error


def _heading_anchor_map(
    blocks: Sequence[SourceBlock],
    decisions: dict[str, StructureDecision],
) -> tuple[dict[str, str], set[str]]:
    """Resolve every source heading to its nearest semantic section anchor.

    A root heading starts a section.  A nested heading starts a new section
    only when its semantic kind differs from the nearest parent anchor;
    otherwise it remains visible content inside that parent section.  This
    keeps common ``## 项目经历`` / ``### 项目名称`` hierarchies intact instead
    of flattening every entry heading into a top-level template section.
    """

    anchor_by_heading: dict[str, str] = {}
    anchor_ids: set[str] = set()
    for block in blocks:
        if block.block_type != "heading":
            continue
        parent_anchor = (
            anchor_by_heading.get(block.parent_section_id)
            if block.parent_section_id is not None
            else None
        )
        if (
            parent_anchor is None
            or decisions[parent_anchor].semantic_kind
            != decisions[block.source_id].semantic_kind
        ):
            parent_anchor = block.source_id
            anchor_ids.add(block.source_id)
        anchor_by_heading[block.source_id] = parent_anchor
    return anchor_by_heading, anchor_ids


def validate_source_closure(
    source_ir: SourceLayoutIR,
    extraction: ResumeExtractionDraft,
) -> tuple[dict[str, StructureDecision], dict[str, LayoutGroup]]:
    """Validate the exactly-once source closure before rendering any text."""

    blocks = sorted(source_ir.blocks, key=lambda block: block.ordinal)
    source_ids = {block.source_id for block in blocks}
    decisions, groups = _decision_values(extraction)
    decision_ids = [decision.source_id for decision in decisions]
    if len(decision_ids) != len(set(decision_ids)):
        raise ResumeImportCompositionError("a source block has multiple structure decisions")
    if any(source_id not in source_ids for source_id in decision_ids):
        raise ResumeImportCompositionError("structure decision references an unknown source block")
    if set(decision_ids) != source_ids:
        raise ResumeImportCompositionError("source blocks are not covered exactly once")
    by_id = {decision.source_id: decision for decision in decisions}
    ordinal_by_id = {block.source_id: block.ordinal for block in blocks}
    block_by_id = {block.source_id: block for block in blocks}

    contact_roles = {
        "contact_row",
        "contact_phone",
        "contact_email",
        "contact_location",
        "contact_link",
    }
    for decision in decisions:
        block = block_by_id[decision.source_id]
        if decision.layout_role == "name":
            if decision.semantic_kind != "basics":
                raise ResumeImportCompositionError("name source block must belong to basics")
            if block.block_type not in {"heading", "paragraph"}:
                raise ResumeImportCompositionError("name source block must be heading or paragraph")
            if block.block_type == "heading" and block.heading_level != 1:
                raise ResumeImportCompositionError("name heading must be level one")
        if decision.layout_role in contact_roles:
            if decision.semantic_kind != "basics":
                raise ResumeImportCompositionError("contact source block must belong to basics")
            if block.block_type not in {
                "paragraph",
                "ordered_list_item",
                "bullet_list_item",
            }:
                raise ResumeImportCompositionError("contact source block must be paragraph or list item")
        if decision.layout_role == "section_heading" and block.block_type != "heading":
            raise ResumeImportCompositionError("section heading decision must reference a heading")
        if decision.layout_role == "entry_header":
            if decision.semantic_kind == "basics" or block.block_type != "paragraph":
                raise ResumeImportCompositionError(
                    "entry header must be a non-basics paragraph"
                )
            if _split_entry_header(block.markdown) is None:
                raise ResumeImportCompositionError(
                    "entry header requires a deterministic source separator"
                )
        if decision.layout_role in {"entry_left", "entry_right"} and block.block_type != "paragraph":
            raise ResumeImportCompositionError("entry side decision must reference a paragraph")
        if block.block_type == "heading" and decision.layout_role not in {"name", "section_heading"}:
            raise ResumeImportCompositionError("heading decision must identify a section or name")

    grouped: dict[str, LayoutGroup] = {}
    member_owner: dict[str, str] = {}
    for group_index, group in enumerate(groups):
        members = list(group.member_source_ids)
        if len(members) < 2:
            raise ResumeImportCompositionError("layout group needs independent source blocks")
        if len(members) != len(set(members)):
            raise ResumeImportCompositionError("layout group repeats a source block")
        if any(source_id not in source_ids for source_id in members):
            raise ResumeImportCompositionError("layout group references an unknown source block")
        if members != sorted(members, key=ordinal_by_id.__getitem__):
            raise ResumeImportCompositionError("layout group members are not in source order")
        member_blocks = [
            next(block for block in blocks if block.source_id == source_id)
            for source_id in members
        ]
        member_positions = [
            next(
                position
                for position, block in enumerate(blocks)
                if block.source_id == source_id
            )
            for source_id in members
        ]
        if member_positions != list(
            range(member_positions[0], member_positions[0] + len(member_positions))
        ):
            raise ResumeImportCompositionError(
                "layout group members must be contiguous source blocks"
            )
        if len({block.parent_section_id for block in member_blocks}) != 1:
            raise ResumeImportCompositionError(
                "layout group must stay within one source section"
            )
        if group.role == "entry_row" and len(members) != 2:
            raise ResumeImportCompositionError("entry row must contain two source blocks")
        if group.role == "entry_row":
            left, right = (by_id[source_id] for source_id in members)
            if (left.layout_role, right.layout_role) != ("entry_left", "entry_right"):
                raise ResumeImportCompositionError(
                    "entry row must identify left and right source blocks"
                )
            if left.semantic_kind != right.semantic_kind:
                raise ResumeImportCompositionError(
                    "entry row must keep one semantic section"
                )
            if left.semantic_kind == "basics":
                raise ResumeImportCompositionError("entry row cannot belong to basics")
        if group.role == "contact_row" and any(
            by_id[source_id].semantic_kind != "basics" for source_id in members
        ):
            raise ResumeImportCompositionError("contact row contains a non-basics source block")
        if group.role == "contact_row" and any(
            by_id[source_id].layout_role
            not in {
                "contact_row",
                "contact_phone",
                "contact_email",
                "contact_location",
                "contact_link",
            }
            for source_id in members
        ):
            raise ResumeImportCompositionError("contact row contains a non-contact source block")
        group_id = f"group_{group_index}"
        for source_id in members:
            if source_id in member_owner:
                raise ResumeImportCompositionError("source block belongs to multiple layout groups")
            member_owner[source_id] = group_id
        grouped[group_id] = group
    entry_group_members = {
        source_id
        for group in grouped.values()
        if group.role == "entry_row"
        for source_id in group.member_source_ids
    }
    if any(
        decision.layout_role in {"entry_left", "entry_right"}
        and decision.source_id not in entry_group_members
        for decision in decisions
    ):
        raise ResumeImportCompositionError(
            "entry side source blocks require an entry_row group"
        )

    basics = [decision for decision in decisions if decision.semantic_kind == "basics"]
    contact_ids = {
        decision.source_id
        for decision in basics
        if decision.layout_role in contact_roles
    }
    contact_groups = [
        set(group.member_source_ids)
        for group in grouped.values()
        if group.role == "contact_row"
    ]
    if len(contact_ids) > 1 and contact_groups != [contact_ids]:
        raise ResumeImportCompositionError(
            "multiple contact source blocks require one contact_row group"
        )
    name_decisions = [decision for decision in basics if decision.layout_role == "name"]
    if len(name_decisions) > 1:
        raise ResumeImportCompositionError("basics must contain one unique name source block")
    if not basics:
        raise ResumeImportCompositionError("structure mapping is missing the basics source block")
    _, heading_anchor_ids = _heading_anchor_map(blocks, by_id)
    basics_heading_anchors = {
        source_id
        for source_id in heading_anchor_ids
        if by_id[source_id].semantic_kind == "basics"
    }
    synthetic_basics_anchor_count = sum(
        1
        for decision in name_decisions
        if block_by_id[decision.source_id].block_type != "heading"
    )
    if len(basics_heading_anchors) + synthetic_basics_anchor_count > 1:
        raise ResumeImportCompositionError("basics must contain one source section anchor")
    if not name_decisions:
        name_candidates = [
            decision
            for decision in basics
            if decision.layout_role == "section_heading"
            and next(block for block in blocks if block.source_id == decision.source_id).heading_level == 1
        ]
        if len(name_candidates) != 1:
            raise ResumeImportCompositionError("structure mapping is missing a unique name source block")
    return by_id, grouped


def _heading_text(markdown: str) -> str:
    return re.sub(r"^\s*#{1,3}[ \t]+", "", markdown, count=1).strip()


def _contact_text(block: SourceBlock) -> str:
    # A contact item that came through as a bullet must not remain a list in
    # the canonical contact paragraph.  The marker itself is deterministic
    # parser syntax, not user content.
    if block.list is not None:
        return re.sub(
            r"^\s*(?:[-*+•]|[0-9]{1,5}[、．.\)）])\s*",
            "",
            block.markdown,
            count=1,
        ).strip()
    return block.markdown.strip()


_ENTRY_SEPARATOR_RE = re.compile(r"\s+[|│]\s+|\s*｜\s*")


def _split_entry_header(markdown: str) -> tuple[str, str] | None:
    match = _ENTRY_SEPARATOR_RE.search(markdown)
    if not match:
        return None
    left = markdown[: match.start()].strip()
    right = markdown[match.end() :].strip()
    if not left or not right:
        return None
    return left, right


def _source_ref(block: SourceBlock, *, field: str = "import") -> SourceRef:
    return SourceRef(
        field=field,
        start_line=block.source_span.start_line,
        end_line=block.source_span.end_line,
        quote=block.markdown[:1_000] or "[source block]",
    )


def _refs(blocks: Iterable[SourceBlock], *, field: str = "import") -> list[SourceRef]:
    return [_source_ref(block, field=field) for block in blocks]


def _item(
    *,
    item_key: str,
    content: str,
    blocks: Sequence[SourceBlock],
    field: str = "import",
) -> CustomItem:
    return CustomItem(
        id=_stable_id("item", item_key),
        content=RichText(content=content),
        source_refs=_refs(blocks, field=field),
    )


@dataclass
class _SectionBuild:
    anchor: SourceBlock | None
    decision: StructureDecision
    blocks: list[SourceBlock]


def _section_key(block: SourceBlock, decision: StructureDecision) -> str:
    if block.block_type == "heading":
        return block.source_id
    return f"preamble:{block.source_id}"


def _find_name_decision(
    blocks: Sequence[SourceBlock],
    decisions: dict[str, StructureDecision],
) -> StructureDecision:
    named = [
        decision
        for decision in decisions.values()
        if decision.layout_role == "name" and decision.semantic_kind == "basics"
    ]
    if len(named) == 1:
        return named[0]
    candidates = [
        decision
        for decision in decisions.values()
        if decision.semantic_kind == "basics"
        and decision.layout_role == "section_heading"
        and next(block for block in blocks if block.source_id == decision.source_id).heading_level == 1
    ]
    if len(candidates) != 1:
        raise ResumeImportCompositionError("structure mapping is missing a unique name source block")
    return candidates[0]


def _build_sections(
    blocks: Sequence[SourceBlock],
    decisions: dict[str, StructureDecision],
) -> list[_SectionBuild]:
    by_id = {block.source_id: block for block in blocks}
    anchor_by_heading, heading_anchor_ids = _heading_anchor_map(blocks, decisions)
    sections: dict[str, _SectionBuild] = {}
    for block in blocks:
        if block.source_id in heading_anchor_ids:
            decision = decisions[block.source_id]
            sections[block.source_id] = _SectionBuild(anchor=block, decision=decision, blocks=[])
    basics_decision = _find_name_decision(blocks, decisions)
    basics_block = by_id[basics_decision.source_id]
    basics_key = basics_block.source_id if basics_block.block_type == "heading" else f"preamble:{basics_block.source_id}"
    if basics_key not in sections:
        sections[basics_key] = _SectionBuild(anchor=None, decision=basics_decision, blocks=[])

    for block in blocks:
        if block.source_id in heading_anchor_ids:
            # An anchor heading is section metadata (or the basics name) and
            # is accounted for separately by the composer.  Same-semantic
            # nested headings are not anchors and remain visible items below.
            continue
        if block.source_id == basics_decision.source_id:
            # A heading-less import may identify a name in a paragraph.  Keep
            # that block in the synthetic basics section even if the source
            # scanner attached it to a preceding heading.
            key = basics_key
        elif block.block_type == "heading":
            key = anchor_by_heading[block.source_id]
        elif block.parent_section_id:
            key = anchor_by_heading[block.parent_section_id]
        else:
            key = basics_key
        sections[key].blocks.append(block)

    # A source heading's own section key should follow its source order;
    # preamble/synthetic basics is placed at the first source position.
    def order(section: _SectionBuild) -> int:
        if section.anchor is not None:
            return section.anchor.ordinal
        return min((block.ordinal for block in section.blocks), default=0)

    return sorted(sections.values(), key=order)


def _group_by_member(groups: dict[str, LayoutGroup]) -> dict[str, LayoutGroup]:
    result: dict[str, LayoutGroup] = {}
    for group in groups.values():
        for source_id in group.member_source_ids:
            result[source_id] = group
    return result


def _group_content(
    group: LayoutGroup,
    members: Sequence[SourceBlock],
    *,
    recipe: ImportLayoutRecipe,
) -> str:
    if group.role == "contact_row":
        separator = recipe.contact_separator if recipe.contact_mode == "inline" else "\n\n"
        return separator.join(_contact_text(block) for block in members)
    if recipe.entry_header_mode != "left_right":
        return "\n\n".join(block.markdown for block in members)
    return (
        f"::: left\n{members[0].markdown.strip()}\n:::\n\n"
        f"::: right\n{members[1].markdown.strip()}\n:::"
    )


_CANONICAL_ORDERED_ITEM_RE = re.compile(r"^[0-9]{1,5}\.\s+(?P<text>.*)$")
_CANONICAL_BULLET_ITEM_RE = re.compile(r"^[-*+]\s+(?P<text>.*)$")
_MAX_SOURCE_REFS_PER_ITEM = 50


def _list_item_text(block: SourceBlock) -> str:
    """Return the source text without the deterministic list marker."""

    value = block.markdown.lstrip()
    pattern = (
        _CANONICAL_ORDERED_ITEM_RE
        if block.list is not None and block.list.kind == "ordered"
        else _CANONICAL_BULLET_ITEM_RE
    )
    match = pattern.match(value)
    return match.group("text").strip() if match else value.strip()


def _commonmark_list_content(blocks: Sequence[SourceBlock]) -> str:
    """Render flat source list blocks as parseable nested CommonMark.

    ``SourceList.depth`` is deliberately retained independently of the
    source indentation.  Re-emitting four spaces per depth gives Markdown
    parsers an unambiguous nesting boundary even when the converter used two
    spaces or tabs.  A blank line before a nested list is important for an
    ordered child whose first number is not ``1``: without it CommonMark can
    treat that line as continuation text in the parent item.
    """

    lines: list[str] = []
    previous: SourceBlock | None = None
    last_by_kind_and_depth: dict[tuple[str, int], SourceList] = {}
    for block in blocks:
        metadata = block.list
        if metadata is None:
            raise ResumeImportCompositionError("list item is missing source list metadata")
        if previous is not None:
            previous_list = previous.list
            assert previous_list is not None
            source_gap = block.source_span.start_line > previous.source_span.end_line + 1
            previous_same_level = last_by_kind_and_depth.get(
                (metadata.kind, metadata.depth)
            )
            starts_new_run = previous_same_level is not None and (
                metadata.start != previous_same_level.start
            )
            changes_kind_at_level = (
                metadata.depth == previous_list.depth
                and metadata.kind != previous_list.kind
            )
            enters_nested_list = metadata.depth > previous_list.depth
            if source_gap or starts_new_run or changes_kind_at_level or enters_nested_list:
                # This creates an unambiguous nested-list boundary and
                # separates independently numbered/type-switched source runs.
                lines.append("")
        indent = "    " * metadata.depth
        marker = f"{metadata.index}." if metadata.kind == "ordered" else "-"
        lines.append(f"{indent}{marker} {_list_item_text(block)}")
        last_by_kind_and_depth[(metadata.kind, metadata.depth)] = metadata
        previous = block
    return "\n".join(lines)


def _source_ref_safe_list_chunks(
    blocks: Sequence[SourceBlock],
) -> Iterable[Sequence[SourceBlock]]:
    """Split long lists without separating a normal nested subtree.

    Prefer a boundary immediately before a depth-zero item.  Thus when the
    nominal 50-block boundary falls between a parent and its nested children,
    the parent moves into the next chunk with those children.  A single subtree
    larger than the source-reference limit cannot be represented across two
    independent rich-text items without inventing or duplicating a parent, so
    it is rejected instead of being silently rendered as an indented code block.
    """

    start = 0
    while start < len(blocks):
        end = min(start + _MAX_SOURCE_REFS_PER_ITEM, len(blocks))
        if end < len(blocks):
            safe_end = end
            while safe_end > start:
                metadata = blocks[safe_end].list
                if metadata is not None and metadata.depth == 0:
                    break
                safe_end -= 1
            if safe_end == start:
                raise ResumeImportCompositionError(
                    "one nested list subtree exceeds the source reference limit",
                    code="RESUME_LAYOUT_UNSUPPORTED",
                )
            end = safe_end
        yield blocks[start:end]
        start = end


def _append_source_items(
    section: _SectionBuild,
    *,
    decisions: dict[str, StructureDecision],
    groups: dict[str, LayoutGroup],
    recipe: ImportLayoutRecipe,
    consumed: set[str],
) -> list[CustomItem]:
    block_by_id = {block.source_id: block for block in section.blocks}
    grouped = _group_by_member(groups)
    items: list[CustomItem] = []
    index = 0
    while index < len(section.blocks):
        block = section.blocks[index]
        if block.source_id in consumed:
            index += 1
            continue
        group = grouped.get(block.source_id)
        if group is not None:
            members = [block_by_id.get(source_id) for source_id in group.member_source_ids]
            if any(member is None for member in members):
                raise ResumeImportCompositionError("layout group crosses section boundaries")
            actual_members = [member for member in members if member is not None]
            content = _group_content(group, actual_members, recipe=recipe)
            items.append(
                _item(
                    item_key="group:" + ":".join(group.member_source_ids),
                    content=content,
                    blocks=actual_members,
                    field="contact_row" if group.role == "contact_row" else "entry_row",
                )
            )
            consumed.update(group.member_source_ids)
            index += 1
            continue

        decision = decisions[block.source_id]
        if decision.layout_role in {
            "contact_row",
            "contact_phone",
            "contact_email",
            "contact_location",
            "contact_link",
        } and section.decision.semantic_kind == "basics":
            # A single source paragraph is already a complete contact row.
            # Independent paragraphs may be merged only when the model has
            # explicitly supplied a validated contact_row group; otherwise
            # preserving one item per source block avoids inventing a row.
            content = _contact_text(block)
            items.append(
                _item(
                    item_key="contact:" + block.source_id,
                    content=content,
                    blocks=[block],
                    field="contact_row",
                )
            )
            consumed.add(block.source_id)
            index += 1
            continue

        # Adjacent list items are one logical rich-text item.  Keeping their
        # CommonMark markers and indentation lets the existing editor/parser
        # retain ordered starts and nested list depth.
        if block.list is not None:
            list_blocks = [block]
            cursor = index + 1
            while cursor < len(section.blocks):
                candidate = section.blocks[cursor]
                if candidate.source_id in consumed or candidate.source_id in grouped or candidate.list is None:
                    break
                list_blocks.append(candidate)
                cursor += 1
            # ``CustomItem.source_refs`` has a strict maximum of 50.  Split a
            # longer source list deterministically instead of rejecting an
            # otherwise valid import.  Each chunk re-emits its actual source
            # indices, so a later ordered chunk starts at the correct number.
            for chunk in _source_ref_safe_list_chunks(list_blocks):
                content = _commonmark_list_content(chunk)
                items.append(
                    _item(
                        item_key="list:" + ":".join(item.source_id for item in chunk),
                        content=content,
                        blocks=chunk,
                        field="list",
                    )
                )
            consumed.update(item.source_id for item in list_blocks)
            index = cursor
            continue

        content = block.markdown
        if (
            recipe.entry_header_mode == "left_right"
            and decision.layout_role == "entry_header"
        ):
            split = _split_entry_header(content)
            if split is None:
                raise ResumeImportCompositionError(
                    "entry header requires a deterministic source separator"
                )
            content = (
                f"::: left\n{split[0]}\n:::\n\n"
                f"::: right\n{split[1]}\n:::"
            )
        items.append(
            _item(item_key=block.source_id, content=content, blocks=[block])
        )
        consumed.add(block.source_id)
        index += 1
    return items


def compose_canonical_resume(
    source_ir: SourceLayoutIR,
    extraction: ResumeExtractionDraft,
    recipe: ImportLayoutRecipe | None = None,
) -> CanonicalImportResult:
    """Compose a source-closed canonical ``ResumeDocument``.

    ``recipe`` is selected from the template snapshot by the caller.  If no
    context is available, the classic recipe is used for backwards-compatible
    direct service callers.
    """

    recipe = recipe or recipe_for_template()
    if recipe.list_output != "commonmark":
        raise ResumeImportCompositionError(
            "unsupported import list output",
            code="RESUME_LAYOUT_UNSUPPORTED",
        )
    try:
        decisions, groups = validate_source_closure(source_ir, extraction)
    except ResumeImportCompositionError:
        raise
    blocks = sorted(source_ir.blocks, key=lambda block: block.ordinal)
    if not blocks:
        raise ResumeImportCompositionError("source layout contains no content")
    sections = _build_sections(blocks, decisions)
    name_decision = _find_name_decision(blocks, decisions)
    name_block = next(block for block in blocks if block.source_id == name_decision.source_id)
    name = _heading_text(name_block.markdown) if name_block.block_type == "heading" else name_block.markdown.strip()
    if not name:
        raise ResumeImportCompositionError("basics name source block is empty")

    consumed: set[str] = set()
    custom_sections: list[CustomSection] = []
    semantic_sections: list[SemanticSection] = []
    name_emitted = False
    for section in sections:
        anchor = section.anchor
        if anchor is not None:
            anchor_decision = decisions[anchor.source_id]
            semantic_kind = anchor_decision.semantic_kind
            title = _heading_text(anchor.markdown)
            consumed.add(anchor.source_id)
        else:
            anchor_decision = section.decision
            semantic_kind = anchor_decision.semantic_kind
            title = "基本信息" if semantic_kind == "basics" else "自定义章节"
        if semantic_kind == "basics":
            title = "基本信息" if anchor is not None and anchor.source_id == name_block.source_id else (title or "基本信息")
        if not title:
            raise ResumeImportCompositionError("source heading is empty")

        items: list[CustomItem] = []
        name_item_id: str | None = None
        if semantic_kind == "basics" and not name_emitted:
            # The item id does not depend on visible content, so reserve it
            # before computing the custom section id.  The marker itself is
            # filled after that id is known; this keeps the Web anchor and
            # semantic custom-section reference identical.
            name_item_id = _stable_id("item", "name:" + name_block.source_id)
            consumed.add(name_block.source_id)
            name_emitted = True
        items.extend(
            _append_source_items(
                section,
                decisions=decisions,
                groups=groups,
                recipe=recipe,
                consumed=consumed,
            )
        )
        if name_item_id is not None:
            item_ids = [name_item_id, *(item.id for item in items)]
        else:
            item_ids = [item.id for item in items]
        if not item_ids and semantic_kind == "basics":
            raise ResumeImportCompositionError("basics source block has no canonical content")
        section_id = _stable_id(
            "blk",
            anchor.source_id if anchor is not None else "preamble",
            *item_ids,
        )
        if name_item_id is not None:
            name_text = (
                _heading_text(name_block.markdown)
                if name_block.block_type == "heading"
                else name_block.markdown.strip()
            )
            name_item = CustomItem(
                id=name_item_id,
                content=RichText(
                    content=f"# [[linkcv-block:{section_id}:basics]]{name_text}"
                ),
                source_refs=_refs([name_block], field="name"),
            )
            insert_at = next(
                (
                    item_index
                    for item_index, item in enumerate(items)
                    if item.source_refs
                    and item.source_refs[0].start_line > name_block.source_span.start_line
                ),
                len(items),
            )
            items.insert(insert_at, name_item)
        custom = CustomSection(id=section_id, title=title, items=items)
        custom_sections.append(custom)
        semantic_sections.append(
            SemanticSection(
                id=_stable_id("sem", section_id),
                semantic_kind=semantic_kind,
                display_title=title,
                semantic_source="import",
                semantic_confidence=anchor_decision.confidence,
                content_key="custom_sections",
                custom_section_id=section_id,
            )
        )

    source_ids = {block.source_id for block in blocks}
    if consumed != source_ids:
        missing = sorted(source_ids - consumed)
        extra = sorted(consumed - source_ids)
        raise ResumeImportCompositionError(
            f"canonical source closure failed ({len(missing)} missing, {len(extra)} extra)"
        )
    document = ResumeDocument(
        basics=ResumeBasics(name=name),
        sections=ResumeSections(custom_sections=custom_sections),
        semantic_sections=semantic_sections,
    )
    return CanonicalImportResult(
        document=document,
        accepted_source_ids=tuple(block.source_id for block in blocks),
        discarded_source_ids=tuple(record.source_id for record in source_ir.deterministic_discards),
        warnings=tuple(source_ir.warnings),
    )


compose_import_document = compose_canonical_resume
compose_resume_document = compose_canonical_resume


__all__ = [
    "CLASSIC_TECHNICAL_RECIPE",
    "CanonicalImportResult",
    "ImportLayoutRecipe",
    "ResumeImportCompositionError",
    "compose_canonical_resume",
    "compose_import_document",
    "compose_resume_document",
    "get_import_layout_recipe",
    "recipe_for_template",
    "validate_source_closure",
]
