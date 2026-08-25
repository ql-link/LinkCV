"""Synchronize official templates with the canonical editor snapshot contract.

Revision 0036 preserved every legacy JSON leaf, including the official
templates' full editor Markdown stored in ``custom_section_editor``.  It also
added a typed ``basics`` semantic section, so the new renderer emitted basic
information once from ``basics`` and a second time from the preserved editor
Markdown.  This forward correction splits the reviewed editor Markdown into
stable semantic blocks and marks the pre-heading block as the editor's basics
block.  The Web renderer can then consume the complete editor document once,
without inventing a second heading or nesting its existing layout directives.

Only official template rows with the known editor section shape are rewritten.
Unexpected official data aborts before the first update.  User resumes and
immutable resume versions are deliberately not changed.

Revision ID: 0037
Revises: 0036
Create Date: 2026-08-25 02:30:32.130803
"""
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume_document import ResumeDocument
from linkcv.domain.resume_style import ResumePresentation

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"

StyleTokens = tuple[
    float,
    float,
    str,
    bool,
    tuple[float, float, float, float],
]

OFFICIAL_TEMPLATE_STYLES: dict[str, StyleTokens] = {
    "blank-cn": (14, 1.55, "#2F4858", False, (14, 16, 14, 16)),
    "classic-cn": (14, 1.55, "#2F4858", False, (14, 16, 14, 16)),
    "modern-two-column-cn": (13.5, 1.5, "#315C6B", False, (12, 14, 12, 14)),
    "compact-tech-cn": (12.5, 1.38, "#263238", True, (10, 12, 10, 12)),
    "classic-technical-cn": (11.5, 1.42, "#2F4858", True, (12, 14, 12, 14)),
    "administrative-sidebar-cn": (10, 1.42, "#294F73", True, (0, 0, 0, 0)),
    "campus-professional-cn": (9.4, 1.38, "#4F8DF7", True, (8, 9, 8, 9)),
    "civic-service-cn": (9.7, 1.45, "#3476D2", True, (0, 10, 8, 10)),
    "creative-orange-cn": (9.6, 1.4, "#FF8A00", True, (0, 10, 8, 10)),
}
EDITOR_SECTION_ID = "custom_section_editor"
HEADING_PATTERN = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
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


def _semantic_kind(title: str) -> str:
    normalized = ICON_PATTERN.sub("", title).replace(" ", "").strip()
    if any(value in normalized for value in ("项目", "开源", "作品")):
        return "project"
    if "校园" in normalized:
        return "activity"
    if any(value in normalized for value in ("实习", "工作", "实践")):
        return "work"
    if "教育" in normalized:
        return "education"
    if any(value in normalized for value in ("技能", "能力")):
        return "skills"
    if any(value in normalized for value in ("证书", "资质")):
        return "certificates"
    if any(value in normalized for value in ("荣誉", "奖项")):
        return "awards"
    if "语言" in normalized:
        return "languages"
    return "custom"


