"""Migrate legacy resume snapshots without discarding their original JSON.

The legacy Tiptap document cannot be transformed safely with SQL alone, so this
revision uses bounded Python conversion after reviewed SQL adds nullable backup
columns. Re-running the conversion is safe: converted rows retain the original
JSON in those columns. Restoring the pre-migration state requires a backup.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-27 13:18:15.874929
"""
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

from linkcv.core.migration_sql import execute_sql_file

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
BATCH_SIZE = 100
LEGACY_DATA_KEYS = {"schema_version", "document", "markdown"}
LEGACY_STYLE_KEYS = {
    "schema_version",
    "settings",
    "split_ratio",
    "preview_scale",
}
LEGACY_SETTING_KEYS = {
    "fontFamily",
    "fontSize",
    "lineHeight",
    "pageMargin",
    "verticalPageMargin",
    "theme",
    "smartOnePage",
    "showSource",
}
NODE_ATTR_KEYS = {
    "doc": set(),
    "text": set(),
    "hardBreak": set(),
    "heading": {"level", "textAlign"},
    "paragraph": {"textAlign"},
    "listItem": set(),
    "bulletList": set(),
    "orderedList": {"start"},
    "resumeRow": {"leftWidth"},
    "avatarImage": {"src", "size", "alt", "title"},
    "resumeImage": {"src", "width", "widthUnit", "align", "alt", "title"},
}
DANGEROUS_MARKDOWN_PATTERN = re.compile(
    r"<(?:script|iframe|object|embed|style)\b|javascript:", re.IGNORECASE
)
BACKUP_COLUMNS = {"legacy_data_json_backup", "legacy_style_json_backup"}


def _decode_json(value: object, *, field: str) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    return value


def _expect_keys(value: dict[str, Any], allowed: set[str], *, field: str) -> None:
    unexpected = sorted(set(value) - allowed)
    if unexpected:
        raise RuntimeError(f"{field} contains unsupported keys: {unexpected}")


def _children(node: dict[str, Any]) -> list[dict[str, Any]]:
    content = node.get("content", [])
    if not isinstance(content, list) or not all(isinstance(item, dict) for item in content):
        raise RuntimeError("legacy Tiptap node content must be an object list")
    return content


def _node_type(node: dict[str, Any]) -> str:
    node_type = node.get("type")
    if not isinstance(node_type, str) or node_type not in NODE_ATTR_KEYS:
        raise RuntimeError(f"unsupported legacy Tiptap node: {node_type!r}")
    attrs = node.get("attrs", {})
    if attrs is None:
        attrs = {}
    if not isinstance(attrs, dict):
        raise RuntimeError(f"legacy Tiptap {node_type} attrs must be an object")
    unexpected = sorted(set(attrs) - NODE_ATTR_KEYS[node_type])
    if unexpected:
        raise RuntimeError(
            f"legacy Tiptap {node_type} contains unsupported attrs: {unexpected}"
        )
    return node_type


def _marked_text(node: dict[str, Any]) -> str:
    value = node.get("text", "")
    if not isinstance(value, str):
        raise RuntimeError("legacy Tiptap text must be a string")
    marks = node.get("marks", [])
    if not isinstance(marks, list):
        raise RuntimeError("legacy Tiptap marks must be a list")
    for mark in marks:
        if not isinstance(mark, dict):
            raise RuntimeError("legacy Tiptap mark must be an object")
        mark_type = mark.get("type")
        attrs = mark.get("attrs") or {}
        if not isinstance(attrs, dict):
            raise RuntimeError("legacy Tiptap mark attrs must be an object")
        if mark_type == "bold":
            _expect_keys(attrs, set(), field="bold mark")
            value = f"**{value}**"
        elif mark_type == "italic":
            _expect_keys(attrs, set(), field="italic mark")
            value = f"*{value}*"
        elif mark_type == "link":
            _expect_keys(attrs, {"href", "target", "rel", "class"}, field="link mark")
            href = attrs.get("href")
            if not isinstance(href, str) or not href:
                raise RuntimeError("legacy Tiptap link href must be a non-empty string")
            value = f"[{value}]({href})"
        else:
            raise RuntimeError(f"unsupported legacy Tiptap mark: {mark_type!r}")
    return value


def _node_text(node: dict[str, Any]) -> str:
    node_type = _node_type(node)
    if node_type == "text":
        return _marked_text(node)
    if node_type == "hardBreak":
        return "\n"
    return "".join(_node_text(child) for child in _children(node))


def _is_default_avatar_placeholder(src: str) -> bool:
    if not src.startswith("data:image/svg+xml"):
        return False
    decoded = unquote(src)
    return "<pattern id=\"p\"" in decoded and ">头像</text>" in decoded


