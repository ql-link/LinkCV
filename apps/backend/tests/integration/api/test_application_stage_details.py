from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from drawoffer.modules.datasets.models import UserDataset
from drawoffer.modules.identity.models import User
from tests.integration.api.test_interviews import build_app, create_job, register


def create_pending(client):
    response = client.post('/api/job-applications', json={
        'job_description_id': create_job(client, '示例渠道公司'),
        'current_stage_type': 'screening', 'current_stage_label': '待投递',
        'stage_state': 'awaiting_schedule',
    })
    assert response.status_code == 201, response.text
    return response.json()['application']


def add_stage(client, application, **payload):
    response = client.post(f"/api/job-applications/{application['id']}/stages", json={
        'client_request_id': str(uuid4()),
        'base_lock_version': application['lock_version'],
        **payload,
    })
    return response


def seed_document(app, email, file_name='示例_Offer.pdf'):
    with app.state.session_factory() as db:
        user = db.scalar(select(User).where(User.email == email))
        dataset = UserDataset(
            user_id=user.id, file_name=file_name, file_format='pdf', content_type='application/pdf',
            idempotency_key=uuid4().hex, request_fingerprint='0' * 64, file_size=1,
            object_name=f'users/{user.id}/datasets/source/{uuid4().hex}.pdf', sha256='0' * 64,
            asset_kind='document',
        )
        db.add(dataset)
        db.commit()
        return str(dataset.id)


def test_recording_an_application_keeps_its_channel_and_allows_editing_it():
    with TestClient(build_app()) as client:
        register(client, 'channel@example.test')
        pending = create_pending(client)
        response = client.put(f"/api/job-applications/{pending['id']}", json={
            'base_lock_version': pending['lock_version'],
            'applied_at': '2026-09-28T09:00:00+08:00', 'applied_channel': ' 同事内推 ',
        })
        assert response.status_code == 200, response.text
        applied = response.json()['application']
        assert applied['applied_channel'] == '同事内推'
        assert applied['phase'] == 'applied'
        edited = client.put(f"/api/job-applications/{applied['id']}", json={
            'base_lock_version': applied['lock_version'], 'applied_channel': '官网投递',
        })
        assert edited.status_code == 200, edited.text
        assert edited.json()['application']['applied_channel'] == '官网投递'


def test_hr_stage_is_its_own_type_and_schedules_hr_sessions():
    with TestClient(build_app()) as client:
        register(client, 'hr-stage@example.test')
        pending = create_pending(client)
        response = add_stage(client, pending, stage_type='hr', applied_at='2026-09-28T09:00:00+08:00')
        assert response.status_code == 200, response.text
        application = response.json()['application']
        assert application['current_stage']['stage_type'] == 'hr'
        assert application['current_stage']['stage_label'] == 'HR 面'
        assert application['current_stage_type'] == 'hr'
        assert application['stage_state'] == 'awaiting_schedule'
        session = client.post(f"/api/job-applications/{application['id']}/interview-sessions", json={
            'client_request_id': str(uuid4()),
            'stage_type': 'hr', 'stage_label': 'HR 面',
            'start_at': '2030-10-19T15:00:00+08:00', 'duration_minutes': 30,
            'timezone': 'Asia/Shanghai', 'mode': 'phone',
        })
        assert session.status_code == 201, session.text
        current = client.get(f"/api/job-applications/{application['id']}").json()['application']
        assert current['stage_state'] == 'scheduled'


def test_oc_stage_records_verbal_details_and_formal_offer_needs_an_offer_stage():
    with TestClient(build_app()) as client:
        register(client, 'oc-stage@example.test')
        pending = create_pending(client)
        response = add_stage(
            client, pending, stage_type='oc', applied_at='2026-09-28T09:00:00+08:00',
            oc_communicated_at='2026-10-21T15:00:00+08:00', oc_contact='电话 · 示例 HR',
            oc_salary_text='35K × 16 薪', oc_start_text='11 月上旬', oc_note='以书面为准',
        )
        assert response.status_code == 200, response.text
        oc = response.json()['application']
        assert oc['current_stage']['stage_type'] == 'oc'
        assert oc['current_stage_type'] == 'offer'
        assert oc['offer_status'] == 'none'
        assert oc['oc_communicated_at'].startswith('2026-10-21T07:00:00')
        assert (oc['oc_contact'], oc['oc_salary_text'], oc['oc_start_text'], oc['oc_note']) == (
            '电话 · 示例 HR', '35K × 16 薪', '11 月上旬', '以书面为准',
        )
        blocked = client.post(f"/api/job-applications/{oc['id']}/offer", json={'base_lock_version': oc['lock_version']})
        assert blocked.status_code == 409
        offer = add_stage(client, oc, stage_type='offer')
        assert offer.status_code == 200, offer.text
        offered = offer.json()['application']
        assert [stage['stage_type'] for stage in offered['stages']] == ['oc', 'offer']
        assert offered['oc_salary_text'] == '35K × 16 薪'


def test_verbal_details_are_rejected_outside_an_oc_stage():
    with TestClient(build_app()) as client:
        register(client, 'oc-reject@example.test')
        pending = create_pending(client)
        response = add_stage(client, pending, stage_type='offer', oc_salary_text='30K')
        assert response.status_code == 400


def test_formal_offer_keeps_probation_and_owned_materials():
    app = build_app()
    with TestClient(app) as client, TestClient(app) as other:
        register(client, 'offer-material@example.test')
        mine = seed_document(app, 'offer-material@example.test')
        register(other, 'offer-material-other@example.test')
        foreign = seed_document(app, 'offer-material-other@example.test', '他人文件.pdf')
        pending = create_pending(client)
        application = add_stage(client, pending, stage_type='offer').json()['application']
        path = f"/api/job-applications/{application['id']}/offer"
        rejected = client.post(path, json={'base_lock_version': application['lock_version'], 'material_dataset_ids': [foreign]})
        assert rejected.status_code == 404
        response = client.post(path, json={
            'base_lock_version': application['lock_version'], 'received_on': '2026-10-24',
            'probation': '3 个月', 'material_dataset_ids': [mine],
        })
        assert response.status_code == 200, response.text
        saved = response.json()['application']
        assert saved['offer_probation'] == '3 个月'
        assert saved['offer_materials'] == [{'dataset_id': mine, 'file_name': '示例_Offer.pdf'}]
        kept = client.post(path, json={'base_lock_version': saved['lock_version'], 'reply_due_on': '2026-10-28'})
        assert kept.json()['application']['offer_materials'] == saved['offer_materials']
        cleared = client.post(path, json={'base_lock_version': kept.json()['application']['lock_version'], 'material_dataset_ids': []})
        assert cleared.json()['application']['offer_materials'] == []
