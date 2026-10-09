import pytest
from fastapi.testclient import TestClient

from tests.integration.api.test_interviews import build_app, create_job, register


def create_offer(client):
    response = client.post('/api/job-applications', json={
        'job_description_id': create_job(client, '日期示例公司'),
        'current_stage_type': 'offer', 'current_stage_label': 'Offer',
        'stage_state': 'negotiating',
    })
    assert response.status_code == 201, response.text
    return response.json()['application']


def test_offer_dates_persist_preserve_omitted_fields_and_clear_explicit_null():
    with TestClient(build_app()) as client:
        register(client, 'offer-date@example.test')
        application = create_offer(client)
        path = f"/api/job-applications/{application['id']}/offer"
        response = client.post(path, json={
            'base_lock_version': application['lock_version'],
            'received_on': '2026-09-30', 'reply_due_on': '2026-10-03', 'start_on': '2026-11-01',
            'notes': '原生客户端备注保留',
        })
        assert response.status_code == 200, response.text
        saved = response.json()['application']
        assert saved['offer_received_on'] == '2026-09-30'
        assert saved['offer_reply_due_on'] == '2026-10-03'
        assert saved['offer_start_on'] == '2026-11-01'
        summary = client.get('/api/job-applications').json()['items'][0]
        assert summary['offer_reply_due_on'] == '2026-10-03'
        legacy = client.post(path, json={'base_lock_version': saved['lock_version']})
        assert legacy.status_code == 200, legacy.text
        assert legacy.json()['application']['offer_reply_due_on'] == '2026-10-03'
        assert legacy.json()['application']['notes'] == '原生客户端备注保留'
        stale = client.post(path, json={'base_lock_version': saved['lock_version'], 'reply_due_on': None})
        assert stale.status_code == 409
        cleared = client.post(path, json={'base_lock_version': legacy.json()['application']['lock_version'], 'reply_due_on': None})
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()['application']['offer_reply_due_on'] is None
        assert cleared.json()['application']['offer_received_on'] == '2026-09-30'
        assert cleared.json()['application']['offer_start_on'] == '2026-11-01'


@pytest.mark.parametrize('field', ['received_on', 'reply_due_on', 'start_on'])
@pytest.mark.parametrize('value', ['2026-02-30', '2026-10-03T00:00:00Z', '0001-01-01', 1790985600])
def test_offer_dates_reject_non_calendar_or_mysql_unsupported_values(field, value):
    with TestClient(build_app()) as client:
        register(client, 'invalid-offer-date@example.test')
        application = create_offer(client)
        response = client.post(f"/api/job-applications/{application['id']}/offer", json={
            'base_lock_version': application['lock_version'], field: value,
        })
        assert response.status_code == 400
        assert response.json() == {'error': 'INVALID_INTERVIEW_REQUEST'}
        current = client.get(f"/api/job-applications/{application['id']}").json()['application']
        assert current['lock_version'] == application['lock_version']
        assert current['offer_status'] == 'none'


def test_offer_dates_cannot_update_another_users_application():
    app = build_app()
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner, 'owner-offer@example.test')
        application = create_offer(owner)
        register(other, 'other-offer@example.test')
        response = other.post(f"/api/job-applications/{application['id']}/offer", json={
            'base_lock_version': application['lock_version'], 'reply_due_on': '2026-10-03',
        })
        assert response.status_code == 404
        assert owner.get(f"/api/job-applications/{application['id']}").json()['application']['offer_reply_due_on'] is None
