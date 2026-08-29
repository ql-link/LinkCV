import pytest

from linkcv.domain.resume import (
    CanonicalCompositionError,
    ParsedSourceBlock,
    SparseResumeAnnotations,
    TemplateDefinition,
    build_source_graph,
    compile_layout_plan,
    compose_canonical_resume_document,
)


def graph():
    return build_source_graph(
        source_document_sha256="a" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="name", page=1, leaf_kind="heading", text="张三"
            ),
            ParsedSourceBlock(
                block_id="contacts",
                page=1,
                leaf_kind="contact",
                text="13800000000｜user@example.test｜https://example.test",
            ),
            ParsedSourceBlock(
                block_id="work", page=1, leaf_kind="heading", text="工作经历"
            ),
            ParsedSourceBlock(
                block_id="entry",
                page=1,
                leaf_kind="paragraph",
                text="示例科技｜工程师",
            ),
            ParsedSourceBlock(
                block_id="body",
                page=1,
                leaf_kind="paragraph",
                text="负责服务稳定性",
            ),
            ParsedSourceBlock(
                block_id="list-3",
                page=1,
                leaf_kind="list_item",
                text="第一项",
                list_kind="ordered",
                list_ordinal=3,
            ),
            ParsedSourceBlock(
                block_id="list-4",
                page=1,
                leaf_kind="list_item",
                text="第二项",
                list_kind="ordered",
                list_ordinal=4,
            ),
        ],
    )


def sparse(graph_value, annotations):
    return SparseResumeAnnotations(
        schema_version="sparse-resume-annotations.v1",
        source_graph_sha256=graph_value.graph_sha256(),
        annotations=annotations,
    )


def test_sparse_annotations_are_optional_and_program_closes_every_source():
    graph_value = graph()
    result = compose_canonical_resume_document(graph_value, sparse(graph_value, []))

    assert len(result.document.source_dispositions) == len(graph_value.leaves)
    assert result.document.identity.name is not None
    assert [contact.contact_kind for contact in result.document.identity.contacts] == [
        "phone",
        "email",
        "website",
    ]
    assert result.document.sections[0].semantic_kind == "work"
    ordered = next(
        block
        for block in result.document.sections[0].blocks
        if block.block_type == "ordered_list"
    )
    assert ordered.start == 3
    assert [item.runs[0].text for item in ordered.items] == ["第一项", "第二项"]
    assert "未分类内容" not in result.document.model_dump_json()


def test_unknown_heading_inside_section_stays_a_body_paragraph():
    graph_value = build_source_graph(
        source_document_sha256="7" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="work-heading",
                page=1,
                leaf_kind="heading",
                text="工作经历",
            ),
            ParsedSourceBlock(
                block_id="company",
                page=1,
                leaf_kind="paragraph",
                text="示例科技",
            ),
            ParsedSourceBlock(
                block_id="technology-heading",
                page=1,
                leaf_kind="heading",
                text="技术架构:Java、Redis",
            ),
            ParsedSourceBlock(
                block_id="work-summary",
                page=1,
                leaf_kind="paragraph",
                text="负责服务稳定性",
            ),
            ParsedSourceBlock(
                block_id="work-item",
                page=1,
                leaf_kind="list_item",
                text="搭建自动化发布流程",
                list_kind="bullet",
            ),
            ParsedSourceBlock(
                block_id="achievement-heading",
                page=1,
                leaf_kind="heading",
                text="核心成果",
            ),
            ParsedSourceBlock(
                block_id="achievement-body",
                page=1,
                leaf_kind="paragraph",
                text="发布耗时缩短",
            ),
            ParsedSourceBlock(
                block_id="project-heading",
                page=1,
                leaf_kind="heading",
                text="项目经历",
            ),
            ParsedSourceBlock(
                block_id="project-body",
                page=1,
                leaf_kind="paragraph",
                text="示例项目",
            ),
        ],
    )

    result = compose_canonical_resume_document(graph_value)

    assert [section.semantic_kind for section in result.document.sections] == [
        "work",
        "project",
    ]
    work = result.document.sections[0]
    assert [block.block_type for block in work.blocks] == [
        "paragraph",
        "paragraph",
        "paragraph",
        "bullet_list",
        "paragraph",
        "paragraph",
    ]
    assert [
        block.runs[0].text
        for block in work.blocks
        if block.block_type == "paragraph"
    ] == [
        "示例科技",
        "技术架构:Java、Redis",
        "负责服务稳定性",
        "核心成果",
        "发布耗时缩短",
    ]
    assert work.blocks[3].items[0].runs[0].text == "搭建自动化发布流程"
    assert len(result.document.source_dispositions) == len(graph_value.leaves)
    assert all(
        disposition.outcome != "dropped"
        for disposition in result.document.source_dispositions
    )


