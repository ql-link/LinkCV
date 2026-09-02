from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from linkcv.domain.resume.legacy_cutover import LegacyCutoverError
from linkcv.domain.resume.legacy_cutover import blank_canonical_document
from linkcv.domain.resume.models import ParagraphBlock

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REVISION_PATH = (
    BACKEND_ROOT
    / "migrations"
    / "versions"
    / "0048_recompose_canonical_rows_and_avatar.py"
)


def load_revision():
    spec = importlib.util.spec_from_file_location("linkcv_revision_0048", REVISION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def labels() -> dict[str, str]:
    return {
        key: key
        for key in (
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
        )
    }


def template_style(key: str, *, region: str = "main") -> dict[str, object]:
    return {
        "schema_version": "template-definition.v1",
        "template_key": key,
        "semantic_labels": labels(),
        "regions": [{"region_id": region, "region_kind": "main", "order": 0}],
        "slots": [
            {
                "slot_id": "all-content",
                "region_id": region,
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
            }
        ],
        "tokens": {
            "font_family": "Source Han Serif SC",
            "font_size_pt": 10,
            "line_height": 1.5,
            "accent_color": "#2F4858",
            "page_margin_mm": 14,
        },
    }


def presentation(style: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": "resume-presentation.v1",
        "portable": {},
        "template_scoped": {style["template_key"]: {}},
        "template_snapshot": style,
    }


def paragraph(node_id: str, value: str) -> dict[str, object]:
    return {
        "node_id": node_id,
        "source_refs": [],
        "block_type": "paragraph",
        "runs": [
            {
                "inline_type": "text",
                "text": value,
                "marks": [],
                "href": None,
                "style": {"color": None, "font_size_pt": None, "highlight_color": None},
            }
        ],
    }


def marked_collapsed_paragraph(
    node_id: str,
    *,
    opener: str,
    body: str,
    closer: str,
    mark: str,
    source_ref: str,
) -> dict[str, object]:
    payload = paragraph(node_id, "placeholder")
    payload["source_refs"] = [source_ref]
    style = {"color": None, "font_size_pt": None, "highlight_color": None}
    payload["runs"] = [
        {
            "inline_type": "text",
            "text": opener,
            "marks": [],
            "href": None,
            "style": style,
        },
        {
            "inline_type": "text",
            "text": "\n",
            "marks": [],
            "href": None,
            "style": style,
        },
        {
            "inline_type": "text",
            "text": body,
            "marks": [mark],
            "href": None,
            "style": style,
        },
        {
            "inline_type": "text",
            "text": "\n",
            "marks": [],
            "href": None,
            "style": style,
        },
        {
            "inline_type": "text",
            "text": closer,
            "marks": [],
            "href": None,
            "style": style,
        },
    ]
    return payload


class Rows:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    def mappings(self) -> "Rows":
        return self

    def all(self) -> list[dict[str, object]]:
        return self.rows


class Connection:
    def __init__(self, *, templates, resumes, versions) -> None:
        self.templates = templates
        self.resumes = resumes
        self.versions = versions
        self.statements: list[str] = []

    def execute(self, statement, _params=None):
        query = str(statement)
        self.statements.append(query)
        if "FROM resume_templates" in query:
            return Rows(self.templates)
        if "FROM resume_versions" in query:
            return Rows(self.versions)
        if "FROM resumes" in query:
            return Rows(self.resumes)
        raise AssertionError(query)


def test_0048_restores_protected_official_avatar_policies() -> None:
    revision = load_revision()
    data = blank_canonical_document(seed="template").model_dump(mode="json")
    rows = [
        {
            "id": index,
            "key": key,
            "data_json": data,
            "style_json": template_style(key),
        }
        for index, key in enumerate(revision.OFFICIAL_AVATAR_POLICY, start=1)
    ]
    connection = Connection(templates=rows, resumes=[], versions=[])
    _, _, _, payloads = revision._template_rows(connection)

    for row in rows:
        avatar = payloads[row["id"]][1]["avatar"]
        expected = revision.OFFICIAL_AVATAR_POLICY[row["key"]]
        assert avatar["visibility"] == expected["visibility"]
        assert avatar["fallback_asset"] == expected["fallback_asset"]
        if "size_px" in expected:
            assert avatar["size_px"] == expected["size_px"]
        assert avatar["region_id"] == "main"


def test_0048_recomposes_flattened_pair_before_any_write() -> None:
    revision = load_revision()
    document = blank_canonical_document(seed="row").model_dump(mode="json")
    section = {
        "node_id": "node_ssssssssssssssss",
        "source_refs": [],
        "semantic_kind": "custom",
        "title": None,
        "entries": [],
        "blocks": [
            paragraph("node_oooooooooooooooo", "::: left 64"),
            paragraph("node_llllllllllllllll", "左侧"),
            paragraph("node_cccccccccccccccc", ":::"),
            paragraph("node_rrrrrrrrrrrrrrrr", "::: right"),
            paragraph("node_bbbbbbbbbbbbbbbb", "右侧"),
            paragraph("node_eeeeeeeeeeeeeeee", ":::"),
        ],
    }
    document["sections"] = [section]
    style = template_style("administrative-sidebar-cn")
    connection = Connection(
        templates=[
            {
                "id": 1,
                "key": style["template_key"],
                "data_json": blank_canonical_document(seed="template").model_dump(
                    mode="json"
                ),
                "style_json": style,
            }
        ],
        resumes=[
            {
                "id": 2,
                "template_id": 1,
                "data_json": document,
                "style_json": presentation(style),
            }
        ],
        versions=[
            {
                "id": 3,
                "resume_id": 2,
                "template_id": 1,
                "data_json": document,
                "style_json": presentation(style),
            }
        ],
    )
    payloads = revision._preflight(connection)

    converted = payloads[3][2][0]
    row = converted["sections"][0]["blocks"][0]
    assert row["block_type"] == "row"
    assert row["row_kind"] == "pair"
    assert row["left_width_percent"] == 64
    assert [cell["blocks"][0]["runs"][0]["text"] for cell in row["cells"]] == [
        "左侧",
        "右侧",
    ]
    assert ":::" not in str(converted)
    assert not any("UPDATE" in statement for statement in connection.statements)


def test_0048_recomposes_pair_collapsed_into_two_marked_paragraphs() -> None:
    revision = load_revision()
    left_id = "node_llllllllllllllll"
    right_id = "node_rrrrrrrrrrrrrrrr"
    left_payload = marked_collapsed_paragraph(
        left_id,
        opener="::: left 64",
        body="左侧",
        closer=":::",
        mark="bold",
        source_ref="src_aaaaaaaaaaaaaaaa",
    )
    left_payload["runs"][2]["href"] = "https://example.com"
    left_payload["runs"][2]["style"]["color"] = "#123456"
    result = revision.recompose_flattened_rows(
        [
            ParagraphBlock.model_validate(left_payload),
            ParagraphBlock.model_validate(
                marked_collapsed_paragraph(
                    right_id,
                    opener="::: right",
                    body="右侧",
                    closer=":::",
                    mark="italic",
                    source_ref="src_bbbbbbbbbbbbbbbb",
                )
            ),
        ],
        seed="collapsed-pair",
    )

    assert len(result) == 1
    row = result[0]
    assert row.block_type == "row"
    assert row.row_kind == "pair"
    assert row.node_id == left_id
    assert row.left_width_percent == 64
    assert row.source_refs == ["src_aaaaaaaaaaaaaaaa", "src_bbbbbbbbbbbbbbbb"]
    assert row.cells[1].node_id == right_id
    assert row.cells[0].blocks[0].runs[0].text == "左侧"
    assert row.cells[0].blocks[0].runs[0].marks == ["bold"]
    assert row.cells[0].blocks[0].runs[0].href == "https://example.com"
    assert row.cells[0].blocks[0].runs[0].style.color == "#123456"
    assert row.cells[1].blocks[0].runs[0].text == "右侧"
    assert row.cells[1].blocks[0].runs[0].marks == ["italic"]


@pytest.mark.parametrize(
    ("kind", "values", "closer"),
    [
        ("meta", ["日期", "组织", "项目", "角色"], "\n::::"),
        ("trio", ["技能", "时长", "程度"], ""),
    ],
)
def test_0048_recomposes_collapsed_fixed_rows(
    kind: str,
    values: list[str],
    closer: str,
) -> None:
    revision = load_revision()
    node_id = "node_ffffffffffffffff"
    block = ParagraphBlock.model_validate(
        paragraph(node_id, ":::: " + kind + "\n" + "\n".join(values) + closer)
    )

    result = revision.recompose_flattened_rows([block], seed=f"collapsed-{kind}")

    assert len(result) == 1
    row = result[0]
    assert row.block_type == "row"
    assert row.row_kind == kind
    assert row.node_id == node_id
    assert [cell.blocks[0].runs[0].text for cell in row.cells] == values
    assert "::::" not in str(row.model_dump(mode="json"))


def test_0048_rejects_ambiguous_collapsed_rows() -> None:
    revision = load_revision()
    with pytest.raises(LegacyCutoverError, match="ambiguous cell count"):
        revision.recompose_flattened_rows(
            [
                ParagraphBlock.model_validate(
                    paragraph(
                        "node_fffffffffffffff1",
                        ":::: trio\n技能\n时长\n::::",
                    )
                )
            ],
            seed="collapsed-short-trio",
        )
    with pytest.raises(LegacyCutoverError, match="nested collapsed pair"):
        revision.recompose_flattened_rows(
            [
                ParagraphBlock.model_validate(
                    paragraph(
                        "node_fffffffffffffff2",
                        "::: left 64\n左侧\n:::: trio\n:::",
                    )
                ),
                ParagraphBlock.model_validate(
                    paragraph(
                        "node_fffffffffffffff3",
                        "::: right\n右侧\n:::",
                    )
                ),
            ],
            seed="collapsed-nested",
        )


def test_0048_blocks_ambiguous_reconstruction_and_is_forward_only() -> None:
    revision = load_revision()
    with pytest.raises(LegacyCutoverError):
        revision.recompose_flattened_rows(
            [
                ParagraphBlock.model_validate(
                    paragraph("node_ooooooooooooooo1", "::: left 64")
                ),
            ],
            seed="bad",
        )
    assert (
        "CREATE TABLE"
        not in (BACKEND_ROOT / "migrations" / "sql" / "0048.up.sql")
        .read_text(encoding="utf-8")
        .upper()
    )
    with pytest.raises(RuntimeError, match="forward-only"):
        revision.downgrade()


def test_0048_preflight_rejects_incomplete_marker_before_any_write() -> None:
    revision = load_revision()
    document = blank_canonical_document(seed="incomplete").model_dump(mode="json")
    document["sections"] = [
        {
            "node_id": "node_ssssssssssssssss",
            "source_refs": [],
            "semantic_kind": "custom",
            "title": None,
            "entries": [],
            "blocks": [paragraph("node_ooooooooooooooo1", "::: left 64")],
        }
    ]
    style = template_style("administrative-sidebar-cn")
    connection = Connection(
        templates=[
            {
                "id": 1,
                "key": style["template_key"],
                "data_json": blank_canonical_document(seed="template").model_dump(
                    mode="json"
                ),
                "style_json": style,
            }
        ],
        resumes=[
            {
                "id": 2,
                "template_id": 1,
                "data_json": document,
                "style_json": presentation(style),
            }
        ],
        versions=[],
    )

    with pytest.raises(LegacyCutoverError, match="incomplete"):
        revision._preflight(connection)
    assert not any("UPDATE" in statement for statement in connection.statements)


def test_0048_does_not_treat_inline_colons_as_a_legacy_layout_marker() -> None:
    revision = load_revision()

    assert revision._raw_marker_present("说明：命名空间示例 foo:::bar") is False
    assert revision._raw_marker_present("::: left 64") is True
