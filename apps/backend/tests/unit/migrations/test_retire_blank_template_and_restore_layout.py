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
    / "0042_retire_blank_template_and_restore_.py"
)
SQL_PATH = BACKEND_ROOT / "migrations" / "sql" / "0042.up.sql"


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0042", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot(template_key: str) -> tuple[dict, dict]:
    data = default_resume_document().model_dump(mode="json")
    data["basics"]["name"] = "张三"
    style = ResumePresentation(
        template_key=template_key,
        page={
            "size": "A4",
            "margin_top_mm": 12,
            "margin_right_mm": 14,
            "margin_bottom_mm": 12,
            "margin_left_mm": 14,
        },
        manifest=default_template_manifest(),
    ).model_dump(mode="json")
    return data, style


def test_restore_classic_technical_layout_preserves_content() -> None:
    revision = load_revision()
    data, style = snapshot("classic-technical-cn")

    restored_data, restored_style = revision._restore_classic_technical_style(
        data, style, field="resumes[1]"
    )

    assert restored_data == data
    assert restored_style["page"] == {
        "size": "A4",
        "margin_top_mm": 9.0,
        "margin_right_mm": 11.0,
        "margin_bottom_mm": 9.0,
        "margin_left_mm": 11.0,
    }


def test_restore_rejects_an_unexpected_theme() -> None:
    revision = load_revision()
    data, style = snapshot("civic-service-cn")

    with pytest.raises(RuntimeError, match="not a classic technical snapshot"):
        revision._restore_classic_technical_style(
            data, style, field="resume_versions[2]"
        )


def test_sql_restores_every_snapshot_table_and_deletes_blank_template() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")

    assert "UPDATE resume_templates" in sql
    assert "UPDATE resumes" in sql
    assert "UPDATE resume_versions" in sql
    assert "DELETE FROM resume_templates WHERE `key` = 'blank-cn'" in sql
