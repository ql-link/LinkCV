from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import jwt
from cryptography.fernet import InvalidToken
from sqlalchemy.orm import Session

from linkresume.core.config import Settings
from linkresume.core.database import utc_now
from linkresume.core.errors import ApiError
from linkresume.core.security import hash_secret, parse_refresh_token, refresh_max_age_seconds, session_key, user_sessions_key
from linkresume.modules.identity.models import User
from linkresume.modules.identity.schemas import UserResponse
from linkresume.modules.identity.session_service import DESKTOP_CHANNEL, prepare_session, revoke_session

RETRY_SECONDS = 120

EXCHANGE_SCRIPT = """-- desktop_exchange
local now = tonumber(redis.call('TIME')[1])
if redis.call('HGET', KEYS[1], 'target_channel') ~= 'desktop' then return {'invalid'} end
if redis.call('HGET', KEYS[1], 'poll_hash') ~= ARGV[1] or redis.call('HGET', KEYS[1], 'code_challenge') ~= ARGV[2] then return {'invalid'} end
local state = redis.call('HGET', KEYS[1], 'state')
if state == 'consumed' then
  if redis.call('HGET', KEYS[1], 'exchange_request_id') ~= ARGV[3] or redis.call('HGET', KEYS[1], 'exchange_fingerprint') ~= ARGV[4] then return {'conflict'} end
  if tonumber(redis.call('HGET', KEYS[1], 'result_expires_at') or '0') <= now then return {'result_expired'} end
  return {'result', redis.call('HGET', KEYS[1], 'result_ciphertext')}
end
if tonumber(redis.call('HGET', KEYS[1], 'expires_at') or '0') <= now then return {'expired'} end
if state ~= 'confirmed' then return {'not_confirmed'} end
if redis.call('HGET', KEYS[1], 'uid') ~= ARGV[5] then return {'invalid'} end
if redis.call('EXISTS', KEYS[2]) == 1 then return {'conflict'} end
local index_type = redis.call('TYPE', KEYS[3]).ok
if index_type ~= 'none' and index_type ~= 'set' then return {'unavailable'} end
redis.call('HSET', KEYS[2], 'uid', ARGV[5], 'rhash', ARGV[7], 'channel', 'desktop', 'created_at', ARGV[8])
redis.call('EXPIRE', KEYS[2], ARGV[9])
redis.call('SADD', KEYS[3], ARGV[6])
redis.call('HSET', KEYS[1], 'state', 'consumed', 'exchange_request_id', ARGV[3], 'exchange_fingerprint', ARGV[4], 'result_sid', ARGV[6], 'result_rhash', ARGV[7], 'result_ciphertext', ARGV[10], 'result_expires_at', ARGV[11])
redis.call('EXPIREAT', KEYS[1], ARGV[11])
return {'result', ARGV[10]}
"""

REFRESH_SCRIPT = """-- desktop_refresh
local now = tonumber(redis.call('TIME')[1])
if redis.call('HGET', KEYS[1], 'channel') ~= 'desktop' or redis.call('HGET', KEYS[1], 'uid') ~= ARGV[1] then return {'invalid'} end
local current = redis.call('HGET', KEYS[1], 'rhash')
if redis.call('HGET', KEYS[1], 'retry_request_id') == ARGV[3] then
  if redis.call('HGET', KEYS[1], 'retry_old_rhash') ~= ARGV[2] then return {'conflict'} end
  if tonumber(redis.call('HGET', KEYS[1], 'retry_expires_at') or '0') > now and redis.call('HGET', KEYS[1], 'retry_new_rhash') == current then
    return {'result', redis.call('HGET', KEYS[1], 'retry_ciphertext')}
  end
end
local index_type = redis.call('TYPE', KEYS[2]).ok
if index_type ~= 'none' and index_type ~= 'set' then return {'unavailable'} end
if current ~= ARGV[2] then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[4])
  return {'replayed'}
end
redis.call('HSET', KEYS[1], 'rhash', ARGV[5], 'retry_request_id', ARGV[3], 'retry_old_rhash', ARGV[2], 'retry_new_rhash', ARGV[5], 'retry_ciphertext', ARGV[6], 'retry_expires_at', ARGV[7])
redis.call('EXPIRE', KEYS[1], ARGV[8])
return {'result', ARGV[6]}
"""