def _markdown_image(node: dict[str, Any], title: str) -> str:
    attrs = node.get("attrs") or {}
    src = attrs.get("src", "")
    if not isinstance(src, str):
        raise RuntimeError("legacy Tiptap image src must be a string")
    if not src:
        return ""
    if src.startswith(("data:", "blob:")):
        if _node_type(node) == "avatarImage" and _is_default_avatar_placeholder(src):
            return ""
        raise RuntimeError("embedded legacy image cannot be converted without data loss")
    alt = str(attrs.get("alt") or "简历图片").replace("\\", "\\\\").replace("]", "\\]")
    destination = src.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f'![{alt}]({destination} "{title}")'


def _node_markdown(node: dict[str, Any]) -> str:
    node_type = _node_type(node)
    if node_type == "text":
        return _marked_text(node)
    if node_type == "hardBreak":
        return "\n"
    if node_type == "heading":
        level = (node.get("attrs") or {}).get("level", 2)
        if not isinstance(level, int) or isinstance(level, bool) or not 1 <= level <= 6:
            raise RuntimeError("legacy heading level must be between 1 and 6")
        return f"{'#' * level} {_node_text(node)}"
    if node_type == "paragraph":
        return _node_text(node)
    if node_type == "listItem":
        return "\n".join(_node_markdown(child) for child in _children(node))
    if node_type == "bulletList":
        return "\n".join(f"- {_node_markdown(item)}" for item in _children(node))
    if node_type == "orderedList":
        start = (node.get("attrs") or {}).get("start", 1)
        if not isinstance(start, int) or isinstance(start, bool) or start < 1:
            raise RuntimeError("legacy ordered list start must be a positive integer")
        return "\n".join(
            f"{start + index}. {_node_markdown(item)}"
            for index, item in enumerate(_children(node))
        )
    if node_type == "resumeRow":
        content = _children(node)
        if len(content) != 2:
            raise RuntimeError("legacy resume row must contain left and right columns")
        return (
            f"::: left\n{_node_text(content[0])}\n:::\n\n"
            f"::: right\n{_node_text(content[1])}\n:::"
        )
    if node_type == "avatarImage":
        size = (node.get("attrs") or {}).get("size", 96)
        if not isinstance(size, (int, float)) or isinstance(size, bool):
            raise RuntimeError("legacy avatar size must be numeric")
        size = min(220, max(56, size))
        return _markdown_image(node, f"linkcv-avatar:{size:g}")
    if node_type == "resumeImage":
        attrs = node.get("attrs") or {}
        width_unit = attrs.get("widthUnit", "%")
        if width_unit not in {"%", "px"}:
            raise RuntimeError("legacy resume image width unit is unsupported")
        width = attrs.get("width", 55)
        if not isinstance(width, (int, float)) or isinstance(width, bool):
            raise RuntimeError("legacy resume image width must be numeric")
        width = min(100 if width_unit == "%" else 794, max(0.1, width))
        align = attrs.get("align", "center")
        if align not in {"left", "center", "right", "full"}:
            raise RuntimeError("legacy resume image alignment is unsupported")
        return _markdown_image(node, f"linkcv-image:{width:g}:{width_unit}:{align}")
    if node_type == "doc":
        return "\n\n".join(
            block for child in _children(node) if (block := _node_markdown(child))
        ).strip()
    raise RuntimeError(f"unsupported legacy Tiptap node: {node_type!r}")


def legacy_data_to_v1(value: object) -> dict[str, Any]:
    legacy = _decode_json(value, field="legacy data_json")
    _expect_keys(legacy, LEGACY_DATA_KEYS, field="legacy data_json")
    if legacy.get("schema_version") != 1:
        raise RuntimeError("legacy data_json schema_version must be 1")
    document = legacy.get("document")
    markdown = legacy.get("markdown")
    if isinstance(document, dict) and markdown is None:
        if _node_type(document) != "doc":
            raise RuntimeError("legacy Tiptap document root must be doc")
        markdown = _node_markdown(document)
    elif isinstance(markdown, str) and document is None:
        pass
    else:
        raise RuntimeError("legacy data_json must contain exactly one document representation")
    if len(markdown) > 20_000:
        raise RuntimeError("converted legacy Markdown exceeds 20000 characters")
    if DANGEROUS_MARKDOWN_PATTERN.search(markdown):
        raise RuntimeError("converted legacy Markdown contains unsafe markup")
    heading = re.search(r"^#\s+(.+)$", markdown, re.MULTILINE)
    name = heading.group(1).strip() if heading else "张三"
    if len(name) > 200:
        raise RuntimeError("converted legacy resume name exceeds 200 characters")
    return {
        "schema_version": "1.0",
        "basics": {
            "name": name,
            "headline": "后端开发工程师",
            "email": None,
            "phone": None,
            "location": None,
            "photo": None,
            "summary": None,
            "links": [],
        },
        "sections": {
            "work_experiences": [],
            "educations": [],
            "projects": [],
            "skills": [],
            "certificates": [],
            "awards": [],
            "languages": [],
            "custom_sections": [
                {
                    "id": "custom_section_editor",
                    "title": "简历正文",
                    "items": [
                        {
                            "id": "custom_item_editor",
                            "title": None,
                            "subtitle": None,
                            "content": {"format": "markdown", "content": markdown},
                            "source_refs": [],
                        }
                    ],
                }
            ],
        },
    }


