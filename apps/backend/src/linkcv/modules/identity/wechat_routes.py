"""微信小程序扫码登录接口（scene 状态机）。

仅服务扫码登录（mode=login）：Web 端请求 /qrcode 生成小程序码，
小程序端扫码确认后 POST /confirm 提交临时 code，Web 端轮询 /status
感知成功并发放会话。绑定走 /api/account/wechat/bind-*（ticket 票据）。

scene 状态机存 Redis，key 形如 ``wechat:login:<scene>``，值
``pending:login`` / ``confirmed:<uid>:login``，TTL 默认 5 分钟。
confirm 用 GETSET 原子地把 ``pending:*`` 翻转为 ``claimed``，只有原值
仍是 pending 才算成功（防重放：一个 scene 只能确认一次，二次提交返回
409）。status 命中 confirmed 后发放会话并删除 scene，防止轮询结束后
残留；qrcode 按 IP 轻量限流（Redis INCR 计数，默认 10 次/分钟）。
"""
from __future__ import annotations

import base64
import logging
import secrets

import redis
from fastapi import APIRouter, Depends, Form, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.integrations.wechat_client import WechatApiError, WechatClient
from linkcv.modules.identity.dependencies import get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.routes import issue_session
from linkcv.modules.identity.schemas import OkResponse, UserResponse

router = APIRouter(prefix="/auth/wechat", tags=["identity"])
logger = logging.getLogger(__name__)


class WeChatQrcodeResponse(BaseModel):
    scene: str
    qr_base64: str


class WeChatStatusResponse(BaseModel):
    status: str
    user: UserResponse | None = None


def get_wechat_client(request: Request) -> WechatClient:
    return request.app.state.wechat_client


def scene_key(scene: str) -> str:
    return f"wechat:login:{scene}"


def qrcode_rate_limit_key(ip: str) -> str:
    return f"wechat:qrcode:{ip}"


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
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


def resolve_wechat_user(db: Session, wechat_openid: str) -> User:
    """按 openid 查用户；不存在则创建微信账号（无邮箱密码）。"""
    user = db.scalar(select(User).where(User.wechat_openid == wechat_openid))
    if user is not None:
        return user

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
        # 并发建号竞态：另一请求已插入相同 openid，回读现成账号。
        db.rollback()
        user = db.scalar(select(User).where(User.wechat_openid == wechat_openid))
        if user is None:
            raise ApiError(409, "WECHAT_BIND_CONFLICT") from None
        return user
    db.refresh(user)
    return user


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

    # scene 前缀 login: 供小程序解析确认页模式；整体长度受微信 32 字符上限约束。
    scene = f"login:{secrets.token_hex(8)}"
    redis_client.set(
        scene_key(scene),
        "pending:login",
        ex=settings.wechat_scene_ttl_seconds,
    )

    try:
        image = wechat.mini_program_qrcode(scene, for_login=True)
    except WechatApiError as error:
        redis_client.delete(scene_key(scene))
        if error.code == "WECHAT_RATE_LIMITED":
            raise ApiError(429, "WECHAT_RATE_LIMITED") from error
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from error
    return WeChatQrcodeResponse(
        scene=scene,
        qr_base64=base64.b64encode(image).decode("ascii"),
    )


@router.get("/status", response_model=WeChatStatusResponse)
def login_status(
    response: Response,
    scene: str = Query(min_length=8, max_length=128),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
) -> WeChatStatusResponse:
    key = scene_key(scene)
    state = redis_client.get(key)
    if state is None:
        return WeChatStatusResponse(status="expired")
    if state.startswith("pending:") or state == "claimed":
        return WeChatStatusResponse(status="pending")
    if not state.startswith("confirmed:"):
        return WeChatStatusResponse(status="expired")

    _, uid, mode = state.split(":", 2)
    if mode != "login" or not uid.isdecimal():
        redis_client.delete(key)
        return WeChatStatusResponse(status="expired")
    user = db.scalar(select(User).where(User.id == int(uid)))
    if user is None or user.status != 1:
        redis_client.delete(key)
        return WeChatStatusResponse(status="expired")

    # 消费结果后立即删除 scene 并发放会话。
    redis_client.delete(key)
    issue_session(response, user, settings, redis_client)
    return WeChatStatusResponse(status="success", user=UserResponse.model_validate(user))


@router.post("/confirm", response_model=OkResponse)
def confirm_login(
    scene: str = Form(min_length=8, max_length=128),
    code: str = Form(min_length=1, max_length=128),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
    wechat: WechatClient = Depends(get_wechat_client),
) -> OkResponse:
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
    key = scene_key(scene)
    # 防重放抢占：GETSET 原子地把 pending:login 翻转为 claimed，原值必须是
    # 匹配的 pending 才算抢占成功；一次抢占后重复提交返回 409。
    previous = redis_client.getset(key, "claimed")
    if previous is None:
        raise ApiError(410, "SCENE_EXPIRED")
    if previous != "pending:login":
        redis_client.delete(key)
        raise ApiError(409, "SCENE_REUSED")

    try:
        openid = wechat.code_to_openid(code)
    except WechatApiError as error:
        redis_client.delete(key)
        if error.code == "WECHAT_CODE_EXCHANGE_FAILED":
            raise ApiError(400, "WECHAT_CODE_INVALID") from error
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE") from error

    user = resolve_wechat_user(db, openid)
    user.last_login_at = utc_now()
    db.commit()
    db.refresh(user)
    # 结果写回 scene 供 status 轮询消费；会话由 status 按 login 模式发放。
    redis_client.set(
        key,
        f"confirmed:{user.id}:login",
        ex=settings.wechat_scene_ttl_seconds,
    )
    return OkResponse(ok=True)
