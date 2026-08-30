import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from linkcv.domain.resume import (
    CanonicalResumeDocument,
    LayoutPlan,
    ResumePresentation,
    SourceGraph,
    SparseResumeAnnotations,
    TemplateDefinition,
    canonical_json_bytes,
    canonical_sha256,
    validate_layout_coverage,
    validate_source_closure,
    validate_sparse_annotations,
)


def template_payload() -> dict:
    return {
        "schema_version": "template-definition.v1",
        "template_key": "classic-cn",
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
        "regions": [{"region_id": "main", "region_kind": "main", "order": 0}],
        "slots": [
            {
                "slot_id": "all-content",
                "region_id": "main",
                "universal_fallback": True,
                "order": 0,
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
            }
        ],
        "tokens": {
            "font_family": "Source Han Serif SC",
            "font_size_pt": 10,
            "line_height": 1.5,
            "accent_color": "#2F4858",
            "page_margin_mm": 14,
        },
        "avatar": {
            "visibility": "show",
            "fallback_asset": "system-default",
            "size_px": 96,
            "region_id": "main",
        },
    }


@pytest.mark.parametrize(
    ("schema_name", "model"),
    [
        ("canonical-resume.schema.json", CanonicalResumeDocument),
        ("source-graph.schema.json", SourceGraph),
        ("sparse-resume-annotations.schema.json", SparseResumeAnnotations),
        ("template-definition.schema.json", TemplateDefinition),
        ("resume-presentation.schema.json", ResumePresentation),
        ("layout-plan.schema.json", LayoutPlan),
    ],
)
def test_python_models_match_shared_contract_fixtures(schema_name, model) -> None:
    root = Path(__file__).resolve().parents[6]
    manifest = json.loads(
        (root / "contracts/resume/fixtures/manifest.json").read_text(encoding="utf-8")
    )
    for payload in manifest[schema_name]["valid"]:
        model.model_validate(payload)
    for payload in manifest[schema_name]["invalid"]:
        with pytest.raises((ValidationError, ValueError)):
            model.model_validate(payload)


def document_payload() -> dict:
    return {
        "schema_version": "canonical-resume.v1",
        "document_id": "node_aaaaaaaaaaaaaaaa",
        "identity": {
            "node_id": "node_bbbbbbbbbbbbbbbb",
            "name": None,
            "headline": None,
            "contacts": [],
            "avatar": None,
        },
        "sections": [
            {
                "node_id": "node_cccccccccccccccc",
                "semantic_kind": "education",
                "title": None,
                "entries": [],
                "blocks": [],
                "source_refs": [],
            }
        ],
        "source_dispositions": [],
    }


def test_canonical_json_matches_shared_fixture() -> None:
    value = {"b": [2, 1], "a": "张三"}
    assert canonical_json_bytes(value).decode() == '{"a":"张三","b":[2,1]}'
    assert (
        canonical_sha256(value)
        == "bad782a92e6a2f40dd9d5c8059ad878b6400e71c6c7de89bf7370370b1cd444c"
    )


def test_canonical_json_rejects_non_nfc() -> None:
    with pytest.raises(ValueError, match="non-NFC"):
        canonical_json_bytes("e\u0301")


def test_canonical_document_rejects_layout_fields_and_duplicate_nodes() -> None:
    payload = document_payload()
    payload["layout"] = {"columns": 2}
    with pytest.raises(ValidationError):
        CanonicalResumeDocument.model_validate(payload)


