from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from linkcv.domain.resume import TemplateDefinition
from tests.canonical_resume_fixtures import canonical_template_payload

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0049_freeze_resume_import_template.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0049.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0049", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Rows:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    def mappings(self) -> _Rows:
        return self

    def all(self) -> list[dict[str, object]]:
        return self.rows


class _Result:
    rowcount = 1


class _Connection:
    def __init__(
        self,
        *,
        active_rows: list[dict[str, object]],
        all_rows: list[dict[str, object]] | None = None,
    ) -> None:
        self.active_rows = active_rows
        self.all_rows = all_rows or active_rows
        self.updates: list[tuple[object, dict[str, object] | None]] = []

    def execute(self, statement: object, params: dict[str, object] | None = None):
        query = str(statement)
        if "LEFT JOIN resume_templates" in query:
            return _Rows(self.active_rows)
        if "SELECT id, source_type" in query:
            return _Rows(self.all_rows)
        if "UPDATE document_parse_tasks" in query:
            self.updates.append((statement, params))
            return _Result()
        raise AssertionError(query)


def template_style(key: str = "classic-technical-cn") -> dict[str, object]:
    return canonical_template_payload(key=key)[1]


def active_row(
    *,
    task_id: int = 1,
    template_id: int = 7,
    key: str = "classic-technical-cn",
    style: dict[str, object] | str | None = None,
) -> dict[str, object]:
    return {
        "id": task_id,
        "selected_template_id": template_id,
        "template_key": key,
        "style_json": template_style(key) if style is None else style,
    }


def test_0049_preflight_normalizes_active_template_definitions() -> None:
    revision = load_revision()
    style = template_style()
    connection = _Connection(active_rows=[active_row(style=json.dumps(style))])

    payloads = revision._preflight(connection)

    assert payloads == {1: TemplateDefinition.model_validate(style).model_dump(mode="json")}
    assert connection.updates == []


def test_0049_preflight_rejects_missing_template_before_any_write() -> None:
    revision = load_revision()
    connection = _Connection(
        active_rows=[
            {
                "id": 1,
                "selected_template_id": None,
                "template_key": None,
                "style_json": None,
            }
        ]
    )

    with pytest.raises(RuntimeError, match="no selected template"):
        revision._preflight(connection)
    assert connection.updates == []


@pytest.mark.parametrize(
    ("key", "style", "message"),
    [
        ("classic-technical-cn", {"schema_version": "template-definition.v1"}, "valid TemplateDefinition"),
        ("other-template-cn", template_style(), "template key disagrees"),
    ],
)
def test_0049_preflight_rejects_invalid_or_mismatched_template(
    key: str,
    style: dict[str, object],
    message: str,
) -> None:
    revision = load_revision()
    connection = _Connection(active_rows=[active_row(key=key, style=style)])

    with pytest.raises(RuntimeError, match=message):
        revision._preflight(connection)
    assert connection.updates == []


def test_0049_backfill_and_postverify_preserve_dataset_and_terminal_nulls() -> None:
    revision = load_revision()
    style = template_style()
    expected = {1: style}
    active = {
        "id": 1,
        "source_type": "resume_import",
        "upload_status": "succeeded",
        "parse_status": "processing",
        "selected_template_style_json": style,
    }
    terminal = {
        "id": 2,
        "source_type": "resume_import",
        "upload_status": "succeeded",
        "parse_status": "failed",
        "selected_template_style_json": None,
    }
    dataset = {
        "id": 3,
        "source_type": "dataset",
        "upload_status": "succeeded",
        "parse_status": "succeeded",
        "selected_template_style_json": None,
    }
    connection = _Connection(active_rows=[], all_rows=[active, terminal, dataset])

    revision._write_frozen_templates(connection, expected)
    revision._verify(connection, expected)

    assert len(connection.updates) == 1
    _, params = connection.updates[0]
    assert params is not None
    assert json.loads(str(params["style_json"])) == style


def test_0049_rejects_changed_active_snapshot_and_is_forward_only() -> None:
    revision = load_revision()
    style = template_style()
    changed = json.loads(json.dumps(style))
    changed["tokens"]["accent_color"] = "#123456"
    connection = _Connection(
        active_rows=[],
        all_rows=[
            {
                "id": 1,
                "source_type": "resume_import",
                "upload_status": "succeeded",
                "parse_status": "processing",
                "selected_template_style_json": changed,
            }
        ],
    )

    with pytest.raises(RuntimeError, match="unexpected template snapshot"):
        revision._verify(connection, {1: style})
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_0049_revision_chain_and_sql_add_only_nullable_json_column() -> None:
    revision = load_revision()
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert revision.revision == "0049"
    assert revision.down_revision == "0048"
    assert "ADD COLUMN selected_template_style_json JSON NULL" in sql
    assert "AFTER selected_template_id" in sql
    assert "DROP COLUMN" not in sql.upper()
