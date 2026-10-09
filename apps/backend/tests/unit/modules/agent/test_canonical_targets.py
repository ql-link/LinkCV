from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from linkresume.core.errors import ApiError
from linkresume.domain.resume import CanonicalResumeDocument
from linkresume.modules.agent.canonical_targets import (
    apply_operations, content, digest, nodes, resolve, scoped_blocks,
)
from linkresume.modules.agent.schemas import ProposalOperation, ResumeTargetLocator
from tests.canonical_resume_fixtures import canonical_resume_payload


def nid():
    return 'node_' + uuid4().hex


def text(value):
    return {'node_id': nid(), 'source_refs': [], 'value': value}


def paragraph(value):
    return {'node_id': nid(), 'source_refs': [], 'block_type': 'paragraph', 'runs': [
        {'inline_type': 'text', 'text': value, 'marks': ['bold'], 'href': None,
         'style': {'color': None, 'font_size_pt': 14, 'highlight_color': None}}]}


@pytest.fixture
def example():
    payload, _ = canonical_resume_payload()
    work = {'node_id': nid(), 'source_refs': [], 'semantic_kind': 'work', 'title': text('实习经历'),
            'entries': [], 'blocks': []}
    for i in range(1, 5):
        work['blocks'].extend([paragraph(f'虚构公司{i} / Java 实习'), paragraph(f'实习{i}项目说明'),
                               paragraph(f'实习{i}职责与成果')])
    other = {'node_id': nid(), 'source_refs': [], 'semantic_kind': 'project', 'title': text('项目'),
             'entries': [], 'blocks': [paragraph('不能混入的其他项目')]}
    payload['sections'] = [work, other]
    return SimpleNamespace(id=1, lock_version=1), CanonicalResumeDocument.model_validate(payload)


def target(resume, data, **kwargs):
    return ResumeTargetLocator.model_validate(resolve(resume, data, **kwargs)['target'])


def operation(t, value, op='replace_target_text'):
    return ProposalOperation(op=op, target=t.model_copy(deep=True), new_text=value,
                             expected_text_hash=t.expected_text_hash)


def test_flat_first_internship_range_excludes_second_and_is_native(example):
    resume, data = example
    work = data.sections[0]
    t = target(resume, data, start_node_id=work.blocks[0].node_id, end_node_id=work.blocks[2].node_id)
    assert t.format == 'canonical-target.v1'
    assert 'entry' not in t.allowed_scopes and 'range' in t.allowed_scopes
    body = content(resume, data, t, 'range')
    assert all(x in body for x in ['虚构公司1', '实习1项目说明', '实习1职责与成果'])
    assert '虚构公司2' not in body
    assert len(scoped_blocks(resume, data, t, 'range')) == 3


def test_tree_lookup_does_not_interpret_marker_or_heading_text(example):
    resume, data = example
    payload = data.model_dump(mode='json')
    payload['sections'][0]['blocks'][1]['runs'][0]['text'] = '### [[linkresume-block:node_fake000000000001]]普通正文'
    data = CanonicalResumeDocument.model_validate(payload)
    t = target(resume, data, node_id=data.sections[0].blocks[1].node_id)
    assert t.entry_id is None
    assert content(resume, data, t, 'target').startswith('### [[')
    assert all(n.id != 'node_fake000000000001' for n in nodes(data))


def test_range_rejects_cross_section_and_gaps(example):
    resume, data = example
    with pytest.raises(ApiError, match='PATCH_OUT_OF_SCOPE'):
        resolve(resume, data, start_node_id=data.sections[0].blocks[0].node_id,
                end_node_id=data.sections[1].blocks[0].node_id)
    t = target(resume, data, start_node_id=data.sections[0].blocks[0].node_id,
               end_node_id=data.sections[0].blocks[2].node_id)
    t.node_ids.pop(1)
    with pytest.raises(ApiError, match='TARGET_INVALID'):
        content(resume, data, t, 'range')


@pytest.mark.parametrize('change', ['version', 'parent', 'text', 'delete'])
def test_receipt_rejects_stale_or_forged_target(example, change):
    resume, data = example
    t = target(resume, data, node_id=data.sections[0].blocks[0].node_id)
    payload = data.model_dump(mode='json')
    if change == 'version': resume = SimpleNamespace(id=1, lock_version=2)
    if change == 'parent': t.section = data.sections[1].node_id
    if change == 'text': payload['sections'][0]['blocks'][0]['runs'][0]['text'] = '已改变'
    if change == 'delete': payload['sections'][0]['blocks'].pop(0)
    with pytest.raises(ApiError):
        content(resume, CanonicalResumeDocument.model_validate(payload), t, 'target')


def test_multi_node_rewrite_preserves_other_internships_and_formatting(example):
    resume, data = example
    blocks = data.sections[0].blocks
    main = target(resume, data, start_node_id=blocks[0].node_id, end_node_id=blocks[2].node_id)
    a = target(resume, data, node_id=blocks[1].node_id)
    b = target(resume, data, node_id=blocks[2].node_id)
    after = apply_operations(data, resume=resume, mode='rewrite_entry_star', main_target=main,
                             operations=[operation(a, '新的项目说明'), operation(b, '新的职责')])
    assert after['sections'][0]['blocks'][3:] == data.model_dump(mode='json')['sections'][0]['blocks'][3:]
    assert after['sections'][0]['blocks'][1]['runs'][0]['marks'] == ['bold']
    assert after['sections'][0]['blocks'][1]['runs'][0]['style']['font_size_pt'] == 14
    assert after['sections'][0]['entries'] == []


