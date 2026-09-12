from __future__ import annotations

import importlib.util
from pathlib import Path

from linkcv.domain.resume_document import ResumeDocument, default_resume_document
from linkcv.domain.resume_snapshot import parse_resume_snapshot
from linkcv.domain.resume_style import ResumePresentation, default_template_manifest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0037_sync_official_template_snapshots.py"
)
DEDUPLICATION_REVISION_PATH = (
    BACKEND_ROOT / "migrations" / "versions" / "0038_remove_official_template_typed_.py"
)
BLOCK_ID_REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0039_normalize_official_template_block_ids.py"
)
MANIFEST_REPAIR_REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0040_repair_official_template_manifests.py"
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0037", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_deduplication_revision():
    spec = importlib.util.spec_from_file_location(
        "linkcv_revision_0038", DEDUPLICATION_REVISION_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_block_id_revision():
    spec = importlib.util.spec_from_file_location(
        "linkcv_revision_0039", BLOCK_ID_REVISION_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_manifest_repair_revision():
    spec = importlib.util.spec_from_file_location(
        "linkcv_revision_0040", MANIFEST_REPAIR_REVISION_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_editor_template(markdown: str) -> dict:
    return {
        "basics": {
            "name": "张三",
            "headline": "平台工程师",
            "email": "zhangsan@example.com",
            "phone": "13800000000",
            "location": "杭州",
            "photo": None,
            "summary": None,
            "links": [],
        },
        "sections": {
            "work_experiences": [],
            "educations": [],
            "projects": [],
            "skills": [],
            "certificates": [],
            "awards": [],
            "languages": [],
            "custom_sections": [
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
            ],
        },
        "semantic_sections": [
            {
                "id": "semantic_basics",
                "semantic_kind": "basics",
                "display_title": "基本信息",
                "semantic_source": "system",
                "semantic_confidence": None,
                "content_key": "basics",
                "custom_section_id": None,
            },
            {
                "id": "semantic_custom_section_editor",
                "semantic_kind": "custom",
                "display_title": "简历正文",
                "semantic_source": "system",
                "semantic_confidence": None,
                "content_key": "custom_sections",
                "custom_section_id": "custom_section_editor",
            },
        ],
    }


def style(template_key: str) -> dict:
    return ResumePresentation(
        template_key=template_key,
        font_size=9.5,
        line_height=1.25,
        manifest=default_template_manifest(),
    ).model_dump(mode="json")


def test_sync_splits_editor_markdown_without_keeping_a_second_basics_semantic() -> None:
    revision = load_revision()
    markdown = (
        "# 张三\n\n13800000000 ｜ zhangsan@example.com\n\n"
        "## 教育经历\n\n北辰大学\n\n"
        "## 实习经历\n\n虚构公司"
    )

    converted = revision._synchronize_data(
        legacy_editor_template(markdown), template_key="classic-technical-cn"
    )
    document = ResumeDocument.model_validate(converted)

    assert [section.semantic_kind for section in document.semantic_sections] == [
        "basics",
        "education",
        "work",
    ]
    assert all(
        section.content_key == "custom_sections"
        for section in document.semantic_sections
    )
    assert [section.title for section in document.sections.custom_sections] == [
        "基本信息",
        "教育经历",
        "实习经历",
    ]
    assert document.sections.custom_sections[0].items[0].content.content == (
        "# 张三\n\n13800000000 ｜ zhangsan@example.com"
    )
    assert "简历正文" not in {
        section.display_title for section in document.semantic_sections
    }


def test_sync_restores_reviewed_classic_technical_style_tokens() -> None:
    revision = load_revision()

    converted = revision._synchronize_style(
        style("classic-technical-cn"), template_key="classic-technical-cn"
    )
    presentation = ResumePresentation.model_validate(converted)

    assert presentation.font_size == 11.5
    assert presentation.line_height == 1.42
    assert presentation.accent_color == "#2F4858"
    assert presentation.smart_one_page is True
    assert presentation.page.model_dump() == {
        "size": "A4",
        "margin_top_mm": 12.0,
        "margin_right_mm": 14.0,
        "margin_bottom_mm": 12.0,
        "margin_left_mm": 14.0,
    }


def test_deduplication_makes_the_editor_sections_the_only_content_truth() -> None:
    revision = load_revision()
    deduplication = load_deduplication_revision()
    markdown = "# 张三\n\n平台工程师 ｜ zhangsan@example.com\n\n## 工作经历\n\n虚构公司"
    synchronized = revision._synchronize_data(
        legacy_editor_template(markdown), template_key="classic-technical-cn"
    )
    converted_data, converted_style = deduplication._remove_typed_duplicates(
        synchronized,
        revision._synchronize_style(
            style("classic-technical-cn"), template_key="classic-technical-cn"
        ),
        template_key="classic-technical-cn",
    )

    snapshot = parse_resume_snapshot(converted_data, converted_style)

    assert snapshot.data.basics.name == "张三"
    assert snapshot.data.basics.headline is None
    assert snapshot.data.basics.email is None
    assert snapshot.data.sections.work_experiences == []
    assert len(snapshot.data.sections.custom_sections) == 2
    assert all(
        section.content_key == "custom_sections"
        for section in snapshot.data.semantic_sections
    )


def test_block_id_normalization_replaces_visible_template_ids_deterministically() -> (
    None
):
    synchronization = load_revision()
    deduplication = load_deduplication_revision()
    normalization = load_block_id_revision()
    markdown = "# 张三\n\n平台工程师\n\n## 工作经历\n\n虚构公司"
    synchronized = synchronization._synchronize_data(
        legacy_editor_template(markdown), template_key="classic-technical-cn"
    )
    data, synchronized_style = deduplication._remove_typed_duplicates(
        synchronized,
        synchronization._synchronize_style(
            style("classic-technical-cn"), template_key="classic-technical-cn"
        ),
        template_key="classic-technical-cn",
    )

    converted_data, converted_style = normalization._normalize_block_ids(
        data,
        synchronized_style,
        template_key="classic-technical-cn",
    )
    repeated_data, repeated_style = normalization._normalize_block_ids(
        converted_data,
        converted_style,
        template_key="classic-technical-cn",
    )
    snapshot = parse_resume_snapshot(converted_data, converted_style)
    block_ids = [section.id for section in snapshot.data.sections.custom_sections]

    assert all(normalization.BLOCK_ID_PATTERN.fullmatch(value) for value in block_ids)
    assert all(not value.startswith("template_") for value in block_ids)
    assert {
        section.custom_section_id for section in snapshot.data.semantic_sections
    } == set(block_ids)
    assert repeated_data == converted_data
    assert repeated_style == converted_style


def test_manifest_repair_keeps_content_and_moves_basics_out_of_sidebar() -> None:
    revision = load_manifest_repair_revision()
    document = default_resume_document()
    presentation = ResumePresentation(
        template_key="administrative-sidebar-cn",
        manifest=default_template_manifest(renderer_key="columns"),
    ).model_dump(mode="json")
    sidebar = next(
        slot
        for slot in presentation["manifest"]["slots"]
        if slot["region_id"] == "sidebar"
    )
    sidebar["accepts"].insert(0, "basics")

    converted_data, converted_style = revision._repair_snapshot(
        document.model_dump(mode="json"),
        presentation,
        field="resume_templates[1]",
    )
    repeated_data, repeated_style = revision._repair_snapshot(
        converted_data,
        converted_style,
        field="resume_templates[1]",
    )

    assert converted_data == document.model_dump(mode="json")
    repaired_sidebar = next(
        slot
        for slot in converted_style["manifest"]["slots"]
        if slot["region_id"] == "sidebar"
    )
    assert "basics" not in repaired_sidebar["accepts"]
    assert repeated_data == converted_data
    assert repeated_style == converted_style
