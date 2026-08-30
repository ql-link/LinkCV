import pytest
from pydantic import ValidationError

from linkcv.domain.document_conversion import PdfLayoutBlock
from linkcv.domain.resume import (
    ParsedSourceBlock,
    build_source_graph,
    build_source_graph_from_layout_ir,
)
from linkcv.domain.section_ir import build_section_ir


def blocks() -> list[ParsedSourceBlock]:
    return [
        ParsedSourceBlock(
            block_id="heading-1",
            page=1,
            leaf_kind="heading",
            text="教育经历",
            bbox=(0.1, 0.1, 0.8, 0.05),
        ),
        ParsedSourceBlock(
            block_id="item-1",
            page=1,
            leaf_kind="list_item",
            text="示例大学",
            list_kind="ordered",
            list_ordinal=1,
        ),
    ]


def test_source_graph_is_stable_for_identical_provider_output() -> None:
    first = build_source_graph(source_document_sha256="a" * 64, blocks=blocks())
    second = build_source_graph(source_document_sha256="a" * 64, blocks=blocks())
    assert first == second
    assert first.graph_sha256() == second.graph_sha256()
    assert first.leaves[0].source_id.startswith("src_")


def test_source_identity_changes_when_source_order_changes() -> None:
    original = build_source_graph(source_document_sha256="a" * 64, blocks=blocks())
    reordered = build_source_graph(
        source_document_sha256="a" * 64, blocks=list(reversed(blocks()))
    )
    assert [leaf.source_id for leaf in original.leaves] != [
        leaf.source_id for leaf in reordered.leaves
    ]


def test_source_graph_accepts_missing_coordinates() -> None:
    graph = build_source_graph(
        source_document_sha256="b" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="p-1", page=1, leaf_kind="paragraph", text="正文"
            )
        ],
    )
    assert graph.leaves[0].bbox is None


def test_source_graph_rejects_bbox_outside_normalized_page() -> None:
    with pytest.raises(ValidationError, match="inside the page"):
        build_source_graph(
            source_document_sha256="e" * 64,
            blocks=[
                ParsedSourceBlock(
                    block_id="p-1",
                    page=1,
                    leaf_kind="paragraph",
                    text="正文",
                    bbox=(0.8, 0.1, 0.3, 0.1),
                )
            ],
        )


def test_source_graph_rejects_invalid_ordered_list_metadata() -> None:
    with pytest.raises(ValidationError, match="list_ordinal"):
        build_source_graph(
            source_document_sha256="c" * 64,
            blocks=[
                ParsedSourceBlock(
                    block_id="item-1",
                    page=1,
                    leaf_kind="list_item",
                    text="条目",
                    list_kind="ordered",
                )
            ],
        )


def test_source_graph_rejects_non_nfc_text_without_normalizing_user_content() -> None:
    with pytest.raises(ValidationError, match="non-NFC"):
        build_source_graph(
            source_document_sha256="d" * 64,
            blocks=[
                ParsedSourceBlock(
                    block_id="p-1", page=1, leaf_kind="paragraph", text="e\u0301"
                )
            ],
        )


def test_source_graph_joins_pdf_layout_page_and_normalized_bbox() -> None:
    source_ir = build_section_ir(
        "# 张三\n\n## 教育经历\n示例大学",
        source_format="pdf",
    )
    hints = [
        PdfLayoutBlock(
            block_id="line-0",
            source_order=0,
            source_page=3,
            role="heading",
            heading_level=1,
            text="张三",
            bbox=(0.1, 0.1, 0.5, 0.2),
            role_source="opendataloader",
        ),
        PdfLayoutBlock(
            block_id="line-1",
            source_order=1,
            source_page=3,
            role="heading",
            heading_level=2,
            text="教育经历",
            bbox=(0.1, 0.3, 0.5, 0.4),
            role_source="opendataloader",
        ),
        PdfLayoutBlock(
            block_id="line-2",
            source_order=2,
            source_page=3,
            role="paragraph",
            text="示例大学",
            bbox=(0.1, 0.5, 0.5, 0.6),
            role_source="opendataloader",
        ),
    ]

    graph = build_source_graph_from_layout_ir(
        source_ir,
        source_document_sha256="f" * 64,
        layout_hints=hints,
    )

    assert [(leaf.page, leaf.block_id) for leaf in graph.leaves] == [
        (3, "line-0"),
        (3, "line-1"),
        (3, "line-2"),
    ]
    assert graph.leaves[1].bbox is not None
    assert graph.leaves[1].bbox.x == 0.1
    assert graph.leaves[1].bbox.width == 0.4


def test_source_graph_without_pdf_layout_keeps_text_order_and_no_bbox() -> None:
    source_ir = build_section_ir("# 张三\n\n正文", source_format="pdf")
    graph = build_source_graph_from_layout_ir(
        source_ir,
        source_document_sha256="e" * 64,
    )
    assert [leaf.text for leaf in graph.leaves] == ["张三", "正文"]
    assert all(leaf.page == 1 and leaf.bbox is None for leaf in graph.leaves)