LOGOUT_SCRIPT = """-- desktop_logout
if redis.call('EXISTS', KEYS[1]) == 0 then return 'ok' end
if redis.call('HGET', KEYS[1], 'channel') ~= 'desktop' or redis.call('HGET', KEYS[1], 'rhash') ~= ARGV[1] or redis.call('HGET', KEYS[1], 'uid') ~= ARGV[2] then return 'invalid' end
local index_type = redis.call('TYPE', KEYS[2]).ok
if index_type ~= 'none' and index_type ~= 'set' then return 'unavailable' end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[3])
return 'ok'
"""


def cipher(settings: Settings):
    result = settings.desktop_retry_cipher
    if result is None:
        raise ApiError(503, 'AUTH_SERVICE_UNAVAILABLE')
    return result


def challenge_for(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).rstrip(b'=').decode('ascii')


def active_user(db: Session, uid: str, redis_client, sid: str | None = None) -> User:
    user = db.get(User, int(uid)) if uid.isdecimal() else None
    if user is not None:
        db.refresh(user)
    if user is None or user.status != 1:
        if sid:
            revoke_session(redis_client, sid)
        raise ApiError(401, 'ACCOUNT_DISABLED')
    return user


def encrypt_result(settings: Settings, user: User, credentials, operation: str, request_id: str, fingerprint: str, deadline: int) -> str:
    payload = {
        'operation': operation, 'sid': credentials.sid, 'channel': DESKTOP_CHANNEL,
        'request_id': request_id, 'fingerprint': fingerprint, 'deadline': deadline,
        'uid': str(user.id), 'rhash': hash_secret(credentials.refresh_token.partition('.')[2]),
        'access_token': credentials.access_token, 'refresh_token': credentials.refresh_token,
    }
    return cipher(settings).encrypt(json.dumps(payload).encode()).decode('ascii')


def recover_result(settings: Settings, db: Session, redis_client, encrypted: str, operation: str, request_id: str, fingerprint: str) -> dict:
    try:
        payload = json.loads(cipher(settings).decrypt(encrypted.encode('ascii')))
        if not all((payload['operation'] == operation, payload['channel'] == DESKTOP_CHANNEL,
                    payload['request_id'] == request_id, payload['fingerprint'] == fingerprint,
                    payload['deadline'] > time.time())):
            raise ValueError('binding')
        stored = redis_client.hgetall(session_key(payload['sid']))
        if not stored or stored.get('channel') != DESKTOP_CHANNEL or stored.get('uid') != payload['uid'] or stored.get('rhash') != payload['rhash']:
            raise ValueError('session')
        user = active_user(db, payload['uid'], redis_client, payload['sid'])
        access = jwt.decode(payload['access_token'], settings.jwt_secret, algorithms=[settings.jwt_algorithm], options={'verify_exp': False})
        return {
            'user': UserResponse.model_validate(user).model_dump(mode='json'),
            'access_token': payload['access_token'], 'refresh_token': payload['refresh_token'],
            'expires_in': max(0, int(access['exp'] - time.time())), 'session_protocol': 1,
        }
    except (InvalidToken, ValueError, KeyError, TypeError, jwt.PyJWTError) as error:
        code = 'LOGIN_RESULT_EXPIRED' if operation == 'exchange' else 'SESSION_INVALID'
        raise ApiError(410 if operation == 'exchange' else 401, code) from error


