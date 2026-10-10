from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator
import pytest
from pydantic import ValidationError

from drawoffer.domain.resume.models import Contact, TextValue


def styled_run(text="张", size=18):
    return {
        "inline_type": "text", "text": text, "marks": [], "href": None,
        "style": {"color": None, "font_size_pt": size, "highlight_color": None},
    }


def inline_image():
    return {
        "inline_type": "media", "media_kind": "inline_image",
        "node_id": "node_image000000000001", "source_refs": [],
        "src": "/api/resumes/1/assets/example.png", "alt": "示例图",
        "width": 48, "width_unit": "px", "height_px": 24,
        "align": None, "system_fallback": False,
    }


@pytest.mark.parametrize("model", [TextValue, Contact])
@pytest.mark.parametrize("image_only", [False, True])
def test_inline_images_round_trip_in_values_and_labels(model, image_only):
    payload = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [],
               "value": "" if image_only else "张三",
               "runs": [inline_image()] + ([] if image_only else [styled_run("张三")])}
    if model is Contact:
        payload.update(contact_kind="other", label="联系人")
    assert model.model_validate(payload).model_dump(mode="json") == payload
    schema = json.loads((Path(__file__).resolve().parents[6] / "contracts/resume/canonical-resume.schema.json").read_text())
    definition = "contact" if model is Contact else "textValue"
    Draft202012Validator({"$ref": f"#/$defs/{definition}", "$defs": schema["$defs"]}).validate(payload)
    # A label can itself contain an image; it is a distinct canonical node.
    payload["prefix_runs"] = [styled_run("联系人："), {**inline_image(), "node_id": "node_image000000000002"}]
    assert model.model_validate(payload).model_dump(mode="json") == payload


def test_contact_still_rejects_empty_content_without_an_image():
    with pytest.raises(ValidationError, match="requires text or inline media"):
        Contact(node_id="node_aaaaaaaaaaaaaaaa", source_refs=[], value="", contact_kind="other")


def test_agent_text_edit_preserves_inline_images_in_structured_fields():
    from drawoffer.modules.agent.canonical_targets import replace_runs

    image = inline_image()
    runs = [styled_run("张"), image, styled_run("三")]
    changed = replace_runs(runs, "张三", "李四", text_only=True)
    assert image in changed
    assert "".join(run["text"] for run in changed if run["inline_type"] == "text") == "李四"
    assert replace_runs([image], "", "张三", text_only=True)[-1] == image


@pytest.mark.parametrize("model", [TextValue, Contact])
def test_optional_styles_preserve_old_payloads_and_round_trip(model):
    payload = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "value": "张三"}
    if model is Contact:
        payload.update(contact_kind="other", label="联系人")
    assert model.model_validate(payload).model_dump(mode="json") == payload
    payload["runs"] = [styled_run(), styled_run("三", None)]
    payload["prefix_runs"] = [styled_run("联系人：", 12)]
    assert model.model_validate(payload).model_dump(mode="json") == payload


@pytest.mark.parametrize("size", [5.5, 48.5, float("nan"), float("inf")])
def test_rejects_out_of_range_font_sizes(size):
    with pytest.raises(ValidationError):
        TextValue(node_id="node_aaaaaaaaaaaaaaaa", source_refs=[], value="张", runs=[styled_run(size=size)])


def test_rejects_styled_text_that_differs_from_semantic_value():
    with pytest.raises(ValidationError, match="must match value"):
        TextValue(node_id="node_aaaaaaaaaaaaaaaa", source_refs=[], value="张三", runs=[styled_run("李四")])


def test_static_schema_accepts_optional_styles_and_rejects_invalid_size():
    root = Path(__file__).resolve().parents[6]
    schema = json.loads((root / "contracts/resume/canonical-resume.schema.json").read_text())
    field_schema = {"$ref": "#/$defs/textValue", "$defs": schema["$defs"]}
    value = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "value": "张", "runs": [styled_run()]}
    validator = Draft202012Validator(field_schema)
    validator.validate(value)
    invalid = deepcopy(value)
    invalid["runs"][0]["style"]["font_size_pt"] = 49
    assert list(validator.iter_errors(invalid))


