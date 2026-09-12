import json

import pytest
from pydantic import ValidationError

from linkcv.domain.resume_document import (
    Highlight,
    Project,
    ResumeBasics,
    ResumeDocument,
    ResumeSections,
    RichText,
    Skill,
    WorkExperience,
    default_resume_document,
    with_default_semantics,
)
from linkcv.domain.resume_snapshot import ResumeSnapshot, parse_resume_snapshot
from linkcv.domain.resume_style import (
    ResumePresentation,
    default_resume_style,
    default_template_manifest,
    template_content_assignments,
)


def test_default_snapshot_uses_the_single_canonical_contract() -> None:
    snapshot = ResumeSnapshot(
        data=default_resume_document(),
        style=default_resume_style(),
    )

    assert snapshot.data.basics.name == "张三"
    assert snapshot.data.semantic_sections[0].semantic_kind == "basics"
    assert snapshot.style.manifest.renderer_key == "flow"
    assert snapshot.style.section_order[0] == "basics"
    assert snapshot.style.smart_one_page is False


def test_parse_snapshot_accepts_serialized_mysql_json_fields() -> None:
    data = default_resume_document().model_dump(mode="json")
    style = default_resume_style().model_dump(mode="json")

    snapshot = parse_resume_snapshot(
        json.dumps(data, ensure_ascii=False),
        json.dumps(style, ensure_ascii=False),
    )

    assert snapshot.data == default_resume_document()
    assert snapshot.style == default_resume_style()


def test_parse_snapshot_rejects_invalid_serialized_json_fields() -> None:
    style = json.dumps(default_resume_style().model_dump(mode="json"))

    with pytest.raises(ValidationError, match="data"):
        parse_resume_snapshot("{not-json", style)


def test_columns_manifest_keeps_identity_in_main_and_secondary_content_in_sidebar() -> None:
    document = with_default_semantics(
        ResumeDocument(
            sections=ResumeSections(skills=[Skill(id="skill_001", name="Python")]),
            semantic_sections=[],
        )
    )
    manifest = default_template_manifest(renderer_key="columns")

    assignments = template_content_assignments(document, manifest)

    basics = next(section for section in document.semantic_sections if section.semantic_kind == "basics")
    skills = next(section for section in document.semantic_sections if section.semantic_kind == "skills")
    assert assignments[basics.id] == "main-content"
    assert assignments[skills.id] == "sidebar-basics"


def test_presentation_requires_the_canonical_manifest() -> None:
    with pytest.raises(ValidationError, match="manifest"):
        ResumePresentation.model_validate({})


def test_document_rejects_duplicate_nested_ids() -> None:
    with pytest.raises(ValidationError, match="must be unique"):
        ResumeDocument(
            sections=ResumeSections(
                work_experiences=[
                    WorkExperience(
                        id="work_001",
                        organization="示例科技有限公司",
                        position="工程师",
                        highlights=[
                            Highlight(
                                id="same_001",
                                content=RichText(content="负责服务开发"),
                            )
                        ],
                    )
                ],
                skills=[Skill(id="same_001", name="Python")],
            ),
            semantic_sections=[],
        )


def test_rich_text_rejects_active_content() -> None:
    with pytest.raises(ValidationError, match="unsafe markdown"):
        RichText(content='<script>alert("x")</script>')


def test_tiptap_rich_text_preserves_supported_marks_and_nodes() -> None:
    payload = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "attrs": {"textAlign": "center"},
                "content": [
                    {
                        "type": "resumeBlockAnchor",
                        "attrs": {"blockId": "blk_1111111111111111", "semanticKind": None},
                    },
                    {
                        "type": "text",
                        "text": "重点文字",
                        "marks": [
                            {"type": "underline"},
                            {"type": "textStyle", "attrs": {"color": "#3478f6", "fontSize": "11.5pt"}},
                            {"type": "highlight", "attrs": {"color": "#fff3c4"}},
                        ],
                    },
                ],
            }
        ],
    }

    rich_text = RichText(format="tiptap-json", content=payload)

    assert rich_text.model_dump(mode="json")["content"] == payload


