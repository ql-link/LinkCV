from __future__ import annotations

import json
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from linkresume.core.database import utc_now
from linkresume.modules.interviews.models import InterviewSession
from linkresume.modules.llm.models import LLMUseCaseRoute, LLMModelRoute, LLMProviderConnection
from linkresume.modules.llm.resolver import MOCK_INTERVIEW, validation_fingerprint
from tests.integration.api.test_interview_prep import PrepGateway, build_app, create_session
from tests.integration.api.test_interviews import register

TEXT = '问：请介绍项目。答：我负责虚构项目的缓存改造，先测量再优化。'


def analysis(score=8):
    rating = {'score': score, 'reason': '记录有清楚的行动说明。', 'evidence': TEXT if score is not None else None}
    return {'summary': '先测量再优化，缺少量化结果。', 'project_expression': rating, 'system_design': rating,
            'communication': rating, 'questions': [{'question': '请介绍项目。', 'answer': '先测量再优化。',
            'evidence': TEXT, 'strength': '说明了行动顺序', 'improvement': '补充测量结果',
            'suggested_answer': '补充实际测量数据，不要编造指标。'}]}


def setup_app(tmp_path, *, configure=True):
    gateway = PrepGateway()
    app = build_app(f'sqlite+pysqlite:///{tmp_path / "review.db"}', gateway, configure=configure)
    if configure:
        with app.state.session_factory() as db:
            binding = db.scalar(select(LLMUseCaseRoute))
            binding.use_case = MOCK_INTERVIEW
            route = db.get(LLMModelRoute, binding.route_id)
            binding.validated_fingerprint = validation_fingerprint(binding, route, db.get(LLMProviderConnection, route.connection_id))
            db.commit()
    return app, gateway


def completed(client):
    session = create_session(client)
    response = client.post(f'/api/interview-sessions/{session["id"]}/complete', json={
        'base_lock_version': session['lock_version'], 'questions_markdown': TEXT, 'review_summary': '手写总结保留'})
    assert response.status_code == 200, response.text
    return response.json()['session']


def generate(client, session, request_id=None):
    return client.post(f'/api/interview-sessions/{session["id"]}/review:generate', json={
        'base_lock_version': session['lock_version'], 'request_id': request_id or str(uuid4())})


def test_review_persists_evidence_and_idempotent_request(tmp_path):
    app, gateway = setup_app(tmp_path)
    gateway.replies.append(json.dumps(analysis(), ensure_ascii=False))
    with TestClient(app) as client:
        register(client, 'review-owner@example.com')
        session = completed(client)
        request_id = str(uuid4())
        response = generate(client, session, request_id)
        assert response.status_code == 200, response.text
        result = response.json()['session']
        assert result['review_status'] == 'ready'
        assert result['review_request_id'] == request_id
        assert result['review_report']['overall_score'] == 8
        assert result['review_report']['questions'][0]['evidence'] == TEXT
        assert not result['review_stale']
        assert result['questions_markdown'] == TEXT and result['review_summary'] == '手写总结保留'
        assert generate(client, session, request_id).status_code == 200
        assert gateway.calls == 1
        listed = client.get('/api/interview-sessions').json()['items'][0]
        assert listed['review_report'] == result['review_report']
        changed = client.put(f'/api/interview-sessions/{session["id"]}', json={
            'base_lock_version': result['lock_version'], 'questions_markdown': TEXT + '补充记录。'})
        assert changed.status_code == 200
        assert changed.json()['session']['review_stale']
        assert generate(client, session, request_id).status_code == 409
        assert gateway.calls == 1


def test_insufficient_evidence_has_no_fabricated_overall_score(tmp_path):
    app, gateway = setup_app(tmp_path)
    reply = analysis()
    reply['system_design'] = analysis(None)['system_design']
    gateway.replies.append(json.dumps(reply, ensure_ascii=False))
    with TestClient(app) as client:
        register(client, 'review-null@example.com')
        response = generate(client, completed(client))
        assert response.status_code == 200, response.text
        assert response.json()['session']['review_report']['overall_score'] is None


