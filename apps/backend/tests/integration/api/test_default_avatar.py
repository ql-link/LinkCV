from pathlib import Path
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from linkresume.modules.identity.default_avatar import DEFAULT_AVATAR_KEY, DEFAULT_AVATAR_URL
from linkresume.modules.identity.models import User
from linkresume.modules.identity.wechat_routes import resolve_wechat_user
from linkresume.modules.miniprogram.account_routes import mini_avatar_url
from tests.integration.api.test_account_routes import build_test_app, _avatar_data_url


def test_registration_profile_and_public_logo_agree_and_upload_replaces_default():
    app = build_test_app()
    with TestClient(app) as client:
        logo = client.get(DEFAULT_AVATAR_URL)
        assert logo.status_code == 200
        assert logo.headers['content-type'] == 'image/png'
        source = Path(__file__).resolve().parents[4] / 'web/src/assets/linkresume-mark.png'
        assert logo.content == source.read_bytes()
        response = client.post('/api/auth/register', json={
            'email': 'logo@example.test', 'password': 'password-123',
        })
        assert response.status_code == 201
        assert response.json()['user']['avatar_url'] == DEFAULT_AVATAR_URL
        assert client.get('/api/auth/me').json()['user']['avatar_url'] == DEFAULT_AVATAR_URL
        assert client.get('/api/account/profile').json()['user']['avatar_url'] == DEFAULT_AVATAR_URL
        response = client.put('/api/account/avatar', json={'dataUrl': _avatar_data_url()})
        assert response.status_code == 200
        assert unquote(response.json()['url']).startswith('/api/assets/users/')
        assert client.get(response.json()['url']).content == b'avatar-bytes'
        assert client.delete('/api/account/avatar').status_code == 200
        assert client.get('/api/account/profile').json()['user']['avatar_url'] is None


@pytest.mark.parametrize('method', ['wechat_qr', 'wechat_miniprogram'])
def test_new_wechat_users_get_logo_and_existing_avatars_are_preserved(method):
    app = build_test_app()
    with app.state.session_factory() as db:
        new_user = resolve_wechat_user(db, 'fictional-' + method, allow_registration=True, method=method)
        assert new_user.avatar_object_key == DEFAULT_AVATAR_KEY
        assert new_user.avatar_url == DEFAULT_AVATAR_URL
        assert mini_avatar_url(new_user) == DEFAULT_AVATAR_URL
        new_user.avatar_object_key = f'users/{new_user.id}/assets/avatar/custom.png'
        db.commit()
        existing = resolve_wechat_user(db, 'fictional-' + method, allow_registration=True, method=method)
        assert unquote(existing.avatar_url) == f'/api/assets/users/{new_user.id}/assets/avatar/custom.png'
        assert mini_avatar_url(existing) == '/api/miniprogram/account/avatar'
        old_user = User(nickname='张三', wechat_openid='old-' + method)
        db.add(old_user)
        db.commit()
        existing = resolve_wechat_user(db, 'old-' + method, allow_registration=True, method=method)
        assert existing.avatar_url is None
