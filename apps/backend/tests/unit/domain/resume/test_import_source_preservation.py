import pytest

from linkresume.domain.resume import (
    SparseResumeAnnotations,
    build_source_graph_from_layout_ir,
    compose_canonical_resume_document,
)
from linkresume.domain.section_ir import build_section_ir


def source(markdown):
    ir = build_section_ir(markdown, source_format="pdf")
    graph = build_source_graph_from_layout_ir(ir, source_document_sha256="a" * 64)
    return graph, ir


def annotation(graph, text, *, role="entry_field", key=None, anchor=None, kind="work", value=None):
    source_id = next(leaf.source_id for leaf in graph.leaves if leaf.text == text)
    anchor_id = (
        next(leaf.source_id for leaf in graph.leaves if leaf.text == anchor)
        if anchor is not None
        else None
    )
    return {
        "source_id": source_id,
        "role": role,
        "semantic_kind": kind,
        "entry_anchor_source_id": anchor_id,
        "field_key": key,
        "normalized_value": value,
        "confidence": 0.9,
    }


def compose(graph, ir, annotations):
    result = compose_canonical_resume_document(
        graph,
        SparseResumeAnnotations(
            schema_version="sparse-resume-annotations.v1",
            source_graph_sha256=graph.graph_sha256(),
            annotations=annotations,
        ),
        source_ir=ir,
    )
    assert result.discarded_source_ids == ()
    return result.document


def block_text(block):
    if block.block_type == "paragraph":
        return "".join(run.text for run in block.runs)
    return ["".join(run.text for run in item.runs) for item in block.items]


@pytest.mark.parametrize("value_mode", ["missing", "empty", "whole_line"])
def test_compact_contact_line_is_split_once_even_with_ambiguous_model_fields(value_mode):
    line = "电话:13800000000 | 邮箱:zhangsan@example.invalid"
    graph, ir = source(f"# 张三\n\n{line}\n\n## 专业技能\n\nJava")
    value = {"missing": None, "empty": "", "whole_line": line}[value_mode]
    document = compose(graph, ir, [
        annotation(graph, line, role="contact", key=key, kind=None, value=value)
        for key in ("phone", "email")
    ])
    assert [(c.contact_kind, c.value) for c in document.identity.contacts] == [
        ("phone", "13800000000"), ("email", "zhangsan@example.invalid")
    ]


@pytest.mark.parametrize("value_mode", ["missing", "whole_line"])
def test_ambiguous_education_fields_preserve_the_original_header_once(value_mode):
    line = "示例大学 - 计算机学院 - 人工智能 ｜ 2023.09-2027.06"
    graph, ir = source(f"# 张三\n\n## 教育背景\n\n{line}")
    document = compose(graph, ir, [
        annotation(graph, line, key=key, anchor=line, kind="education",
                   value=line if value_mode == "whole_line" else None)
        for key in ("organization", "degree", "major")
    ])
    entry = document.sections[0].entries[0]
    assert entry.fields.name.value == line
    assert all(value is None for key, value in entry.fields if key != "name")
    assert entry.blocks == []


