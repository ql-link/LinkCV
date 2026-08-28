from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_style import ResumePresentation, default_template_manifest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0044_restore_classic_technical_density.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0044.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0044", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def classic_snapshot() -> tuple[dict, dict]:
    data = default_resume_document().model_dump(mode="json")
    data["basics"]["name"] = "张三"
    style = ResumePresentation(
        template_key="classic-technical-cn",
        font_size=11.5,
        line_height=1.42,
        accent_color="#2F4858",
        smart_one_page=True,
        page={
            "size": "A4",
            "margin_top_mm": 9,
            "margin_right_mm": 11,
            "margin_bottom_mm": 9,
            "margin_left_mm": 11,
        },
        manifest=default_template_manifest(),
    ).model_dump(mode="json")
    return data, style


def test_density_target_preserves_content_and_page_margins() -> None:
    revision = load_revision()
    data, style = classic_snapshot()

    expected_data, expected_style = revision._target_snapshot(
        data,
        style,
        field="resume_templates[1]",
    )

    assert expected_data == data
    assert expected_style["font_size"] == 9.5
    assert expected_style["line_height"] == 1.25
    assert expected_style["accent_color"] == "#202632"
    assert expected_style["page"] == {
        "size": "A4",
        "margin_top_mm": 9.0,
        "margin_right_mm": 11.0,
        "margin_bottom_mm": 9.0,
        "margin_left_mm": 11.0,
    }


def test_density_preflight_rejects_unexpected_old_style() -> None:
    revision = load_revision()
    data, style = classic_snapshot()
    style["font_size"] = 9.5

    with pytest.raises(RuntimeError, match="protected 0043"):
        revision._target_snapshot(data, style, field="resume_templates[1]")


def test_density_migration_is_forward_only_and_template_only() -> None:
    revision = load_revision()
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert revision.revision == "0044"
    assert revision.down_revision == "0043"
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()

    assert "UPDATE resume_templates" in sql
    assert "WHERE `key` = 'classic-technical-cn'" in sql
    assert "JSON_EXTRACT(style_json, '$.font_size')" in sql
    assert "JSON_EXTRACT(style_json, '$.line_height')" in sql
    assert "JSON_EXTRACT(style_json, '$.accent_color')" in sql
    assert "UPDATE resumes" not in sql
    assert "UPDATE resume_versions" not in sql
