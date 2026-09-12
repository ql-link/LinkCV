"""Freeze the selected template definition on active resume imports.

Revision 0047 added the relational template identity to generic parse tasks,
but a worker still had to re-read the mutable template row to obtain its
layout.  This revision adds a nullable JSON snapshot.  Only active
``resume_import`` tasks are backfilled; dataset tasks and terminal historical
tasks intentionally remain nullable.

Every candidate value is normalized and validated before the DDL or first
UPDATE.  The worker can therefore use the task snapshot for a stable import
while the template catalog remains free to change later.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op

from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume import TemplateDefinition

revision: str = "0049"
down_revision: str | None = "0048"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
JsonObject = dict[str, Any]
FrozenTemplatePayloads = dict[int, JsonObject]


def _decode_json(value: object, *, field: str) -> object:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    return value


def _normalized_definition(
    value: object,
    *,
    template_key: object,
    field: str,
) -> JsonObject:
    if not isinstance(template_key, str) or not template_key:
        raise RuntimeError(f"{field} has no valid template key")
    decoded = _decode_json(value, field=field)
    try:
        definition = TemplateDefinition.model_validate(decoded)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} is not a valid TemplateDefinition") from error
    if definition.template_key != template_key:
        raise RuntimeError(f"{field} template key disagrees with its relational key")
    return definition.model_dump(mode="json")


def _active_resume_import_rows(
    connection: sa.engine.Connection,
) -> list[dict[str, Any]]:
    return (
        connection.execute(
            sa.text(
                "SELECT d.id, d.selected_template_id, "
                "t.`key` AS template_key, t.style_json "
                "FROM document_parse_tasks AS d "
                "LEFT JOIN resume_templates AS t "
                "ON t.id = d.selected_template_id "
                "WHERE d.source_type = 'resume_import' "
                "AND (d.upload_status = 'uploading' "
                "OR d.parse_status = 'processing') "
                "ORDER BY d.id"
            )
        )
        .mappings()
        .all()
    )


def _preflight(connection: sa.engine.Connection) -> FrozenTemplatePayloads:
    """Validate and normalize every active import before schema mutation."""

    payloads: FrozenTemplatePayloads = {}
    for row in _active_resume_import_rows(connection):
        task_id = int(row["id"])
        selected_template_id = row.get("selected_template_id")
        if selected_template_id is None:
            raise RuntimeError(
                f"document_parse_tasks[{task_id}] has no selected template"
            )
        if row.get("template_key") is None or row.get("style_json") is None:
            raise RuntimeError(
                f"document_parse_tasks[{task_id}] references a missing template"
            )
        payloads[task_id] = _normalized_definition(
            row["style_json"],
            template_key=row["template_key"],
            field=f"document_parse_tasks[{task_id}].selected_template_style_json",
        )
    return payloads


def _write_frozen_templates(
    connection: sa.engine.Connection,
    payloads: FrozenTemplatePayloads,
) -> None:
    statement = sa.text(
        "UPDATE document_parse_tasks "
        "SET selected_template_style_json = :style_json "
        "WHERE id = :id "
        "AND source_type = 'resume_import' "
        "AND (upload_status = 'uploading' OR parse_status = 'processing')"
    )
    for task_id, payload in payloads.items():
        result = connection.execute(
            statement,
            {
                "id": task_id,
                "style_json": json.dumps(
                    payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            },
        )
        if result.rowcount != 1:
            raise RuntimeError(
                f"active resume import {task_id} changed during 0049 backfill"
            )


def _verify(
    connection: sa.engine.Connection,
    expected: FrozenTemplatePayloads,
) -> None:
    """Verify active backfills and preserve null semantics for other tasks."""

    rows = (
        connection.execute(
            sa.text(
                "SELECT id, source_type, upload_status, parse_status, "
                "selected_template_style_json "
                "FROM document_parse_tasks ORDER BY id"
            )
        )
        .mappings()
        .all()
    )
    seen_active: set[int] = set()
    for row in rows:
        task_id = int(row["id"])
        source_type = row["source_type"]
        frozen = row.get("selected_template_style_json")
        if source_type == "dataset":
            if frozen is not None:
                raise RuntimeError(
                    f"dataset task {task_id} unexpectedly has a template snapshot"
                )
            continue
        if source_type != "resume_import":
            continue
        active = row["upload_status"] == "uploading" or row["parse_status"] == (
            "processing"
        )
        if not active:
            if frozen is not None:
                decoded = _decode_json(
                    frozen,
                    field=f"document_parse_tasks[{task_id}].selected_template_style_json",
                )
                template_key = (
                    decoded.get("template_key")
                    if isinstance(decoded, dict)
                    else None
                )
                _normalized_definition(
                    decoded,
                    template_key=template_key,
                    field=f"document_parse_tasks[{task_id}].selected_template_style_json",
                )
            continue
        if frozen is None:
            raise RuntimeError(
                f"active resume import {task_id} has no template snapshot after 0049"
            )
        if task_id not in expected:
            raise RuntimeError(
                f"active resume import {task_id} was not present during 0049 preflight"
            )
        decoded = _decode_json(
            frozen,
            field=f"document_parse_tasks[{task_id}].selected_template_style_json",
        )
        if decoded != expected[task_id]:
            raise RuntimeError(
                f"active resume import {task_id} has an unexpected template snapshot"
            )
        try:
            TemplateDefinition.model_validate(decoded)
        except (TypeError, ValueError) as error:
            raise RuntimeError(
                f"active resume import {task_id} has an invalid template snapshot"
            ) from error
        seen_active.add(task_id)
    if seen_active != set(expected):
        raise RuntimeError("0049 active resume import backfill verification is incomplete")


def upgrade() -> None:
    connection = op.get_bind()
    payloads = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0049.up.sql")
    _write_frozen_templates(connection, payloads)
    _verify(connection, payloads)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
