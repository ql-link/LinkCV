import pytest
from markdown_it import MarkdownIt
from pydantic import ValidationError

from linkcv.domain.resume_extraction import (
    LayoutGroup,
    ResumeExtractionDraft,
    StructureDecision,
)
from linkcv.domain.resume_import_composition import (
    ImportLayoutRecipe,
    ResumeImportCompositionError,
    compose_canonical_resume,
)
from linkcv.domain.section_ir import build_section_ir, clean_source_markdown


def _decisions(ir, roles: dict[int, tuple[str, str]]) -> list[StructureDecision]:
    return [
        StructureDecision(
            source_id=block.source_id,
            semantic_kind=roles[index][0],
            layout_role=roles[index][1],
        )
        for index, block in enumerate(ir.blocks)
    ]


def test_source_layout_preserves_order_titles_ranges_and_list_metadata() -> None:
    ir = build_section_ir(
        """# 测试者
电话：13800000000 ｜ test@example.invalid

## 工作经历
1、第一项
2、第二项
    3、嵌套项

## 自定义章节
普通正文
"""
    )

    assert [block.block_type for block in ir.blocks] == [
        "heading",
        "paragraph",
        "heading",
        "ordered_list_item",
        "ordered_list_item",
        "ordered_list_item",
        "heading",
        "paragraph",
    ]
    assert [block.ordinal for block in ir.blocks] == sorted(
        block.ordinal for block in ir.blocks
    )
    assert [block.source_span.start_line for block in ir.blocks] == [1, 2, 4, 5, 6, 7, 9, 10]
    assert ir.blocks[0].heading_level == 1
    assert ir.blocks[2].heading_level == 2
    assert ir.blocks[3].parent_section_id == ir.blocks[2].source_id
    assert ir.blocks[5].list is not None
    assert ir.blocks[3].list.model_dump() == {
        "kind": "ordered",
        "start": 1,
        "index": 1,
        "depth": 0,
    }
    assert ir.blocks[5].list.model_dump() == {
        "kind": "ordered",
        "start": 3,
        "index": 3,
        "depth": 1,
    }
    assert [section.heading for section in ir.sections] == [
        "测试者",
        "工作经历",
        "自定义章节",
    ]


def test_deterministic_cleaning_only_replaces_known_spacing_entities() -> None:
    assert clean_source_markdown("A&nbsp;B&#x20;C&#32;D &amp; E") == "A B C D &amp; E"
    ir = build_section_ir("- -&#x20;重复前缀\n\n-1°C 环境\n\n2024.10 版本")

    assert [block.block_type for block in ir.blocks] == [
        "bullet_list_item",
        "paragraph",
        "paragraph",
    ]
    assert ir.blocks[0].markdown == "- 重复前缀"
    assert ir.blocks[1].markdown == "-1°C 环境"
    assert ir.blocks[2].markdown == "2024.10 版本"


@pytest.mark.parametrize(
    ("source_items", "expected"),
    [
        ("1、第一项\n2、第二项", "1. 第一项\n2. 第二项"),
        ("1．第一项\n2．第二项", "1. 第一项\n2. 第二项"),
        ("1) 第一项\n2) 第二项", "1. 第一项\n2. 第二项"),
        ("3. 第三项\n4. 第四项", "3. 第三项\n4. 第四项"),
    ],
)
def test_composer_preserves_supported_ordered_marker_variants(
    source_items: str,
    expected: str,
) -> None:
    ir = build_section_ir(f"# 测试者\n## 工作经历\n{source_items}")
    roles = {
        index: (
            ("basics", "name")
            if index == 0
            else ("work", "section_heading")
            if index == 1
            else ("work", "body")
        )
        for index in range(len(ir.blocks))
    }

    result = compose_canonical_resume(
        ir,
        ResumeExtractionDraft(decisions=_decisions(ir, roles)),
    )

    assert result.document.sections.custom_sections[1].items[0].content.content == expected


def test_source_layout_records_only_whitelisted_deterministic_discards() -> None:
    ir = build_section_ir(
        "\n# 测试者\n\n<!-- linkparse: page 1 -->\n\n<!-- linkparse: source=fixture -->\n正文"
    )

    assert [record.reason_code for record in ir.deterministic_discards] == [
        "whitespace_only",
        "whitespace_only",
        "linkparse_page_separator",
        "whitespace_only",
        "linkparse_provenance_marker",
    ]
    assert set(ir.source_ids) == {
        record.source_id
        for record in [*ir.blocks, *ir.deterministic_discards]
    }
    assert len(ir.source_ids) == len(ir.blocks) + len(ir.deterministic_discards)


