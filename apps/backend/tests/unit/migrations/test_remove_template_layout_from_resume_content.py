from __future__ import annotations

import importlib.util
from pathlib import Path

from linkcv.domain.resume_document import default_resume_document
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.domain.resume_style import ResumePresentation, default_template_manifest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0041_remove_template_layout_from_resume_content.py"
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0041", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_editor_snapshot(markdown: str) -> tuple[dict, dict]:
    document = default_resume_document().model_dump(mode="json")
    document["sections"]["custom_sections"] = [
        {
            "id": "custom_section_editor",
            "title": "简历正文",
            "items": [
                {
                    "id": "custom_item_editor",
                    "title": None,
                    "subtitle": None,
                    "content": {"format": "markdown", "content": markdown},
                    "source_refs": [],
                }
            ],
        }
    ]
    document["semantic_sections"].append(
        {
            "id": "semantic_custom_section_editor",
            "semantic_kind": "custom",
            "display_title": "简历正文",
            "semantic_source": "system",
            "semantic_confidence": None,
            "content_key": "custom_sections",
            "custom_section_id": "custom_section_editor",
        }
    )
    manifest = default_template_manifest(
        renderer_key="columns", avatar_visibility="show"
    ).model_dump(mode="json")
    sidebar = next(
        slot for slot in manifest["slots"] if slot["region_id"] == "sidebar"
    )
    sidebar["accepts"] = ["skills", "languages", "avatar"]
    style = ResumePresentation(
        template_key="administrative-sidebar-cn", manifest=manifest
    ).model_dump(mode="json")
    parse_resume_snapshot(document, style)
    return document, style


def test_repair_splits_sidebar_content_and_removes_page_projection() -> None:
    revision = load_revision()
    markdown = """:::: sidebar
![虚构头像](/templates/avatar-cat.jpg "linkcv-avatar:108")

### 基本信息

:icon[MapPin]: 上海

### 核心能力

**办公能力：** 熟练使用表格

### 兴趣爱好

- 徒步
::::

:::: main
# 张三

行政专员

## :icon[Briefcase]: 工作经历

- 维护行政台账
::::"""
    data, style = legacy_editor_snapshot(markdown)

    converted_data, converted_style = revision._repair_snapshot(
        data, style, field="resumes[1]"
    )
    repeated_data, repeated_style = revision._repair_snapshot(
        converted_data, converted_style, field="resumes[1]"
    )
    snapshot = parse_resume_snapshot(converted_data, converted_style)

    assert [section.semantic_kind for section in snapshot.data.semantic_sections] == [
        "basics",
        "profile",
        "skills",
        "interests",
        "work",
    ]
    serialized = str(converted_data)
    assert ":::: sidebar" not in serialized
    assert ":::: main" not in serialized
    assert "avatar-cat.jpg" not in serialized
    assert snapshot.data.basics.photo is None
    assert snapshot.data.basics.headline is None
    sidebar = next(
        slot
        for slot in snapshot.style.manifest.slots
        if slot.region_id == "sidebar"
    )
    assert "profile" in sidebar.accepts
    assert "interests" in sidebar.accepts
    assert repeated_data == converted_data
    assert repeated_style == converted_style


def test_repair_promotes_a_private_editor_avatar_to_content_metadata() -> None:
    revision = load_revision()
    data, style = legacy_editor_snapshot(
        """:::: sidebar
![用户头像](/api/resumes/1/assets/avatar.png "linkcv-avatar:96")
::::

:::: main
# 张三
::::"""
    )

    converted_data, converted_style = revision._repair_snapshot(
        data, style, field="resume_versions[9]"
    )
    snapshot = parse_resume_snapshot(converted_data, converted_style)

    assert snapshot.data.basics.photo == "/api/resumes/1/assets/avatar.png"
    assert "avatar.png" not in str(snapshot.data.sections.model_dump(mode="json"))


def test_repair_preserves_all_legacy_item_ids_and_source_refs() -> None:
    revision = load_revision()
    document = default_resume_document().model_dump(mode="json")
    document["basics"] = {
        **document["basics"],
        "name": "张三",
        "headline": None,
        "email": None,
        "phone": None,
        "location": None,
        "summary": None,
        "links": [],
    }
    document["sections"]["custom_sections"] = [
        {
            "id": "blk_1111111111111111",
            "title": "基本信息",
            "items": [{
                "id": "item_1111111111111111",
                "title": None,
                "subtitle": None,
                "content": {
                    "format": "markdown",
                    "content": ":::: main\n# 张三",
                },
                "source_refs": [],
            }],
        },
        {
            "id": "blk_2222222222222222",
            "title": "工作经历",
            "items": [
                {
                    "id": "item_2222222222222222",
                    "title": "示例公司",
                    "subtitle": None,
                    "content": {"format": "markdown", "content": "负责示例项目"},
                    "source_refs": [{
                        "field": "work.first",
                        "source": "extracted_markdown",
                        "start_line": 1,
                        "end_line": 1,
                        "quote": "负责示例项目",
                    }],
                },
                {
                    "id": "item_legacy_source_2",
                    "title": None,
                    "subtitle": "补充说明",
                    "content": {"format": "markdown", "content": "补充内容\n::::"},
                    "source_refs": [{
                        "field": "work.second",
                        "source": "extracted_markdown",
                        "start_line": 2,
                        "end_line": 2,
                        "quote": "补充内容",
                    }],
                },
            ],
        },
    ]
    document["semantic_sections"] = [
        {
            "id": "semantic_1111111111111111",
            "semantic_kind": "basics",
            "display_title": "基本信息",
            "semantic_source": "system",
            "semantic_confidence": None,
            "content_key": "custom_sections",
            "custom_section_id": "blk_1111111111111111",
        },
        {
            "id": "semantic_2222222222222222",
            "semantic_kind": "work",
            "display_title": "工作经历",
            "semantic_source": "import",
            "semantic_confidence": 0.95,
            "content_key": "custom_sections",
            "custom_section_id": "blk_2222222222222222",
        },
    ]
    style = ResumePresentation(
        template_key="administrative-sidebar-cn",
        manifest=default_template_manifest(renderer_key="columns"),
    ).model_dump(mode="json")
    parse_resume_snapshot(document, style)

    converted_data, converted_style = revision._repair_snapshot(
        document, style, field="resume_versions[10]"
    )
    snapshot = parse_resume_snapshot(converted_data, converted_style)
    work = next(
        section
        for section in snapshot.data.sections.custom_sections
        if section.id == "blk_2222222222222222"
    )

    assert [item.id for item in work.items] == [
        "item_2222222222222222",
        "item_legacy_source_2",
    ]
    assert [
        source.field
        for item in work.items
        for source in item.source_refs
    ] == ["work.first", "work.second"]
    assert work.items[1].content.content == ""
