import base64
import hmac
import secrets
import time
from typing import Literal
from uuid import UUID

import redis
from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from linkresume.core.config import Settings
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.redis import get_redis
from linkresume.core.security import hash_secret, parse_refresh_token
from linkresume.integrations.wechat_client import WechatApiError, WechatClient
from linkresume.modules.identity import desktop_login_service as service
from linkresume.modules.identity.dependencies import get_current_desktop_user, get_settings
from linkresume.modules.identity.models import User
from linkresume.modules.identity.schemas import UserResponse
from linkresume.modules.identity.wechat_routes import client_ip, get_wechat_client, scene_key


class DesktopRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                settings = request.app.state.settings
                if any(name in request.cookies for name in (
                    settings.access_cookie_name,
                    settings.refresh_cookie_name,
                    settings.session_cookie_name,
                )):
                    raise ApiError(401, 'SESSION_INVALID')
                if request.url.path != '/api/auth/desktop/me' and 'authorization' in request.headers:
                    raise ApiError(401, 'SESSION_INVALID')
                response = await original(request)
            except ApiError as error:
                request.state.error_code = error.code
                response = JSONResponse({'error': error.code}, status_code=error.status_code, headers=error.headers)
            except RequestValidationError:
                request.state.error_code = 'INVALID_DESKTOP_REQUEST'
                response = JSONResponse({'error': 'INVALID_DESKTOP_REQUEST'}, status_code=422)
            except (redis.RedisError, SQLAlchemyError):
                request.state.error_code = 'AUTH_SERVICE_UNAVAILABLE'
                response = JSONResponse({'error': 'AUTH_SERVICE_UNAVAILABLE'}, status_code=503)
            response.headers['Cache-Control'] = 'no-store'
            return response

        return handler


router = APIRouter(prefix='/auth/desktop', tags=['identity'], route_class=DesktopRoute)

RATE_SCRIPT = """-- desktop_rate_limit
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return count
"""


def rate_limit(redis_client, key: str, maximum: int):
    if redis_client.eval(RATE_SCRIPT, 1, f'auth:desktop:rate:{key}') > maximum:
        raise ApiError(429, 'AUTH_RATE_LIMITED', headers={'Retry-After': '60'})


class QrcodeRequest(BaseModel):
    platform: Literal['macos', 'windows']
    client_version: str = Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9.+_-]+$')
    code_challenge: str = Field(pattern=r'^[A-Za-z0-9_-]{43}$')
    code_challenge_method: Literal['S256']

    @field_validator('code_challenge')
    @classmethod
    def canonical_challenge(cls, value: str):
        raw = base64.urlsafe_b64decode(value + '=')
        if base64.urlsafe_b64encode(raw).rstrip(b'=').decode() != value:
            raise ValueError('noncanonical challenge')
        return value


class StatusRequest(BaseModel):
    scene: str = Field(pattern=r'^desktop:[a-f0-9]{16}$')
    poll_token: str = Field(min_length=1, max_length=128)


class ExchangeRequest(StatusRequest):
    code_verifier: str = Field(min_length=43, max_length=128, pattern=r'^[A-Za-z0-9._~-]+$')
    request_id: UUID


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class RefreshRequest(LogoutRequest):
    request_id: UUID


@router.get('/capabilities')
def capabilities(settings: Settings = Depends(get_settings)):
    return {'wechat_login_enabled': settings.wechat_enabled and settings.desktop_retry_cipher is not None, 'session_protocol': 1}


@router.post('/wechat/qrcode')
def qrcode(payload: QrcodeRequest, request: Request, settings: Settings = Depends(get_settings),
           redis_client=Depends(get_redis), wechat: WechatClient = Depends(get_wechat_client)):
    service.cipher(settings)
    if not settings.wechat_enabled:
        raise ApiError(503, 'AUTH_SERVICE_UNAVAILABLE')
    rate_limit(redis_client, f'qrcode:{client_ip(request)}', settings.wechat_qrcode_requests_per_minute)
    scene = f'desktop:{secrets.token_hex(8)}'
    poll_token = secrets.token_urlsafe(24)
    ttl = settings.wechat_scene_ttl_seconds
    key = scene_key(scene)
    redis_client.eval("""-- desktop_create_challenge
local now = tonumber(redis.call('TIME')[1])
redis.call('HSET', KEYS[1], 'state', 'pending', 'target_channel', 'desktop',
  'platform', ARGV[1], 'client_version', ARGV[2], 'code_challenge', ARGV[3],
  'code_challenge_method', 'S256', 'poll_hash', ARGV[4], 'expires_at', now + tonumber(ARGV[5]))
redis.call('EXPIREAT', KEYS[1], now + tonumber(ARGV[5]))
return 1
""", 1, key, payload.platform, payload.client_version, payload.code_challenge, hash_secret(poll_token), ttl)
    try:
        image = wechat.mini_program_qrcode(scene, for_login=True)
    except WechatApiError as error:
        redis_client.delete(key)
        raise ApiError(503, 'AUTH_SERVICE_UNAVAILABLE') from error
    return {'scene': scene, 'poll_token': poll_token, 'qr_base64': base64.b64encode(image).decode('ascii'), 'expires_in': ttl, 'poll_interval_seconds': 2}


@router.post('/wechat/status')
def status(payload: StatusRequest, request: Request, redis_client=Depends(get_redis)):
    rate_limit(redis_client, f'status:ip:{client_ip(request)}', 120)
    rate_limit(redis_client, f'status:scene:{payload.scene}', 30)
    record = redis_client.hgetall(scene_key(payload.scene))
    if not record:
        return {'status': 'expired'}
    if record.get('target_channel') != 'desktop' or not hmac.compare_digest(record.get('poll_hash', ''), hash_secret(payload.poll_token)):
        raise ApiError(401, 'LOGIN_CHALLENGE_INVALID')
    state = record.get('state', 'expired')
    if state != 'consumed' and float(record.get('expires_at', 0)) <= time.time():
        state = 'expired'
    return {'status': 'pending' if state == 'processing' else state}


@router.post('/wechat/exchange')
def exchange(payload: ExchangeRequest, request: Request, settings: Settings = Depends(get_settings),
             db: Session = Depends(get_db), redis_client=Depends(get_redis)):
    rate_limit(redis_client, f'exchange:ip:{client_ip(request)}', 120)
    rate_limit(redis_client, f'exchange:scene:{payload.scene}', 10)
    return service.exchange(payload.scene, payload.poll_token, payload.code_verifier, str(payload.request_id), settings, db, redis_client)


@router.post('/refresh')
def refresh(payload: RefreshRequest, request: Request, settings: Settings = Depends(get_settings),
            db: Session = Depends(get_db), redis_client=Depends(get_redis)):
    rate_limit(redis_client, f'refresh:ip:{client_ip(request)}', 120)
    parsed = parse_refresh_token(payload.refresh_token)
    if parsed:
        rate_limit(redis_client, f'refresh:sid:{hash_secret(parsed[0])}', 30)
    return service.refresh(payload.refresh_token, str(payload.request_id), settings, db, redis_client)


@router.post('/logout')
def logout(payload: LogoutRequest, request: Request, redis_client=Depends(get_redis)):
    rate_limit(redis_client, f'logout:ip:{client_ip(request)}', 120)
    service.logout(payload.refresh_token, redis_client)
    return {'ok': True}


@router.get('/me')
def me(user: User = Depends(get_current_desktop_user)):
    return {'user': UserResponse.model_validate(user)}