def test_model_boundaries_reject_typed_text_fields_but_direct_legacy_shim_is_not_model_input() -> None:
    for validate in (
        lambda: ResumeExtractionDraft.model_validate({"basics": {"name": "测试者"}}),
        lambda: ResumeExtractionDraft.model_validate_json(
            '{"unmapped_fragments":["不应进入正文"]}'
        ),
    ):
        with pytest.raises(ValidationError):
            validate()

    # A trusted old in-process utility can still construct the compatibility
    # object, but it cannot pass the strict model_validate boundary above.
    legacy = ResumeExtractionDraft(basics={"name": "测试者"})
    assert legacy.is_legacy is True
    assert legacy.model_dump() == {"decisions": [], "groups": []}


def test_composer_keeps_contact_section_order_lists_and_section_anchor() -> None:
    ir = build_section_ir(
        """# 测试者
电话：13800000000 ｜ test@example.invalid ｜ example.invalid

## 教育经历
某大学

## 工作经历
1、第一项
2、第二项
"""
    )
    draft = ResumeExtractionDraft(
        decisions=_decisions(
            ir,
            {
                0: ("basics", "name"),
                1: ("basics", "contact_row"),
                2: ("education", "section_heading"),
                3: ("education", "body"),
                4: ("work", "section_heading"),
                5: ("work", "body"),
                6: ("work", "body"),
            },
        )
    )

    result = compose_canonical_resume(ir, draft)
    document = result.document
    sections = document.sections.custom_sections

    assert [section.title for section in sections] == [
        "基本信息",
        "教育经历",
        "工作经历",
    ]
    assert [section.semantic_kind for section in document.semantic_sections] == [
        "basics",
        "education",
        "work",
    ]
    assert document.sections.work_experiences == []
    assert document.sections.educations == []
    assert document.sections.projects == []
    assert "电话：13800000000" in sections[0].items[1].content.content
    assert "test@example.invalid" in sections[0].items[1].content.content
    assert "example.invalid" in sections[0].items[1].content.content
    assert sections[2].items[0].content.content == "1. 第一项\n2. 第二项"
    assert f"linkcv-block:{sections[0].id}:basics" in sections[0].items[0].content.content
    assert all(section.title != "未分类内容" for section in sections)
    assert set(result.accepted_source_ids) == {block.source_id for block in ir.blocks}


def test_composer_renders_nested_ordered_starts_as_commonmark() -> None:
    ir = build_section_ir(
        """# 测试者
## 工作经历
1、第一项
    3、嵌套项
    4、嵌套项二
2、第二项
"""
    )
    result = compose_canonical_resume(
        ir,
        ResumeExtractionDraft(
            decisions=_decisions(
                ir,
                {
                    0: ("basics", "name"),
                    1: ("work", "section_heading"),
                    2: ("work", "body"),
                    3: ("work", "body"),
                    4: ("work", "body"),
                    5: ("work", "body"),
                },
            )
        ),
    )
    content = result.document.sections.custom_sections[1].items[0].content.content

    assert content == "1. 第一项\n\n    3. 嵌套项\n    4. 嵌套项二\n2. 第二项"
    rendered = MarkdownIt("commonmark").render(content)
    assert '<ol start="3">' in rendered
    assert rendered.count("<ol") == 2
    roundtrip = build_section_ir(content)
    assert [
        (block.list.kind, block.list.start, block.list.index, block.list.depth)
        for block in roundtrip.blocks
        if block.list is not None
    ] == [
        ("ordered", 1, 1, 0),
        ("ordered", 3, 3, 1),
        ("ordered", 3, 4, 1),
        ("ordered", 2, 2, 0),
    ]