def _split_editor_markdown(
    markdown: str, *, template_key: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    matches = list(HEADING_PATTERN.finditer(markdown))
    blocks: list[tuple[str, str, str]] = []
    first_end = matches[0].start() if matches else len(markdown)
    blocks.append(("基本信息", "basics", markdown[:first_end].strip()))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        title = match.group(1).strip()
        blocks.append(
            (title, _semantic_kind(title), markdown[match.end() : end].strip())
        )

    slug = template_key.replace("-", "_")
    custom_sections: list[dict[str, Any]] = []
    semantic_sections: list[dict[str, Any]] = []
    for index, (title, kind, body) in enumerate(blocks):
        section_id = f"template_{slug}_{index:02d}"
        item_id = f"item_{slug}_{index:02d}"
        custom_sections.append(
            {
                "id": section_id,
                "title": title,
                "items": [
                    {
                        "id": item_id,
                        "title": None,
                        "subtitle": None,
                        "content": {"format": "markdown", "content": body},
                        "source_refs": [],
                    }
                ],
            }
        )
        semantic_sections.append(
            {
                "id": f"semantic_{section_id}",
                "semantic_kind": kind,
                "display_title": title,
                "semantic_source": "system",
                "semantic_confidence": None,
                "content_key": "custom_sections",
                "custom_section_id": section_id,
            }
        )
    return custom_sections, semantic_sections


def _editor_markdown(data: dict[str, Any], *, template_key: str) -> str | None:
    sections = data.get("sections")
    if not isinstance(sections, dict):
        raise RuntimeError(f"official template {template_key} has invalid sections")
    custom_sections = sections.get("custom_sections")
    if not isinstance(custom_sections, list):
        raise RuntimeError(f"official template {template_key} has invalid custom sections")
    editor = next(
        (
            section
            for section in custom_sections
            if isinstance(section, dict)
            and section.get("id") == EDITOR_SECTION_ID
        ),
        None,
    )
    if editor is None:
        # Blank and early built-in templates can already use typed canonical
        # content; style synchronization still applies to those rows.
        return None
    items = editor.get("items")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise RuntimeError(f"official template {template_key} editor section is ambiguous")
    content = items[0].get("content")
    markdown = content.get("content") if isinstance(content, dict) else None
    if not isinstance(markdown, str) or not markdown.strip():
        raise RuntimeError(f"official template {template_key} editor Markdown is empty")
    if len(custom_sections) != 1:
        raise RuntimeError(f"official template {template_key} mixes editor and typed custom content")
    return markdown.strip()


def _synchronize_data(value: object, *, template_key: str) -> dict[str, Any]:
    data = _decode_json(value, field=f"resume_templates[{template_key}].data_json")
    markdown = _editor_markdown(data, template_key=template_key)
    if markdown is None:
        return ResumeDocument.model_validate(data).model_dump(mode="json")
    custom_sections, semantic_sections = _split_editor_markdown(markdown, template_key=template_key)
    candidate = dict(data)
    candidate["sections"] = {**data["sections"], "custom_sections": custom_sections}
    candidate["semantic_sections"] = semantic_sections
    return ResumeDocument.model_validate(candidate).model_dump(mode="json")


def _synchronize_style(value: object, *, template_key: str) -> dict[str, Any]:
    style = _decode_json(value, field=f"resume_templates[{template_key}].style_json")
    font_size, line_height, accent, smart_one_page, margins = OFFICIAL_TEMPLATE_STYLES[template_key]
    top, right, bottom, left = margins
    candidate = {
        **style,
        "font_size": font_size,
        "line_height": line_height,
        "accent_color": accent,
        "smart_one_page": smart_one_page,
        "page": {
            **style.get("page", {}),
            "size": "A4",
            "margin_top_mm": top,
            "margin_right_mm": right,
            "margin_bottom_mm": bottom,
            "margin_left_mm": left,
        },
    }
    return ResumePresentation.model_validate(candidate).model_dump(mode="json")


ConvertedTemplate = tuple[int, str, dict[str, Any], dict[str, Any]]


def _preflight(connection: sa.engine.Connection) -> list[ConvertedTemplate]:
    converted: list[ConvertedTemplate] = []
    rows = connection.execute(
        sa.text("SELECT id, `key`, data_json, style_json FROM resume_templates ORDER BY id")
    ).mappings()
    for row in rows:
        template_key = str(row["key"])
        if template_key not in OFFICIAL_TEMPLATE_STYLES:
            continue
        converted.append(
            (
                int(row["id"]),
                template_key,
                _synchronize_data(row["data_json"], template_key=template_key),
                _synchronize_style(row["style_json"], template_key=template_key),
            )
        )
    if {item[1] for item in converted} != set(OFFICIAL_TEMPLATE_STYLES):
        raise RuntimeError("official template set is incomplete")
    return converted


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0037.up.sql")
    converted = _preflight(connection)
    for template_id, template_key, data, style in converted:
        result = connection.execute(
            sa.text(
                "UPDATE resume_templates SET data_json = :data_json, style_json = :style_json "
                "WHERE id = :id AND `key` = :key"
            ),
            {
                "id": template_id,
                "key": template_key,
                "data_json": json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                "style_json": json.dumps(style, ensure_ascii=False, separators=(",", ":")),
            },
        )
        if result.rowcount != 1:
            raise RuntimeError(f"official template {template_key} was not synchronized")
    for template_id, template_key, expected_data, expected_style in converted:
        row = connection.execute(
            sa.text("SELECT data_json, style_json FROM resume_templates WHERE id = :id AND `key` = :key"),
            {"id": template_id, "key": template_key},
        ).mappings().one_or_none()
        if row is None:
            raise RuntimeError(f"official template {template_key} disappeared during verification")
        actual_data = _decode_json(
            row["data_json"], field=f"resume_templates[{template_key}].data_json"
        )
        actual_style = _decode_json(
            row["style_json"], field=f"resume_templates[{template_key}].style_json"
        )
        if actual_data != expected_data or actual_style != expected_style:
            raise RuntimeError(f"official template {template_key} synchronization verification failed")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