@pytest.mark.parametrize("model", [TextValue, Contact])
@pytest.mark.parametrize("align", ["left", "center", "right"])
def test_alignment_round_trips_and_omits_when_unset(model, align):
    payload = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "value": "张三"}
    if model is Contact:
        payload.update(contact_kind="other", label="联系人")
    assert model.model_validate(payload).model_dump(mode="json") == payload
    payload["align"] = align
    assert model.model_validate(payload).model_dump(mode="json") == payload


@pytest.mark.parametrize("model", [TextValue, Contact])
@pytest.mark.parametrize("align", ["full", "", "justify", 0, True])
def test_alignment_rejects_unsupported_values(model, align):
    payload = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "value": "张三", "align": align}
    if model is Contact:
        payload.update(contact_kind="other", label="联系人")
    with pytest.raises(ValidationError):
        model.model_validate(payload)


def test_alignment_ignores_explicit_null_like_unset():
    payload = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "value": "张三", "align": None}
    assert TextValue.model_validate(payload).model_dump(mode="json") == {
        "node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "value": "张三",
    }


def test_paragraph_block_alignment_round_trips_and_omits_when_unset():
    from drawoffer.domain.resume.models import ParagraphBlock

    payload = {
        "node_id": "node_bbbbbbbbbbbbbbbb", "source_refs": [],
        "block_type": "paragraph", "runs": [styled_run()],
    }
    assert ParagraphBlock.model_validate(payload).model_dump(mode="json") == payload
    aligned = {**payload, "align": "center"}
    assert ParagraphBlock.model_validate(aligned).model_dump(mode="json") == aligned


def test_paragraph_block_rejects_media_only_alignment():
    from drawoffer.domain.resume.models import ParagraphBlock

    with pytest.raises(ValidationError):
        ParagraphBlock.model_validate({
            "node_id": "node_bbbbbbbbbbbbbbbb", "source_refs": [],
            "block_type": "paragraph", "runs": [styled_run()], "align": "full",
        })


def test_unset_alignment_keeps_historical_document_dump_and_digest_stable():
    from drawoffer.domain.resume.models import CanonicalResumeDocument
    from tests.canonical_resume_fixtures import canonical_resume_payload

    payload, _ = canonical_resume_payload()
    document = CanonicalResumeDocument.model_validate(payload)
    dumped = document.model_dump(mode="json")
    # A document written before this change must reproduce byte for byte,
    # otherwise every stored content_sha256 comparison would drift.
    assert json.dumps(dumped, sort_keys=True) == json.dumps(payload, sort_keys=True)
    assert "align" not in json.dumps(dumped, sort_keys=True)
    assert document.content_sha256() == CanonicalResumeDocument.model_validate(payload).content_sha256()


def test_static_schema_accepts_alignment_and_rejects_media_only_value():
    root = Path(__file__).resolve().parents[6]
    schema = json.loads((root / "contracts/resume/canonical-resume.schema.json").read_text())
    field_schema = {"$ref": "#/$defs/textValue", "$defs": schema["$defs"]}
    validator = Draft202012Validator(field_schema)
    value = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "value": "张", "align": "center"}
    validator.validate(value)
    invalid = deepcopy(value)
    invalid["align"] = "full"
    assert list(validator.iter_errors(invalid))