@pytest.mark.parametrize("explicit_body_anchor", [False, True])
def test_two_experiences_keep_their_own_introduction_and_numbered_list(explicit_body_anchor):
    first = "示例甲公司 ｜ 2026.01-2026.03 ｜ 后端实习生"
    second = "示例乙公司 ｜ 2026.04-2026.06 ｜ Java实习生"
    graph, ir = source(f"""# 张三

## 实习经历

{first}

技术架构:Java、Redis

工作介绍:第一段介绍

1. 第一段成果一
2. 第一段成果二

{second}

技术架构:Python、MySQL

工作介绍:第二段介绍

1. 第二段成果一
2. 第二段成果二
""")
    hints = [
        annotation(graph, line, key=key, anchor=line)
        for line in (first, second)
        for key in ("organization", "role", "start_date", "end_date")
    ]
    if explicit_body_anchor:
        for text, anchor in (("工作介绍:第一段介绍", first), ("第一段成果一", first),
                             ("工作介绍:第二段介绍", second), ("第二段成果一", second)):
            hints.append(annotation(graph, text, role="body", anchor=anchor))
    section = compose(graph, ir, hints).sections[0]
    assert section.blocks == []
    assert [entry.fields.name.value for entry in section.entries] == [first, second]
    assert [[block_text(block) for block in entry.blocks] for entry in section.entries] == [
        ["技术架构:Java、Redis", "工作介绍:第一段介绍", ["第一段成果一", "第一段成果二"]],
        ["技术架构:Python、MySQL", "工作介绍:第二段介绍", ["第二段成果一", "第二段成果二"]],
    ]
    assert [entry.blocks[-1].start for entry in section.entries] == [1, 1]


def test_separate_field_sources_can_still_be_structured_without_normalized_values():
    graph, ir = source("# 张三\n\n## 工作经历\n\n示例科技\n\n工程师\n\n1. 服务治理")
    document = compose(graph, ir, [
        annotation(graph, "示例科技", key="organization", anchor="示例科技"),
        annotation(graph, "工程师", key="role", anchor="示例科技"),
    ])
    entry = document.sections[0].entries[0]
    assert entry.fields.organization.value == "示例科技"
    assert entry.fields.role.value == "工程师"
    assert entry.fields.name is None
    assert block_text(entry.blocks[0]) == ["服务治理"]


@pytest.mark.parametrize("values", [
    {"organization": "示例科技", "role": "工程师"},
    {"organization": "来源不存在的公司", "role": "工程师"},
    {"organization": "示例科技", "role": "示例科技"},
])
def test_partial_invented_or_overlapping_fields_cannot_discard_source_text(values):
    line = "示例科技 ｜ 2025.01-2026.02 ｜ 工程师"
    graph, ir = source(f"# 张三\n\n## 工作经历\n\n{line}")
    entry = compose(graph, ir, [
        annotation(graph, line, key=key, anchor=line, value=value)
        for key, value in values.items()
    ]).sections[0].entries[0]
    assert entry.fields.name.value == line
    assert entry.fields.organization is None
    assert entry.fields.role is None


def test_duplicate_entry_field_keeps_the_second_source_instead_of_overwriting():
    graph, ir = source("# 张三\n\n## 工作经历\n\n示例科技\n\n附属团队\n\n负责维护服务")
    entry = compose(graph, ir, [
        annotation(graph, text, key="organization", anchor="示例科技")
        for text in ("示例科技", "附属团队")
    ]).sections[0].entries[0]
    assert entry.fields.organization.value == "示例科技"
    assert [block_text(block) for block in entry.blocks] == ["附属团队", "负责维护服务"]


def test_anchor_text_not_used_by_a_field_remains_visible():
    graph, ir = source("# 张三\n\n## 个人项目\n\n示例项目\n\nhttps://example.invalid\n\n项目介绍")
    entry = compose(graph, ir, [
        annotation(graph, "https://example.invalid", key="url", anchor="示例项目", kind="project")
    ]).sections[0].entries[0]
    assert entry.fields.name.value == "示例项目"
    assert entry.fields.url.value == "https://example.invalid"
    assert block_text(entry.blocks[0]) == "项目介绍"


def test_section_preface_is_not_moved_after_structured_entries():
    graph, ir = source("# 张三\n\n## 工作经历\n\n经历概述\n\n示例科技｜工程师\n\n1. 服务治理")
    section = compose(graph, ir, [
        annotation(graph, "示例科技｜工程师", key=key, anchor="示例科技｜工程师", value=value)
        for key, value in (("organization", "示例科技"), ("role", "工程师"))
    ]).sections[0]
    assert section.entries == []
    assert [block_text(block) for block in section.blocks] == ["经历概述", "示例科技｜工程师", ["服务治理"]]
