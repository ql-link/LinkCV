"""Canonical nodes are the sole authority for Agent read and edit scopes."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
from typing import Any
from uuid import uuid4

from drawoffer.core.errors import ApiError
from drawoffer.domain.resume import CanonicalResumeDocument

MAX_RANGE_NODES = 100
MAX_READ_CHARS = 60_000
FIELD_KEYS = ('name', 'organization', 'role', 'location', 'start_date', 'end_date', 'url', 'degree', 'major')


def digest(text: str) -> str:
    return 'sha256:' + hashlib.sha256(text.encode()).hexdigest()


def inline_text(runs: list[dict]) -> str:
    return ''.join(r.get('text', '') if r['inline_type'] == 'text' else
                   f":icon[{r['name']}]" if r['inline_type'] == 'icon' else r.get('alt') or '' for r in runs)


def at(payload: Any, path: tuple) -> Any:
    for key in path:
        payload = payload[key]
    return payload


@dataclass(frozen=True)
class Node:
    id: str
    kind: str
    text: str
    section: str | None
    entry: str | None
    field: str
    path: tuple
    container: tuple | None
    order: int
    editable: bool = True


def nodes(data: CanonicalResumeDocument) -> list[Node]:
    payload = data.model_dump(mode='json')
    result: list[Node] = []

    def add(obj, path, kind, section=None, entry=None, field='markdown', container=None,
            alias=None, text=None, editable=True):
        value = text if text is not None else obj.get('value', inline_text(obj.get('runs', [])))
        result.append(Node(alias or obj['node_id'], kind, value, section, entry, field,
                           path, container, len(result), editable))

    def blocks(items, path, section, entry):
        for i, block in enumerate(items):
            p = (*path, i)
            kind = block['block_type']
            if kind in ('ordered_list', 'bullet_list'):
                for j, item in enumerate(block['items']):
                    add(item, (*p, 'items', j), 'list_item', section, entry, container=(*p, 'items'))
            elif kind == 'row':
                for j, cell in enumerate(block['cells']):
                    for k, paragraph in enumerate(cell['blocks']):
                        add(paragraph, (*p, 'cells', j, 'blocks', k), 'row_paragraph', section, entry,
                            container=(*p, 'cells', j, 'blocks'))
            elif kind == 'media':
                add(block, p, 'media', section, entry, container=path,
                    text=block.get('alt') or '', editable=False)
            else:
                add(block, p, 'paragraph', section, entry, container=path)

    identity = payload['identity']
    if identity.get('name'):
        add(identity['name'], ('identity', 'name'), 'identity', field='name', alias=identity['node_id'])
        add(identity['name'], ('identity', 'name'), 'field', field='name')
    if identity.get('headline'):
        add(identity['headline'], ('identity', 'headline'), 'field', field='headline')
    for i, contact in enumerate(identity['contacts']):
        add(contact, ('identity', 'contacts', i), 'contact', field='value')
    for i, section in enumerate(payload['sections']):
        sid = section['node_id']; sp = ('sections', i)
        title = section.get('title')
        add(title or section, (*sp, 'title'), 'section', sid, field='title', alias=sid,
            text=title['value'] if title else section['semantic_kind'], editable=bool(title))
        if title:
            add(title, (*sp, 'title'), 'field', sid, field='title')
        for j, entry in enumerate(section['entries']):
            eid = entry['node_id']; ep = (*sp, 'entries', j)
            primary = next((key for key in ('name', 'organization', 'role', 'degree') if entry['fields'].get(key)), None)
            if primary:
                add(entry['fields'][primary], (*ep, 'fields', primary), 'entry', sid, eid,
                    field=primary, alias=eid)
            else:
                add(entry, ep, 'entry', sid, eid, text='经历', editable=False)
            for key in FIELD_KEYS:
                field = entry['fields'].get(key)
                if field:
                    add(field, (*ep, 'fields', key), 'field', sid, eid, field=key)
            blocks(entry['blocks'], (*ep, 'blocks'), sid, eid)
        blocks(section['blocks'], (*sp, 'blocks'), sid, None)
    return result


def leaf_nodes(index: list[Node]) -> list[Node]:
    # Anchor aliases are directory entries, not extra copies of their fields.
    return [n for n in index if n.kind not in ('identity', 'section', 'entry')]


def locator(resume, node: Node, selected: str | None = None) -> dict:
    scopes = ['target', 'resume']
    if node.section:
        scopes.append('section')
    if node.entry:
        scopes.append('entry')
    return dict(resume_id=str(resume.id), base_lock_version=resume.lock_version,
                surface='canonical', format='canonical-target.v1', target_kind=node.kind,
                section=node.section, entry_id=node.entry, field=node.field, item_id=None,
                block_id=node.id, node_ids=[], selected_text=selected,
                expected_text_hash=digest(selected or node.text), allowed_scopes=scopes)


def range_digest(selected: list[Node]) -> str:
    return digest(json.dumps([(n.id, n.section, n.entry, n.text) for n in selected], ensure_ascii=False))


def select_range(index: list[Node], start: str, end: str) -> list[Node]:
    leaves = [n for n in leaf_nodes(index) if n.field != 'title']
    positions = {n.id: i for i, n in enumerate(leaves)}
    if start not in positions or end not in positions or positions[start] > positions[end]:
        raise ApiError(422, 'TARGET_INVALID')
    selected = leaves[positions[start]:positions[end] + 1]
    if len(selected) > MAX_RANGE_NODES or not selected[0].section or any(
        (n.section, n.entry) != (selected[0].section, selected[0].entry) for n in selected
    ):
        raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
    return selected


def resolve(resume, data, *, selection_context=None, quoted_text=None, scope_hint='target',
            node_id=None, start_node_id=None, end_node_id=None) -> dict:
    index = nodes(data)
    if start_node_id or end_node_id:
        if not start_node_id or not end_node_id or (node_id and node_id != start_node_id) or selection_context:
            raise ApiError(422, 'TARGET_INVALID')
        selected = select_range(index, start_node_id, end_node_id)
        if quoted_text and ' '.join(quoted_text.split()) not in ' '.join(' '.join(n.text for n in selected).split()):
            return {'status': 'not_found', 'target': None, 'candidates': []}
        target = locator(resume, selected[0])
        target.update(target_kind='range', node_ids=[n.id for n in selected], selected_text=None,
                      expected_text_hash=range_digest(selected), allowed_scopes=['target', 'range', 'section', 'resume'])
        return {'status': 'resolved', 'target': target, 'candidates': []}
    quote = selection_context.selected_text if selection_context is not None else quoted_text
    if node_id:
        matches = [n for n in index if n.id == node_id and (not quote or quote in n.text)]
    elif selection_context is not None:
        selected_ids = selection_context.block_ids
        selected = [n for n in index if n.id in selected_ids]
        if len(selected) != len(set(selected_ids)):
            return {'status': 'not_found', 'target': None, 'candidates': []}
        matches = [n for n in selected if quote and quote in n.text]
        if not matches and len(selected) > 1:
            entry_ids = {n.entry for n in selected}
            if len(entry_ids) == 1 and None not in entry_ids and quote and all(n.text in quote for n in selected):
                anchor = next(n for n in index if n.kind == 'entry' and n.entry == selected[0].entry)
                return {'status': 'resolved', 'target': locator(resume, anchor), 'candidates': []}
            leaves = leaf_nodes(index)
            ordered = [n for n in leaves if n.id in selected_ids]
            if len(ordered) == len(set(selected_ids)):
                ranged = select_range(index, ordered[0].id, ordered[-1].id)
                if {n.id for n in ranged} == set(selected_ids):
                    return resolve(resume, data, start_node_id=ordered[0].id, end_node_id=ordered[-1].id)
    else:
        matches = [n for n in index if quote and quote in n.text]
        # Fields may have an entry/section anchor alias; prefer that anchor,
        # preserving the existing ability to select the complete parent.
        aliases = {n.path for n in matches if n.kind in ('identity', 'section', 'entry')}
        matches = [n for n in matches if n.kind in ('identity', 'section', 'entry') or n.path not in aliases]
    if len(matches) == 1:
        return {'status': 'resolved', 'target': locator(resume, matches[0], quote), 'candidates': []}
    if len(matches) > 1:
        return {'status': 'ambiguous', 'target': None, 'candidates': [
            {'target': locator(resume, n, quote), 'label': n.text[:100], 'excerpt': n.text[:240]} for n in matches[:10]]}
    if not quote and not node_id and selection_context is None and scope_hint == 'resume':
        return {'status': 'resolved', 'target': dict(resume_id=str(resume.id), base_lock_version=resume.lock_version,
                surface='canonical', format='canonical-target.v1', target_kind='resume', section='resume',
                entry_id=None, field='data', item_id=None, block_id=None, selected_text=None, node_ids=[],
                expected_text_hash=digest(json.dumps(data.model_dump(mode='json'), ensure_ascii=False, sort_keys=True)),
                allowed_scopes=['resume']), 'candidates': []}
    return {'status': 'not_found', 'target': None, 'candidates': []}


def validated_nodes(resume, data, target) -> tuple[list[Node], Node | None, list[Node] | None]:
    if str(resume.id) != target.resume_id or resume.lock_version != target.base_lock_version:
        raise ApiError(409, 'TARGET_STALE')
    if target.surface == 'canonical' and target.format != 'canonical-target.v1':
        raise ApiError(422, 'TARGET_INVALID')
    index = nodes(data)
    if target.section == 'resume' and target.block_id is None:
        if target.surface == 'canonical' and (target.target_kind != 'resume' or target.node_ids or target.field != 'data' or target.entry_id is not None or target.selected_text is not None):
            raise ApiError(422, 'TARGET_INVALID')
        text = json.dumps(data.model_dump(mode='json'), ensure_ascii=False, sort_keys=True)
        if target.expected_text_hash != digest(text):
            raise ApiError(409, 'TARGET_STALE')
        return index, None, None
    node = next((n for n in index if n.id == target.block_id), None)
    if node is None:
        raise ApiError(409, 'TARGET_STALE')
    # Old persisted receipts are decoded by their real node identity, not
    # by rebuilding the previous Markdown representation.
    historical_field = 'markdown' if node.kind in ('entry', 'section', 'identity') else node.field
    expected_fields = {node.field} if target.surface == 'canonical' else {node.field, historical_field}
    if target.section != node.section or target.entry_id != node.entry or target.field not in expected_fields:
        raise ApiError(422, 'TARGET_INVALID')
    if target.surface == 'canonical' and target.format != 'canonical-target.v1':
        raise ApiError(422, 'TARGET_INVALID')
    if target.node_ids:
        if target.surface != 'canonical' or target.target_kind != 'range':
            raise ApiError(422, 'TARGET_INVALID')
        selected = select_range(index, target.node_ids[0], target.node_ids[-1])
        if [n.id for n in selected] != target.node_ids or target.block_id != selected[0].id:
            raise ApiError(422, 'TARGET_INVALID')
        if range_digest(selected) != target.expected_text_hash or target.selected_text is not None:
            raise ApiError(409, 'TARGET_STALE')
        return index, node, selected
    if target.surface == 'canonical' and target.target_kind != node.kind:
        raise ApiError(422, 'TARGET_INVALID')
    expected = target.selected_text or node.text
    if expected not in node.text or digest(expected) != target.expected_text_hash:
        raise ApiError(409, 'TARGET_STALE')
    return index, node, None


def scoped_nodes(resume, data, target, scope: str) -> list[Node]:
    index, node, selected = validated_nodes(resume, data, target)
    if node is None:
        if scope != 'resume':
            raise ApiError(422, 'SCOPE_FORBIDDEN')
        return leaf_nodes(index)
    if scope in ('target', 'range') and selected is not None:
        return selected
    if scope == 'target':
        return [node]
    if scope == 'entry' and node.entry:
        return [n for n in index if n.entry == node.entry and n.kind != 'entry']
    if scope == 'section' and node.section:
        return [n for n in index if n.section == node.section and n.kind not in ('entry', 'section')]
    if scope == 'resume':
        return leaf_nodes(index)
    raise ApiError(422, 'SCOPE_FORBIDDEN')


def content(resume, data, target, scope: str) -> str:
    selected = scoped_nodes(resume, data, target, scope)
    if scope == 'resume':
        return json.dumps(data.model_dump(mode='json'), ensure_ascii=False, sort_keys=True)
    if scope == 'target' and not target.node_ids:
        return target.selected_text or selected[0].text
    return '\n\n'.join(n.text for n in selected)


def scoped_blocks(resume, data, target, scope: str) -> list[dict]:
    selected = scoped_nodes(resume, data, target, scope)
    return [dict(target=locator(resume, n, target.selected_text if scope == 'target' and not target.node_ids else None),
                 node_id=n.id, node_type=n.kind, parent_section_id=n.section, parent_entry_id=n.entry,
                 order=n.order, editable=n.editable, content=n.text) for n in selected]


def replace_runs(runs: list[dict], expected: str, replacement: str, *, text_only: bool = False) -> list[dict]:
    def run_text(run):
        return run.get('text', '') if text_only else inline_text([run])

    text = ''.join(run_text(run) for run in runs)
    if not expected:
        if text:
            raise ApiError(409, 'TARGET_STALE')
        return ([plain_run(replacement)] if replacement else []) + [deepcopy(run) for run in runs if text_only and run['inline_type'] != 'text']
    if text.count(expected) != 1:
        raise ApiError(409, 'TARGET_STALE')
    start = text.index(expected); end = start + len(expected)
    result = []; pos = 0; inserted = False
    for run in runs:
        if text_only and run['inline_type'] != 'text':
            result.append(deepcopy(run))
            continue
        size = len(run_text(run)); next_pos = pos + size
        if next_pos <= start or pos >= end:
            result.append(deepcopy(run))
        else:
            if run['inline_type'] != 'text':
                raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
            prefix = run['text'][:max(0, start - pos)]
            suffix = run['text'][max(0, end - pos):]
            value = prefix + (replacement if not inserted else '') + suffix
            if value:
                copy = deepcopy(run); copy['text'] = value; result.append(copy)
            inserted = True
        pos = next_pos
    return result


def plain_run(text):
    return dict(inline_type='text', text=text, marks=[], href=None,
                style=dict(color=None, font_size_pt=None, highlight_color=None))


def remove_source_targets(payload, removed):
    for disposition in payload['source_dispositions']:
        disposition['target_node_ids'] = [n for n in disposition['target_node_ids'] if n not in removed]
        if not disposition['target_node_ids'] and disposition['outcome'] != 'dropped':
            disposition.update(outcome='dropped', reason_code='agent_deleted_content')


def apply_operations(data, *, resume, mode, main_target, operations) -> dict:
    if mode == 'polish_local' and (len(operations) != 1 or operations[0].op not in ('replace_target_text', 'delete_target')):
        raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
    if mode == 'generate_from_materials' and any(op.op != 'insert_after_target' for op in operations):
        raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
    index, main, ranged = validated_nodes(resume, data, main_target)
    if main is None:
        raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
    if mode == 'rewrite_entry_star':
        if ranged is not None:
            permitted = {n.id for n in ranged}
        elif main.entry:
            permitted = {n.id for n in index if n.entry == main.entry}
        else:
            raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
    elif ranged is not None:
        permitted = {n.id for n in ranged}
    elif main.kind == 'section' and mode == 'polish_local':
        permitted = {n.id for n in index if n.section == main.section}
    elif main.kind == 'entry' and mode == 'polish_local':
        permitted = {n.id for n in index if n.entry == main.entry}
    else:
        permitted = {main.id}
    payload = data.model_dump(mode='json')
    for operation in operations:
        current = CanonicalResumeDocument.model_validate(payload)
        _, node, op_range = validated_nodes(resume, current, operation.target)
        if (node is None or op_range is not None or node.id not in permitted or not node.editable
            or operation.expected_text_hash != operation.target.expected_text_hash
            or '[[linkresume-block:' in operation.new_text
            or (mode != 'generate_from_materials' and '\n' in operation.new_text)):
            raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
        expected = operation.target.selected_text or node.text
        obj = at(payload, node.path)
        delete_whole = (operation.op == 'replace_target_text' and not operation.new_text
                        and expected == node.text and node.kind == 'paragraph')
        if operation.op == 'replace_target_text' and not delete_whole:
            if 'value' in obj:
                if obj['value'].count(expected) != 1 and not (expected == obj['value'] == ''):
                    raise ApiError(409, 'TARGET_STALE')
                obj['value'] = obj['value'].replace(expected, operation.new_text, 1) if expected else operation.new_text
                if obj.get('runs') is not None:
                    obj['runs'] = replace_runs(obj['runs'], expected, operation.new_text, text_only=True)
                has_media = any(run['inline_type'] == 'media' for run in (obj.get('runs') or []) + (obj.get('prefix_runs') or []))
                if not obj['value'] and not has_media and 'fields' in node.path:
                    at(payload, node.path[:-1])[node.path[-1]] = None
                    remove_source_targets(payload, {obj['node_id']})
            else:
                obj['runs'] = replace_runs(obj['runs'], expected, operation.new_text)
        elif operation.op == 'delete_target' or delete_whole:
            if operation.new_text or expected != node.text or node.kind not in ('paragraph', 'list_item'):
                raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
            container = at(payload, node.container)
            removed = {container.pop(node.path[-1])['node_id']}
            if node.kind == 'list_item' and not container:
                list_path = node.container[:-1]
                parent = at(payload, list_path[:-1]); removed.add(parent.pop(list_path[-1])['node_id'])
            remove_source_targets(payload, removed)
        elif operation.op == 'insert_after_target':
            if mode != 'generate_from_materials' or node.kind not in ('paragraph', 'list_item', 'entry', 'section') or not operation.new_text.strip():
                raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
            new = dict(node_id=f'node_{uuid4().hex}', source_refs=[], runs=[plain_run(operation.new_text)])
            if node.kind != 'list_item':
                new['block_type'] = 'paragraph'
            if node.kind in ('section', 'entry'):
                parent_path = node.path[:-1] if node.kind == 'section' else node.path[:-2]
                at(payload, (*parent_path, 'blocks')).insert(0, new)
            else:
                at(payload, node.container).insert(node.path[-1] + 1, new)
        else:
            raise ApiError(422, 'PATCH_OUT_OF_SCOPE')
        if not operation.target.selected_text:
            operation.target.selected_text = expected
    return CanonicalResumeDocument.model_validate(payload).model_dump(mode='json')
