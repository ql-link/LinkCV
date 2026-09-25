"""Version 3 Agent edits applied directly to the canonical resume tree."""

from copy import deepcopy
from typing import Any
from uuid import uuid4

from linkresume.core.errors import ApiError
from linkresume.domain.resume import CanonicalResumeDocument
from linkresume.modules.agent.resume_tools import BLOCK_MARKER_PATTERN, text_hash


def _text_run(text: str, template: dict[str, Any] | None = None) -> dict[str, Any]:
    run = deepcopy(template) if template is not None else {
        "inline_type": "text", "marks": [], "href": None,
        "style": {"color": None, "font_size_pt": None, "highlight_color": None},
    }
    run["text"] = text
    return run


def _find_target(data: dict[str, Any], target: Any) -> tuple[str, dict[str, Any], Any]:
    """Return (kind, object, container), checking the locator's parent scope."""
    if target.surface != "editor" or not target.block_id:
        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
    for section in data["sections"]:
        if target.section != section["node_id"]:
            continue
        if target.block_id == section["node_id"] and target.entry_id is None:
            return "section", section, None
        containers = [(section["blocks"], None)]
        for entry in section["entries"]:
            if target.entry_id != entry["node_id"]:
                continue
            if target.block_id == entry["node_id"]:
                return "entry", entry, section
            for field_name, value in entry["fields"].items():
                if value is not None and target.block_id == value["node_id"]:
                    if target.field != field_name:
                        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
                    return "field", value, (entry["fields"], field_name)
            containers.append((entry["blocks"], entry["node_id"]))
        for blocks, entry_id in containers:
            if target.entry_id != entry_id:
                continue
            for block in blocks:
                if block["node_id"] == target.block_id:
                    return "block", block, blocks
                if block["block_type"] in {"ordered_list", "bullet_list"}:
                    for item in block["items"]:
                        if item["node_id"] == target.block_id:
                            return "list_item", item, block
                elif block["block_type"] == "row":
                    for cell in block["cells"]:
                        for paragraph in cell["blocks"]:
                            if paragraph["node_id"] == target.block_id:
                                return "row_paragraph", paragraph, cell
    raise ApiError(409, "TARGET_STALE")


def allowed_canonical_operations(data: CanonicalResumeDocument, target: Any) -> list[str]:
    if target.surface != "editor":
        return []
    kind, node, parent = _find_target(data.model_dump(mode="json"), target)
    if kind == "field":
        return (["clear_field"] if target.selected_text in {None, node["value"]} else []) + ["replace_text_range"]
    if kind == "entry":
        return ["insert_bullet"]
    if kind in {"block", "list_item", "row_paragraph"}:
        allowed = []
        if kind != "block" or node["block_type"] == "paragraph":
            if all(item["inline_type"] == "text" for item in node["runs"]):
                allowed.append("replace_text_range")
            if kind in {"block", "list_item"} and target.selected_text in {
                None, "".join(item["text"] for item in node["runs"] if item["inline_type"] == "text"),
            }:
                allowed.append("delete_node")
        if kind == "list_item" and parent["block_type"] == "bullet_list":
            allowed.append("insert_bullet")
        return allowed
    return []


def _replace_text(value: dict[str, Any], expected: str, replacement: str) -> None:
    if not expected:
        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
    is_field = "value" in value
    runs = value.get("runs")
    if is_field and runs is None:
        content = value["value"]
        if content.count(expected) != 1:
            raise ApiError(409, "TARGET_STALE")
        value["value"] = content.replace(expected, replacement, 1)
        return
    if runs is None or any(run["inline_type"] != "text" for run in runs):
        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
    content = "".join(run["text"] for run in runs)
    if content.count(expected) != 1:
        raise ApiError(409, "TARGET_STALE")
    start = content.index(expected)
    end = start + len(expected)
    cursor = 0
    replacement_run = None
    replacement_index = None
    for index, run in enumerate(runs):
        next_cursor = cursor + len(run["text"])
        if start >= cursor and end <= next_cursor:
            replacement_run = run
            replacement_index = index
            break
        cursor = next_cursor
    if replacement_run is None:
        # A range crossing differently styled runs has no unambiguous style.
        raise ApiError(422, "PATCH_OUT_OF_SCOPE")
    offset = start - cursor
    prefix = replacement_run["text"][:offset]
    suffix = replacement_run["text"][offset + len(expected):]
    changed = [
        *([_text_run(prefix, replacement_run)] if prefix else []),
        *([_text_run(replacement, replacement_run)] if replacement else []),
        *([_text_run(suffix, replacement_run)] if suffix else []),
    ]
    runs[replacement_index:replacement_index + 1] = changed
    if is_field:
        value["value"] = content[:start] + replacement + content[end:]


