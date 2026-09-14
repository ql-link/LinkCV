from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator
import pytest
from pydantic import ValidationError

from linkresume.domain.resume.models import Contact, TextValue


def styled_run(text="张", size=18):
    return {
        "inline_type": "text", "text": text, "marks": [], "href": None,
        "style": {"color": None, "font_size_pt": size, "highlight_color": None},
    }


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


def test_agent_replacement_clears_only_replaced_field_runs():
    from linkresume.domain.resume.models import CanonicalResumeDocument
    from linkresume.modules.agent.resume_tools import editor_markdown, replace_editor_markdown
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
    markdown = editor_markdown(data)
    edited = markdown.replace(section["title"]["value"], "新的章节标题", 1)
    result = CanonicalResumeDocument.model_validate(replace_editor_markdown(data, edited))
    assert result.sections[0].title.value == "新的章节标题"
    assert result.sections[0].title.runs is None
    assert result.identity.name.runs == data.identity.name.runs