def test_canonical_document_preserves_inline_links_and_ordered_list_start() -> None:
    payload = document_payload()
    payload["sections"][0]["blocks"] = [
        {
            "node_id": "node_dddddddddddddddd",
            "block_type": "ordered_list",
            "start": 3,
            "items": [
                {
                    "node_id": "node_eeeeeeeeeeeeeeee",
                    "source_refs": [],
                    "runs": [
                        {
                            "inline_type": "text",
                            "text": "项目网站",
                            "marks": ["bold"],
                            "href": "https://example.test/project",
                            "style": {
                                "color": "#3478F6",
                                "font_size_pt": 11.5,
                                "highlight_color": "#FFF3C4",
                            },
                        }
                    ],
                }
            ],
        }
    ]
    document = CanonicalResumeDocument.model_validate(payload)
    block = document.sections[0].blocks[0]
    assert block.start == 3
    assert block.items[0].runs[0].href == "https://example.test/project"
    assert block.items[0].runs[0].style.font_size_pt == 11.5
    payload = document_payload()
    payload["sections"][0]["node_id"] = "node_bbbbbbbbbbbbbbbb"
    with pytest.raises(ValidationError, match="node ids must be unique"):
        CanonicalResumeDocument.model_validate(payload)


def test_canonical_rows_are_strict_fixed_cardinality_content_blocks() -> None:
    payload = document_payload()
    payload["sections"][0]["blocks"] = [
        {
            "node_id": "node_dddddddddddddddd",
            "source_refs": [],
            "block_type": "row",
            "row_kind": "pair",
            "left_width_percent": 64,
            "cells": [
                {
                    "node_id": "node_eeeeeeeeeeeeeeee",
                    "source_refs": [],
                    "blocks": [
                        {
                            "node_id": "node_1111111111111111",
                            "source_refs": [],
                            "block_type": "paragraph",
                            "runs": [],
                        }
                    ],
                },
                {
                    "node_id": "node_ffffffffffffffff",
                    "source_refs": [],
                    "blocks": [
                        {
                            "node_id": "node_2222222222222222",
                            "source_refs": [],
                            "block_type": "paragraph",
                            "runs": [],
                        }
                    ],
                },
            ],
        }
    ]
    document = CanonicalResumeDocument.model_validate(payload)
    assert document.sections[0].blocks[0].block_type == "row"

    for invalid_blocks in ([], [
        {
            "node_id": "node_1111111111111111",
            "source_refs": [],
            "block_type": "paragraph",
            "runs": [],
        },
        {
            "node_id": "node_3333333333333333",
            "source_refs": [],
            "block_type": "paragraph",
            "runs": [],
        },
    ], [{
        "node_id": "node_1111111111111111",
        "source_refs": [],
        "block_type": "bullet_list",
        "start": None,
        "items": [],
    }]):
        invalid_cell = document_payload()
        invalid_cell["sections"][0]["blocks"] = [{
            "node_id": "node_dddddddddddddddd",
            "source_refs": [],
            "block_type": "row",
            "row_kind": "pair",
            "left_width_percent": 64,
            "cells": [
                {"node_id": "node_eeeeeeeeeeeeeeee", "source_refs": [], "blocks": invalid_blocks},
                {
                    "node_id": "node_ffffffffffffffff",
                    "source_refs": [],
                    "blocks": [{
                        "node_id": "node_2222222222222222",
                        "source_refs": [],
                        "block_type": "paragraph",
                        "runs": [],
                    }],
                },
            ],
        }]
        with pytest.raises(ValidationError):
            CanonicalResumeDocument.model_validate(invalid_cell)

    for kind, count in (("meta", 3), ("trio", 4)):
        invalid = document_payload()
        invalid["sections"][0]["blocks"] = [{
            "node_id": "node_dddddddddddddddd",
            "source_refs": [],
            "block_type": "row",
            "row_kind": kind,
            "left_width_percent": None,
            "cells": [
                {
                    "node_id": f"node_{index:016x}",
                    "source_refs": [],
                    "blocks": [{
                        "node_id": f"node_{index + 100:016x}",
                        "source_refs": [],
                        "block_type": "paragraph",
                        "runs": [],
                    }],
                }
                for index in range(10, 10 + count)
            ],
        }]
        with pytest.raises(ValidationError):
            CanonicalResumeDocument.model_validate(invalid)