def apply_canonical_operations(
    data: CanonicalResumeDocument, operations: list[Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = data.model_dump(mode="json")
    changes = []
    for operation in operations:
        if operation.operation_version != 3:
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        target = operation.target
        if operation.expected_text_hash != target.expected_text_hash:
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        if operation.op not in allowed_canonical_operations(
            CanonicalResumeDocument.model_validate(payload), target
        ):
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        kind, node, parent = _find_target(payload, target)
        op = operation.op
        if BLOCK_MARKER_PATTERN.search(operation.new_text):
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        if op == "clear_field":
            if kind != "field" or target.selected_text not in {None, node["value"]}:
                raise ApiError(422, "PATCH_OUT_OF_SCOPE")
            before = node["value"]
            fields, field_name = parent
            fields[field_name] = None
            after = ""
        elif op == "replace_text_range":
            if kind not in {"field", "block", "list_item", "row_paragraph"}:
                raise ApiError(422, "PATCH_OUT_OF_SCOPE")
            if kind == "block" and node["block_type"] != "paragraph":
                raise ApiError(422, "PATCH_OUT_OF_SCOPE")
            content = node["value"] if kind == "field" else "".join(
                run["text"] for run in node["runs"] if run["inline_type"] == "text"
            )
            expected = target.selected_text or content
            if target.selected_text and text_hash(expected) != operation.expected_text_hash:
                raise ApiError(409, "TARGET_STALE")
            before = expected
            _replace_text(node, expected, operation.new_text)
            after = operation.new_text
        elif op == "delete_node":
            if kind == "block" and node["block_type"] == "paragraph":
                before = "".join(run["text"] for run in node["runs"] if run["inline_type"] == "text")
                if target.selected_text not in {None, before} or text_hash(before) != operation.expected_text_hash:
                    raise ApiError(409, "TARGET_STALE")
                parent.remove(node)
            elif kind == "list_item":
                before = "".join(run["text"] for run in node["runs"] if run["inline_type"] == "text")
                if target.selected_text not in {None, before} or text_hash(before) != operation.expected_text_hash:
                    raise ApiError(409, "TARGET_STALE")
                parent["items"].remove(node)
                if not parent["items"]:
                    for section in payload["sections"]:
                        for blocks in [section["blocks"], *(entry["blocks"] for entry in section["entries"])]:
                            if parent in blocks:
                                blocks.remove(parent)
                                break
            else:
                raise ApiError(422, "PATCH_OUT_OF_SCOPE")
            after = ""
        elif op == "insert_bullet":
            if kind == "entry":
                before = next((value["value"] for value in node["fields"].values() if value), "经历")
                if target.selected_text not in {None, before}:
                    raise ApiError(422, "PATCH_OUT_OF_SCOPE")
                bullet_lists = [block for block in node["blocks"] if block["block_type"] == "bullet_list"]
                if bullet_lists:
                    bullet_list = bullet_lists[-1]
                else:
                    bullet_list = {
                        "node_id": f"node_{uuid4().hex}", "block_type": "bullet_list", "start": None,
                        "items": [],
                    }
                    node["blocks"].append(bullet_list)
                insert_at = len(bullet_list["items"])
            elif kind == "list_item" and parent["block_type"] == "bullet_list":
                before = "".join(run["text"] for run in node["runs"] if run["inline_type"] == "text")
                if text_hash(before) != operation.expected_text_hash:
                    raise ApiError(409, "TARGET_STALE")
                bullet_list = parent
                insert_at = bullet_list["items"].index(node) + 1
            else:
                raise ApiError(422, "PATCH_OUT_OF_SCOPE")
            bullet_list["items"].insert(insert_at, {
                "node_id": f"node_{uuid4().hex}", "source_refs": [],
                "runs": [_text_run(operation.new_text.strip())],
            })
            after = operation.new_text.strip()
        else:
            raise ApiError(422, "PATCH_OUT_OF_SCOPE")
        changes.append({
            "target": target.model_dump(mode="json"), "op": op,
            "before": before, "after": after,
        })
    CanonicalResumeDocument.model_validate(payload)
    return payload, changes