def _number(
    value: object,
    *,
    field: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    if value is None:
        value = default
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise RuntimeError(f"{field} must be numeric")
    result = float(value)
    if not minimum <= result <= maximum:
        raise RuntimeError(f"{field} is outside the supported range")
    return result


def legacy_style_to_v1(value: object) -> dict[str, Any]:
    legacy = _decode_json(value, field="legacy style_json")
    _expect_keys(legacy, LEGACY_STYLE_KEYS, field="legacy style_json")
    if legacy.get("schema_version") != 1:
        raise RuntimeError("legacy style_json schema_version must be 1")
    settings = legacy.get("settings")
    if not isinstance(settings, dict):
        raise RuntimeError("legacy style_json settings must be an object")
    _expect_keys(settings, LEGACY_SETTING_KEYS, field="legacy settings")
    theme = settings.get("theme", "classic")
    if theme not in {"classic", "modern", "compact"}:
        raise RuntimeError("legacy theme is unsupported")
    font_family = settings.get("fontFamily", "source-han-serif")
    if not isinstance(font_family, str) or not font_family:
        raise RuntimeError("legacy fontFamily must be a non-empty string")
    if "Source Han Serif" in font_family:
        font_family = "source-han-serif"
    if len(font_family) > 100:
        raise RuntimeError("legacy fontFamily exceeds 100 characters")
    smart_one_page = settings.get("smartOnePage", False)
    if not isinstance(smart_one_page, bool):
        raise RuntimeError("legacy smartOnePage must be boolean")
    page_margin = _number(
        settings.get("pageMargin"),
        field="legacy pageMargin",
        default=16,
        minimum=0,
        maximum=50,
    )
    vertical_margin = _number(
        settings.get("verticalPageMargin"),
        field="legacy verticalPageMargin",
        default=16,
        minimum=0,
        maximum=50,
    )
    return {
        "schema_version": "1.0",
        "template_key": f"{theme}-cn",
        "font_family": font_family,
        "font_size": _number(
            settings.get("fontSize"),
            field="legacy fontSize",
            default=10.5,
            minimum=6,
            maximum=32,
        ),
        "line_height": _number(
            settings.get("lineHeight"),
            field="legacy lineHeight",
            default=1.32,
            minimum=1,
            maximum=3,
        ),
        "accent_color": "#2F4858",
        "smart_one_page": smart_one_page,
        "page": {
            "size": "A4",
            "margin_top_mm": vertical_margin,
            "margin_right_mm": page_margin,
            "margin_bottom_mm": vertical_margin,
            "margin_left_mm": page_margin,
        },
        "section_order": ["basics", "custom_sections"],
    }


def _schema_version(value: dict[str, Any]) -> object:
    return value.get("schema_version")


def _update_snapshot(
    connection: Connection,
    *,
    table: str,
    record_id: int,
    legacy_data: dict[str, Any],
    legacy_style: dict[str, Any],
    data: dict[str, Any],
    style: dict[str, Any],
) -> None:
    preserve_updated_at = ", updated_at = updated_at" if table == "resumes" else ""
    statement = sa.text(
        f"UPDATE {table} SET "
        "legacy_data_json_backup = :legacy_data, "
        "legacy_style_json_backup = :legacy_style, "
        "data_json = :data, style_json = :style"
        f"{preserve_updated_at} WHERE id = :record_id"
    ).bindparams(
        sa.bindparam("legacy_data", type_=sa.JSON()),
        sa.bindparam("legacy_style", type_=sa.JSON()),
        sa.bindparam("data", type_=sa.JSON()),
        sa.bindparam("style", type_=sa.JSON()),
    )
    connection.execute(
        statement,
        {
            "record_id": record_id,
            "legacy_data": legacy_data,
            "legacy_style": legacy_style,
            "data": data,
            "style": style,
        },
    )


def _migrate_table(connection: Connection, table: str) -> None:
    last_id = 0
    while True:
        rows = connection.execute(
            sa.text(
                f"SELECT id, data_json, style_json, "
                "legacy_data_json_backup, legacy_style_json_backup "
                f"FROM {table} WHERE id > :last_id AND ("
                "legacy_data_json_backup IS NOT NULL OR "
                "legacy_style_json_backup IS NOT NULL OR "
                "JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = '1' OR "
                "JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.schema_version')) = '1'"
                ") ORDER BY id LIMIT :batch_size"
            ),
            {"last_id": last_id, "batch_size": BATCH_SIZE},
        ).mappings().all()
        if not rows:
            break
        for row in rows:
            record_id = int(row["id"])
            data = _decode_json(row["data_json"], field=f"{table}.{record_id}.data_json")
            style = _decode_json(row["style_json"], field=f"{table}.{record_id}.style_json")
            backup_data_raw = row["legacy_data_json_backup"]
            backup_style_raw = row["legacy_style_json_backup"]
            if (backup_data_raw is None) != (backup_style_raw is None):
                raise RuntimeError(f"{table}.{record_id} has an incomplete legacy backup")
            if backup_data_raw is not None:
                backup_data = _decode_json(
                    backup_data_raw, field=f"{table}.{record_id}.legacy_data_json_backup"
                )
                backup_style = _decode_json(
                    backup_style_raw, field=f"{table}.{record_id}.legacy_style_json_backup"
                )
                if _schema_version(data) == "1.0" and _schema_version(style) == "1.0":
                    legacy_data_to_v1(backup_data)
                    legacy_style_to_v1(backup_style)
                    last_id = record_id
                    continue
                if _schema_version(data) != 1 or _schema_version(style) != 1:
                    raise RuntimeError(f"{table}.{record_id} has inconsistent migration state")
                legacy_data = backup_data
                legacy_style = backup_style
            else:
                if _schema_version(data) != 1 or _schema_version(style) != 1:
                    raise RuntimeError(f"{table}.{record_id} has mismatched legacy schemas")
                legacy_data = data
                legacy_style = style
            _update_snapshot(
                connection,
                table=table,
                record_id=record_id,
                legacy_data=legacy_data,
                legacy_style=legacy_style,
                data=legacy_data_to_v1(legacy_data),
                style=legacy_style_to_v1(legacy_style),
            )
            last_id = record_id
    remaining = connection.scalar(
        sa.text(
            f"SELECT COUNT(*) FROM {table} WHERE "
            "JSON_UNQUOTE(JSON_EXTRACT(data_json, '$.schema_version')) = '1' OR "
            "JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.schema_version')) = '1'"
        )
    )
    if remaining:
        raise RuntimeError(f"{table} still contains {remaining} legacy snapshots")


def _restore_table(connection: Connection, table: str) -> None:
    preserve_updated_at = ", updated_at = updated_at" if table == "resumes" else ""
    statement = sa.text(
        f"UPDATE {table} SET data_json = legacy_data_json_backup, "
        "style_json = legacy_style_json_backup"
        f"{preserve_updated_at} WHERE legacy_data_json_backup IS NOT NULL "
        "AND legacy_style_json_backup IS NOT NULL"
    )
    incomplete = connection.scalar(
        sa.text(
            f"SELECT COUNT(*) FROM {table} WHERE "
            "(legacy_data_json_backup IS NULL) <> (legacy_style_json_backup IS NULL)"
        )
    )
    if incomplete:
        raise RuntimeError(f"{table} contains incomplete legacy backups")
    connection.execute(statement)


def _backup_columns_exist(connection: Connection) -> bool:
    states = []
    inspector = sa.inspect(connection)
    for table in ("resumes", "resume_versions"):
        columns = {column["name"] for column in inspector.get_columns(table)}
        present = columns & BACKUP_COLUMNS
        if present and present != BACKUP_COLUMNS:
            raise RuntimeError(f"{table} contains only part of the 0005 backup columns")
        states.append(present == BACKUP_COLUMNS)
    if any(states) and not all(states):
        raise RuntimeError("0005 backup columns exist on only one snapshot table")
    return all(states)


def upgrade() -> None:
    connection = op.get_bind()
    if not _backup_columns_exist(connection):
        execute_sql_file(connection, SQL_DIR / "0005.up.sql")
    _migrate_table(connection, "resumes")
    _migrate_table(connection, "resume_versions")


def downgrade() -> None:
    raise RuntimeError("LinkCV database migrations are forward-only")
