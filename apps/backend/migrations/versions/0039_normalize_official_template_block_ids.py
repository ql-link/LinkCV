"""Normalize official template block ids for the editor renderer.

Revision 0037 split reviewed template Markdown into semantic custom sections,
but generated ``template_*`` section identifiers.  The Web editor deliberately
recognizes only opaque ``blk_*`` anchors, so those identifiers were rendered as
visible text.  This forward correction replaces every official template custom
section identifier with a deterministic opaque block id and updates its
semantic reference in the same snapshot.

All official templates are converted and validated before the first update.
The written rows are then read back and converted again to verify the complete
snapshot set.  User resumes and immutable versions are not changed; callers
must recreate affected development data from the corrected templates.

Revision ID: 0039
Revises: 0038
Create Date: 2026-08-25 02:56:21.879814
"""

import hashlib
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume_snapshot import parse_resume_snapshot

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
BLOCK_ID_PATTERN = re.compile(r"^blk_[a-z0-9]{16,64}$")
OFFICIAL_TEMPLATE_KEYS = {
    "blank-cn",
    "classic-cn",
    "modern-two-column-cn",
    "compact-tech-cn",
    "classic-technical-cn",
    "administrative-sidebar-cn",
    "campus-professional-cn",
    "civic-service-cn",
    "creative-orange-cn",
}


def _decode_json(value: object, *, field: str) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    return value


def _stable_block_id(*, template_key: str, original_id: str) -> str:
    digest = hashlib.sha256(
        f"official-template:{template_key}:{original_id}".encode()
    ).hexdigest()[:24]
    return f"blk_{digest}"


def _normalize_block_ids(
    data_value: object,
    style_value: object,
    *,
    template_key: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    data = _decode_json(data_value, field=f"resume_templates[{template_key}].data_json")
    style = _decode_json(
        style_value, field=f"resume_templates[{template_key}].style_json"
    )
    sections = data.get("sections")
    semantic_sections = data.get("semantic_sections")
    custom_sections = (
        sections.get("custom_sections") if isinstance(sections, dict) else None
    )
    if not isinstance(custom_sections, list) or not isinstance(semantic_sections, list):
        raise RuntimeError(f"official template {template_key} has invalid sections")

    id_map: dict[str, str] = {}
    normalized_custom: list[dict[str, Any]] = []
    for section in custom_sections:
        if not isinstance(section, dict) or not isinstance(section.get("id"), str):
            raise RuntimeError(
                f"official template {template_key} has invalid custom content"
            )
        original_id = section["id"]
        block_id = (
            original_id
            if BLOCK_ID_PATTERN.fullmatch(original_id)
            else _stable_block_id(template_key=template_key, original_id=original_id)
        )
        if original_id in id_map or block_id in id_map.values():
            raise RuntimeError(
                f"official template {template_key} has duplicate block ids"
            )
        id_map[original_id] = block_id
        normalized_custom.append({**section, "id": block_id})

    normalized_semantic: list[dict[str, Any]] = []
    for semantic in semantic_sections:
        if not isinstance(semantic, dict):
            raise RuntimeError(
                f"official template {template_key} has invalid semantics"
            )
        if semantic.get("content_key") != "custom_sections":
            normalized_semantic.append(semantic)
            continue
        original_id = semantic.get("custom_section_id")
        if not isinstance(original_id, str) or original_id not in id_map:
            raise RuntimeError(
                f"official template {template_key} has an unresolved semantic block"
            )
        normalized_semantic.append(
            {**semantic, "custom_section_id": id_map[original_id]}
        )

    candidate = {
        **data,
        "sections": {**sections, "custom_sections": normalized_custom},
        "semantic_sections": normalized_semantic,
    }
    snapshot = parse_resume_snapshot(candidate, style)
    return snapshot.data.model_dump(mode="json"), snapshot.style.model_dump(mode="json")


ConvertedTemplate = tuple[int, str, dict[str, Any], dict[str, Any]]


def _preflight(connection: sa.engine.Connection) -> list[ConvertedTemplate]:
    converted: list[ConvertedTemplate] = []
    rows = connection.execute(
        sa.text(
            "SELECT id, `key`, data_json, style_json FROM resume_templates ORDER BY id"
        )
    ).mappings()
    for row in rows:
        template_key = str(row["key"])
        if template_key not in OFFICIAL_TEMPLATE_KEYS:
            continue
        data, style = _normalize_block_ids(
            row["data_json"], row["style_json"], template_key=template_key
        )
        converted.append((int(row["id"]), template_key, data, style))
    if {item[1] for item in converted} != OFFICIAL_TEMPLATE_KEYS:
        raise RuntimeError("official template set is incomplete")
    return converted


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0039.up.sql")
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
                "data_json": json.dumps(
                    data, ensure_ascii=False, separators=(",", ":")
                ),
                "style_json": json.dumps(
                    style, ensure_ascii=False, separators=(",", ":")
                ),
            },
        )
        if result.rowcount != 1:
            raise RuntimeError(f"official template {template_key} was not normalized")
    verified = _preflight(connection)
    if verified != converted:
        raise RuntimeError("official template block id verification failed")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