def test_template_avatar_is_strict_and_must_reference_a_region() -> None:
    template = TemplateDefinition.model_validate(template_payload())
    assert template.avatar.size_px == 96
    invalid = template_payload()
    invalid["avatar"] = {
        "visibility": "hide",
        "fallback_asset": "system-default",
        "size_px": 96,
        "region_id": "missing",
    }
    with pytest.raises(ValidationError):
        TemplateDefinition.model_validate(invalid)


def test_canonical_document_preserves_template_independent_media() -> None:
    payload = document_payload()
    payload["identity"]["avatar"] = {
        "node_id": "node_dddddddddddddddd",
        "source_refs": [],
        "media_kind": "avatar",
        "src": "/api/resumes/1/assets/avatar.png",
        "alt": "头像",
        "width": 96.0,
        "width_unit": "px",
        "height_px": 96.0,
        "align": None,
        "system_fallback": False,
    }
    payload["sections"][0]["blocks"] = [
        {
            "node_id": "node_eeeeeeeeeeeeeeee",
            "source_refs": [],
            "block_type": "media",
            "media_kind": "resume_image",
            "src": "/api/resumes/1/assets/project.png",
            "alt": "项目截图",
            "width": 60.0,
            "width_unit": "%",
            "height_px": None,
            "align": "right",
            "system_fallback": False,
        },
        {
            "node_id": "node_ffffffffffffffff",
            "source_refs": [],
            "block_type": "paragraph",
            "runs": [
                {
                    "inline_type": "text",
                    "text": "项目",
                    "marks": [],
                    "href": None,
                    "style": {
                        "color": None,
                        "font_size_pt": None,
                        "highlight_color": None,
                    },
                },
                {
                    "inline_type": "media",
                    "node_id": "node_gggggggggggggggg",
                    "source_refs": [],
                    "media_kind": "inline_image",
                    "src": "/api/resumes/1/assets/logo.png",
                    "alt": "标志",
                    "width": 84.0,
                    "width_unit": "px",
                    "height_px": 30.0,
                    "align": None,
                    "system_fallback": False,
                },
                {
                    "inline_type": "text",
                    "text": "说明",
                    "marks": [],
                    "href": None,
                    "style": {
                        "color": None,
                        "font_size_pt": None,
                        "highlight_color": None,
                    },
                },
            ],
        },
    ]
    document = CanonicalResumeDocument.model_validate(payload)
    assert document.identity.avatar is not None
    assert document.sections[0].blocks[0].media_kind == "resume_image"
    assert document.sections[0].blocks[1].runs[1].media_kind == "inline_image"


def test_python_contract_does_not_coerce_json_scalar_types() -> None:
    payload = {
        "schema_version": "source-graph.v1",
        "source_document_sha256": "0" * 64,
        "leaves": [
            {
                "source_id": "src_aaaaaaaaaaaaaaaa",
                "ordinal": "0",
                "page": "1",
                "block_id": "a",
                "leaf_kind": "heading",
                "text": "教育经历",
                "bbox": None,
                "list_kind": None,
                "list_ordinal": None,
            }
        ],
    }
    with pytest.raises(ValidationError):
        SourceGraph.model_validate(payload)


def test_template_requires_exactly_one_total_fallback() -> None:
    template = TemplateDefinition.model_validate(template_payload())
    assert template.slots[0].universal_fallback is True
    payload = template_payload()
    payload["slots"][0]["accepts"] = ["work"]
    with pytest.raises(ValidationError, match="universal fallback"):
        TemplateDefinition.model_validate(payload)


def test_presentation_keeps_template_scoped_settings_separate() -> None:
    presentation = ResumePresentation.model_validate(
        {
            "schema_version": "resume-presentation.v1",
            "portable": {"font_scale": 1},
            "template_scoped": {
                "classic-cn": {"avatar_size_px": 96},
                "modern-cn": {"avatar_size_px": 120},
            },
            "template_snapshot": template_payload(),
        }
    )
    assert presentation.template_scoped["classic-cn"].avatar_size_px == 96
    assert presentation.template_scoped["modern-cn"].avatar_size_px == 120


