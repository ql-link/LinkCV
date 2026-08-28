"""Remove template-owned page layout from persisted resume content.

Older editor snapshots persisted ``:::: sidebar`` / ``:::: main`` page
projection together with user content.  Re-projecting that document into a
different manifest could nest layout containers, move the identity header, or
drop sidebar sections.  This forward correction converts affected full-editor
Markdown into projection-free semantic blocks and routes profile/interests to
the sidebar of column manifests.

All rows are converted and validated before the first write.  Visible Markdown
lines are compared as a multiset before and after conversion, excluding only
page-region markers and presentation-owned avatar markup.  Every written
snapshot is then read back and verified again.

Revision ID: 0041
Revises: 0040
Create Date: 2026-08-25 14:05:00.000000
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume_document import rich_text_to_markdown
from linkcv.domain.resume_snapshot import ResumeSnapshot, parse_resume_snapshot

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
TABLES = ("resume_templates", "resumes", "resume_versions")
LEGACY_EDITOR_SECTION_ID = "custom_section_editor"
PAGE_OPEN_PATTERN = re.compile(r"^\s*::::\s+(sidebar|main)\s*$")
WIDE_OPEN_PATTERN = re.compile(r"^\s*::::\s+(meta|trio)\s*$")
WIDE_CLOSE_PATTERN = re.compile(r"^\s*::::\s*$")
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
AVATAR_PATTERN = re.compile(
    r'^\s*!\[[^\]]*\]\((\S+)(?:\s+"linkcv-avatar:[^"]+")\)\s*$'
)
BLOCK_ANCHOR_PATTERN = re.compile(
    r"\[\[linkcv-block:blk_[a-z0-9]{16,64}(?::[a-z]+)?\]\]"
)
ICON_PATTERN = re.compile(r":icon\[[^\]]+\]:")


def _decode_json(value: object, *, field: str) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    return value


def _semantic_kind(title: str, *, sidebar: bool = False) -> str:
    normalized = ICON_PATTERN.sub("", title).replace(" ", "").strip()
    if any(value in normalized for value in ("兴趣", "爱好")):
        return "interests"
    if any(value in normalized for value in ("技能", "能力", "技术")):
        return "skills"
    if "语言" in normalized:
        return "languages"
    if any(value in normalized for value in ("项目", "开源", "作品")):
        return "project"
    if "校园" in normalized:
        return "activity"
    if any(value in normalized for value in ("实习", "工作", "实践")):
        return "work"
    if "教育" in normalized:
        return "education"
    if any(value in normalized for value in ("证书", "资质")):
        return "certificates"
    if any(value in normalized for value in ("荣誉", "奖项")):
        return "awards"
    if sidebar or any(value in normalized for value in ("基本信息", "简介", "概况", "评价")):
        return "profile"
    return "custom"


def _stable_block_id(seed: str) -> str:
    return f"blk_{hashlib.sha256(seed.encode()).hexdigest()[:24]}"


def _markdown_items(section: Any) -> str:
    parts: list[str] = []
    for item in section.items:
        if item.title:
            parts.append(f"### {item.title}")
        if item.subtitle:
            parts.append(item.subtitle)
        content = rich_text_to_markdown(item.content).strip()
        if content:
            parts.append(content)
    return "\n\n".join(parts).strip()


def _full_editor_markdown(snapshot: ResumeSnapshot, *, field: str) -> str | None:
    document = snapshot.data
    custom = {section.id: section for section in document.sections.custom_sections}
    legacy = custom.get(LEGACY_EDITOR_SECTION_ID)
    if legacy is not None:
        if len(custom) != 1 or len(legacy.items) != 1:
            raise RuntimeError(f"{field} mixes a legacy full editor with other custom content")
        item = legacy.items[0]
        if item.content.format != "markdown" or not isinstance(item.content.content, str):
            raise RuntimeError(f"{field} legacy full editor is not Markdown")
        return item.content.content.strip()

    if not all(
        semantic.content_key == "custom_sections" and semantic.custom_section_id
        for semantic in document.semantic_sections
    ):
        return None
    ordered: list[str] = []
    for semantic in document.semantic_sections:
        section = custom.get(semantic.custom_section_id or "")
        if section is None:
            raise RuntimeError(f"{field} has an unresolved editor section")
        if any(item.content.format != "markdown" for item in section.items):
            return None
        body = _markdown_items(section)
        if semantic.semantic_kind == "basics":
            ordered.append(body)
        else:
            ordered.append(
                "\n\n".join(part for part in (f"## {semantic.display_title}", body) if part)
            )
    markdown = "\n\n".join(part for part in ordered if part).strip()
    has_page_projection = any(
        PAGE_OPEN_PATTERN.fullmatch(line) for line in markdown.splitlines()
    )
    return markdown if has_page_projection else None


def _extract_page_regions(markdown: str) -> tuple[str, str, list[str]]:
    main: list[str] = []
    sidebar: list[str] = []
    avatars: list[str] = []
    stack: list[str] = []
    fenced = False
    for line in markdown.splitlines():
        if re.match(r"^\s*(?:```|~~~)", line):
            fenced = not fenced
            target = sidebar if "sidebar" in stack else main
            target.append(line)
            continue
        if not fenced:
            opening = PAGE_OPEN_PATTERN.fullmatch(line)
            if opening:
                stack.append(opening.group(1))
                continue
            wide_opening = WIDE_OPEN_PATTERN.fullmatch(line)
            if wide_opening:
                stack.append(wide_opening.group(1))
                target = sidebar if "sidebar" in stack else main
                target.append(line)
                continue
            if WIDE_CLOSE_PATTERN.fullmatch(line):
                kind = stack.pop() if stack else None
                if kind in {"meta", "trio"}:
                    target = sidebar if "sidebar" in stack else main
                    target.append(line)
                elif kind is None:
                    target = sidebar if "sidebar" in stack else main
                    target.append(line)
                continue
            avatar = AVATAR_PATTERN.fullmatch(line)
            if avatar:
                avatars.append(avatar.group(1))
                continue
        target = sidebar if "sidebar" in stack else main
        target.append(line)
    if any(kind in {"meta", "trio"} for kind in stack):
        raise RuntimeError("unclosed content-owned wide region")
    return "\n".join(main).strip(), "\n".join(sidebar).strip(), avatars


def _split_headings(
    markdown: str,
    *,
    level: int,
    default_title: str,
    default_kind: str,
    sidebar: bool,
) -> list[tuple[str, str, str]]:
    lines = markdown.splitlines()
    matches: list[tuple[int, str]] = []
    fenced = False
    for index, line in enumerate(lines):
        if re.match(r"^\s*(?:```|~~~)", line):
            fenced = not fenced
            continue
        if fenced:
            continue
        heading = HEADING_PATTERN.fullmatch(line)
        if heading and len(heading.group(1)) == level:
            matches.append((index, heading.group(2).strip()))
    blocks: list[tuple[str, str, str]] = []
    first = matches[0][0] if matches else len(lines)
    prefix = "\n".join(lines[:first]).strip()
    if prefix or not matches:
        blocks.append((default_title, default_kind, prefix))
    for position, (start, title) in enumerate(matches):
        end = matches[position + 1][0] if position + 1 < len(matches) else len(lines)
        body = "\n".join(lines[start + 1 : end]).strip()
        blocks.append((title, _semantic_kind(title, sidebar=sidebar), body))
    return blocks


def _visible_lines(markdown: str) -> Counter[str]:
    main, sidebar, _ = _extract_page_regions(markdown)
    visible: Counter[str] = Counter()
    for line in [*main.splitlines(), *sidebar.splitlines()]:
        value = BLOCK_ANCHOR_PATTERN.sub("", line).strip()
        heading = HEADING_PATTERN.fullmatch(value)
        if heading:
            value = heading.group(2).strip()
        if value:
            visible[value] += 1
    return visible


def _previous_sections(snapshot: ResumeSnapshot) -> tuple[dict[str, Any], dict[tuple[str, str], Any]]:
    custom = {section.id: section for section in snapshot.data.sections.custom_sections}
    by_key: dict[tuple[str, str], Any] = {}
    title_counts = Counter(
        (semantic.display_title.strip(), semantic.semantic_kind)
        for semantic in snapshot.data.semantic_sections
    )
    for semantic in snapshot.data.semantic_sections:
        key = (semantic.display_title.strip(), semantic.semantic_kind)
        if title_counts[key] == 1:
            by_key[key] = semantic
    return custom, by_key


def _projection_free_document(
    snapshot: ResumeSnapshot,
    markdown: str,
    *,
    field: str,
) -> dict[str, Any]:
    main, sidebar, avatar_sources = _extract_page_regions(markdown)
    if not main.strip():
        raise RuntimeError(f"{field} has no main resume content")
    main_blocks = _split_headings(
        main,
        level=2,
        default_title="基本信息",
        default_kind="basics",
        sidebar=False,
    )
    sidebar_blocks = _split_headings(
        sidebar,
        level=3,
        default_title="侧栏信息",
        default_kind="profile",
        sidebar=True,
    ) if sidebar else []
    if not main_blocks or main_blocks[0][1] != "basics":
        raise RuntimeError(f"{field} cannot identify its basics block")
    blocks = [main_blocks[0], *sidebar_blocks, *main_blocks[1:]]
    if len(blocks) > 50:
        raise RuntimeError(f"{field} produces too many editor sections")

    old_custom, old_by_key = _previous_sections(snapshot)
    old_basics = next(
        (
            semantic for semantic in snapshot.data.semantic_sections
            if semantic.semantic_kind == "basics" and semantic.custom_section_id
        ),
        None,
    )
    used_ids: set[str] = set()
    custom_sections: list[dict[str, Any]] = []
    semantic_sections: list[dict[str, Any]] = []
    occurrence = Counter((title.strip(), kind) for title, kind, _ in blocks)
    for index, (title, kind, body) in enumerate(blocks):
        old_semantic = old_basics if index == 0 else (
            old_by_key.get((title.strip(), kind))
            if occurrence[(title.strip(), kind)] == 1
            else None
        )
        old_id = old_semantic.custom_section_id if old_semantic else None
        block_id = old_id or _stable_block_id(f"{field}:{title}:{kind}:{index}")
        if block_id in used_ids:
            raise RuntimeError(f"{field} produces duplicate editor section ids")
        used_ids.add(block_id)
        old_section = old_custom.get(block_id)
        old_items = list(old_section.items) if old_section is not None else []
        item_id = old_items[0].id if old_items else f"item_{block_id[4:]}"
        source_refs = old_items[0].source_refs if old_items else []
        # A projected editor snapshot flattened every legacy item into the
        # visible Markdown body. Keep the first stable item as that body's
        # owner and retain all remaining item ids/source refs as empty metadata
        # carriers, so layout removal cannot silently destroy provenance.
        items = [
            {
                "id": item_id,
                "title": None,
                "subtitle": None,
                "content": {"format": "markdown", "content": body},
                "source_refs": [item.model_dump(mode="json") for item in source_refs],
            },
            *[
                {
                    "id": item.id,
                    "title": None,
                    "subtitle": None,
                    "content": {"format": "markdown", "content": ""},
                    "source_refs": [
                        source_ref.model_dump(mode="json")
                        for source_ref in item.source_refs
                    ],
                }
                for item in old_items[1:]
            ],
        ]
        custom_sections.append(
            {
                "id": block_id,
                "title": title,
                "items": items,
            }
        )
        semantic_sections.append(
            {
                "id": old_semantic.id if old_semantic else f"semantic_{block_id}",
                "semantic_kind": kind,
                "display_title": title,
                "semantic_source": old_semantic.semantic_source if old_semantic else "system",
                "semantic_confidence": old_semantic.semantic_confidence if old_semantic else None,
                "content_key": "custom_sections",
                "custom_section_id": block_id,
            }
        )

    current = snapshot.data.model_dump(mode="json")
    safe_avatar = next(
        (
            source for source in avatar_sources
            if source.startswith(("/api/assets/", "/api/resumes/", "http://", "https://"))
        ),
        None,
    )
    candidate = {
        **current,
        "basics": {
            **current["basics"],
            "headline": None,
            "email": None,
            "phone": None,
            "location": None,
            "photo": current["basics"].get("photo") or safe_avatar,
            "summary": None,
            "links": [],
        },
        "sections": {
            **current["sections"],
            "work_experiences": [],
            "educations": [],
            "projects": [],
            "skills": [],
            "certificates": [],
            "awards": [],
            "languages": [],
            "custom_sections": custom_sections,
        },
        "semantic_sections": semantic_sections,
    }
    return candidate


def _logical_markdown(snapshot: ResumeSnapshot) -> str:
    custom = {section.id: section for section in snapshot.data.sections.custom_sections}
    parts: list[str] = []
    for semantic in snapshot.data.semantic_sections:
        section = custom.get(semantic.custom_section_id or "")
        if section is None:
            continue
        body = _markdown_items(section)
        if semantic.semantic_kind == "basics":
            parts.append(body)
        else:
            parts.append("\n\n".join(part for part in (f"## {semantic.display_title}", body) if part))
    return "\n\n".join(part for part in parts if part).strip()


def _repair_manifest(style: dict[str, Any]) -> dict[str, Any]:
    manifest = style.get("manifest")
    if not isinstance(manifest, dict) or manifest.get("renderer_key") != "columns":
        return style
    regions = manifest.get("regions")
    slots = manifest.get("slots")
    if not isinstance(regions, list) or not isinstance(slots, list):
        raise RuntimeError("column manifest is incomplete")
    sidebar_ids = {
        region.get("id") for region in regions
        if isinstance(region, dict) and region.get("kind") == "sidebar"
    }
    explicit_accepts = {
        kind
        for slot in slots
        if isinstance(slot, dict) and not slot.get("fallback")
        for kind in slot.get("accepts", [])
        if isinstance(kind, str)
    }
    repaired_slots: list[dict[str, Any]] = []
    added = False
    for slot in slots:
        if not isinstance(slot, dict) or not isinstance(slot.get("accepts"), list):
            raise RuntimeError("column manifest has an invalid slot")
        accepts = list(slot["accepts"])
        if slot.get("region_id") in sidebar_ids and "skills" in accepts:
            for kind in ("profile", "interests"):
                if kind not in explicit_accepts and kind not in accepts:
                    accepts.append(kind)
                    added = True
        repaired_slots.append({**slot, "accepts": accepts})
    if not added:
        return style
    return {**style, "manifest": {**manifest, "slots": repaired_slots}}


def _repair_snapshot(
    data_value: object,
    style_value: object,
    *,
    field: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    data = _decode_json(data_value, field=f"{field}.data_json")
    style = _decode_json(style_value, field=f"{field}.style_json")
    current = parse_resume_snapshot(data, style)
    editor_markdown = _full_editor_markdown(current, field=field)
    candidate_data = (
        _projection_free_document(current, editor_markdown, field=field)
        if editor_markdown is not None
        else current.data.model_dump(mode="json")
    )
    candidate_style = _repair_manifest(current.style.model_dump(mode="json"))
    repaired = parse_resume_snapshot(candidate_data, candidate_style)
    if editor_markdown is not None:
        if _visible_lines(editor_markdown) != _visible_lines(_logical_markdown(repaired)):
            raise RuntimeError(f"{field} visible content changed during layout removal")
    return repaired.data.model_dump(mode="json"), repaired.style.model_dump(mode="json")


ConvertedRow = tuple[str, int, dict[str, Any], dict[str, Any], bool]


def _preflight(connection: sa.engine.Connection) -> list[ConvertedRow]:
    converted: list[ConvertedRow] = []
    for table in TABLES:
        rows = connection.execute(
            sa.text(f"SELECT id, data_json, style_json FROM {table} ORDER BY id")
        ).mappings()
        for row in rows:
            current_data = _decode_json(
                row["data_json"], field=f"{table}[{row['id']}].data_json"
            )
            current_style = _decode_json(
                row["style_json"], field=f"{table}[{row['id']}].style_json"
            )
            data, style = _repair_snapshot(
                current_data,
                current_style,
                field=f"{table}[{row['id']}]",
            )
            converted.append(
                (
                    table,
                    int(row["id"]),
                    data,
                    style,
                    data != current_data or style != current_style,
                )
            )
    return converted


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0041.up.sql")
    converted = _preflight(connection)
    for table, row_id, data, style, changed in converted:
        if not changed:
            continue
        result = connection.execute(
            sa.text(
                f"UPDATE {table} SET data_json = :data_json, style_json = :style_json "
                "WHERE id = :id"
            ),
            {
                "id": row_id,
                "data_json": json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                "style_json": json.dumps(style, ensure_ascii=False, separators=(",", ":")),
            },
        )
        if result.rowcount != 1:
            raise RuntimeError(f"{table}[{row_id}] layout repair was not written")
    verified = _preflight(connection)
    expected_payload = [row[:4] for row in converted]
    if any(row[4] for row in verified) or [row[:4] for row in verified] != expected_payload:
        raise RuntimeError("resume layout repair verification failed")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
