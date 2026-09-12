from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.domain.resume_style import (
    PageStyle,
    ResumePresentation,
    default_resume_style,
    default_template_manifest,
)

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT / "migrations" / "versions" / "0047_bind_canonical_resume_templates.py"
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0047", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Rows:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def mappings(self) -> _Rows:
        return self

    def all(self) -> list[dict[str, object]]:
        return self._rows


class _Connection:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def execute(self, _statement: object) -> _Rows:
        return _Rows(self._rows)


class _CutoverConnection:
    def __init__(
        self,
        *,
        templates: list[dict[str, object]],
        resumes: list[dict[str, object]],
        versions: list[dict[str, object]],
        tasks: list[dict[str, object]] | None = None,
    ) -> None:
        self.templates = templates
        self.resumes = resumes
        self.versions = versions
        self.tasks = tasks or []
        self.writes: list[str] = []

    def execute(
        self,
        statement: object,
        _params: dict[str, object] | None = None,
    ) -> _Rows:
        query = str(statement)
        if query.startswith(
            "SELECT id, `key`, data_json, style_json FROM resume_templates"
        ):
            return _Rows(self.templates)
        if "SELECT id, is_active FROM resume_templates" in query:
            return _Rows(
                [
                    {
                        "id": row["id"],
                        "is_active": row.get("is_active", 0),
                    }
                    for row in self.templates
                    if row["key"] == "blank-cn"
                ]
            )
        if "SELECT id, is_active, data_json, style_json" in query:
            return _Rows([row for row in self.templates if row["key"] == "blank-cn"])
        if query.startswith(
            "SELECT id, template_id, data_json, style_json FROM resumes"
        ):
            return _Rows(self.resumes)
        if query.startswith(
            "SELECT id, resume_id, data_json, style_json FROM resume_versions"
        ):
            return _Rows(self.versions)
        if "FROM document_parse_tasks AS d" in query:
            return _Rows(self.tasks)
        if query.startswith("INSERT INTO resume_templates"):
            assert _params is not None
            self.templates.append(
                {
                    "id": 99,
                    "key": _params["key"],
                    "data_json": _params["data_json"],
                    "style_json": _params["style_json"],
                    "is_active": 0,
                }
            )
            self.writes.append(query)
            return _Result()
        self.writes.append(query)
        raise AssertionError(f"unexpected write/query during preflight: {query}")

    def scalar(
        self,
        statement: object,
        _params: dict[str, object] | None = None,
    ) -> int:
        query = str(statement)
        if "FROM document_parse_tasks" in query:
            return 0
        if "SELECT id FROM resume_templates" in query:
            return 99
        raise AssertionError(f"unexpected scalar during preflight: {query}")


class _Result:
    rowcount = 1


def _legacy_payload(
    *,
    key: str,
    name: str,
    style: ResumePresentation | None = None,
) -> tuple[dict[str, object], dict[str, object]]:
    data = default_resume_document().model_dump(mode="json")
    data["basics"]["name"] = name
    current_style = style or default_resume_style().model_copy(
        update={"template_key": key}
    )
    return data, current_style.model_dump(mode="json")


def _template_row(
    *, template_id: int = 1, key: str = "classic-cn"
) -> dict[str, object]:
    data, style = _legacy_payload(key=key, name="模板示例")
    return {
        "id": template_id,
        "key": key,
        "data_json": data,
        "style_json": style,
        "is_active": 1,
    }


def _old_canonical_template_row(
    revision, *, template_id: int = 1, key: str = "classic-cn"
):
    data, style = _legacy_payload(key=key, name="模板示例")
    snapshot = parse_resume_snapshot(data, style)
    canonical_data = revision.convert_legacy_document(snapshot.data).model_dump(
        mode="json"
    )
    definition = revision.convert_legacy_template(
        snapshot.style,
        template_key=key,
    ).model_dump(mode="json")
    definition.pop("avatar")
    return {
        "id": template_id,
        "key": key,
        "data_json": canonical_data,
        "style_json": definition,
        "is_active": 1,
    }


