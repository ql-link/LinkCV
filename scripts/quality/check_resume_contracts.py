#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path
import sys
import unicodedata

from jsonschema import Draft202012Validator
from referencing import Registry, Resource


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "backend" / "src"))

from linkcv.domain.resume.canonical_json import canonical_json_bytes, canonical_sha256

CONTRACTS = ROOT / "contracts" / "resume"
MANIFEST = CONTRACTS / "fixtures" / "manifest.json"
HASH_FIXTURES = CONTRACTS / "fixtures" / "canonical-hash.json"
SCHEMAS = (
    "canonical-resume.schema.json",
    "source-graph.schema.json",
    "sparse-resume-annotations.schema.json",
    "template-definition.schema.json",
    "resume-presentation.schema.json",
    "layout-plan.schema.json",
)
SEMANTIC_KINDS = {
    "identity", "profile", "work", "education", "project", "skills",
    "activity", "interests", "certificates", "awards", "languages", "custom",
}


def _load(path: Path) -> object:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def _assert_nfc(value: object, path: str = "$") -> None:
    if isinstance(value, str):
        if value != unicodedata.normalize("NFC", value):
            raise ValueError(f"non-NFC string at {path}")
        if any(unicodedata.category(char) == "Cc" and char not in "\n\t" for char in value):
            raise ValueError(f"control character at {path}")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"non-finite number at {path}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_nfc(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            _assert_nfc(key, f"{path}.<key>")
            _assert_nfc(item, f"{path}.{key}")


def _assert_closed_objects(schema: object, path: str = "$") -> None:
    if isinstance(schema, dict):
        if schema.get("type") == "object" and schema.get("additionalProperties") is not False:
            raise ValueError(f"open object schema at {path}")
        for key, value in schema.items():
            _assert_closed_objects(value, f"{path}.{key}")
    elif isinstance(schema, list):
        for index, value in enumerate(schema):
            _assert_closed_objects(value, f"{path}[{index}]")


def _semantic_checks(name: str, instance: dict[str, object]) -> None:
    if name == "canonical-resume.schema.json":
        node_ids: list[str] = [instance["document_id"]]

        def collect(value: object) -> None:
            if isinstance(value, dict):
                node_id = value.get("node_id")
                if isinstance(node_id, str):
                    node_ids.append(node_id)
                for child in value.values():
                    collect(child)
            elif isinstance(value, list):
                for child in value:
                    collect(child)

        collect(instance)
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("canonical node ids must be unique")
        disposition_ids = [item["source_id"] for item in instance["source_dispositions"]]
        if len(disposition_ids) != len(set(disposition_ids)):
            raise ValueError("canonical source dispositions must be unique")
        for disposition in instance["source_dispositions"]:
            outcome = disposition["outcome"]
            targets = disposition["target_node_ids"]
            reason = disposition["reason_code"]
            if outcome == "mapped" and (not targets or reason is not None):
                raise ValueError("mapped disposition is invalid")
            if outcome == "transformed" and (not targets or reason is None):
                raise ValueError("transformed disposition is invalid")
            if outcome == "dropped" and (targets or reason is None):
                raise ValueError("dropped disposition is invalid")
            if any(target not in node_ids for target in targets):
                raise ValueError("source disposition target does not exist")
        def check_blocks(blocks: object) -> None:
            if not isinstance(blocks, list):
                return
            for block in blocks:
                if not isinstance(block, dict) or block.get("block_type") != "row":
                    continue
                kind = block.get("row_kind")
                cells = block.get("cells")
                expected = {"pair": 2, "meta": 4, "trio": 3}.get(kind)
                if expected is None or not isinstance(cells, list) or len(cells) != expected:
                    raise ValueError("canonical row has the wrong cell cardinality")
                width = block.get("left_width_percent")
                if kind == "pair" and not isinstance(width, (int, float)):
                    raise ValueError("pair row requires a width")
                if kind != "pair" and width is not None:
                    raise ValueError("fixed row cannot declare a width")
                for cell in cells:
                    if not isinstance(cell, dict):
                        raise ValueError("row cell must be an object")
                    check_blocks(cell.get("blocks"))
        for section in instance["sections"]:
            check_blocks(section["blocks"])
            for entry in section["entries"]:
                check_blocks(entry["blocks"])
    elif name == "source-graph.schema.json":
        leaves = instance["leaves"]
        ids = [leaf["source_id"] for leaf in leaves]
        ordinals = [leaf["ordinal"] for leaf in leaves]
        if len(ids) != len(set(ids)) or ordinals != list(range(len(ordinals))):
            raise ValueError("SourceGraph ids must be unique and ordinals contiguous")
        for leaf in leaves:
            if leaf["leaf_kind"] == "list_item" and leaf["list_kind"] is None:
                raise ValueError("list_item leaves require list_kind")
            if leaf["leaf_kind"] != "list_item" and leaf["list_kind"] is not None:
                raise ValueError("only list_item leaves may have list_kind")
            if leaf["list_kind"] == "ordered" and leaf["list_ordinal"] is None:
                raise ValueError("ordered list leaves require list_ordinal")
            if leaf["list_kind"] != "ordered" and leaf["list_ordinal"] is not None:
                raise ValueError("only ordered list leaves may have list_ordinal")
            bbox = leaf["bbox"]
            if bbox is not None and (
                bbox["x"] + bbox["width"] > 1 or bbox["y"] + bbox["height"] > 1
            ):
                raise ValueError("normalized bbox must stay inside page")
    elif name == "sparse-resume-annotations.schema.json":
        keys: list[tuple[object, object, object]] = []
        for annotation in instance["annotations"]:
            if annotation["role"] == "entry_field" and (
                annotation["field_key"] is None
                or annotation["entry_anchor_source_id"] is None
            ):
                raise ValueError("entry_field requires field key and entry anchor")
            if annotation["role"] == "contact" and annotation["field_key"] is None:
                raise ValueError("contact requires field key")
            if annotation["role"] not in {"entry_field", "contact"} and annotation["field_key"] is not None:
                raise ValueError("only field annotations may declare field_key")
            keys.append((annotation["source_id"], annotation["role"], annotation["field_key"]))
        if len(keys) != len(set(keys)):
            raise ValueError("sparse annotation composite keys must be unique")
    elif name == "template-definition.schema.json":
        slots = instance["slots"]
        fallbacks = [slot for slot in slots if slot["universal_fallback"]]
        if len(fallbacks) != 1 or set(fallbacks[0]["accepts"]) != SEMANTIC_KINDS:
            raise ValueError("template requires one universal fallback covering all kinds")
        region_ids = {region["region_id"] for region in instance["regions"]}
        if len(region_ids) != len(instance["regions"]):
            raise ValueError("template region ids must be unique")
        slot_ids = [slot["slot_id"] for slot in slots]
        if len(slot_ids) != len(set(slot_ids)) or any(slot["region_id"] not in region_ids for slot in slots):
            raise ValueError("template slots must be unique and reference regions")
        explicit_kinds = [
            kind for slot in slots if not slot["universal_fallback"] for kind in slot["accepts"]
        ]
        if len(explicit_kinds) != len(set(explicit_kinds)):
            raise ValueError("a semantic kind may target only one explicit slot")
        avatar = instance.get("avatar")
        if not isinstance(avatar, dict) or avatar.get("region_id") not in region_ids:
            raise ValueError("template avatar must reference a declared region")
        if avatar.get("visibility") == "hide" and avatar.get("fallback_asset") != "none":
            raise ValueError("hidden avatar cannot declare a fallback")
    elif name == "layout-plan.schema.json":
        region_ids = [region["region_id"] for region in instance["regions"]]
        if len(region_ids) != len(set(region_ids)):
            raise ValueError("LayoutPlan region ids must be unique")
        node_ids = [node["node_id"] for region in instance["regions"] for node in region["nodes"]]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("LayoutPlan node ids must be unique")