def test_tiptap_rich_text_normalizes_the_ordered_list_noop_type_default() -> None:
    payload = {
        "type": "doc",
        "content": [
            {
                "type": "orderedList",
                "attrs": {"start": 1, "type": None},
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": "第一项"}],
                            }
                        ],
                    }
                ],
            }
        ],
    }

    rich_text = RichText(format="tiptap-json", content=payload)

    ordered_list = rich_text.model_dump(mode="json")["content"]["content"][0]
    assert ordered_list["attrs"] == {"start": 1}
    assert payload["content"][0]["attrs"] == {"start": 1, "type": None}


def test_tiptap_rich_text_rejects_a_non_null_ordered_list_type() -> None:
    with pytest.raises(ValidationError, match="unsupported tiptap keys"):
        RichText(
            format="tiptap-json",
            content={
                "type": "doc",
                "content": [
                    {
                        "type": "orderedList",
                        "attrs": {"start": 1, "type": "A"},
                        "content": [],
                    }
                ],
            },
        )


def test_tiptap_rich_text_rejects_unknown_nodes_and_unsafe_assets() -> None:
    with pytest.raises(ValidationError, match="unsupported tiptap node"):
        RichText(
            format="tiptap-json",
            content={"type": "doc", "content": [{"type": "iframe"}]},
        )
    with pytest.raises(ValidationError, match="unsafe tiptap image source"):
        RichText(
            format="tiptap-json",
            content={
                "type": "doc",
                "content": [
                    {
                        "type": "resumeImage",
                        "attrs": {"src": "javascript:alert(1)"},
                    }
                ],
            },
        )


def test_resource_and_link_fields_reject_active_schemes() -> None:
    with pytest.raises(ValidationError, match="photo must use"):
        ResumeBasics(photo="javascript:alert(1)")
    with pytest.raises(ValidationError, match="project URL must use"):
        Project(id="project_001", name="示例项目", url="javascript:alert(1)")


def test_dated_entries_allow_content_inconsistent_dates() -> None:
    reversed_dates = WorkExperience(
        id="work_001",
        organization="示例科技有限公司",
        position="工程师",
        start_date="2025-10",
        end_date="2016-03",
    )
    current_with_end_date = Project(
        id="project_001",
        name="示例项目",
        current=True,
        end_date="2025-01",
    )

    assert reversed_dates.start_date == "2025-10"
    assert reversed_dates.end_date == "2016-03"
    assert current_with_end_date.current is True
    assert current_with_end_date.end_date == "2025-01"


def test_resume_content_fields_do_not_enforce_content_quality() -> None:
    work = WorkExperience(
        id="work_001",
        organization="",
        position="",
        start_date="时间写得有点乱",
    )
    basics = ResumeBasics(email="这不是标准邮箱", phone="电话号码可能写错了")

    assert work.organization == ""
    assert work.position == ""
    assert work.start_date == "时间写得有点乱"
    assert basics.email == "这不是标准邮箱"
    assert basics.phone == "电话号码可能写错了"


def test_snapshot_removes_unknown_style_sections_and_adds_present_sections() -> None:
    snapshot = ResumeSnapshot(
        data=with_default_semantics(ResumeDocument(
            sections=ResumeSections(skills=[Skill(id="skill_001", name="Python")]),
            semantic_sections=[],
        )),
        style=default_resume_style().model_copy(update={"section_order": ["unknown", "basics"]}),
    )

    assert snapshot.style.section_order == ["basics", "skills"]


def test_canonical_editor_rejects_a_parallel_typed_content_copy() -> None:
    payload = default_resume_document().model_dump(mode="json")
    payload["sections"]["skills"] = [{"id": "skill_001", "name": "Python", "level": None, "keywords": []}]
    payload["sections"]["custom_sections"] = [{
        "id": "blk_1111111111111111",
        "title": "基本信息",
        "items": [{
            "id": "item_1111111111111111",
            "title": None,
            "subtitle": None,
            "content": {"format": "markdown", "content": "# 张三"},
            "source_refs": [],
        }],
    }]
    payload["semantic_sections"] = [{
        "id": "sem_1111111111111111",
        "semantic_kind": "basics",
        "display_title": "基本信息",
        "semantic_source": "system",
        "semantic_confidence": None,
        "content_key": "custom_sections",
        "custom_section_id": "blk_1111111111111111",
    }]
    document = ResumeDocument.model_validate(payload)

    with pytest.raises(ValidationError, match="typed duplicate"):
        ResumeSnapshot(data=document, style=default_resume_style())
