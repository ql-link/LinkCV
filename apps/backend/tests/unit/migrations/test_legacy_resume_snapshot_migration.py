from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from linkcv.domain.resume_snapshot import parse_resume_snapshot

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0005_migrate_legacy_resume_snapshots.py"
)
CANONICAL_REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0036_migrate_resume_snapshots_to_canonical_.py"
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0005", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_canonical_revision():
    spec = importlib.util.spec_from_file_location(
        "linkcv_revision_0036", CANONICAL_REVISION_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_data() -> dict[str, object]:
    return {
        "schema_version": 1,
        "document": {
            "type": "doc",
            "content": [
                {
                    "type": "avatarImage",
                    "attrs": {
                        "src": "data:image/svg+xml;utf8,%3Csvg%3E%3Cpattern%20id%3D%22p%22%3E%3C/pattern%3E%3Ctext%3E%E5%A4%B4%E5%83%8F%3C/text%3E%3C/svg%3E",
                        "size": 96,
                    },
                },
                {
                    "type": "heading",
                    "attrs": {"level": 1, "textAlign": "center"},
                    "content": [{"type": "text", "text": "张三"}],
                },
                {
                    "type": "paragraph",
                    "attrs": {"textAlign": None},
                    "content": [
                        {
                            "type": "text",
                            "text": "后端开发工程师",
                            "marks": [{"type": "bold"}],
                        }
                    ],
                },
                {
                    "type": "resumeRow",
                    "attrs": {"leftWidth": 65},
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": "示例公司"}]},
                        {"type": "paragraph", "content": [{"type": "text", "text": "2026"}]},
                    ],
                },
            ],
        },
    }


def legacy_style() -> dict[str, object]:
    return {
        "schema_version": 1,
        "settings": {
            "fontFamily": '"Source Han Serif SC", SimSun, serif',
            "fontSize": 10.5,
            "lineHeight": 1.32,
            "pageMargin": 16,
            "verticalPageMargin": 14,
            "theme": "classic",
            "smartOnePage": True,
            "showSource": False,
        },
        "split_ratio": 0.4,
        "preview_scale": 1.0,
    }


def test_legacy_snapshot_converts_to_current_contract() -> None:
    revision = load_revision()
    canonical = load_canonical_revision()

    data = canonical._convert_data(
        revision.legacy_data_to_v1(legacy_data()), field="test.data"
    )
    style = canonical._convert_style(
        revision.legacy_style_to_v1(legacy_style()), field="test.style"
    )
    snapshot = parse_resume_snapshot(data, style)

    markdown = snapshot.data.sections.custom_sections[0].items[0].content.content
    assert "# 张三" in markdown
    assert "**后端开发工程师**" in markdown
    assert "::: left\n示例公司" in markdown
    assert "data:image" not in markdown
    assert snapshot.style.smart_one_page is True
    assert snapshot.style.page.margin_top_mm == 14


def test_legacy_conversion_rejects_unrepresentable_embedded_image() -> None:
    revision = load_revision()
    data = legacy_data()
    document = data["document"]
    assert isinstance(document, dict)
    content = document["content"]
    assert isinstance(content, list)
    image = content[0]
    assert isinstance(image, dict)
    image["attrs"] = {"src": "data:image/png;base64,not-a-placeholder", "size": 96}

    with pytest.raises(RuntimeError, match="cannot be converted without data loss"):
        revision.legacy_data_to_v1(data)


def test_legacy_conversion_rejects_unknown_style_fields() -> None:
    revision = load_revision()
    style = legacy_style()
    settings = style["settings"]
    assert isinstance(settings, dict)
    settings["unreviewedSetting"] = "value"

    with pytest.raises(RuntimeError, match="unsupported keys"):
        revision.legacy_style_to_v1(style)