def test_sparse_annotations_may_be_incomplete_but_not_unknown() -> None:
    graph = SourceGraph.model_validate(
        {
            "schema_version": "source-graph.v1",
            "source_document_sha256": "0" * 64,
            "leaves": [
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "ordinal": 0,
                    "page": 1,
                    "block_id": "a",
                    "leaf_kind": "heading",
                    "text": "教育经历",
                    "bbox": None,
                    "list_kind": None,
                    "list_ordinal": None,
                },
                {
                    "source_id": "src_bbbbbbbbbbbbbbbb",
                    "ordinal": 1,
                    "page": 1,
                    "block_id": "b",
                    "leaf_kind": "paragraph",
                    "text": "示例大学",
                    "bbox": None,
                    "list_kind": None,
                    "list_ordinal": None,
                },
            ],
        }
    )
    annotations = SparseResumeAnnotations.model_validate(
        {
            "schema_version": "sparse-resume-annotations.v1",
            "source_graph_sha256": graph.graph_sha256(),
            "annotations": [
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "role": "section_title",
                    "semantic_kind": "education",
                    "entry_anchor_source_id": None,
                    "field_key": None,
                    "normalized_value": None,
                    "confidence": 0.9,
                }
            ],
        }
    )
    validate_sparse_annotations(graph, annotations)
    invalid = annotations.model_copy(
        update={
            "annotations": [
                annotations.annotations[0].model_copy(
                    update={"source_id": "src_zzzzzzzzzzzzzzzz"}
                )
            ]
        }
    )
    with pytest.raises(ValueError, match="unknown source_id"):
        validate_sparse_annotations(graph, invalid)


def test_sparse_annotations_allow_multiple_fields_for_one_source_and_anchor_entries() -> (
    None
):
    graph = SourceGraph.model_validate(
        {
            "schema_version": "source-graph.v1",
            "source_document_sha256": "0" * 64,
            "leaves": [
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "ordinal": 0,
                    "page": 1,
                    "block_id": "a",
                    "leaf_kind": "paragraph",
                    "text": "示例科技｜工程师",
                    "bbox": None,
                    "list_kind": None,
                    "list_ordinal": None,
                }
            ],
        }
    )
    payload = {
        "schema_version": "sparse-resume-annotations.v1",
        "source_graph_sha256": graph.graph_sha256(),
        "annotations": [
            {
                "source_id": "src_aaaaaaaaaaaaaaaa",
                "role": "entry_field",
                "semantic_kind": "work",
                "entry_anchor_source_id": "src_aaaaaaaaaaaaaaaa",
                "field_key": "organization",
                "normalized_value": "示例科技",
                "confidence": 0.9,
            },
            {
                "source_id": "src_aaaaaaaaaaaaaaaa",
                "role": "entry_field",
                "semantic_kind": "work",
                "entry_anchor_source_id": "src_aaaaaaaaaaaaaaaa",
                "field_key": "role",
                "normalized_value": "工程师",
                "confidence": 0.9,
            },
        ],
    }
    annotations = SparseResumeAnnotations.model_validate(payload)
    validate_sparse_annotations(graph, annotations)
    duplicate = annotations.model_copy(
        update={"annotations": [annotations.annotations[0], annotations.annotations[0]]}
    )
    with pytest.raises(ValueError, match="composite keys"):
        validate_sparse_annotations(graph, duplicate)


