"""微信小程序身份接口与网页扫码登录状态机。"""

from __future__ import annotations

import base64
import hmac
import logging
import secrets

import redis
from fastapi import APIRouter, Depends, Form, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.core.security import (
    access_max_age_seconds,
    hash_secret,
    set_access_cookie,
    set_refresh_cookie,
)
from linkcv.integrations.wechat_client import WechatApiError, WechatClient
from linkcv.modules.identity.dependencies import get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.schemas import OkResponse, UserResponse
from linkcv.modules.identity.session_service import (
    MINIPROGRAM_CHANNEL,
    WEB_CHANNEL,
    issue_session,
    revoke_refresh_token,
    revoke_session,
    rotate_session,
)

router = APIRouter(prefix="/auth/wechat", tags=["identity"])
logger = logging.getLogger(__name__)
SCENE_CLAIM_TIMEOUT_SECONDS = 30

CLAIM_SCENE_SCRIPT = """-- wechat_claim
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'missing' end
local claimed_at = tonumber(redis.call('HGET', KEYS[1], 'claimed_at') or '0')
local stale = state == 'processing' and tonumber(ARGV[2]) - claimed_at >= tonumber(ARGV[4])
if state == 'pending' or stale then
  redis.call('HSET', KEYS[1], 'state', 'processing', 'claim_id', ARGV[1], 'claimed_at', ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return 'claimed'
end
return state
"""

FINALIZE_SCENE_SCRIPT = """-- wechat_finalize
if redis.call('HGET', KEYS[1], 'state') ~= 'processing' then return 0 end
if redis.call('HGET', KEYS[1], 'claim_id') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', ARGV[2], 'uid', ARGV[3])
redis.call('HDEL', KEYS[1], 'claim_id', 'claimed_at')
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
"""

RESTORE_SCENE_SCRIPT = """-- wechat_restore
if redis.call('HGET', KEYS[1], 'state') ~= 'processing' then return 0 end
if redis.call('HGET', KEYS[1], 'claim_id') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'pending')
redis.call('HDEL', KEYS[1], 'claim_id', 'claimed_at')
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"""

CANCEL_SCENE_SCRIPT = """-- wechat_cancel
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return 'missing' end
if state == 'pending' then
  redis.call('HSET', KEYS[1], 'state', 'cancelled')
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return 'cancelled'
end
return state
"""

SWAP_WEB_SESSION_SCRIPT = """-- wechat_swap_web_session
if redis.call('HGET', KEYS[1], 'state') ~= 'confirmed' then return '__invalid__' end
if redis.call('HGET', KEYS[1], 'uid') ~= ARGV[1] then return '__invalid__' end
local previous = redis.call('HGET', KEYS[1], 'web_sid') or ''
redis.call('HSET', KEYS[1], 'web_sid', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return previous
"""


class WeChatQrcodeResponse(BaseModel):
    scene: str
    poll_token: str
    qr_base64: str


class WeChatStatusResponse(BaseModel):
    status: str
    user: UserResponse | None = None


class CancelResponse(BaseModel):
    ok: bool
    status: str


class MiniProgramLoginRequest(BaseModel):
    code: str = Field(min_length=1, max_length=128)
    privacy_accepted: bool = False


class MiniProgramAccountStatusRequest(BaseModel):
    code: str = Field(min_length=1, max_length=128)


class MiniProgramAccountStatusResponse(BaseModel):
    registered: bool


class MiniProgramRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class MiniProgramLogoutRequest(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=512)


class MiniProgramAuthResponse(BaseModel):
    user: UserResponse
    access_token: str
    refresh_token: str
    expires_in: int


def get_wechat_client(request: Request) -> WechatClient:
    return request.app.state.wechat_client


def scene_key(scene: str) -> str:
    return f"wechat:login:{scene}"


def qrcode_rate_limit_key(ip: str) -> str:
    return f"wechat:qrcode:{ip}"


