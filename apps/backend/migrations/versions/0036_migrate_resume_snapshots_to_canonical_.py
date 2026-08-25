"""Migrate every resume snapshot to the single canonical runtime model.

The conversion is intentionally implemented in bounded Python rather than SQL:
it validates every current resume, immutable version, and template before the
first write, verifies that all existing JSON leaves are preserved, then writes
the converted set in the Alembic transaction. A failure raises before commit;
production recovery remains the release backup because migrations are
forward-only.

Revision ID: 0036
Revises: 0035
Create Date: 2026-08-25 01:09:22.834258
"""
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume_document import ResumeDocument, with_default_semantics
from linkcv.domain.resume_style import (
    ResumePresentation,
    default_template_manifest,
)

revision: str = "0036"
down_revision: str | None = "0035"
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
AVATAR_TEMPLATE_KEYS = {
    "administrative-sidebar-cn",
    "campus-professional-cn",
    "civic-service-cn",
    "creative-orange-cn",
}
COLUMN_TEMPLATE_KEYS = {
    "modern-two-column-cn",
    "administrative-sidebar-cn",
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


def _assert_legacy_contract(value: dict[str, Any], *, field: str) -> None:
    if value.get("schema_version") != "1.0":
        raise RuntimeError(f"{field} is not the supported pre-migration structure")


def _assert_preserved(before: object, after: object, *, path: str = "$") -> None:
    if isinstance(before, dict):
        if not isinstance(after, dict):
            raise RuntimeError(f"canonical conversion changed object type at {path}")
        for key, value in before.items():
            if key == "schema_version" and path == "$":
                continue
            if key not in after:
                raise RuntimeError(f"canonical conversion dropped {path}.{key}")
            _assert_preserved(value, after[key], path=f"{path}.{key}")
        return
    if isinstance(before, list):
        if not isinstance(after, list) or len(before) != len(after):
            raise RuntimeError(f"canonical conversion changed list size at {path}")
        for index, value in enumerate(before):
            _assert_preserved(value, after[index], path=f"{path}[{index}]")
        return
    if before != after:
        raise RuntimeError(f"canonical conversion changed value at {path}")


def _convert_data(value: object, *, field: str) -> dict[str, Any]:
    legacy = _decode_json(value, field=field)
    _assert_legacy_contract(legacy, field=field)
    candidate = {key: item for key, item in legacy.items() if key != "schema_version"}
    candidate["semantic_sections"] = candidate.get("semantic_sections", [])
    document = with_default_semantics(ResumeDocument.model_validate(candidate))
    converted = document.model_dump(mode="json")
    _assert_preserved(legacy, converted)
    return converted


def _convert_style(value: object, *, field: str) -> dict[str, Any]:
    legacy = _decode_json(value, field=field)
    _assert_legacy_contract(legacy, field=field)
    template_key = str(legacy.get("template_key") or "classic-cn")
    candidate = {key: item for key, item in legacy.items() if key != "schema_version"}
    candidate["manifest"] = default_template_manifest(
        renderer_key="columns" if template_key in COLUMN_TEMPLATE_KEYS else "flow",
        avatar_visibility="show" if template_key in AVATAR_TEMPLATE_KEYS else "hide",
    ).model_dump(mode="json")
    presentation = ResumePresentation.model_validate(candidate)
    converted = presentation.model_dump(mode="json")
    _assert_preserved(legacy, converted)
    return converted


def _preflight(connection: sa.engine.Connection) -> list[tuple[str, int, dict[str, Any], dict[str, Any], int | None]]:
    converted: list[tuple[str, int, dict[str, Any], dict[str, Any], int | None]] = []
    for table in ("resume_templates", "resumes", "resume_versions"):
        rows = connection.execute(
            sa.text(f"SELECT id, data_json, style_json{', `key`, is_active' if table == 'resume_templates' else ''} FROM {table} ORDER BY id")
        ).mappings()
        for row in rows:
            row_id = int(row["id"])
            data = _convert_data(row["data_json"], field=f"{table}[{row_id}].data_json")
            style = _convert_style(row["style_json"], field=f"{table}[{row_id}].style_json")
            next_active: int | None = None
            if table == "resume_templates":
                next_active = int(row["is_active"]) if str(row["key"]) in OFFICIAL_TEMPLATE_KEYS else 0
            converted.append((table, row_id, data, style, next_active))
    return converted


def upgrade() -> None:
    connection = op.get_bind()
    execute_sql_file(connection, SQL_DIR / "0036.up.sql")
    converted = _preflight(connection)
    for table, row_id, data, style, next_active in converted:
        assignments = "data_json = :data_json, style_json = :style_json"
        parameters: dict[str, object] = {
            "id": row_id,
            "data_json": json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            "style_json": json.dumps(style, ensure_ascii=False, separators=(",", ":")),
        }
        if next_active is not None:
            assignments += ", is_active = :is_active"
            parameters["is_active"] = next_active
        result = connection.execute(
            sa.text(f"UPDATE {table} SET {assignments} WHERE id = :id"),
            parameters,
        )
        if result.rowcount != 1:
            raise RuntimeError(f"canonical conversion lost {table}[{row_id}]")
    for table, row_id, expected_data, expected_style, expected_active in converted:
        row = connection.execute(
            sa.text(
                f"SELECT data_json, style_json{', is_active' if table == 'resume_templates' else ''} "
                f"FROM {table} WHERE id = :id"
            ),
            {"id": row_id},
        ).mappings().one_or_none()
        if row is None:
            raise RuntimeError(f"canonical verification lost {table}[{row_id}]")
        actual_data = _decode_json(row["data_json"], field=f"{table}[{row_id}].data_json")
        actual_style = _decode_json(row["style_json"], field=f"{table}[{row_id}].style_json")
        if actual_data != expected_data or actual_style != expected_style:
            raise RuntimeError(f"canonical verification mismatch for {table}[{row_id}]")
        if expected_active is not None and int(row["is_active"]) != expected_active:
            raise RuntimeError(f"canonical activation mismatch for {table}[{row_id}]")


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
