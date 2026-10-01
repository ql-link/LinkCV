import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
import redis
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from linkresume.core.config import Settings
from linkresume.core.errors import ApiError
from linkresume.core.security import session_key, user_sessions_key
from linkresume.integrations.wechat_client import WechatClient
from linkresume.main import create_app
from linkresume.modules.identity import desktop_login_service as service
from linkresume.modules.identity.models import User
from tests.fakes import FakeRedis
from tests.integration.api.test_identity_resumes_assets import FakeStorage
from tests.integration.api.test_wechat_routes import wxacode_handler


def build_desktop_app(cache, database_url):
    settings = Settings(
        database_url=database_url,
        jwt_secret='integration-test-secret-with-32-bytes',
        auth_desktop_retry_encryption_key=Fernet.generate_key().decode(),
        wechat_appid='wx-fixture-appid', wechat_secret='fixture-secret',
    )
    app = create_app(settings, storage=FakeStorage(), redis=cache, create_schema=True)
    app.state.wechat_client = WechatClient(
        appid='wx-fixture-appid', secret='fixture-secret',
        qr_page='pages/bind/bind', login_page='pages/login/index',
        transport=httpx.MockTransport(wxacode_handler()),
    )
    with app.state.session_factory() as db:
        db.add(User(wechat_openid='openid-fixture', nickname='张三', is_admin=True))
        db.commit()
    return app


