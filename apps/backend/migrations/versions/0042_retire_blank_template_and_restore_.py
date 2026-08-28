"""Retire the blank template and restore the reviewed official layout.

The blank template is no longer a product entry. Existing resumes own complete
data/style snapshots, so deleting the template row keeps their content and
presentation while the ``ON DELETE SET NULL`` foreign key clears only their
source reference.

Revision 0037 also widened the classic technical template margins from the
reviewed production values. This forward correction restores those page
tokens in the template and every persisted snapshot that uses that theme.
All affected JSON is validated before the SQL-first update and after it.

Revision ID: 0042
Revises: 0041
Create Date: 2026-08-25 15:11:13.197997
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op
from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume_snapshot import parse_resume_snapshot

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
BLANK_TEMPLATE_KEY = "blank-cn"
CLASSIC_TECHNICAL_KEY = "classic-technical-cn"
CLASSIC_TECHNICAL_MARGINS = (9.0, 11.0, 9.0, 11.0)
SNAPSHOT_TABLES = ("resume_templates", "resumes", "resume_versions")


def _decode_json(value: object, *, field: str) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    return value


def _restore_classic_technical_style(
    data_value: object,
    style_value: object,
    *,
    field: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    data = _decode_json(data_value, field=f"{field}.data_json")
    style = _decode_json(style_value, field=f"{field}.style_json")
    current = parse_resume_snapshot(data, style)
    if current.style.template_key != CLASSIC_TECHNICAL_KEY:
        raise RuntimeError(f"{field} is not a classic technical snapshot")
    top, right, bottom, left = CLASSIC_TECHNICAL_MARGINS
    candidate_style = {
        **current.style.model_dump(mode="json"),
        "page": {
            **current.style.page.model_dump(mode="json"),
            "margin_top_mm": top,
            "margin_right_mm": right,
            "margin_bottom_mm": bottom,
            "margin_left_mm": left,
        },
    }
    restored = parse_resume_snapshot(
        current.data.model_dump(mode="json"), candidate_style
    )
    if restored.data != current.data:
        raise RuntimeError(f"{field} content changed during layout restoration")
    return (
        restored.data.model_dump(mode="json"),
        restored.style.model_dump(mode="json"),
    )


ExpectedSnapshot = tuple[str, int, dict[str, Any], dict[str, Any]]


def _preflight(
    connection: sa.engine.Connection,
) -> tuple[int, tuple[int, ...], list[ExpectedSnapshot]]:
    blank_rows = connection.execute(
        sa.text(
            "SELECT id, data_json, style_json FROM resume_templates "
            "WHERE `key` = :key FOR UPDATE"
        ),
        {"key": BLANK_TEMPLATE_KEY},
    ).mappings().all()
    if len(blank_rows) != 1:
        raise RuntimeError("the official blank template must exist exactly once")
    blank = blank_rows[0]
    blank_id = int(blank["id"])
    blank_snapshot = parse_resume_snapshot(blank["data_json"], blank["style_json"])
    if blank_snapshot.style.template_key != BLANK_TEMPLATE_KEY:
        raise RuntimeError("the blank template row has an unexpected style snapshot")
    referenced_resume_ids = tuple(
        int(row["id"])
        for row in connection.execute(
            sa.text("SELECT id FROM resumes WHERE template_id = :template_id ORDER BY id"),
            {"template_id": blank_id},
        ).mappings()
    )

    expected: list[ExpectedSnapshot] = []
    for table in SNAPSHOT_TABLES:
        if table == "resume_templates":
            query = sa.text(
                "SELECT id, data_json, style_json FROM resume_templates "
                "WHERE `key` = :key ORDER BY id"
            )
        else:
            query = sa.text(
                f"SELECT id, data_json, style_json FROM {table} "
                "WHERE JSON_UNQUOTE(JSON_EXTRACT(style_json, '$.template_key')) = :key "
                "ORDER BY id"
            )
        rows = connection.execute(query, {"key": CLASSIC_TECHNICAL_KEY}).mappings()
        for row in rows:
            data, style = _restore_classic_technical_style(
                row["data_json"],
                row["style_json"],
                field=f"{table}[{row['id']}]",
            )
            expected.append((table, int(row["id"]), data, style))
    if not any(table == "resume_templates" for table, *_ in expected):
        raise RuntimeError("the classic technical template is missing")
    return blank_id, referenced_resume_ids, expected


def _verify(
    connection: sa.engine.Connection,
    *,
    blank_id: int,
    referenced_resume_ids: tuple[int, ...],
    expected: list[ExpectedSnapshot],
) -> None:
    remaining_blank = connection.scalar(
        sa.text("SELECT COUNT(*) FROM resume_templates WHERE `key` = :key"),
        {"key": BLANK_TEMPLATE_KEY},
    )
    if remaining_blank != 0:
        raise RuntimeError("the blank template was not deleted")
    if referenced_resume_ids:
        rows = connection.execute(
            sa.text(
                "SELECT id, template_id FROM resumes "
                "WHERE id IN :resume_ids ORDER BY id"
            ).bindparams(sa.bindparam("resume_ids", expanding=True)),
            {"resume_ids": referenced_resume_ids},
        ).mappings().all()
        if [int(row["id"]) for row in rows] != list(referenced_resume_ids):
            raise RuntimeError("a resume referencing the blank template disappeared")
        if any(row["template_id"] is not None for row in rows):
            raise RuntimeError("a retired blank-template reference was not cleared")
    dangling = connection.scalar(
        sa.text("SELECT COUNT(*) FROM resumes WHERE template_id = :template_id"),
        {"template_id": blank_id},
    )
    if dangling != 0:
        raise RuntimeError("blank-template references remain after deletion")

    for table, row_id, expected_data, expected_style in expected:
        row = connection.execute(
            sa.text(f"SELECT data_json, style_json FROM {table} WHERE id = :id"),
            {"id": row_id},
        ).mappings().one_or_none()
        if row is None:
            raise RuntimeError(f"{table}[{row_id}] disappeared during verification")
        actual_data = _decode_json(
            row["data_json"], field=f"{table}[{row_id}].data_json"
        )
        actual_style = _decode_json(
            row["style_json"], field=f"{table}[{row_id}].style_json"
        )
        if actual_data != expected_data or actual_style != expected_style:
            raise RuntimeError(f"{table}[{row_id}] layout restoration failed")


def upgrade() -> None:
    connection = op.get_bind()
    blank_id, referenced_resume_ids, expected = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0042.up.sql")
    _verify(
        connection,
        blank_id=blank_id,
        referenced_resume_ids=referenced_resume_ids,
        expected=expected,
    )


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