def test_explicit_section_title_annotation_starts_new_custom_section():
    graph_value = build_source_graph(
        source_document_sha256="8" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="work-heading",
                page=1,
                leaf_kind="heading",
                text="工作经历",
            ),
            ParsedSourceBlock(
                block_id="custom-heading",
                page=1,
                leaf_kind="heading",
                text="技术架构",
            ),
            ParsedSourceBlock(
                block_id="custom-body",
                page=1,
                leaf_kind="paragraph",
                text="Java、Redis",
            ),
        ],
    )
    custom_heading_id = graph_value.leaves[1].source_id
    annotations = sparse(
        graph_value,
        [
            {
                "source_id": custom_heading_id,
                "role": "section_title",
                "semantic_kind": "custom",
                "entry_anchor_source_id": None,
                "field_key": None,
                "normalized_value": None,
                "confidence": 1.0,
            }
        ],
    )

    result = compose_canonical_resume_document(graph_value, annotations)

    assert [section.semantic_kind for section in result.document.sections] == [
        "work",
        "custom",
    ]
    assert result.document.sections[1].title is not None
    assert result.document.sections[1].title.value == "技术架构"
    assert result.document.sections[1].blocks[0].runs[0].text == "Java、Redis"
    assert len(result.document.source_dispositions) == len(graph_value.leaves)


def test_unknown_heading_starts_custom_section_when_no_section_exists():
    graph_value = build_source_graph(
        source_document_sha256="9" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="name-heading",
                page=1,
                leaf_kind="heading",
                text="张三",
            ),
            ParsedSourceBlock(
                block_id="custom-heading",
                page=1,
                leaf_kind="heading",
                text="自定义栏目",
            ),
            ParsedSourceBlock(
                block_id="custom-body",
                page=1,
                leaf_kind="paragraph",
                text="示例内容",
            ),
        ],
    )

    result = compose_canonical_resume_document(graph_value)

    assert result.document.identity.name is not None
    assert result.document.identity.name.value == "张三"
    assert [section.semantic_kind for section in result.document.sections] == [
        "custom"
    ]
    assert result.document.sections[0].title is not None
    assert result.document.sections[0].title.value == "自定义栏目"
    assert result.document.sections[0].blocks[0].runs[0].text == "示例内容"
    assert len(result.document.source_dispositions) == len(graph_value.leaves)


def test_preamble_paragraph_name_and_contact_line_become_identity_before_section():
    graph_value = build_source_graph(
        source_document_sha256="b" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="name-paragraph",
                page=1,
                leaf_kind="paragraph",
                text="张三",
            ),
            ParsedSourceBlock(
                block_id="contact-paragraph",
                page=1,
                leaf_kind="paragraph",
                text="10000000000｜demo@example.test",
            ),
            ParsedSourceBlock(
                block_id="education-heading",
                page=1,
                leaf_kind="heading",
                text="教育经历",
            ),
            ParsedSourceBlock(
                block_id="education-body",
                page=1,
                leaf_kind="paragraph",
                text="示例大学",
            ),
        ],
    )

    result = compose_canonical_resume_document(graph_value)

    assert result.document.identity.name is not None
    assert result.document.identity.name.value == "张三"
    assert [contact.contact_kind for contact in result.document.identity.contacts] == [
        "phone",
        "email",
    ]
    assert [section.semantic_kind for section in result.document.sections] == [
        "education"
    ]
    assert len(result.document.source_dispositions) == len(graph_value.leaves)
    assert all(
        disposition.outcome != "dropped"
        for disposition in result.document.source_dispositions
    )


