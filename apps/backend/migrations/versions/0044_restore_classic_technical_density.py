"""Restore the compact density for future classic technical snapshots.

The classic technical template is the only row changed by this revision.
Existing resumes and immutable resume versions own their complete style
snapshots and are deliberately outside the migration's write set.

The SQL predicate protects the reviewed 0043 values.  The Python preflight and
postflight additionally validate the complete canonical snapshot, the target
row count, and the exact data preservation boundary before reporting success.

Revision ID: 0044
Revises: 0043
Create Date: 2026-08-26 14:00:00.000000
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

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
CLASSIC_TECHNICAL_KEY = "classic-technical-cn"
EXPECTED_CURRENT = {
    "font_size": 11.5,
    "line_height": 1.42,
    "accent_color": "#2F4858",
    "page": {
        "margin_top_mm": 9.0,
        "margin_right_mm": 11.0,
        "margin_bottom_mm": 9.0,
        "margin_left_mm": 11.0,
    },
}
TARGET_DENSITY = {
    "font_size": 9.5,
    "line_height": 1.25,
    "accent_color": "#202632",
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


def _assert_current_density(style: Any, *, field: str) -> None:
    expected_page = EXPECTED_CURRENT["page"]
    if (
        style.template_key != CLASSIC_TECHNICAL_KEY
        or style.font_size != EXPECTED_CURRENT["font_size"]
        or style.line_height != EXPECTED_CURRENT["line_height"]
        or style.accent_color != EXPECTED_CURRENT["accent_color"]
        or style.page.margin_top_mm != expected_page["margin_top_mm"]
        or style.page.margin_right_mm != expected_page["margin_right_mm"]
        or style.page.margin_bottom_mm != expected_page["margin_bottom_mm"]
        or style.page.margin_left_mm != expected_page["margin_left_mm"]
    ):
        raise RuntimeError(
            f"{field} does not match the protected 0043 classic technical style"
        )


def _target_snapshot(
    data_value: object,
    style_value: object,
    *,
    field: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    data = _decode_json(data_value, field=f"{field}.data_json")
    style = _decode_json(style_value, field=f"{field}.style_json")
    current = parse_resume_snapshot(data, style)
    _assert_current_density(current.style, field=field)
    candidate_style = {
        **current.style.model_dump(mode="json"),
        "font_size": TARGET_DENSITY["font_size"],
        "line_height": TARGET_DENSITY["line_height"],
        "accent_color": TARGET_DENSITY["accent_color"],
    }
    target = parse_resume_snapshot(
        current.data.model_dump(mode="json"),
        candidate_style,
    )
    if target.data != current.data:
        raise RuntimeError(f"{field} content changed during density restoration")
    return (
        current.data.model_dump(mode="json"),
        target.style.model_dump(mode="json"),
    )


def _preflight(
    connection: sa.engine.Connection,
) -> tuple[int, dict[str, Any], dict[str, Any]]:
    rows = connection.execute(
        sa.text(
            "SELECT id, data_json, style_json FROM resume_templates "
            "WHERE `key` = :key FOR UPDATE"
        ),
        {"key": CLASSIC_TECHNICAL_KEY},
    ).mappings().all()
    if len(rows) != 1:
        raise RuntimeError(
            "classic technical template must exist exactly once before 0044"
        )
    row = rows[0]
    data, target_style = _target_snapshot(
        row["data_json"],
        row["style_json"],
        field=f"resume_templates[{row['id']}]",
    )
    return int(row["id"]), data, target_style


def _verify(
    connection: sa.engine.Connection,
    *,
    template_id: int,
    expected_data: dict[str, Any],
    expected_style: dict[str, Any],
) -> None:
    rows = connection.execute(
        sa.text(
            "SELECT id, data_json, style_json FROM resume_templates "
            "WHERE `key` = :key ORDER BY id"
        ),
        {"key": CLASSIC_TECHNICAL_KEY},
    ).mappings().all()
    if len(rows) != 1 or int(rows[0]["id"]) != template_id:
        raise RuntimeError("classic technical template row count changed in 0044")
    actual_data = _decode_json(
        rows[0]["data_json"],
        field=f"resume_templates[{template_id}].data_json",
    )
    actual_style = _decode_json(
        rows[0]["style_json"],
        field=f"resume_templates[{template_id}].style_json",
    )
    actual = parse_resume_snapshot(actual_data, actual_style)
    expected = parse_resume_snapshot(expected_data, expected_style)
    if actual.data != expected.data:
        raise RuntimeError("0044 changed classic technical template content")
    if actual.style != expected.style:
        raise RuntimeError("0044 did not produce the protected target style")


def upgrade() -> None:
    connection = op.get_bind()
    template_id, expected_data, expected_style = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0044.up.sql")
    _verify(
        connection,
        template_id=template_id,
        expected_data=expected_data,
        expected_style=expected_style,
    )


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
