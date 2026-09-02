from __future__ import annotations

import importlib.util
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from tests.canonical_resume_fixtures import canonical_resume_payload

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0050_normalize_canonical_icons.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0050.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0050", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Rows:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    def mappings(self) -> "_Rows":
        return self

    def all(self) -> list[dict[str, object]]:
        return self.rows


class _Result:
    rowcount = 1


class _Connection:
    def __init__(self, rows: dict[str, list[dict[str, object]]]) -> None:
        self.rows = rows
        self.updates: list[tuple[str, dict[str, object] | None]] = []

    def execute(self, statement: object, params: dict[str, object] | None = None):
        query = str(statement)
        for table in self.rows:
            if f"FROM {table} ORDER BY id" in query:
                if query.startswith("SELECT id, data_json"):
                    return _Rows(self.rows[table])
        if query.startswith("UPDATE "):
            self.updates.append((query, params))
            assert params is not None
            table = query.split()[1]
            row = next(item for item in self.rows[table] if item["id"] == params["id"])
            row["data_json"] = json.loads(str(params["data_json"]))
            return _Result()
        raise AssertionError(query)


def marker_document() -> dict[str, Any]:
    document, _ = canonical_resume_payload()
    document = deepcopy(document)
    document["sections"] = [{
        "node_id": "node_eeeeeeeeeeeeeeee",
        "source_refs": [],
        "semantic_kind": "work",
        "title": {
            "node_id": "node_ffffffffffffffff",
            "source_refs": [],
            "value": " :icon[Briefcase]: 工作经历 ",
        },
        "entries": [],
        "blocks": [{
            "node_id": "node_gggggggggggggggg",
            "source_refs": [],
            "block_type": "paragraph",
            "runs": [{
                "inline_type": "text",
                "text": "前 :icon[Mail]: 后 :icon[NotAllowed]: :icon[",
                "marks": ["bold"],
                "href": "https://example.test/profile",
                "style": {
                    "color": "#112233",
                    "font_size_pt": 11,
                    "highlight_color": "#ddeeff",
                },
            }],
        }],
    }]
    return document


def test_0050_normalizes_title_and_inline_markers_without_losing_run_metadata() -> None:
    revision = load_revision()

    normalized = revision.normalize_canonical_document(marker_document())

    section = normalized["sections"][0]
    assert section["title"]["value"] == "工作经历"
    assert section["title_icon"] == {"inline_type": "icon", "name": "Briefcase"}
    assert section["blocks"][0]["runs"] == [
        {
            "inline_type": "text",
            "text": "前 ",
            "marks": ["bold"],
            "href": "https://example.test/profile",
            "style": {
                "color": "#112233",
                "font_size_pt": 11,
                "highlight_color": "#ddeeff",
            },
        },
        {"inline_type": "icon", "name": "Mail"},
        {
            "inline_type": "text",
            "text": " 后 :icon[NotAllowed]: :icon[",
            "marks": ["bold"],
            "href": "https://example.test/profile",
            "style": {
                "color": "#112233",
                "font_size_pt": 11,
                "highlight_color": "#ddeeff",
            },
        },
    ]
    assert revision.normalize_canonical_document(normalized) == normalized


def test_0050_preserves_unknown_and_incomplete_markers_without_planning_updates() -> None:
    revision = load_revision()
    document = marker_document()
    section = document["sections"][0]
    section["title"]["value"] = "普通章节"
    section["blocks"][0]["runs"][0]["text"] = (
        "未知 :icon[NotAllowed]:，不完整 :icon[Mail]"
    )

    normalized = revision.normalize_canonical_document(document)

    assert normalized == document
    assert revision.normalize_canonical_document(normalized) == normalized
    connection = _Connection({
        table: [{"id": index, "data_json": deepcopy(document)}]
        for index, table in enumerate(revision.TABLES, start=1)
    })
    assert revision._preflight(connection) == {table: {} for table in revision.TABLES}
    assert connection.updates == []


def test_0050_upgrade_writes_all_three_tables_and_second_run_is_a_noop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = load_revision()
    connection = _Connection({
        table: [{"id": index, "data_json": marker_document()}]
        for index, table in enumerate(revision.TABLES, start=1)
    })
    sql_calls: list[object] = []
    monkeypatch.setattr(revision.op, "get_bind", lambda: connection)
    monkeypatch.setattr(
        revision,
        "execute_sql_file",
        lambda _connection, path: sql_calls.append(path),
    )

    revision.upgrade()

    assert len(sql_calls) == 1
    assert {query.split()[1] for query, _params in connection.updates} == set(
        revision.TABLES
    )
    assert len(connection.updates) == 3

    revision.upgrade()

    assert len(sql_calls) == 2
    assert len(connection.updates) == 3
    revision._verify(connection)


def test_0050_preflights_all_tables_and_blocks_conflicts_before_upgrade_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = load_revision()
    clean, _ = canonical_resume_payload()
    conflicting = marker_document()
    conflicting["sections"][0]["title_icon"] = {"inline_type": "icon", "name": "Award"}
    connection = _Connection({
        "resume_templates": [{"id": 1, "data_json": clean}],
        "resumes": [{"id": 2, "data_json": marker_document()}],
        "resume_versions": [{"id": 3, "data_json": conflicting}],
    })
    sql_calls: list[object] = []
    monkeypatch.setattr(revision.op, "get_bind", lambda: connection)
    monkeypatch.setattr(
        revision,
        "execute_sql_file",
        lambda _connection, path: sql_calls.append(path),
    )

    with pytest.raises(RuntimeError, match="structured title icon"):
        revision.upgrade()

    assert connection.updates == []
    assert sql_calls == []


def test_0050_revision_is_forward_only_and_sql_first() -> None:
    revision = load_revision()
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert revision.revision == "0050"
    assert revision.down_revision == "0049"
    assert "SELECT 1" in sql
    assert "DROP" not in sql.upper()
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()