@pytest.mark.parametrize('quote', ['编造的原句', '   '])
def test_invalid_evidence_retains_previous_report_and_manual_record(tmp_path, quote):
    app, gateway = setup_app(tmp_path)
    gateway.replies.append(json.dumps(analysis(), ensure_ascii=False))
    with TestClient(app) as client:
        register(client, 'review-failed@example.com')
        session = generate(client, completed(client)).json()['session']
        reply = analysis()
        reply['questions'][0]['evidence'] = quote
        gateway.replies.append(json.dumps(reply, ensure_ascii=False))
        request_id = str(uuid4())
        response = generate(client, session, request_id)
        assert response.status_code == 502, response.text
        result = client.get(f'/api/interview-sessions/{session["id"]}').json()['session']
        assert result['review_status'] == 'failed' and result['review_error'] == 'LLM_RESPONSE_INVALID'
        assert result['review_report'] == session['review_report']
        assert result['questions_markdown'] == TEXT
        assert generate(client, session, request_id).status_code == 502
        assert gateway.calls == 2


def test_missing_model_fails_without_losing_text(tmp_path):
    app, gateway = setup_app(tmp_path, configure=False)
    with TestClient(app) as client:
        register(client, 'review-unconfigured@example.com')
        session = completed(client)
        assert generate(client, session).status_code == 503
        result = client.get(f'/api/interview-sessions/{session["id"]}').json()['session']
        assert result['review_status'] == 'failed' and result['review_report'] is None
        assert result['questions_markdown'] == TEXT
        assert gateway.calls == 0


def test_review_owner_state_and_lock_are_checked_before_model(tmp_path):
    app, gateway = setup_app(tmp_path)
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, 'review-a@example.com')
        register(other, 'review-b@example.com')
        scheduled = create_session(owner)
        assert generate(owner, scheduled).status_code == 409
        session = completed(owner)
        assert generate(other, session).status_code == 404
        assert generate(owner, {**session, 'lock_version': session['lock_version'] - 1}).status_code == 409
        changed = owner.put(f'/api/interview-sessions/{session["id"]}', json={
            'base_lock_version': session['lock_version'], 'questions_markdown': None})
        assert generate(owner, changed.json()['session']).status_code == 400
        assert gateway.calls == 0


def test_active_request_and_interrupted_retry_do_not_call_model_twice(tmp_path):
    app, gateway = setup_app(tmp_path)
    with TestClient(app) as client:
        register(client, 'review-interrupted@example.com')
        session = completed(client)
        request_id = str(uuid4())
        import hashlib
        with app.state.session_factory() as db:
            row = db.get(InterviewSession, int(session['id']))
            row.review_request_id = request_id
            row.review_status = 'generating'
            row.review_started_at = utc_now()
            row.review_report = {'request_source_hash': hashlib.sha256(TEXT.encode()).hexdigest()}
            db.commit()
        assert generate(client, session).status_code == 409
        assert generate(client, session, request_id).json()['session']['review_status'] == 'generating'
        with app.state.session_factory() as db:
            db.get(InterviewSession, int(session['id'])).review_started_at = utc_now() - timedelta(minutes=4)
            db.commit()
        assert generate(client, session, request_id).status_code == 502
        session = client.get(f'/api/interview-sessions/{session["id"]}').json()["session"]
        gateway.replies.append(json.dumps(analysis(), ensure_ascii=False))
        assert generate(client, session).status_code == 200
        assert gateway.calls == 1


def test_record_changed_during_generation_cannot_be_overwritten(tmp_path):
    app, gateway = setup_app(tmp_path)
    with TestClient(app) as client:
        register(client, 'review-race@example.com')
        session = completed(client)
        original_complete = gateway.complete
        async def complete_with_edit(**kwargs):
            with app.state.session_factory() as db:
                row = db.get(InterviewSession, int(session['id']))
                row.questions_markdown = TEXT + '生成过程中新增记录。'
                row.lock_version += 1
                db.commit()
            return await original_complete(**kwargs)
        gateway.complete = complete_with_edit
        gateway.replies.append(json.dumps(analysis(), ensure_ascii=False))
        response = generate(client, session)
        assert response.status_code == 200, response.text
        result = response.json()['session']
        assert result['review_status'] == 'failed' and result['review_error'] == 'INTERVIEW_REVIEW_SOURCE_CHANGED'
        assert result['review_report'] is None
        assert result['questions_markdown'] == TEXT + '生成过程中新增记录。'


@pytest.mark.parametrize('field', ['question', 'answer'])
def test_fabricated_original_question_or_answer_is_rejected(tmp_path, field):
    app, gateway = setup_app(tmp_path)
    reply = analysis()
    reply['questions'][0][field] = '原始记录中没有的内容'
    gateway.replies.append(json.dumps(reply, ensure_ascii=False))
    with TestClient(app) as client:
        register(client, 'review-evidence@example.com')
        assert generate(client, completed(client)).status_code == 502