@pytest.fixture(params=['fake', 'real'])
def desktop_app(request, tmp_path):
    database_url = f'sqlite+pysqlite:///{tmp_path / "desktop.db"}'
    if request.param == 'fake':
        yield build_desktop_app(FakeRedis(), database_url)
        return
    if os.environ.get('RUN_DESKTOP_REDIS_TESTS') != '1':
        pytest.skip('set RUN_DESKTOP_REDIS_TESTS=1 to verify real Redis atomicity')
    executable = shutil.which('redis-server')
    if executable is None:
        pytest.skip('isolated redis-server is required')
    with tempfile.TemporaryDirectory(prefix='desktop-auth-') as directory:
        socket = str(Path(directory) / 'redis.sock')
        process = subprocess.Popen(
            [executable, '--port', '0', '--unixsocket', socket, '--save', '',
             '--appendonly', 'no', '--dir', directory],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        cache = redis.Redis(unix_socket_path=socket, decode_responses=True)
        try:
            for _ in range(100):
                try:
                    cache.ping()
                    break
                except redis.ConnectionError:
                    if process.poll() is not None:
                        pytest.fail('isolated Redis exited before startup: ' + process.communicate()[0])
                    time.sleep(0.01)
            else:
                pytest.fail('isolated Redis did not start')
            yield build_desktop_app(cache, database_url)
        finally:
            cache.close()
            process.terminate()
            process.wait(timeout=5)


def challenge(client):
    verifier = 'v' * 43
    response = client.post('/api/auth/desktop/wechat/qrcode', json={
        'platform': 'macos', 'client_version': '1.0.0',
        'code_challenge': service.challenge_for(verifier), 'code_challenge_method': 'S256',
    })
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'no-store'
    return {**response.json(), 'code_verifier': verifier, 'request_id': str(uuid4())}


def exchange_body(qr):
    return {key: qr[key] for key in ('scene', 'poll_token', 'code_verifier', 'request_id')}


def login(client):
    qr = challenge(client)
    confirmation = client.post('/api/auth/wechat/confirm', data={
        'scene': qr['scene'], 'code': 'fixture-code',
    })
    assert confirmation.status_code == 200, confirmation.text
    response = client.post('/api/auth/desktop/wechat/exchange', json=exchange_body(qr))
    assert response.status_code == 200, response.text
    assert not response.headers.get('set-cookie')
    return qr, response.json()


def test_desktop_readonly_resources_keep_ownership_and_version_checks(desktop_app):
    from linkresume.modules.identity.session_service import issue_session
    from linkresume.modules.resumes.models import ResumeTemplate
    from tests.canonical_resume_fixtures import canonical_template_payload
    from tests.integration.api.test_resume_pdf import FakeRenderer

    settings = desktop_app.state.settings
    desktop_app.state.resume_pdf_renderer = FakeRenderer()
    with desktop_app.state.session_factory() as db:
        data, style = canonical_template_payload(key='desktop-fixture')
        template = ResumeTemplate(key='desktop-fixture', name='测试模板', data_json=data, style_json=style, is_active=1)
        stranger = User(wechat_openid='openid-stranger', nickname='李四')
        db.add_all([template, stranger])
        db.commit()
        template_id = str(template.id)
        owner_web = issue_session(db.get(User, 1), settings, desktop_app.state.redis, channel='web')
        stranger_web = issue_session(stranger, settings, desktop_app.state.redis, channel='web')

    with TestClient(desktop_app) as client:
        _, tokens = login(client)
        headers = {'Authorization': 'Bearer ' + tokens['access_token']}
        fixtures = []
        for credentials in (owner_web, stranger_web):
            client.cookies.set(settings.access_cookie_name, credentials.access_token)
            created = client.post('/api/resumes', json={'title': '虚构简历', 'template_id': template_id})
            assert created.status_code == 201, created.text
            resume = created.json()['resume']
            uploaded = client.post(f"/api/resumes/{resume['id']}/assets", json={
                'file_name': 'fixture.png', 'data_url': 'data:image/png;base64,cG5nLWJ5dGVz',
            })
            assert uploaded.status_code == 201, uploaded.text
            legacy = client.post('/api/assets', json={
                'fileName': 'fixture.png', 'dataUrl': 'data:image/png;base64,cG5nLWJ5dGVz',
            })
            assert legacy.status_code == 201, legacy.text
            fixtures.append((resume, uploaded.json()['asset']['url'], legacy.json()['asset']['url']))
            client.cookies.clear()

        owned, owned_asset, owned_legacy = fixtures[0]
        other, other_asset, other_legacy = fixtures[1]
        rid = owned['id']
        for path in ('/api/resume-templates', f'/api/resume-templates/{template_id}', '/api/resumes', f'/api/resumes/{rid}'):
            assert client.get(path, headers=headers).status_code == 200, path
        assert [item['id'] for item in client.get('/api/resumes', headers=headers).json()['resumes']] == [rid]
        for path in (owned_asset, owned_legacy):
            assert client.get(path, headers=headers).content == b'png-bytes'
        pdf = client.get(f'/api/resumes/{rid}/pdf', params={'lock_version': 1}, headers=headers)
        assert pdf.status_code == 200, pdf.text
        assert pdf.content.startswith(b'%PDF')
        assert client.get(f'/api/resumes/{rid}/pdf', params={'lock_version': 2}, headers=headers).status_code == 409
        for path in (f"/api/resumes/{other['id']}", f"/api/resumes/{other['id']}/pdf?lock_version=1", other_asset):
            assert client.get(path, headers=headers).status_code == 404, path
        assert client.get(other_legacy, headers=headers).status_code == 403

        for method, path in (
            ('POST', '/api/resumes'), ('PUT', f'/api/resumes/{rid}'),
            ('POST', f'/api/resumes/{rid}/copy'), ('POST', f'/api/resumes/{rid}/apply-template'),
            ('DELETE', f'/api/resumes/{rid}'), ('POST', f'/api/resumes/{rid}/assets'),
            ('DELETE', owned_asset), ('POST', '/api/assets'),
            ('GET', '/api/auth/admin/users'), ('GET', '/api/auth/admin/users/1'),
            ('PATCH', '/api/auth/admin/users/1/status'), ('GET', '/api/auth/admin/stats'),
            ('GET', '/api/account/profile'),
        ):
            denied = client.request(method, path, headers=headers, json={})
            assert denied.status_code == 401, (method, path, denied.text)
        assert client.get(f'/api/resumes/{rid}', headers=headers).json()['resume']['lock_version'] == 1
        assert client.get(owned_asset, headers=headers).content == b'png-bytes'


def test_desktop_login_retry_refresh_logout_and_channels(desktop_app):
    with TestClient(desktop_app) as client:
        qr, tokens = login(client)
        repeated = client.post('/api/auth/desktop/wechat/exchange', json=exchange_body(qr))
        assert repeated.json()['refresh_token'] == tokens['refresh_token']
        assert repeated.json()['access_token'] == tokens['access_token']
        changed = {**exchange_body(qr), 'request_id': str(uuid4())}
        assert client.post('/api/auth/desktop/wechat/exchange', json=changed).status_code == 409
        headers = {'Authorization': 'Bearer ' + tokens['access_token']}
        assert client.get('/api/auth/desktop/me', headers=headers).status_code == 200
        assert client.get('/api/resumes', headers=headers).status_code == 200
        assert client.get('/api/resume-templates', headers=headers).status_code == 200
        assert client.get('/api/auth/me', headers=headers).json()['user'] is None
        for path in ('/api/account/profile', '/api/auth/admin/users'):
            assert client.get(path, headers=headers).status_code == 401
        assert client.post('/api/resumes', headers=headers, json={}).status_code == 401
        sid = tokens['refresh_token'].split('.')[0]
        wrong = client.post('/api/auth/desktop/logout', json={'refresh_token': sid + '.wrong'})
        assert wrong.status_code == 401
        assert desktop_app.state.redis.exists(session_key(sid))
        request = {'refresh_token': tokens['refresh_token'], 'request_id': str(uuid4())}
        rotated = client.post('/api/auth/desktop/refresh', json=request)
        assert rotated.status_code == 200, rotated.text
        replay = client.post('/api/auth/desktop/refresh', json=request)
        assert replay.json()['refresh_token'] == rotated.json()['refresh_token']
        logout = client.post('/api/auth/desktop/logout', json={
            'refresh_token': rotated.json()['refresh_token'],
        })
        assert logout.status_code == 200
        assert client.post('/api/auth/desktop/refresh', json=request).status_code == 401
        assert client.post('/api/auth/desktop/wechat/exchange', json=exchange_body(qr)).status_code == 410


@pytest.mark.parametrize('mutation', ['expired', 'tampered', 'revoked', 'rotated', 'disabled'])
def test_exchange_cache_cannot_restore_invalid_session(desktop_app, mutation):
    with TestClient(desktop_app) as client:
        qr, tokens = login(client)
        cache = desktop_app.state.redis
        key = 'wechat:login:' + qr['scene']
        sid = tokens['refresh_token'].split('.')[0]
        if mutation == 'expired':
            cache.hset(key, 'result_expires_at', int(time.time()) - 1)
        elif mutation == 'tampered':
            cache.hset(key, 'result_ciphertext', 'invalid-ciphertext')
        elif mutation == 'revoked':
            service.logout(tokens['refresh_token'], cache)
        elif mutation == 'rotated':
            with desktop_app.state.session_factory() as db:
                service.refresh(tokens['refresh_token'], str(uuid4()), desktop_app.state.settings, db, cache)
        else:
            with desktop_app.state.session_factory() as db:
                db.get(User, int(tokens['user']['id'])).status = 0
                db.commit()
        response = client.post('/api/auth/desktop/wechat/exchange', json=exchange_body(qr))
        assert response.status_code == (401 if mutation == 'disabled' else 410)
        if mutation == 'disabled':
            assert not cache.exists(session_key(sid))
        assert 'access_token' not in response.json()
        assert response.headers['cache-control'] == 'no-store'


def test_credentials_cannot_cross_channels_or_mix_with_cookies(desktop_app):
    with TestClient(desktop_app) as client:
        qr, tokens = login(client)
        settings = desktop_app.state.settings
        sid = tokens['refresh_token'].split('.')[0]
        headers = {'Authorization': 'Bearer ' + tokens['access_token']}
        for channel in ('web', 'miniprogram'):
            from linkresume.core.security import create_access_token
            token = create_access_token(int(tokens['user']['id']), sid, settings, channel)
            wrong_headers = {'Authorization': 'Bearer ' + token}
            for path in ('/api/auth/desktop/me', '/api/resumes', '/api/resume-templates'):
                assert client.get(path, headers=wrong_headers).status_code == 401
        for name in (settings.access_cookie_name, settings.refresh_cookie_name, settings.session_cookie_name):
            client.cookies.set(name, 'fixture-cookie')
            assert client.get('/api/auth/desktop/me', headers=headers).status_code == 401
            assert client.get('/api/resumes', headers=headers).status_code == 401
            assert client.post('/api/auth/desktop/wechat/exchange', json=exchange_body(qr)).status_code == 401
            client.cookies.clear()
        assert client.post('/api/auth/desktop/refresh', headers=headers, json={
            'refresh_token': tokens['refresh_token'], 'request_id': str(uuid4()),
        }).status_code == 401
        assert desktop_app.state.redis.exists(session_key(sid))


def test_refresh_conflict_and_expired_retry_do_not_restore_tokens(desktop_app):
    with TestClient(desktop_app) as client:
        _, tokens = login(client)
        request_id = str(uuid4())
        body = {'refresh_token': tokens['refresh_token'], 'request_id': request_id}
        rotated = client.post('/api/auth/desktop/refresh', json=body).json()
        conflict = client.post('/api/auth/desktop/refresh', json={
            'refresh_token': rotated['refresh_token'], 'request_id': request_id,
        })
        assert conflict.status_code == 409
        assert conflict.json()['error'] == 'AUTH_IDEMPOTENCY_CONFLICT'
        sid = tokens['refresh_token'].split('.')[0]
        desktop_app.state.redis.hset(session_key(sid), 'retry_expires_at', int(time.time()) - 1)
        replay = client.post('/api/auth/desktop/refresh', json=body)
        assert replay.status_code == 401
        assert replay.json()['error'] == 'REFRESH_REPLAYED'
        assert not desktop_app.state.redis.exists(session_key(sid))


def test_desktop_key_fails_closed_without_disabling_web(desktop_app):
    for value in (None, 'invalid'):
        from pydantic import SecretStr
        desktop_app.state.settings.auth_desktop_retry_encryption_key = SecretStr(value) if value else None
        with TestClient(desktop_app) as client:
            assert client.get('/api/auth/desktop/capabilities').json()['wechat_login_enabled'] is False
            response = client.post('/api/auth/desktop/wechat/qrcode', json={
                'platform': 'macos', 'client_version': '1.0',
                'code_challenge': service.challenge_for('v' * 43), 'code_challenge_method': 'S256',
            })
            assert response.status_code == 503
            assert client.get('/api/auth/me').status_code == 200


def test_expiry_proof_and_validation_do_not_issue_session(desktop_app):
    with TestClient(desktop_app) as client:
        qr = challenge(client)
        body = exchange_body(qr)
        wrong = {**body, 'code_verifier': 'x' * 43}
        assert client.post('/api/auth/desktop/wechat/exchange', json=wrong).status_code == 401
        assert client.post('/api/auth/desktop/wechat/exchange', json=body).status_code == 409
        invalid = client.post('/api/auth/desktop/refresh', json={
            'refresh_token': 'fixture-private-token', 'request_id': 'invalid',
        })
        assert invalid.status_code == 422
        assert 'fixture-private-token' not in invalid.text
        assert invalid.headers['cache-control'] == 'no-store'
        key = 'wechat:login:' + qr['scene']
        desktop_app.state.redis.hset(key, 'expires_at', int(time.time()) - 1)
        response = client.post('/api/auth/wechat/confirm', data={
            'scene': qr['scene'], 'code': 'fixture-code',
        })
        assert response.status_code == 410
        assert desktop_app.state.redis.hget(key, 'state') == 'pending'
        assert not desktop_app.state.redis.smembers(user_sessions_key(1))


def test_concurrent_exchange_uses_one_session_and_refresh_replay_revokes(desktop_app):
    with TestClient(desktop_app) as client:
        qr = challenge(client)
        assert client.post('/api/auth/wechat/confirm', data={
            'scene': qr['scene'], 'code': 'fixture-code',
        }).status_code == 200
        cache = desktop_app.state.redis
        key = 'wechat:login:' + qr['scene']
        ttl = cache.ttls[key] if isinstance(cache, FakeRedis) else cache.ttl(key)
        assert ttl <= desktop_app.state.settings.wechat_scene_ttl_seconds

    def consume(_):
        with desktop_app.state.session_factory() as db:
            return service.exchange(qr['scene'], qr['poll_token'], qr['code_verifier'],
                                    qr['request_id'], desktop_app.state.settings, db, desktop_app.state.redis)

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(consume, range(20)))
    assert len({result['refresh_token'] for result in results}) == 1
    token = results[0]['refresh_token']
    sid = token.split('.')[0]
    uid = results[0]['user']['id']
    assert desktop_app.state.redis.smembers(user_sessions_key(int(uid))) == {sid}
    with desktop_app.state.session_factory() as db:
        request_id = str(uuid4())
        rotated = service.refresh(token, request_id, desktop_app.state.settings, db, desktop_app.state.redis)
        with pytest.raises(ApiError) as error:
            service.refresh(token, str(uuid4()), desktop_app.state.settings, db, desktop_app.state.redis)
        assert error.value.code == 'REFRESH_REPLAYED'
        assert not desktop_app.state.redis.exists(session_key(sid))
        with pytest.raises(ApiError):
            service.refresh(rotated['refresh_token'], str(uuid4()), desktop_app.state.settings, db, desktop_app.state.redis)