def test_composer_keeps_same_semantic_nested_heading_and_list_in_parent_section() -> None:
    ir = build_section_ir(
        """# 测试者
## 项目经历
### LinkRag
1、第一项
    3、嵌套项
2、第二项
## 教育经历
某大学
"""
    )
    result = compose_canonical_resume(
        ir,
        ResumeExtractionDraft(
            decisions=_decisions(
                ir,
                {
                    0: ("basics", "name"),
                    1: ("project", "section_heading"),
                    2: ("project", "section_heading"),
                    3: ("project", "body"),
                    4: ("project", "body"),
                    5: ("project", "body"),
                    6: ("education", "section_heading"),
                    7: ("education", "body"),
                },
            )
        ),
    )

    sections = result.document.sections.custom_sections
    assert [section.title for section in sections] == [
        "基本信息",
        "项目经历",
        "教育经历",
    ]
    assert [
        section.semantic_kind
        for section in result.document.semantic_sections
        if section.semantic_kind == "project"
    ] == ["project"]
    project_contents = [item.content.content for item in sections[1].items]
    assert project_contents == [
        "### LinkRag",
        "1. 第一项\n\n    3. 嵌套项\n2. 第二项",
    ]
    assert sum(content.count("LinkRag") for content in project_contents) == 1
    assert result.accepted_source_ids == tuple(block.source_id for block in ir.blocks)


def test_composer_splits_long_ordered_list_at_source_ref_limit() -> None:
    source_items = "\n".join(f"{number}、第 {number} 项" for number in range(3, 54))
    ir = build_section_ir(f"# 测试者\n## 工作经历\n{source_items}")
    roles = {
        index: (
            ("basics", "name")
            if index == 0
            else ("work", "section_heading")
            if index == 1
            else ("work", "body")
        )
        for index in range(len(ir.blocks))
    }

    result = compose_canonical_resume(
        ir,
        ResumeExtractionDraft(decisions=_decisions(ir, roles)),
    )

    work_items = result.document.sections.custom_sections[1].items
    assert len(work_items) == 2
    assert [len(item.source_refs) for item in work_items] == [50, 1]
    assert work_items[0].content.content.startswith("3. 第 3 项\n")
    assert work_items[0].content.content.endswith("52. 第 52 项")
    assert work_items[1].content.content == "53. 第 53 项"
    assert '<ol start="53">' in MarkdownIt("commonmark").render(
        work_items[1].content.content
    )
    assert sum(len(item.source_refs) for item in work_items) == 51
    assert result.accepted_source_ids == tuple(block.source_id for block in ir.blocks)


def test_long_list_chunk_keeps_parent_with_nested_child() -> None:
    leading_items = "\n".join(
        f"{number}、第 {number} 项" for number in range(3, 52)
    )
    ir = build_section_ir(
        f"# 测试者\n## 工作经历\n{leading_items}\n52、父项\n    1、嵌套项"
    )
    roles = {
        index: (
            ("basics", "name")
            if index == 0
            else ("work", "section_heading")
            if index == 1
            else ("work", "body")
        )
        for index in range(len(ir.blocks))
    }

    result = compose_canonical_resume(
        ir,
        ResumeExtractionDraft(decisions=_decisions(ir, roles)),
    )

    work_items = result.document.sections.custom_sections[1].items
    assert [len(item.source_refs) for item in work_items] == [49, 2]
    assert work_items[1].content.content == "52. 父项\n\n    1. 嵌套项"
    rendered = MarkdownIt("commonmark").render(work_items[1].content.content)
    assert '<ol start="52">' in rendered
    assert rendered.count("<ol") == 2


def test_oversized_single_nested_subtree_is_rejected_instead_of_corrupted() -> None:
    nested_items = "\n".join(
        f"    {number}、嵌套项 {number}" for number in range(1, 51)
    )
    ir = build_section_ir(
        f"# 测试者\n## 工作经历\n3、父项\n{nested_items}"
    )
    roles = {
        index: (
            ("basics", "name")
            if index == 0
            else ("work", "section_heading")
            if index == 1
            else ("work", "body")
        )
        for index in range(len(ir.blocks))
    }

    with pytest.raises(ResumeImportCompositionError) as raised:
        compose_canonical_resume(
            ir,
            ResumeExtractionDraft(decisions=_decisions(ir, roles)),
        )

    assert raised.value.code == "RESUME_LAYOUT_UNSUPPORTED"


def test_composer_rejects_non_adjacent_or_cross_section_layout_groups() -> None:
    ir = build_section_ir(
        """# 测试者

电话：138

中间正文

邮箱：test@example.invalid
"""
    )
    draft_decisions = _decisions(
        ir,
        {
            0: ("basics", "name"),
            1: ("basics", "contact_phone"),
            2: ("basics", "body"),
            3: ("basics", "contact_email"),
        },
    )

    with pytest.raises(ResumeImportCompositionError, match="contiguous"):
        compose_canonical_resume(
            ir,
            ResumeExtractionDraft(
                decisions=draft_decisions,
                groups=[
                    LayoutGroup(
                        role="contact_row",
                        member_source_ids=[ir.blocks[1].source_id, ir.blocks[3].source_id],
                    )
                ],
            ),
        )