def test_alignment_does_not_change_node_ids_order_or_sources():
    from drawoffer.domain.resume.models import CanonicalResumeDocument

    def document(align):
        name = {"node_id": "node_bbbbbbbbbbbbbbbb", "source_refs": ["src_name000000000001"], "value": "张三"}
        title = {"node_id": "node_cccccccccccccccc", "source_refs": ["src_title00000000001"], "value": "工作经历"}
        block = {
            "node_id": "node_dddddddddddddddd", "source_refs": [],
            "block_type": "paragraph", "runs": [styled_run("负责服务治理", None)],
        }
        if align:
            name["align"] = align
            title["align"] = align
            block["align"] = align
        return {
            "schema_version": "canonical-resume.v1",
            "document_id": "node_aaaaaaaaaaaaaaaa",
            "identity": {
                "node_id": "node_eeeeeeeeeeeeeeee",
                "name": name,
                "headline": None,
                "contacts": [],
                "avatar": None,
            },
            "sections": [{
                "node_id": "node_ffffffffffffffff",
                "source_refs": [],
                "semantic_kind": "work",
                "title": title,
                "entries": [],
                "blocks": [block],
            }],
            "source_dispositions": [],
        }

    plain = CanonicalResumeDocument.model_validate(document(None))
    aligned = CanonicalResumeDocument.model_validate(document("center"))

    assert aligned.identity.node_id == plain.identity.node_id
    assert aligned.identity.name.node_id == plain.identity.name.node_id
    assert aligned.identity.name.source_refs == plain.identity.name.source_refs
    assert [section.node_id for section in aligned.sections] == [
        section.node_id for section in plain.sections
    ]
    assert aligned.sections[0].blocks[0].node_id == plain.sections[0].blocks[0].node_id
    assert aligned.sections[0].blocks[0].runs == plain.sections[0].blocks[0].runs


def test_agent_native_replacement_preserves_field_styles():
    from drawoffer.domain.resume.models import CanonicalResumeDocument
    from types import SimpleNamespace
    from drawoffer.modules.agent.canonical_targets import resolve, apply_operations
    from drawoffer.modules.agent.schemas import ResumeTargetLocator, ProposalOperation
    from tests.canonical_resume_fixtures import canonical_resume_payload

    payload, _ = canonical_resume_payload()
    payload["identity"]["name"] = {"node_id": "node_styledname000001", "source_refs": [], "value": "张三"}
    payload["sections"] = [{
        "node_id": "node_stylesection0001", "source_refs": [], "semantic_kind": "work",
        "title": {"node_id": "node_styletitle000001", "source_refs": [], "value": "工作经历"},
        "entries": [], "blocks": [],
    }]
    section = payload["sections"][0]
    section["title"]["runs"] = [styled_run(section["title"]["value"])]
    name = payload["identity"]["name"]
    name["runs"] = [styled_run(name["value"], 24)]
    data = CanonicalResumeDocument.model_validate(payload)
    resume = SimpleNamespace(id=1, lock_version=1)
    target = ResumeTargetLocator.model_validate(resolve(resume, data, node_id=section["node_id"])["target"])
    operation = ProposalOperation(op="replace_target_text", target=target, new_text="新的章节标题", expected_text_hash=target.expected_text_hash)
    result = CanonicalResumeDocument.model_validate(apply_operations(data, resume=resume, mode="polish_local", main_target=target, operations=[operation]))
    assert result.sections[0].title.value == "新的章节标题"
    assert result.sections[0].title.runs[0].style == data.sections[0].title.runs[0].style
    assert result.identity.name.runs == data.identity.name.runs

@pytest.mark.parametrize("align", [None, "left", "center", "right"])
def test_list_item_alignment_matches_static_schema_and_round_trips(align):
    from drawoffer.domain.resume.models import ListItem

    payload = {"node_id": "node_aaaaaaaaaaaaaaaa", "source_refs": [], "runs": [styled_run()]}
    expected = dict(payload)
    if align is not None:
        expected["align"] = align
    payload["align"] = align
    assert ListItem.model_validate(payload).model_dump(mode="json") == expected
    root = Path(__file__).resolve().parents[6]
    schema = json.loads((root / "contracts/resume/canonical-resume.schema.json").read_text())
    validator = Draft202012Validator({"$ref": "#/$defs/listItem", "$defs": schema["$defs"]})
    validator.validate(payload)
    validator.validate(expected)
    invalid = {**payload, "align": "justify"}
    assert list(validator.iter_errors(invalid))
    with pytest.raises(ValidationError):
        ListItem.model_validate(invalid)
