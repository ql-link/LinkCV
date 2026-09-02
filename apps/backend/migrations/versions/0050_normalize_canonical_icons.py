"""Normalize legacy Markdown icon markers in canonical resume snapshots.

0049 is already present in shared environments, so the icon repair belongs to
its own forward-only revision.  The conversion is deliberately implemented in
Python: MySQL JSON expressions cannot safely preserve every text-run mark,
link, style, and run boundary while splitting a marker.  Every row in all
three canonical snapshot tables is read and validated before the SQL entry
point or the first UPDATE is executed.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from alembic import op

from linkcv.core.migration_sql import execute_sql_file
from linkcv.domain.resume import CanonicalResumeDocument

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).parent.parent / "sql"
TABLES = ("resume_templates", "resumes", "resume_versions")

JsonObject = dict[str, Any]
CanonicalPayloads = dict[str, dict[int, JsonObject]]

INLINE_ICON_NAMES: frozenset[str] = frozenset(
    {
        "Mail",
        "Phone",
        "MapPin",
        "Globe",
        "Github",
        "Linkedin",
        "GraduationCap",
        "Briefcase",
        "Award",
        "Star",
        "Calendar",
        "Code2",
    }
)
INLINE_ICON_MARKER = re.compile(r":icon\[(?P<name>[A-Za-z0-9]+)\]:")
SECTION_ICON_MARKER = re.compile(
    r"\A[ \t]*:icon\[(?P<name>[A-Za-z0-9]+)\]:[ \t]*(?P<title>.*)\Z",
    re.DOTALL,
)


def _decode_json(value: object, *, field: str) -> object:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{field} is not valid JSON") from error
    return value


def _object(value: object, *, field: str) -> JsonObject:
    decoded = _decode_json(value, field=field)
    if not isinstance(decoded, dict):
        raise RuntimeError(f"{field} must be a JSON object")
    return decoded


def _has_valid_marker(value: str) -> bool:
    return any(
        match.group("name") in INLINE_ICON_NAMES
        for match in INLINE_ICON_MARKER.finditer(value)
    )


def _split_text_run(run: JsonObject, *, field: str) -> list[JsonObject]:
    value = run.get("text")
    if not isinstance(value, str):
        raise RuntimeError(f"{field}.text must be a string")
    matches = [
        match
        for match in INLINE_ICON_MARKER.finditer(value)
        if match.group("name") in INLINE_ICON_NAMES
    ]
    if not matches:
        return [copy.deepcopy(run)]

    result: list[JsonObject] = []
    cursor = 0
    for match in matches:
        if match.start() > cursor:
            text_run = copy.deepcopy(run)
            text_run["text"] = value[cursor : match.start()]
            result.append(text_run)
        result.append(
            {
                "inline_type": "icon",
                "name": match.group("name"),
            }
        )
        cursor = match.end()
    if cursor < len(value):
        text_run = copy.deepcopy(run)
        text_run["text"] = value[cursor:]
        result.append(text_run)
    return result


def _normalize_runs(runs: object, *, field: str) -> list[JsonObject]:
    if not isinstance(runs, list):
        raise RuntimeError(f"{field} must be a JSON array")
    typed_runs: list[JsonObject] = []
    for index, run in enumerate(runs):
        if not isinstance(run, dict):
            raise RuntimeError(f"{field}[{index}] must be a JSON object")
        typed_runs.append(run)

    has_structured_icon = any(run.get("inline_type") == "icon" for run in typed_runs)
    has_marker = any(
        run.get("inline_type") == "text"
        and isinstance(run.get("text"), str)
        and _has_valid_marker(run["text"])
        for run in typed_runs
    )
    if has_structured_icon and has_marker:
        raise RuntimeError(f"{field} mixes a structured icon with a legacy marker")

    result: list[JsonObject] = []
    for index, run in enumerate(typed_runs):
        if run.get("inline_type") == "text":
            result.extend(_split_text_run(run, field=f"{field}[{index}]"))
        else:
            result.append(copy.deepcopy(run))
    return result


def _normalize_blocks(blocks: object, *, field: str) -> None:
    if not isinstance(blocks, list):
        raise RuntimeError(f"{field} must be a JSON array")
    for block_index, block in enumerate(blocks):
        if not isinstance(block, dict):
            raise RuntimeError(f"{field}[{block_index}] must be a JSON object")
        block_type = block.get("block_type")
        block_field = f"{field}[{block_index}]"
        if block_type == "paragraph":
            block["runs"] = _normalize_runs(block.get("runs"), field=f"{block_field}.runs")
        elif block_type in {"ordered_list", "bullet_list"}:
            items = block.get("items")
            if not isinstance(items, list):
                raise RuntimeError(f"{block_field}.items must be a JSON array")
            for item_index, item in enumerate(items):
                if not isinstance(item, dict):
                    raise RuntimeError(
                        f"{block_field}.items[{item_index}] must be a JSON object"
                    )
                item["runs"] = _normalize_runs(
                    item.get("runs"),
                    field=f"{block_field}.items[{item_index}].runs",
                )
        elif block_type == "row":
            cells = block.get("cells")
            if not isinstance(cells, list):
                raise RuntimeError(f"{block_field}.cells must be a JSON array")
            for cell_index, cell in enumerate(cells):
                if not isinstance(cell, dict):
                    raise RuntimeError(
                        f"{block_field}.cells[{cell_index}] must be a JSON object"
                    )
                _normalize_blocks(
                    cell.get("blocks"),
                    field=f"{block_field}.cells[{cell_index}].blocks",
                )


def _normalize_section_title(section: JsonObject, *, field: str) -> None:
    title = section.get("title")
    if not isinstance(title, dict):
        return
    value = title.get("value")
    if not isinstance(value, str):
        return
    match = SECTION_ICON_MARKER.fullmatch(value)
    if match is None or match.group("name") not in INLINE_ICON_NAMES:
        return
    if section.get("title_icon") is not None:
        raise RuntimeError(f"{field} mixes a structured title icon with a legacy marker")
    title["value"] = match.group("title").strip()
    section["title_icon"] = {
        "inline_type": "icon",
        "name": match.group("name"),
    }


def _normalize_document(value: object, *, field: str) -> JsonObject:
    payload = _object(value, field=field)
    try:
        # Validate before touching the candidate.  This makes malformed or
        # already-conflicting canonical data fail before any write can occur.
        CanonicalResumeDocument.model_validate(payload)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} is not canonical resume JSON") from error

    candidate = copy.deepcopy(payload)
    sections = candidate.get("sections")
    if not isinstance(sections, list):
        raise RuntimeError(f"{field}.sections must be a JSON array")
    for section_index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise RuntimeError(f"{field}.sections[{section_index}] must be a JSON object")
        section_field = f"{field}.sections[{section_index}]"
        _normalize_section_title(section, field=section_field)
        _normalize_blocks(
            section.get("blocks"),
            field=f"{section_field}.blocks",
        )
        entries = section.get("entries")
        if not isinstance(entries, list):
            raise RuntimeError(f"{section_field}.entries must be a JSON array")
        for entry_index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                raise RuntimeError(
                    f"{section_field}.entries[{entry_index}] must be a JSON object"
                )
            _normalize_blocks(
                entry.get("blocks"),
                field=f"{section_field}.entries[{entry_index}].blocks",
            )

    try:
        CanonicalResumeDocument.model_validate(candidate)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{field} failed strict validation after icon repair") from error
    return candidate


def normalize_canonical_document(value: object, *, field: str = "canonical document") -> JsonObject:
    """Return a validated, idempotent canonical icon conversion."""

    return _normalize_document(value, field=field)


def _table_rows(
    connection: sa.engine.Connection,
    table: str,
) -> list[dict[str, Any]]:
    if table not in TABLES:
        raise RuntimeError(f"unsupported canonical table: {table}")
    return (
        connection.execute(
            sa.text(f"SELECT id, data_json FROM {table} ORDER BY id")
        )
        .mappings()
        .all()
    )


def _preflight(connection: sa.engine.Connection) -> CanonicalPayloads:
    """Validate every row, returning only rows whose JSON actually changes."""

    payloads: CanonicalPayloads = {table: {} for table in TABLES}
    for table in TABLES:
        for row in _table_rows(connection, table):
            row_id = int(row["id"])
            field = f"{table}[{row_id}].data_json"
            raw = _object(row.get("data_json"), field=field)
            candidate = _normalize_document(raw, field=field)
            if candidate != raw:
                payloads[table][row_id] = candidate
    return payloads


def _write_payloads(
    connection: sa.engine.Connection,
    payloads: CanonicalPayloads,
) -> None:
    statements = {
        table: sa.text(
            f"UPDATE {table} SET data_json=:data_json WHERE id=:id"
        )
        for table in TABLES
    }
    for table in TABLES:
        for row_id, payload in payloads.get(table, {}).items():
            result = connection.execute(
                statements[table],
                {
                    "id": row_id,
                    "data_json": json.dumps(
                        payload,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                },
            )
            rowcount = getattr(result, "rowcount", None)
            if rowcount is not None and rowcount != 1:
                raise RuntimeError(f"{table}[{row_id}] changed during 0050 icon repair")


def _verify(connection: sa.engine.Connection) -> None:
    """Verify all rows are valid and require no further conversion."""

    for table in TABLES:
        for row in _table_rows(connection, table):
            row_id = int(row["id"])
            field = f"{table}[{row_id}].data_json"
            raw = _object(row.get("data_json"), field=field)
            normalized = _normalize_document(raw, field=field)
            if normalized != raw:
                raise RuntimeError(f"{field} still contains a legacy icon marker")


def upgrade() -> None:
    connection = op.get_bind()
    payloads = _preflight(connection)
    execute_sql_file(connection, SQL_DIR / "0050.up.sql")
    _write_payloads(connection, payloads)
    _verify(connection)


def downgrade() -> None:
    raise RuntimeError(
        "LinkCV database migrations are forward-only; restore a backup or create a new forward revision"
    )