def login_rate_limit_key(ip: str) -> str:
    return f"wechat:miniprogram_login:{ip}"


def client_ip(request: Request) -> str:
    # Uvicorn/Starlette resolves trusted proxy headers into request.client.
    # Reading X-Forwarded-For here would let direct clients spoof rate-limit keys.
    return request.client.host if request.client else "unknown"


def check_qrcode_rate_limit(
    ip: str,
    settings: Settings,
    redis_client: "redis.Redis",
) -> None:
    key = qrcode_rate_limit_key(ip)
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 60)
    if count > settings.wechat_qrcode_requests_per_minute:
        raise ApiError(429, "WECHAT_RATE_LIMITED")


def check_miniprogram_login_rate_limit(
    ip: str,
    settings: Settings,
    redis_client: "redis.Redis",
) -> None:
    key = login_rate_limit_key(ip)
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 60)
    if count > settings.wechat_login_requests_per_minute:
        raise ApiError(429, "WECHAT_RATE_LIMITED")


def resolve_wechat_user(
    db: Session,
    wechat_openid: str,
    *,
    allow_registration: bool,
) -> User:
    user = db.scalar(select(User).where(User.wechat_openid == wechat_openid))
    if user is not None:
        return user
    if not allow_registration:
        raise ApiError(400, "PRIVACY_AGREEMENT_REQUIRED")
    user = User(
        wechat_openid=wechat_openid,
        email=None,
        password_hash=None,
        nickname=f"微信用户{secrets.token_hex(3)}",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user = db.scalar(select(User).where(User.wechat_openid == wechat_openid))
        if user is None:
            raise ApiError(409, "WECHAT_IDENTITY_CONFLICT") from None
        return user
    db.refresh(user)
    return user


def exchange_openid(wechat: WechatClient, code: str) -> str:
    try:
        return wechat.code_to_openid(code)
    except WechatApiError as error:
        if error.code == "WECHAT_CODE_EXCHANGE_FAILED":
            raise ApiError(400, "WECHAT_CODE_INVALID") from error
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from error


def mini_auth_response(user: User, credentials, settings: Settings) -> MiniProgramAuthResponse:
    return MiniProgramAuthResponse(
        user=UserResponse.model_validate(user),
        access_token=credentials.access_token,
        refresh_token=credentials.refresh_token,
        expires_in=access_max_age_seconds(settings),
    )


@router.post("/qrcode", response_model=WeChatQrcodeResponse)
def create_login_qrcode(
    request: Request,
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    wechat: WechatClient = Depends(get_wechat_client),
) -> WeChatQrcodeResponse:
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
    check_qrcode_rate_limit(client_ip(request), settings, redis_client)
    scene = f"login:{secrets.token_hex(8)}"
    poll_token = secrets.token_urlsafe(24)
    key = scene_key(scene)
    redis_client.hset(
        key,
        mapping={
            "state": "pending",
            "created_at": utc_now().isoformat(),
            "poll_hash": hash_secret(poll_token),
        },
    )
    redis_client.expire(key, settings.wechat_scene_ttl_seconds)
    try:
        image = wechat.mini_program_qrcode(scene, for_login=True)
    except WechatApiError as error:
        redis_client.delete(key)
        if error.code == "WECHAT_RATE_LIMITED":
            raise ApiError(429, "WECHAT_RATE_LIMITED") from error
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from error
    return WeChatQrcodeResponse(
        scene=scene,
        poll_token=poll_token,
        qr_base64=base64.b64encode(image).decode("ascii"),
    )


@router.get("/status", response_model=WeChatStatusResponse)
def login_status(
    response: Response,
    scene: str = Query(min_length=8, max_length=128),
    poll_token: str | None = Query(default=None, min_length=1, max_length=128),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
) -> WeChatStatusResponse:
    key = scene_key(scene)
    state = redis_client.hget(key, "state")
    if state is None:
        return WeChatStatusResponse(status="expired")
    if state in {"pending", "processing"}:
        return WeChatStatusResponse(status="pending")
    if state == "cancelled":
        return WeChatStatusResponse(status="cancelled")
    if state != "confirmed":
        redis_client.delete(key)
        return WeChatStatusResponse(status="expired")
    expected_poll_hash = redis_client.hget(key, "poll_hash") or ""
    supplied_poll_hash = hash_secret(poll_token) if poll_token else ""
    if not expected_poll_hash or not hmac.compare_digest(
        expected_poll_hash, supplied_poll_hash
    ):
        # The mini program shares the scene so it can display state, but only the
        # Web page that created the QR code may consume or replace its session.
        return WeChatStatusResponse(status="success")
    uid = redis_client.hget(key, "uid") or ""
    if not uid.isdecimal():
        redis_client.delete(key)
        return WeChatStatusResponse(status="expired")
    user = db.scalar(select(User).where(User.id == int(uid)))
    if user is None or user.status != 1 or user.is_admin:
        redis_client.delete(key)
        return WeChatStatusResponse(status="expired")

    credentials = issue_session(user, settings, redis_client, channel=WEB_CHANNEL)
    previous_sid = redis_client.eval(
        SWAP_WEB_SESSION_SCRIPT,
        1,
        key,
        uid,
        credentials.sid,
        settings.wechat_scene_ttl_seconds,
    )
    if previous_sid == "__invalid__":
        revoke_session(redis_client, credentials.sid, user.id)
        return WeChatStatusResponse(status="expired")
    if previous_sid:
        revoke_session(redis_client, previous_sid, user.id)
    set_access_cookie(response, credentials.access_token, settings)
    set_refresh_cookie(response, credentials.refresh_token, settings)
    return WeChatStatusResponse(
        status="success", user=UserResponse.model_validate(user)
    )


@router.post("/confirm", response_model=OkResponse)
def confirm_login(
    scene: str = Form(min_length=8, max_length=128),
    code: str = Form(min_length=1, max_length=128),
    privacy_accepted: bool = Form(default=False),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
    wechat: WechatClient = Depends(get_wechat_client),
) -> OkResponse:
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
    key = scene_key(scene)
    claim_id = secrets.token_urlsafe(16)
    claimed = redis_client.eval(
        CLAIM_SCENE_SCRIPT,
        1,
        key,
        claim_id,
        int(utc_now().timestamp()),
        settings.wechat_scene_ttl_seconds,
        SCENE_CLAIM_TIMEOUT_SECONDS,
    )
    if claimed == "missing":
        raise ApiError(410, "SCENE_EXPIRED")
    if claimed == "confirmed":
        return OkResponse(ok=True)
    if claimed == "cancelled":
        raise ApiError(409, "SCENE_CANCELLED")
    if claimed in {"processing", "claimed"} and claimed != "claimed":
        raise ApiError(409, "SCENE_IN_PROGRESS")
    if claimed != "claimed":
        raise ApiError(409, "SCENE_CONFLICT")

    try:
        openid = exchange_openid(wechat, code)
    except ApiError:
        redis_client.eval(
            RESTORE_SCENE_SCRIPT,
            1,
            key,
            claim_id,
            settings.wechat_scene_ttl_seconds,
        )
        raise
    try:
        user = resolve_wechat_user(
            db,
            openid,
            allow_registration=privacy_accepted,
        )
    except Exception:
        redis_client.eval(
            RESTORE_SCENE_SCRIPT,
            1,
            key,
            claim_id,
            settings.wechat_scene_ttl_seconds,
        )
        raise
    if user.status != 1 or user.is_admin:
        redis_client.eval(
            FINALIZE_SCENE_SCRIPT,
            1,
            key,
            claim_id,
            "cancelled",
            str(user.id),
            settings.wechat_scene_ttl_seconds,
        )
        error_code = (
            "ACCOUNT_DISABLED"
            if user.status != 1
            else "ADMIN_WECHAT_LOGIN_FORBIDDEN"
        )
        raise ApiError(401, error_code)
    try:
        user.last_login_at = utc_now()
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()
        redis_client.eval(
            RESTORE_SCENE_SCRIPT,
            1,
            key,
            claim_id,
            settings.wechat_scene_ttl_seconds,
        )
        raise
    finalized = redis_client.eval(
        FINALIZE_SCENE_SCRIPT,
        1,
        key,
        claim_id,
        "confirmed",
        str(user.id),
        settings.wechat_scene_ttl_seconds,
    )
    if not finalized:
        raise ApiError(409, "SCENE_CONFLICT")
    return OkResponse(ok=True)


@router.post("/cancel", response_model=CancelResponse)
def cancel_login(
    scene: str = Form(min_length=8, max_length=128),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> CancelResponse:
    state = redis_client.eval(
        CANCEL_SCENE_SCRIPT,
        1,
        scene_key(scene),
        settings.wechat_scene_ttl_seconds,
    )
    if state == "missing":
        raise ApiError(410, "SCENE_EXPIRED")
    if state == "confirmed":
        raise ApiError(409, "SCENE_CONFIRMED")
    if state == "processing":
        raise ApiError(409, "SCENE_IN_PROGRESS")
    if state != "cancelled":
        raise ApiError(409, "SCENE_CONFLICT")
    return CancelResponse(ok=True, status="cancelled")


@router.post("/miniprogram/login", response_model=MiniProgramAuthResponse)
def miniprogram_login(
    payload: MiniProgramLoginRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
    wechat: WechatClient = Depends(get_wechat_client),
) -> MiniProgramAuthResponse:
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
    check_miniprogram_login_rate_limit(
        client_ip(request), settings, redis_client
    )
    user = resolve_wechat_user(
        db,
        exchange_openid(wechat, payload.code),
        allow_registration=payload.privacy_accepted,
    )
    if user.status != 1:
        raise ApiError(401, "ACCOUNT_DISABLED")
    if user.is_admin:
        raise ApiError(403, "ADMIN_WECHAT_LOGIN_FORBIDDEN")
    user.last_login_at = utc_now()
    db.commit()
    db.refresh(user)
    credentials = issue_session(
        user, settings, redis_client, channel=MINIPROGRAM_CHANNEL
    )
    return mini_auth_response(user, credentials, settings)


@router.post(
    "/miniprogram/account-status",
    response_model=MiniProgramAccountStatusResponse,
)
def miniprogram_account_status(
    payload: MiniProgramAccountStatusRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
    wechat: WechatClient = Depends(get_wechat_client),
) -> MiniProgramAccountStatusResponse:
    """判断当前微信身份是否已有关联账号，不创建账号或签发会话。"""
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
    check_miniprogram_login_rate_limit(
        client_ip(request), settings, redis_client
    )
    openid = exchange_openid(wechat, payload.code)
    registered = db.scalar(
        select(User.id).where(User.wechat_openid == openid)
    ) is not None
    return MiniProgramAccountStatusResponse(registered=registered)


@router.post("/miniprogram/refresh", response_model=MiniProgramAuthResponse)
def miniprogram_refresh(
    payload: MiniProgramRefreshRequest,
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
) -> MiniProgramAuthResponse:
    rotated = rotate_session(
        payload.refresh_token,
        MINIPROGRAM_CHANNEL,
        db,
        settings,
        redis_client,
    )
    if rotated is None:
        raise ApiError(401, "INVALID_CREDENTIALS")
    user, credentials = rotated
    return mini_auth_response(user, credentials, settings)


@router.post("/miniprogram/logout", response_model=OkResponse)
def miniprogram_logout(
    payload: MiniProgramLogoutRequest,
    redis_client: "redis.Redis" = Depends(get_redis),
) -> OkResponse:
    revoke_refresh_token(
        redis_client,
        payload.refresh_token,
        expected_channel=MINIPROGRAM_CHANNEL,
    )
    return OkResponse(ok=True)