def test_template_cutover_preserves_default_content() -> None:
    revision = load_revision()
    data = default_resume_document().model_dump(mode="json")
    data["basics"]["name"] = "张三"
    data["basics"]["headline"] = "平台工程师"
    style = ResumePresentation(
        template_key="classic-technical-cn",
        manifest=default_template_manifest(),
    ).model_dump(mode="json")

    _, _, _, converted = revision._template_rows(
        _Connection(
            [
                {
                    "id": 8,
                    "key": "classic-technical-cn",
                    "data_json": data,
                    "style_json": style,
                }
            ]
        )
    )

    canonical_data, definition = converted[8]
    assert canonical_data["identity"]["name"]["value"] == "张三"
    assert canonical_data["identity"]["headline"]["value"] == "平台工程师"
    assert definition["template_key"] == "classic-technical-cn"


def test_template_cutover_normalizes_old_canonical_definition_avatar() -> None:
    revision = load_revision()
    row = _old_canonical_template_row(revision)

    _, _, definitions, converted = revision._template_rows(_Connection([row]))

    definition = definitions[row["id"]]
    assert definition.avatar.visibility == "hide"
    assert definition.avatar.fallback_asset == "none"
    assert definition.avatar.size_px == 96
    assert definition.avatar.region_id == "main"
    assert converted[row["id"]][1]["avatar"] == {
        "visibility": "hide",
        "fallback_asset": "none",
        "size_px": 96,
        "region_id": "main",
    }
    assert row["is_active"] == 1


def test_preflight_normalizes_old_canonical_resume_snapshot_avatar() -> None:
    revision = load_revision()
    template = _old_canonical_template_row(revision)
    data, legacy_style = _legacy_payload(key="classic-cn", name="历史简历")
    snapshot = parse_resume_snapshot(data, legacy_style)
    canonical_data = revision.convert_legacy_document(snapshot.data).model_dump(
        mode="json"
    )
    definition = revision.convert_legacy_template(
        snapshot.style,
        template_key="classic-cn",
    ).model_dump(mode="json")
    definition.pop("avatar")
    canonical_style = {
        "schema_version": "resume-presentation.v1",
        "portable": {},
        "template_scoped": {"classic-cn": {}},
        "template_snapshot": definition,
    }
    connection = _CutoverConnection(
        templates=[template],
        resumes=[
            {
                "id": 10,
                "template_id": template["id"],
                "data_json": canonical_data,
                "style_json": canonical_style,
            }
        ],
        versions=[],
    )

    payloads = revision._preflight(connection)

    migrated_style = payloads[3][10][1]
    assert migrated_style["template_snapshot"]["avatar"] == {
        "visibility": "hide",
        "fallback_asset": "none",
        "size_px": 96,
        "region_id": "main",
    }
    assert payloads[3][10][0]["identity"]["name"]["value"] == "历史简历"
    assert connection.writes == []


def test_template_cutover_rejects_ambiguous_old_canonical_avatar_region() -> None:
    revision = load_revision()
    row = _old_canonical_template_row(revision)
    row["style_json"] = {
        **row["style_json"],
        "regions": [
            {"region_id": "left", "region_kind": "main", "order": 0},
            {"region_id": "right", "region_kind": "main", "order": 1},
        ],
        "slots": [
            {
                "slot_id": "left-content",
                "region_id": "left",
                "accepts": [
                    "identity",
                    "profile",
                    "work",
                    "education",
                    "project",
                    "skills",
                    "activity",
                    "interests",
                    "certificates",
                    "awards",
                    "languages",
                    "custom",
                ],
                "universal_fallback": True,
                "order": 0,
            },
            {
                "slot_id": "right-content",
                "region_id": "right",
                "accepts": ["identity"],
                "universal_fallback": True,
                "order": 1,
            },
        ],
    }

    with pytest.raises(RuntimeError, match="identity/avatar region"):
        revision._template_rows(_Connection([row]))


