"""Repair official column-template manifests.

Revision 0036 assigned the complete ``basics`` semantic block to the sidebar
of every column template. That block also contains the candidate name and
headline, so applying the administrative template moved the identity header
out of the main column. This forward correction removes ``basics`` from the
official sidebar slot in templates, resumes and immutable versions while
preserving all content and every other presentation value.

Every targeted snapshot is converted and validated before the first write,
then read back and validated again.

Revision ID: 0040
Revises: 0039
Create Date: 2026-08-25 12:15:12.083497
"""

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume_snapshot import parse_resume_snapshot

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
COLUMN_TEMPLATE_KEYS = {"modern-two-column-cn", "administrative-sidebar-cn"}
TABLES = ("resume_templates", "resumes", "resume_versions")


def _decode_json(value: object, *, field: str) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    return value


def _repair_snapshot(
    data_value: object,
    style_value: object,
    *,
    field: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    data = _decode_json(data_value, field=f"{field}.data_json")
    style = _decode_json(style_value, field=f"{field}.style_json")
    current = parse_resume_snapshot(data, style)
    if current.style.template_key not in COLUMN_TEMPLATE_KEYS:
        return current.data.model_dump(mode="json"), current.style.model_dump(mode="json")

    manifest = current.style.manifest.model_dump(mode="json")
    sidebar_ids = {
        region["id"] for region in manifest["regions"] if region["kind"] == "sidebar"
    }
    changed = False
    repaired_slots: list[dict[str, Any]] = []
    for slot in manifest["slots"]:
        accepts = list(slot["accepts"])
        if slot["region_id"] in sidebar_ids and "basics" in accepts:
            accepts.remove("basics")
            changed = True
        repaired_slots.append({**slot, "accepts": accepts})
    if not changed:
        return current.data.model_dump(mode="json"), current.style.model_dump(mode="json")

    candidate_style = {
        **current.style.model_dump(mode="json"),
        "manifest": {**manifest, "slots": repaired_slots},
    }
    repaired = parse_resume_snapshot(current.data.model_dump(mode="json"), candidate_style)
    if repaired.data != current.data:
        raise RuntimeError(f"{field} content changed during manifest repair")
    return repaired.data.model_dump(mode="json"), repaired.style.model_dump(mode="json")


ConvertedRow = tuple[str, int, dict[str, Any], dict[str, Any]]


def _preflight(connection: sa.engine.Connection) -> list[ConvertedRow]:
    converted: list[ConvertedRow] = []
    for table in TABLES:
        rows = connection.execute(
            sa.text(f"SELECT id, data_json, style_json FROM {table} ORDER BY id")
        ).mappings()
        for row in rows:
            style = _decode_json(row["style_json"], field=f"{table}[{row['id']}].style_json")
            if style.get("template_key") not in COLUMN_TEMPLATE_KEYS:
                continue
            data, repaired_style = _repair_snapshot(
                row["data_json"],
                style,
                field=f"{table}[{row['id']}]",
            )
            converted.append((table, int(row["id"]), data, repaired_style))
    return converted


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0040.up.sql")
    converted = _preflight(connection)
    for table, row_id, data, style in converted:
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
            raise RuntimeError(f"{table}[{row_id}] manifest was not repaired")
    verified = _preflight(connection)
    if verified != converted:
        raise RuntimeError("official column-template manifest verification failed")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