def test_concurrent_refresh_returns_one_result_without_extending_retry(desktop_app):
    with TestClient(desktop_app) as client:
        _, tokens = login(client)
    cache = desktop_app.state.redis
    request_id = str(uuid4())

    def rotate(_):
        with desktop_app.state.session_factory() as db:
            return service.refresh(tokens['refresh_token'], request_id, desktop_app.state.settings, db, cache)

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(rotate, range(20)))
    assert len({result['refresh_token'] for result in results}) == 1
    assert len({result['access_token'] for result in results}) == 1
    key = session_key(tokens['refresh_token'].split('.')[0])
    before = cache.hgetall(key)
    ttl_before = cache.ttls[key] if isinstance(cache, FakeRedis) else cache.ttl(key)
    repeated = rotate(None)
    assert repeated['refresh_token'] == results[0]['refresh_token']
    assert repeated['access_token'] == results[0]['access_token']
    assert repeated['expires_in'] <= results[0]['expires_in']
    assert cache.hgetall(key) == before
    ttl_after = cache.ttls[key] if isinstance(cache, FakeRedis) else cache.ttl(key)
    assert ttl_after <= ttl_before


def test_wrong_type_session_index_fails_before_session_mutation(desktop_app):
    cache = desktop_app.state.redis
    with TestClient(desktop_app) as client:
        qr = challenge(client)
        assert client.post('/api/auth/wechat/confirm', data={
            'scene': qr['scene'], 'code': 'fixture-code',
        }).status_code == 200
        index = user_sessions_key(1)
        cache.set(index, 'fixture-wrong-type')
        response = client.post('/api/auth/desktop/wechat/exchange', json=exchange_body(qr))
        assert response.status_code == 503
        assert cache.hget('wechat:login:' + qr['scene'], 'state') == 'confirmed'
        cache.delete(index)
        response = client.post('/api/auth/desktop/wechat/exchange', json=exchange_body(qr))
        assert response.status_code == 200
        tokens = response.json()
        sid = tokens['refresh_token'].split('.')[0]
        key = session_key(sid)
        before = cache.hgetall(key)
        cache.delete(index)
        cache.set(index, 'fixture-wrong-type')
        response = client.post('/api/auth/desktop/refresh', json={
            'refresh_token': tokens['refresh_token'], 'request_id': str(uuid4()),
        })
        assert response.status_code == 503
        assert cache.hgetall(key) == before
        response = client.post('/api/auth/desktop/logout', json={'refresh_token': tokens['refresh_token']})
        assert response.status_code == 503
        assert cache.hgetall(key) == before
