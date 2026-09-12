"""Remove typed duplicates from canonical official template snapshots.

Revision 0037 split each official editor Markdown document into stable custom
sections, but deliberately retained the old typed fields while validating only
the document shape.  The complete snapshot contract rejects that second copy.
This forward correction keeps the reviewed editor sections as the sole content
truth, retains only the name/photo metadata allowed by the contract, and
validates each complete data/style pair before the first write.

Revision ID: 0038
Revises: 0037
Create Date: 2026-08-25 02:41:37.223636
"""
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume_snapshot import parse_resume_snapshot

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
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


def _remove_typed_duplicates(
    data_value: object,
    style_value: object,
    *,
    template_key: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    data = _decode_json(
        data_value, field=f"resume_templates[{template_key}].data_json"
    )
    style = _decode_json(
        style_value, field=f"resume_templates[{template_key}].style_json"
    )
    semantic_sections = data.get("semantic_sections")
    if not isinstance(semantic_sections, list) or not semantic_sections:
        raise RuntimeError(f"official template {template_key} has no semantic sections")
    if all(
        isinstance(section, dict)
        and section.get("content_key") == "custom_sections"
        for section in semantic_sections
    ):
        basics = data.get("basics")
        sections = data.get("sections")
        if not isinstance(basics, dict) or not isinstance(sections, dict):
            raise RuntimeError(f"official template {template_key} has invalid content")
        data = {
            **data,
            "basics": {
                **basics,
                "headline": None,
                "email": None,
                "phone": None,
                "location": None,
                "summary": None,
                "links": [],
            },
            "sections": {
                **sections,
                "work_experiences": [],
                "educations": [],
                "projects": [],
                "skills": [],
                "certificates": [],
                "awards": [],
                "languages": [],
            },
        }
    snapshot = parse_resume_snapshot(data, style)
    return (
        snapshot.data.model_dump(mode="json"),
        snapshot.style.model_dump(mode="json"),
    )


ConvertedTemplate = tuple[int, str, dict[str, Any], dict[str, Any]]


def _preflight(connection: sa.engine.Connection) -> list[ConvertedTemplate]:
    converted: list[ConvertedTemplate] = []
    rows = connection.execute(
        sa.text("SELECT id, `key`, data_json, style_json FROM resume_templates ORDER BY id")
    ).mappings()
    for row in rows:
        template_key = str(row["key"])
        if template_key not in OFFICIAL_TEMPLATE_KEYS:
            continue
        data, style = _remove_typed_duplicates(
            row["data_json"], row["style_json"], template_key=template_key
        )
        converted.append((int(row["id"]), template_key, data, style))
    if {item[1] for item in converted} != OFFICIAL_TEMPLATE_KEYS:
        raise RuntimeError("official template set is incomplete")
    return converted


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0038.up.sql")
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
            raise RuntimeError(f"official template {template_key} was not normalized")
    verified = _preflight(connection)
    if verified != converted:
        raise RuntimeError("official template duplicate removal verification failed")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