def exchange(scene: str, poll_token: str, verifier: str, request_id: str, settings: Settings, db: Session, redis_client) -> dict:
    cipher(settings)
    key = f'wechat:login:{scene}'
    record = redis_client.hgetall(key)
    if not record:
        raise ApiError(410, 'LOGIN_CHALLENGE_EXPIRED')
    challenge = challenge_for(verifier)
    poll_hash = hash_secret(poll_token)
    if record.get('target_channel') != DESKTOP_CHANNEL or not hmac.compare_digest(record.get('poll_hash', ''), poll_hash) or not hmac.compare_digest(record.get('code_challenge', ''), challenge):
        raise ApiError(401, 'LOGIN_CHALLENGE_INVALID')
    if record.get('state') != 'consumed' and float(record.get('expires_at', 0)) <= time.time():
        raise ApiError(410, 'LOGIN_CHALLENGE_EXPIRED')
    if record.get('state') not in {'confirmed', 'consumed'}:
        raise ApiError(409, 'LOGIN_NOT_CONFIRMED')
    user = active_user(db, record.get('uid', ''), redis_client, record.get('result_sid'))
    credentials = prepare_session(user, settings, channel=DESKTOP_CHANNEL)
    fingerprint = hash_secret(f'{scene}:{poll_hash}:{challenge}')
    deadline = int(time.time()) + RETRY_SECONDS
    encrypted = encrypt_result(settings, user, credentials, 'exchange', request_id, fingerprint, deadline)
    result = redis_client.eval(EXCHANGE_SCRIPT, 3, key, session_key(credentials.sid), user_sessions_key(user.id),
        poll_hash, challenge, request_id, fingerprint, str(user.id), credentials.sid,
        hash_secret(credentials.refresh_token.partition('.')[2]), utc_now().isoformat(), refresh_max_age_seconds(settings), encrypted, deadline)
    if result[0] != 'result':
        status, code = {
            'invalid': (401, 'LOGIN_CHALLENGE_INVALID'), 'expired': (410, 'LOGIN_CHALLENGE_EXPIRED'),
            'not_confirmed': (409, 'LOGIN_NOT_CONFIRMED'), 'conflict': (409, 'LOGIN_EXCHANGE_CONFLICT'),
            'result_expired': (410, 'LOGIN_RESULT_EXPIRED'),
            'unavailable': (503, 'AUTH_SERVICE_UNAVAILABLE'),
        }[result[0]]
        raise ApiError(status, code)
    return recover_result(settings, db, redis_client, result[1], 'exchange', request_id, fingerprint)


def refresh(refresh_token: str, request_id: str, settings: Settings, db: Session, redis_client) -> dict:
    cipher(settings)
    parsed = parse_refresh_token(refresh_token)
    if parsed is None:
        raise ApiError(401, 'SESSION_INVALID')
    sid, secret = parsed
    record = redis_client.hgetall(session_key(sid))
    if not record or record.get('channel') != DESKTOP_CHANNEL:
        raise ApiError(401, 'SESSION_INVALID')
    user = active_user(db, record.get('uid', ''), redis_client, sid)
    credentials = prepare_session(user, settings, channel=DESKTOP_CHANNEL, sid=sid)
    fingerprint = hash_secret(secret)
    deadline = int(time.time()) + RETRY_SECONDS
    encrypted = encrypt_result(settings, user, credentials, 'refresh', request_id, fingerprint, deadline)
    result = redis_client.eval(REFRESH_SCRIPT, 2, session_key(sid), user_sessions_key(user.id),
        str(user.id), fingerprint, request_id, sid, hash_secret(credentials.refresh_token.partition('.')[2]), encrypted, deadline, refresh_max_age_seconds(settings))
    if result[0] != 'result':
        status, code = {'invalid': (401, 'SESSION_INVALID'), 'conflict': (409, 'AUTH_IDEMPOTENCY_CONFLICT'), 'replayed': (401, 'REFRESH_REPLAYED'), 'unavailable': (503, 'AUTH_SERVICE_UNAVAILABLE')}[result[0]]
        raise ApiError(status, code)
    return recover_result(settings, db, redis_client, result[1], 'refresh', request_id, fingerprint)


def logout(refresh_token: str, redis_client) -> None:
    parsed = parse_refresh_token(refresh_token)
    if parsed is None:
        raise ApiError(401, 'SESSION_INVALID')
    sid, secret = parsed
    record = redis_client.hgetall(session_key(sid))
    if not record:
        return
    uid = record.get('uid', '')
    if not uid.isdecimal():
        raise ApiError(401, 'SESSION_INVALID')
    result = redis_client.eval(LOGOUT_SCRIPT, 2, session_key(sid), user_sessions_key(int(uid)), hash_secret(secret), uid, sid)
    if result == 'unavailable':
        raise ApiError(503, 'AUTH_SERVICE_UNAVAILABLE')
    if result != 'ok':
        raise ApiError(401, 'SESSION_INVALID')