def test_composer_rejects_multiple_independent_contact_blocks_without_contact_row() -> None:
    ir = build_section_ir(
        """# 测试者

电话：13800000000

邮箱：test@example.invalid
"""
    )
    with pytest.raises(
        ResumeImportCompositionError,
        match="multiple contact source blocks",
    ):
        compose_canonical_resume(
            ir,
            ResumeExtractionDraft(
                decisions=_decisions(
                    ir,
                    {
                        0: ("basics", "name"),
                        1: ("basics", "contact_phone"),
                        2: ("basics", "contact_email"),
                    },
                )
            ),
        )


def test_composer_rejects_invalid_decision_role_combinations() -> None:
    ir = build_section_ir("# 测试者\n普通正文")
    cases = (
        {0: ("work", "name"), 1: ("custom", "body")},
        {0: ("basics", "name"), 1: ("custom", "section_heading")},
        {0: ("custom", "entry_left"), 1: ("custom", "body")},
        {0: ("basics", "name"), 1: ("work", "entry_header")},
    )
    for roles in cases:
        with pytest.raises(ResumeImportCompositionError):
            compose_canonical_resume(
                ir,
                ResumeExtractionDraft(decisions=_decisions(ir, roles)),
            )


def test_entry_header_rejects_basics_paragraph_even_with_separator() -> None:
    ir = build_section_ir("# 测试者\n电话：138 ｜ test@example.invalid")

    with pytest.raises(ResumeImportCompositionError, match="non-basics paragraph"):
        compose_canonical_resume(
            ir,
            ResumeExtractionDraft(
                decisions=_decisions(
                    ir,
                    {
                        0: ("basics", "name"),
                        1: ("basics", "entry_header"),
                    },
                )
            ),
        )


def test_left_right_layout_requires_group_or_deterministic_separator() -> None:
    ir = build_section_ir(
        """# 测试者
## 工作经历
公司名称 职位名称

公司名称 ｜ 职位名称

技术栈：Java ｜ MySQL
"""
    )
    draft = ResumeExtractionDraft(
        decisions=_decisions(
            ir,
            {
                0: ("basics", "name"),
                1: ("work", "section_heading"),
                2: ("work", "body"),
                3: ("work", "entry_header"),
                4: ("work", "body"),
            },
        )
    )
    result = compose_canonical_resume(
        ir,
        draft,
        ImportLayoutRecipe(
            key="test-template",
            renderer="flow",
            entry_header_mode="left_right",
        ),
    )

    contents = [
        item.content.content
        for item in result.document.sections.custom_sections[1].items
    ]
    assert contents[0] == "公司名称 职位名称"
    assert "::: left" in contents[1]
    assert "::: right" in contents[1]
    assert contents[2] == "技术栈：Java ｜ MySQL"


def test_explicit_groups_merge_contacts_and_render_independent_entry_blocks() -> None:
    ir = build_section_ir(
        """# 测试者

电话：13800000000

邮箱：test@example.invalid

网站：example.invalid

## 工作经历

示例公司

后端工程师
"""
    )
    draft = ResumeExtractionDraft(
        decisions=_decisions(
            ir,
            {
                0: ("basics", "name"),
                1: ("basics", "contact_phone"),
                2: ("basics", "contact_email"),
                3: ("basics", "contact_link"),
                4: ("work", "section_heading"),
                5: ("work", "entry_left"),
                6: ("work", "entry_right"),
            },
        ),
        groups=[
            LayoutGroup(
                role="contact_row",
                member_source_ids=[
                    ir.blocks[1].source_id,
                    ir.blocks[2].source_id,
                    ir.blocks[3].source_id,
                ],
            ),
            LayoutGroup(
                role="entry_row",
                member_source_ids=[ir.blocks[5].source_id, ir.blocks[6].source_id],
            ),
        ],
    )

    result = compose_canonical_resume(ir, draft)
    basics, work = result.document.sections.custom_sections
    assert len(basics.items) == 2
    assert "  ·  " in basics.items[1].content.content
    assert "::: left\n示例公司" in work.items[0].content.content
    assert "::: right\n后端工程师" in work.items[0].content.content