def test_sparse_annotations_allow_multiple_contacts_from_one_source_line() -> None:
    graph = SourceGraph.model_validate(
        {
            "schema_version": "source-graph.v1",
            "source_document_sha256": "0" * 64,
            "leaves": [
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "ordinal": 0,
                    "page": 1,
                    "block_id": "a",
                    "leaf_kind": "contact",
                    "text": "13800000000｜user@example.test｜https://example.test",
                    "bbox": None,
                    "list_kind": None,
                    "list_ordinal": None,
                }
            ],
        }
    )
    annotations = SparseResumeAnnotations.model_validate(
        {
            "schema_version": "sparse-resume-annotations.v1",
            "source_graph_sha256": graph.graph_sha256(),
            "annotations": [
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "role": "contact",
                    "semantic_kind": None,
                    "entry_anchor_source_id": None,
                    "field_key": "phone",
                    "normalized_value": "13800000000",
                    "confidence": 0.9,
                },
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "role": "contact",
                    "semantic_kind": None,
                    "entry_anchor_source_id": None,
                    "field_key": "email",
                    "normalized_value": "user@example.test",
                    "confidence": 0.9,
                },
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "role": "contact",
                    "semantic_kind": None,
                    "entry_anchor_source_id": None,
                    "field_key": "website",
                    "normalized_value": "https://example.test",
                    "confidence": 0.9,
                },
            ],
        }
    )
    validate_sparse_annotations(graph, annotations)
    assert [item.field_key for item in annotations.annotations] == [
        "phone",
        "email",
        "website",
    ]


def test_source_closure_requires_one_disposition_per_leaf_and_valid_target() -> None:
    graph = SourceGraph.model_validate(
        {
            "schema_version": "source-graph.v1",
            "source_document_sha256": "0" * 64,
            "leaves": [
                {
                    "source_id": "src_aaaaaaaaaaaaaaaa",
                    "ordinal": 0,
                    "page": 1,
                    "block_id": "a",
                    "leaf_kind": "paragraph",
                    "text": "教育经历",
                    "bbox": None,
                    "list_kind": None,
                    "list_ordinal": None,
                }
            ],
        }
    )
    payload = document_payload()
    payload["sections"][0]["source_refs"] = ["src_aaaaaaaaaaaaaaaa"]
    payload["source_dispositions"] = [
        {
            "source_id": "src_aaaaaaaaaaaaaaaa",
            "outcome": "mapped",
            "target_node_ids": ["node_cccccccccccccccc"],
            "reason_code": None,
        }
    ]
    document = CanonicalResumeDocument.model_validate(payload)
    validate_source_closure(graph, document)
    incomplete = document.model_copy(update={"source_dispositions": []})
    with pytest.raises(ValueError, match="close the SourceGraph"):
        validate_source_closure(graph, incomplete)
    dropped_but_referenced = document.model_copy(
        update={
            "source_dispositions": [
                document.source_dispositions[0].model_copy(
                    update={
                        "outcome": "dropped",
                        "target_node_ids": [],
                        "reason_code": "decorative",
                    }
                )
            ]
        }
    )
    with pytest.raises(ValueError, match="dropped source cannot be referenced"):
        validate_source_closure(graph, dropped_but_referenced)


def test_layout_plan_covers_identity_and_sections_exactly_once() -> None:
    document = CanonicalResumeDocument.model_validate(document_payload())
    template = TemplateDefinition.model_validate(template_payload())
    plan = LayoutPlan.model_validate(
        {
            "schema_version": "layout-plan.v1",
            "content_sha256": document.content_sha256(),
            "template_key": "classic-cn",
            "regions": [
                {
                    "region_id": "main",
                    "order": 0,
                    "nodes": [
                        {
                            "node_id": "node_bbbbbbbbbbbbbbbb",
                            "semantic_kind": "identity",
                            "slot_id": "all-content",
                        },
                        {
                            "node_id": "node_cccccccccccccccc",
                            "semantic_kind": "education",
                            "slot_id": "all-content",
                        },
                    ],
                }
            ],
        }
    )
    validate_layout_coverage(document, template, plan)
    incomplete = plan.model_copy(
        update={
            "regions": [
                plan.regions[0].model_copy(update={"nodes": plan.regions[0].nodes[:1]})
            ]
        }
    )
    with pytest.raises(ValueError, match="cover every"):
        validate_layout_coverage(document, template, incomplete)
