from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from drawoffer.core.security import session_key, create_access_token
from drawoffer.modules.identity.session_service import prepare_session
from drawoffer.modules.identity.models import User
from drawoffer.modules.datasets.models import UserDataset
from drawoffer.modules.resumes.models import DocumentParseTask
from tests.integration.api.test_user_datasets import build_test_app, register, upload_file, mark_dataset_succeeded


def desktop(app, uid):
    with app.state.session_factory() as db:
        user = db.get(User, int(uid))
        credentials = prepare_session(user, app.state.settings, channel='desktop')
        app.state.redis.hset(session_key(credentials.sid), mapping={'uid': str(uid), 'channel': 'desktop'})
    return credentials, {'Authorization': 'Bearer ' + credentials.access_token}


def test_desktop_library_owned_folder_upload_replay_preview_move_and_delete():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        with app.state.session_factory() as db:
            uid = db.scalar(select(User.id))
        client.cookies.clear()
        credentials, headers = desktop(app, uid)
        client.headers.update(headers)
        folder = client.post('/api/datasets/folders', json={'name': '虚构项目资料'})
        assert folder.status_code == 201, folder.text
        fid = folder.json()['id']
        key = str(uuid4())
        response = upload_file(client, content=b'# Fictional project', idempotency_key=key, data={'folder_id': fid})
        assert response.status_code == 202, response.text
        did = response.json()['id']
        replay = upload_file(client, content=b'# Fictional project', idempotency_key=key, data={'folder_id': fid})
        assert replay.status_code in (200, 202), replay.text
        assert replay.json()['id'] == did
        mark_dataset_succeeded(app, int(did), b'# Fictional project\n\nNative preview')
        content = client.get(f'/api/datasets/{did}/content')
        assert content.status_code == 200, content.text
        assert content.json()['markdown'].startswith('# Fictional')
        source = client.get(f'/api/datasets/{did}/source')
        assert source.status_code == 200 and source.content == b'# Fictional project'
        assert 'no-store' in source.headers['cache-control']
        assert client.patch(f'/api/datasets/{did}', json={'name': '虚构经历'}).status_code == 200
        other = client.post('/api/datasets/folders', json={'name': '虚构面试资料'}).json()['id']
        moved = client.post('/api/datasets/move-batch', json={'dataset_ids': [did], 'folder_id': other})
        assert moved.status_code == 200, moved.text
        assert client.get(f'/api/datasets/{did}').json()['folder_id'] == other
        assert client.delete(f'/api/datasets/{did}').status_code == 200
        assert client.delete(f'/api/datasets/folders/{other}', params={'confirm_contents': 'true'}).status_code == 200
        assert client.get('/api/datasets').status_code == 200
        for channel in ('web', 'miniprogram'):
            token = create_access_token(int(uid), credentials.sid, app.state.settings, channel)
            assert client.get('/api/datasets/folders', headers={'Authorization': 'Bearer ' + token}).status_code == 401
        client.cookies.set(app.state.settings.access_cookie_name, 'fictional-cookie')
        assert client.get('/api/datasets/folders').status_code == 401


def test_desktop_library_cannot_read_or_mutate_other_users_resources():
    app = build_test_app()
    with TestClient(app) as owner:
        register(owner, 'library-owner@example.com')
        folder = owner.post('/api/datasets/folders', json={'name': '私有虚构资料'}).json()['id']
        record = upload_file(owner, data={'folder_id': folder}).json()
    with TestClient(app) as stranger:
        register(stranger, 'library-stranger@example.com')
        with app.state.session_factory() as db:
            uid = db.scalar(select(User.id).where(User.email == 'library-stranger@example.com'))
        stranger.cookies.clear()
        _, headers = desktop(app, uid)
        stranger.headers.update(headers)
        assert stranger.get('/api/datasets').json()['datasets'] == []
        for suffix in ('', '/content', '/source'):
            assert stranger.get('/api/datasets/' + record['id'] + suffix).status_code == 404
        assert stranger.patch('/api/datasets/' + record['id'], json={'name': '越权'}).status_code == 404
        assert stranger.patch('/api/datasets/folders/' + folder, json={'name': '越权'}).status_code == 404
        assert stranger.delete('/api/datasets/folders/' + folder, params={'confirm_contents': 'true'}).status_code == 404
        denied = upload_file(stranger, data={'folder_id': folder})
        assert denied.status_code == 404
        assert stranger.get('/api/datasets/01/source').status_code == 403


def test_desktop_document_replace_uses_existing_revision_and_idempotency_contract():
    from tests.integration.api.test_dataset_edit_replace import replace
    app = build_test_app()
    with TestClient(app) as client:
        register(client, 'library-replace@example.com')
        did = upload_file(client).json()['id']
        mark_dataset_succeeded(app, int(did), b'# Original')
        with app.state.session_factory() as db:
            uid = db.scalar(select(User.id))
        client.cookies.clear()
        _, headers = desktop(app, uid)
        client.headers.update(headers)
        assert replace(client, did, revision='99').status_code == 412
        key = str(uuid4())
        accepted = replace(client, did, key)
        assert accepted.status_code == 202, accepted.text
        assert replace(client, did, key).json()['id'] == did
        assert replace(client, did, key, content=b'changed').status_code == 409
        assert client.get(f'/api/datasets/{did}/content').status_code == 409


def test_desktop_attach_and_unlink_keep_owned_library_files():
    from tests.integration.api.test_interviews import create_application, create_job, session_payload
    app = build_test_app()
    with TestClient(app) as client:
        register(client, 'library-attach@example.com')
        application = create_application(client, create_job(client, '虚构面试公司'))
        created = client.post(f"/api/job-applications/{application['id']}/interview-sessions", json=session_payload(str(uuid4())))
        sid = created.json()['session']['id']
        did = upload_file(client).json()['id']
        mark_dataset_succeeded(app, int(did))
        with app.state.session_factory() as db:
            uid = db.scalar(select(User.id))
        client.cookies.clear()
        _, headers = desktop(app, uid)
        client.headers.update(headers)
        path = f'/api/interview-sessions/{sid}/assets'
        attached = client.post(path + '/attach', json={'dataset_id': did})
        assert attached.status_code == 201, attached.text
        assert client.post(path + '/attach', json={'dataset_id': did}).status_code == 201
        assert client.get(f'/api/datasets/{did}').json()['interview_session_id'] == sid
        assert client.delete(path + '/' + did).status_code == 200
        assert client.get(f'/api/datasets/{did}').json()['interview_session_id'] is None
        with app.state.session_factory() as db:
            stranger = User(email='library-outsider@example.com', nickname='虚构外部用户')
            db.add(stranger)
            db.commit()
            stranger_id = stranger.id
        _, other_headers = desktop(app, stranger_id)
        assert client.post(path + '/attach', json={'dataset_id': did}, headers=other_headers).status_code == 404
        assert client.delete(path + '/' + did, headers=other_headers).status_code == 404