def test_preflight_plans_blank_tombstone_without_replacing_historical_snapshots() -> (
    None
):
    revision = load_revision()
    resume_style_model = default_resume_style().model_copy(
        update={"template_key": "blank-cn", "accent_color": "#123456", "font_size": 12}
    )
    version_style_model = default_resume_style().model_copy(
        update={
            "template_key": "blank-cn",
            "accent_color": "#654321",
            "font_size": 15,
            "page": PageStyle(
                margin_top_mm=4,
                margin_right_mm=7,
                margin_bottom_mm=5,
                margin_left_mm=8,
            ),
        }
    )
    resume_data, resume_style = _legacy_payload(
        key="blank-cn", name="历史简历", style=resume_style_model
    )
    version_data, version_style = _legacy_payload(
        key="blank-cn", name="历史版本", style=version_style_model
    )
    connection = _CutoverConnection(
        templates=[_template_row()],
        resumes=[
            {
                "id": 10,
                "template_id": None,
                "data_json": resume_data,
                "style_json": resume_style,
            }
        ],
        versions=[
            {
                "id": 20,
                "resume_id": 10,
                "data_json": version_data,
                "style_json": version_style,
            }
        ],
    )

    payloads = revision._preflight(connection)
    resume_templates, version_templates, templates, resumes, versions = payloads

    assert resume_templates == {10: revision.TOMBSTONE_TEMPLATE_ID}
    assert version_templates == {20: revision.TOMBSTONE_TEMPLATE_ID}
    assert templates[revision.TOMBSTONE_TEMPLATE_ID][1]["template_key"] == "blank-cn"
    assert resumes[10][0]["identity"]["name"]["value"] == "历史简历"
    assert versions[20][0]["identity"]["name"]["value"] == "历史版本"
    assert resumes[10][1]["template_snapshot"]["template_key"] == "blank-cn"
    assert versions[20][1]["template_snapshot"]["template_key"] == "blank-cn"
    assert resumes[10][1]["template_snapshot"]["tokens"]["font_size_pt"] == 12
    assert versions[20][1]["template_snapshot"]["tokens"]["font_size_pt"] == 15
    assert resumes[10][1]["template_snapshot"]["tokens"]["accent_color"] == "#123456"
    assert versions[20][1]["template_snapshot"]["tokens"]["accent_color"] == "#654321"
    assert resumes[10][1]["portable"]["accent_color"] == "#123456"
    assert versions[20][1]["portable"]["accent_color"] == "#654321"
    assert connection.writes == []


def test_preflight_rejects_unknown_template_before_any_write() -> None:
    revision = load_revision()
    data, style = _legacy_payload(key="unknown-template-cn", name="未知模板")
    connection = _CutoverConnection(
        templates=[_template_row()],
        resumes=[
            {
                "id": 10,
                "template_id": None,
                "data_json": data,
                "style_json": style,
            }
        ],
        versions=[],
    )

    with pytest.raises(RuntimeError, match="unknown style template"):
        revision._preflight(connection)
    assert connection.writes == []


def test_materialize_tombstone_replaces_sentinel_before_schema_cutover() -> None:
    revision = load_revision()
    resume_data, resume_style = _legacy_payload(key="blank-cn", name="历史简历")
    connection = _CutoverConnection(
        templates=[_template_row()],
        resumes=[
            {
                "id": 10,
                "template_id": None,
                "data_json": resume_data,
                "style_json": resume_style,
            }
        ],
        versions=[],
    )

    planned = revision._preflight(connection)
    materialized = revision._materialize_tombstone(connection, planned)

    assert materialized[0] == {10: 99}
    assert any(
        statement.startswith("INSERT INTO resume_templates")
        for statement in connection.writes
    )
    assert connection.templates[-1]["is_active"] == 0


def test_preflight_rejects_relational_template_conflict_before_any_write() -> None:
    revision = load_revision()
    data, style = _legacy_payload(key="blank-cn", name="冲突模板")
    connection = _CutoverConnection(
        templates=[_template_row()],
        resumes=[
            {
                "id": 10,
                "template_id": 1,
                "data_json": data,
                "style_json": style,
            }
        ],
        versions=[],
    )

    with pytest.raises(RuntimeError, match="conflicts with template_id"):
        revision._preflight(connection)
    assert connection.writes == []


def test_preflight_rejects_invalid_json_before_any_write() -> None:
    revision = load_revision()
    connection = _CutoverConnection(
        templates=[_template_row()],
        resumes=[
            {
                "id": 10,
                "template_id": None,
                "data_json": "{",
                "style_json": json.dumps({"template_key": "blank-cn"}),
            }
        ],
        versions=[],
    )

    with pytest.raises(RuntimeError, match="not valid JSON"):
        revision._preflight(connection)
    assert connection.writes == []


def test_0047_sql_keeps_tombstone_insert_before_not_null_cutover() -> None:
    sql = (
        Path(__file__).resolve().parents[3] / "migrations" / "sql" / "0047.up.sql"
    ).read_text(encoding="utf-8")
    assert "MODIFY COLUMN template_id BIGINT UNSIGNED NOT NULL" in sql
    assert "INSERT INTO resume_templates" not in sql
    assert "DROP FOREIGN KEY fk_resumes_template" in sql
