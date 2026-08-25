from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from linkcv.domain.resume_document import CustomItem, CustomSection, ResumeDocument, RichText
from linkcv.domain.resume_style import ResumePresentation, default_template_manifest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0036_migrate_resume_snapshots_to_canonical_.py"
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0036", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_data() -> dict:
    data = ResumeDocument(
        sections={
            "custom_sections": [
                CustomSection(
                    id="custom_history",
                    title="工作历程",
                    items=[
                        CustomItem(
                            id="custom_item_history",
                            content=RichText(content="负责虚构项目的需求分析"),
                        )
                    ],
                )
            ]
        },
        semantic_sections=[],
    ).model_dump(mode="json", exclude={"semantic_sections"})
    return {"schema_version": "1.0", **data}


def legacy_style(template_key: str) -> dict:
    style = ResumePresentation(
        template_key=template_key, manifest=default_template_manifest()
    ).model_dump(
        mode="json", exclude={"manifest"}
    )
    return {"schema_version": "1.0", **style}


def test_conversion_removes_runtime_version_and_preserves_content() -> None:
    revision = load_revision()

    data = revision._convert_data(legacy_data(), field="resume.data")
    style = revision._convert_style(
        legacy_style("administrative-sidebar-cn"), field="resume.style"
    )

    assert "schema_version" not in data
    assert "schema_version" not in style
    assert data["sections"]["custom_sections"][0]["items"][0]["content"][
        "content"
    ] == "负责虚构项目的需求分析"
    assert data["semantic_sections"][-1]["display_title"] == "工作历程"
    assert style["manifest"]["renderer_key"] == "columns"
    assert style["manifest"]["avatar"] == {
        "visibility": "show",
        "fallback_asset": "system-default",
        "size": 96,
    }
    modern_style = revision._convert_style(
        legacy_style("modern-two-column-cn"), field="template.style"
    )
    assert modern_style["manifest"]["renderer_key"] == "columns"


def test_preflight_rejects_unknown_legacy_structure_before_writes() -> None:
    revision = load_revision()
    unsupported = legacy_data()
    unsupported["schema_version"] = "unexpected"

    with pytest.raises(RuntimeError, match="not the supported pre-migration structure"):
        revision._convert_data(unsupported, field="resume.data")