def main() -> int:
    schemas = {name: _load(CONTRACTS / name) for name in SCHEMAS}
    registry = Registry().with_resources(
        [(name, Resource.from_contents(schema)) for name, schema in schemas.items()]
    )
    for name, schema in schemas.items():
        Draft202012Validator.check_schema(schema)
        _assert_closed_objects(schema, name)

    fixtures = _load(MANIFEST)
    if set(fixtures) != set(SCHEMAS):
        raise ValueError("fixture manifest must cover exactly all resume schemas")
    checked = 0
    for name, groups in fixtures.items():
        validator = Draft202012Validator(schemas[name], registry=registry)
        for instance in groups["valid"]:
            validator.validate(instance)
            _assert_nfc(instance)
            _semantic_checks(name, instance)
            if canonical_sha256(instance) != canonical_sha256(json.loads(canonical_json_bytes(instance))):
                raise ValueError(f"unstable canonical JSON for {name}")
            checked += 1
        for instance in groups["invalid"]:
            schema_failed = bool(list(validator.iter_errors(instance)))
            semantic_failed = False
            if not schema_failed:
                try:
                    _semantic_checks(name, instance)
                except ValueError:
                    semantic_failed = True
            if not schema_failed and not semantic_failed:
                raise ValueError(f"invalid fixture unexpectedly passed for {name}")
            checked += 1
    hash_fixtures = _load(HASH_FIXTURES)
    for case in hash_fixtures["valid"]:
        encoded = canonical_json_bytes(case["value"])
        if encoded.decode("utf-8") != case["canonical_utf8"]:
            raise ValueError("canonical UTF-8 fixture mismatch")
        if canonical_sha256(case["value"]) != case["sha256"]:
            raise ValueError("canonical SHA-256 fixture mismatch")
        checked += 1
    for case in hash_fixtures["invalid"]:
        try:
            canonical_json_bytes(case["value"])
        except ValueError:
            checked += 1
        else:
            raise ValueError(f"invalid canonical fixture passed: {case['reason']}")
    print(f"resume contracts: {len(schemas)} schemas, {checked} fixtures passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"resume contract check failed: {error}", file=sys.stderr)
        raise SystemExit(1)