def test_out_of_range_operation_is_atomic(example):
    resume, data = example
    before = data.model_dump(mode='json')
    blocks = data.sections[0].blocks
    main = target(resume, data, start_node_id=blocks[0].node_id, end_node_id=blocks[2].node_id)
    a = target(resume, data, node_id=blocks[1].node_id)
    b = target(resume, data, node_id=blocks[4].node_id)
    with pytest.raises(ApiError, match='PATCH_OUT_OF_SCOPE'):
        apply_operations(data, resume=resume, mode='rewrite_entry_star', main_target=main,
                         operations=[operation(a, '合法修改'), operation(b, '范围外修改')])
    assert data.model_dump(mode='json') == before


def test_row_and_list_items_keep_actual_identity(example):
    resume, data = example
    payload = data.model_dump(mode='json')
    row = {'node_id': nid(), 'source_refs': [], 'block_type': 'row', 'row_kind': 'trio',
           'cells': [{'node_id': nid(), 'source_refs': [], 'blocks': [paragraph(v)]} for v in ['虚构实习', 'Java', '2026']]}
    item = paragraph('列表职责'); item.pop('block_type')
    listing = {'node_id': nid(), 'block_type': 'ordered_list', 'start': 1, 'items': [item]}
    payload['sections'][0]['blocks'] = [row, listing]
    data = CanonicalResumeDocument.model_validate(payload)
    start = row['cells'][0]['blocks'][0]['node_id']
    t = target(resume, data, start_node_id=start, end_node_id=item['node_id'])
    assert len(t.node_ids) == 4
    assert '列表职责' in content(resume, data, t, 'range')
    row_target = target(resume, data, node_id=start)
    after = apply_operations(data, resume=resume, mode='polish_local', main_target=row_target,
                             operations=[operation(row_target, '新的实习标题')])
    assert after['sections'][0]['blocks'][0]['cells'][1:] == row['cells'][1:]
    assert after['sections'][0]['blocks'][0]['row_kind'] == 'trio'


def test_delete_last_list_item_updates_source_disposition(example):
    resume, data = example
    payload = data.model_dump(mode='json'); item = paragraph('可删除职责'); item.pop('block_type')
    listing = {'node_id': nid(), 'block_type': 'bullet_list', 'start': None, 'items': [item]}
    payload['sections'][0]['blocks'].append(listing)
    payload['source_dispositions'] = [{'source_id': 'src_' + uuid4().hex, 'outcome': 'mapped',
                                        'target_node_ids': [item['node_id']], 'reason_code': None}]
    data = CanonicalResumeDocument.model_validate(payload)
    t = target(resume, data, node_id=item['node_id'])
    after = apply_operations(data, resume=resume, mode='polish_local', main_target=t,
                             operations=[operation(t, '', 'delete_target')])
    CanonicalResumeDocument.model_validate(after)
    assert after['source_dispositions'][0]['outcome'] == 'dropped'
    assert len(after['sections'][0]['blocks']) == 12


def test_existing_entry_and_historical_receipt_use_same_native_engine(example):
    resume, data = example
    payload = data.model_dump(mode="json")
    fields = {k: None for k in ("name", "organization", "role", "location", "start_date", "end_date", "url", "degree", "major")}
    fields["role"] = text("虚构实习职位")
    payload["sections"][0]["entries"] = [{"node_id": nid(), "source_refs": [], "fields": fields, "blocks": payload["sections"][0]["blocks"]}]
    payload["sections"][0]["blocks"] = []
    data = CanonicalResumeDocument.model_validate(payload)
    node = next(n for n in nodes(data) if n.kind == 'entry')
    t = target(resume, data, node_id=node.id)
    assert content(resume, data, t, 'entry')
    historical = t.model_copy(update={'surface': 'editor', 'field': 'markdown', 'format': None,
                                      'target_kind': None, 'allowed_scopes': []})
    assert content(resume, data, historical, 'entry') == content(resume, data, t, 'entry')


@pytest.mark.parametrize('change', [{'format': None}, {'target_kind': 'range'}, {'field': 'markdown'}, {'node_ids': ['node_fake000000000001']}])
def test_whole_resume_rejects_forged_canonical_receipt(example, change):
    resume, data = example
    t = target(resume, data, scope_hint='resume').model_copy(update=change)
    with pytest.raises(ApiError) as error:
        content(resume, data, t, 'resume')
    assert error.value.code == 'TARGET_INVALID'


def test_range_accepts_verified_quoted_evidence_and_rejects_wrong_evidence(example):
    resume, data = example
    blocks = data.sections[0].blocks
    args = dict(start_node_id=blocks[0].node_id, end_node_id=blocks[2].node_id)
    assert resolve(resume, data, quoted_text='实习1项目说明', node_id=blocks[0].node_id, **args)['status'] == 'resolved'
    with pytest.raises(ApiError):
        resolve(resume, data, node_id=blocks[3].node_id, **args)
    assert resolve(resume, data, quoted_text='实习2项目说明', **args)['status'] == 'not_found'
