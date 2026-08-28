import pytest

from linkcv.domain.resume.legacy_cutover import (
    LegacyCutoverError,
    convert_legacy_document,
    convert_legacy_template,
    presentation_for_legacy,
    rich_text_blocks,
)
from linkcv.domain.resume.models import ListBlock, ParagraphBlock, RowBlock
from linkcv.domain.resume_document import RichText, default_resume_document
from linkcv.domain.resume_style import PageStyle, default_resume_style


def test_cutover_preserves_markdown_list_start_links_and_marks() -> None:
    blocks = rich_text_blocks(
        RichText(
            format="markdown",
            content="3. **项目三** [网站](https://example.invalid)\n4. 项目四",
        ),
        seed="ordered",
    )

    ordered = next(block for block in blocks if isinstance(block, ListBlock))
    assert ordered.start == 3
    assert [item.runs[0].text for item in ordered.items] == ["项目三", "项目四"]
    assert ordered.items[0].runs[0].marks == ["bold"]
    link_run = next(run for run in ordered.items[0].runs if getattr(run, "href", None))
    assert link_run.href == "https://example.invalid"


def test_cutover_strips_layout_containers_but_keeps_tiptap_text_and_style() -> None:
    blocks = rich_text_blocks(
        RichText(
            format="tiptap-json",
            content={
                "type": "doc",
                "content": [
                    {
                        "type": "resumeRow",
                        "attrs": {"leftWidth": 50},
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "保留内容",
                                        "marks": [
                                            {"type": "underline"},
                                            {
                                                "type": "textStyle",
                                                "attrs": {
                                                    "color": "#123456",
                                                    "fontSize": "12pt",
                                                },
                                            },
                                            {
                                                "type": "highlight",
                                                "attrs": {"color": "#FFEEDD"},
                                            },
                                        ],
                                    }
                                ],
                            },
                            {"type": "paragraph", "content": [{"type": "text", "text": "右侧"}]},
                        ],
                    }
                ],
            },
        ),
        seed="layout",
    )

    row = next(block for block in blocks if isinstance(block, RowBlock))
    assert row.row_kind == "pair"
    assert row.left_width_percent == 50
    paragraph = row.cells[0].blocks[0]
    run = paragraph.runs[0]
    assert run.text == "保留内容"
    assert run.marks == ["underline"]
    assert run.style.color == "#123456"
    assert run.style.font_size_pt == 12
    assert run.style.highlight_color == "#FFEEDD"


@pytest.mark.parametrize(
    ("node_type", "row_kind", "cell_count", "left_width"),
    [
        ("resumeRow", "pair", 2, 64),
        ("resumeMetaRow", "meta", 4, None),
        ("resumeTrioRow", "trio", 3, None),
    ],
)
def test_cutover_maps_all_tiptap_row_shapes(
    node_type: str,
    row_kind: str,
    cell_count: int,
    left_width: int | None,
) -> None:
    attrs = {"leftWidth": left_width} if left_width is not None else {}
    row = {
        "type": node_type,
        "attrs": attrs,
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": f"{row_kind}-{index}"}],
            }
            for index in range(cell_count)
        ],
    }

    blocks = rich_text_blocks(
        RichText(
            format="tiptap-json",
            content={"type": "doc", "content": [row]},
        ),
        seed=f"tiptap-{row_kind}",
    )

    assert len(blocks) == 1
    canonical = blocks[0]
    assert isinstance(canonical, RowBlock)
    assert canonical.row_kind == row_kind
    assert len(canonical.cells) == cell_count
    assert canonical.left_width_percent == left_width
    assert [cell.blocks[0].runs[0].text for cell in canonical.cells] == [
        f"{row_kind}-{index}" for index in range(cell_count)
    ]


@pytest.mark.parametrize(
    ("row_kind", "content", "cell_count", "left_width"),
    [
        (
            "pair",
            "::: left 64\n左侧\n:::\n::: right\n右侧\n:::",
            2,
            64,
        ),
        ("meta", ":::: meta\n姓名\n组织\n角色\n地点\n::::", 4, None),
        ("trio", ":::: trio\n项目\n职责\n成果\n::::", 3, None),
    ],
)
def test_cutover_maps_all_legacy_markdown_row_shapes(
    row_kind: str,
    content: str,
    cell_count: int,
    left_width: int | None,
) -> None:
    blocks = rich_text_blocks(
        RichText(format="markdown", content=content),
        seed=f"markdown-{row_kind}",
    )

    assert len(blocks) == 1
    canonical = blocks[0]
    assert isinstance(canonical, RowBlock)
    assert canonical.row_kind == row_kind
    assert len(canonical.cells) == cell_count
    assert canonical.left_width_percent == left_width
    assert all(":::" not in " ".join(run.text for run in cell.blocks[0].runs) for cell in canonical.cells)


def test_cutover_rejects_incomplete_or_nested_legacy_row_containers() -> None:
    with pytest.raises(LegacyCutoverError, match="incomplete"):
        rich_text_blocks(
            RichText(format="markdown", content="::: left 60\n左侧\n:::\n::: right\n右侧"),
            seed="incomplete-pair",
        )

    with pytest.raises(LegacyCutoverError, match="nested"):
        rich_text_blocks(
            RichText(
                format="markdown",
                content=":::: meta\n姓名\n:::: main\n错误\n::::\n角色\n地点\n::::",
            ),
            seed="nested-meta",
        )

    with pytest.raises(LegacyCutoverError, match="exactly 3"):
        rich_text_blocks(
            RichText(format="markdown", content=":::: trio\n一\n二\n::::"),
            seed="short-trio",
        )


def test_inline_three_colons_remain_ordinary_resume_text() -> None:
    blocks = rich_text_blocks(
        RichText(format="markdown", content="普通正文中的 foo:::bar 不属于布局标签"),
        seed="literal-colons",
    )

    assert len(blocks) == 1
    assert blocks[0].block_type == "paragraph"


def test_cutover_builds_canonical_document_template_and_presentation() -> None:
    legacy_document = default_resume_document()
    legacy_style = default_resume_style()
    template = convert_legacy_template(legacy_style, template_key="classic-cn")
    document = convert_legacy_document(legacy_document)
    presentation = presentation_for_legacy(legacy_style, template)

    assert document.schema_version == "canonical-resume.v1"
    assert document.identity.name is not None
    assert document.identity.name.value == "张三"
    assert template.schema_version == "template-definition.v1"
    assert sum(slot.universal_fallback for slot in template.slots) == 1
    assert presentation.template_snapshot == template


def test_cutover_preserves_asymmetric_page_margins() -> None:
    style = default_resume_style().model_copy(
        update={
            "page": PageStyle(
                margin_top_mm=0,
                margin_right_mm=10,
                margin_bottom_mm=8,
                margin_left_mm=10,
            )
        }
    )
    template = convert_legacy_template(style, template_key="civic-service-cn")
    presentation = presentation_for_legacy(style, template)

    assert template.tokens.page_margin_top_mm == 0
    assert template.tokens.page_margin_right_mm == 10
    assert template.tokens.page_margin_bottom_mm == 8
    assert template.tokens.page_margin_left_mm == 10
    assert presentation.portable.page_margin_top_mm == 0
    assert presentation.portable.page_margin_bottom_mm == 8


def test_cutover_rejects_nested_lists_instead_of_flattening_them() -> None:
    with pytest.raises(LegacyCutoverError, match="nested"):
        rich_text_blocks(
            RichText(format="markdown", content="- 一级\n  - 二级"),
            seed="nested",
        )