def test_labeled_personal_websites_count_as_preamble_contacts():
    graph_value = build_source_graph(
        source_document_sha256="f" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="name-paragraph",
                page=1,
                leaf_kind="paragraph",
                text="张三",
            ),
            ParsedSourceBlock(
                block_id="contact-paragraph",
                page=1,
                leaf_kind="paragraph",
                text=(
                    "10000000000 | demo@example.test | "
                    "个人网站:www.example.test | https://portfolio.example.test"
                ),
            ),
            ParsedSourceBlock(
                block_id="education-heading",
                page=1,
                leaf_kind="heading",
                text="教育经历",
            ),
            ParsedSourceBlock(
                block_id="education-body",
                page=1,
                leaf_kind="paragraph",
                text="示例大学",
            ),
        ],
    )

    result = compose_canonical_resume_document(graph_value)

    assert result.document.identity.name is not None
    assert result.document.identity.name.value == "张三"
    assert [contact.contact_kind for contact in result.document.identity.contacts] == [
        "phone",
        "email",
        "website",
        "website",
    ]
    assert [contact.value for contact in result.document.identity.contacts] == [
        "10000000000",
        "demo@example.test",
        "www.example.test",
        "https://portfolio.example.test",
    ]
    assert [section.semantic_kind for section in result.document.sections] == [
        "education"
    ]
    assert len(result.document.source_dispositions) == len(graph_value.leaves)
    assert all(
        disposition.outcome != "dropped"
        for disposition in result.document.source_dispositions
    )


def test_body_url_after_section_remains_a_paragraph_not_identity_contact():
    graph_value = build_source_graph(
        source_document_sha256="c" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="projects-heading",
                page=1,
                leaf_kind="heading",
                text="项目经历",
            ),
            ParsedSourceBlock(
                block_id="project-url",
                page=1,
                leaf_kind="paragraph",
                text="项目主页见 https://example.test/demo",
            ),
        ],
    )

    result = compose_canonical_resume_document(graph_value)

    assert result.document.identity.contacts == []
    assert result.document.sections[0].blocks[0].runs[0].text == (
        "项目主页见 https://example.test/demo"
    )


def test_document_title_paragraph_is_not_inferred_as_identity_name():
    graph_value = build_source_graph(
        source_document_sha256="d" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="document-title",
                page=1,
                leaf_kind="paragraph",
                text="个人简历",
            ),
            ParsedSourceBlock(
                block_id="body",
                page=1,
                leaf_kind="paragraph",
                text="负责服务稳定性",
            ),
            ParsedSourceBlock(
                block_id="education-heading",
                page=1,
                leaf_kind="heading",
                text="教育经历",
            ),
        ],
    )

    result = compose_canonical_resume_document(graph_value)

    assert result.document.identity.name is None
    assert result.document.sections[0].semantic_kind == "custom"
    assert result.document.sections[0].blocks[0].runs[0].text == "个人简历"


def test_short_name_shaped_preamble_without_contact_stays_visible_body():
    graph_value = build_source_graph(
        source_document_sha256="e" * 64,
        blocks=[
            ParsedSourceBlock(
                block_id="short-preamble",
                page=1,
                leaf_kind="paragraph",
                text="春风",
            ),
            ParsedSourceBlock(
                block_id="education-heading",
                page=1,
                leaf_kind="heading",
                text="教育经历",
            ),
        ],
    )

    result = compose_canonical_resume_document(graph_value)

    assert result.document.identity.name is None
    assert result.document.sections[0].semantic_kind == "custom"
    assert result.document.sections[0].blocks[0].runs[0].text == "春风"
    assert len(result.document.source_dispositions) == len(graph_value.leaves)
    assert all(
        disposition.outcome != "dropped"
        for disposition in result.document.source_dispositions
    )


def test_one_source_can_enhance_multiple_fields_on_one_entry():
    graph_value = graph()
    entry_source_id = graph_value.leaves[3].source_id
    annotations = sparse(
        graph_value,
        [
            {
                "source_id": entry_source_id,
                "role": "entry_field",
                "semantic_kind": "work",
                "entry_anchor_source_id": entry_source_id,
                "field_key": "organization",
                "normalized_value": "示例科技",
                "confidence": 0.9,
            },
            {
                "source_id": entry_source_id,
                "role": "entry_field",
                "semantic_kind": "work",
                "entry_anchor_source_id": entry_source_id,
                "field_key": "role",
                "normalized_value": "工程师",
                "confidence": 0.9,
            },
        ],
    )

    result = compose_canonical_resume_document(graph_value, annotations)
    entry = result.document.sections[0].entries[0]
    assert entry.fields.organization is not None
    assert entry.fields.organization.value == "示例科技"
    assert entry.fields.role is not None
    assert entry.fields.role.value == "工程师"


def test_unknown_and_duplicate_sparse_enhancements_fail():
    graph_value = graph()
    annotation = {
        "source_id": "src_aaaaaaaaaaaaaaaa",
        "role": "body",
        "semantic_kind": "work",
        "entry_anchor_source_id": None,
        "field_key": None,
        "normalized_value": None,
        "confidence": 0.9,
    }
    with pytest.raises(CanonicalCompositionError, match="unknown source_id"):
        compose_canonical_resume_document(
            graph_value, sparse(graph_value, [annotation])
        )

    source_id = graph_value.leaves[2].source_id
    duplicate = {
        "source_id": source_id,
        "role": "body",
        "semantic_kind": "work",
        "entry_anchor_source_id": None,
        "field_key": None,
        "normalized_value": None,
        "confidence": 0.9,
    }
    with pytest.raises(CanonicalCompositionError, match="composite keys"):
        compose_canonical_resume_document(
            graph_value, sparse(graph_value, [duplicate, duplicate])
        )


def template():
    return TemplateDefinition.model_validate(
        {
            "schema_version": "template-definition.v1",
            "template_key": "runtime-cn",
            "semantic_labels": {
                "profile": "个人简介",
                "work": "工作经历",
                "education": "教育经历",
                "project": "项目经历",
                "skills": "专业技能",
                "activity": "活动经历",
                "interests": "兴趣爱好",
                "certificates": "证书",
                "awards": "奖项",
                "languages": "语言能力",
            },
            "regions": [
                {"region_id": "header", "region_kind": "header", "order": 0},
                {"region_id": "main", "region_kind": "main", "order": 1},
            ],
            "slots": [
                {
                    "slot_id": "identity",
                    "region_id": "header",
                    "accepts": ["identity"],
                    "universal_fallback": False,
                    "order": 0,
                },
                {
                    "slot_id": "all",
                    "region_id": "main",
                    "accepts": [
                        "identity",
                        "profile",
                        "work",
                        "education",
                        "project",
                        "skills",
                        "activity",
                        "interests",
                        "certificates",
                        "awards",
                        "languages",
                        "custom",
                    ],
                    "universal_fallback": True,
                    "order": 0,
                },
            ],
                "tokens": {
                "font_family": "sans",
                "font_size_pt": 10,
                "line_height": 1.5,
                "accent_color": "#000000",
                    "page_margin_mm": 12,
                },
                "avatar": {
                    "visibility": "hide",
                    "fallback_asset": "none",
                    "size_px": 96,
                    "region_id": "header",
                },
            }
    )


def test_layout_plan_routes_each_top_level_node_once():
    graph_value = graph()
    result = compose_canonical_resume_document(graph_value)
    plan = compile_layout_plan(result.document, template())
    nodes = [node for region in plan.regions for node in region.nodes]
    assert [node.node_id for node in nodes] == [
        result.document.identity.node_id,
        *(section.node_id for section in result.document.sections),
    ]
    assert len({node.node_id for node in nodes}) == len(nodes)
