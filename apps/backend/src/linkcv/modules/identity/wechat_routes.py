"""微信小程序扫码登录与账号绑定三接口。

scene 状态机存 Redis，key 形如 ``wechat:login:<scene>``，值 ``pending:<mode>`` /
``confirmed:<uid>:<mode>``，TTL 默认 5 分钟。confirm 用 GETSET 原子地把
``pending:*`` 翻转为 ``confirmed:*``，只有原值仍是 pending 才算成功（防重放：
一个 scene 只能确认一次，二次提交返回 409）。status 命中 confirmed 后发放
会话（仅 login 模式）并删除 scene，防止轮询结束后残留；qrcode 按 IP 轻量限流
（Redis INCR 计数，默认 10 次/分钟）。

设计取舍：方案文档"confirm 成功即删 scene"落实为两段式——confirm 只负责原子
确认（防重放），scene 记录在 status 消费后才删除，否则轮询无法读到确认结果。
"""
from __future__ import annotations

import base64
import logging
import secrets
from typing import Literal

import redis
from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    Query,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from linkcv.core.config import Settings
from linkcv.core.database import get_db, utc_now
from linkcv.core.errors import ApiError
from linkcv.core.redis import get_redis
from linkcv.core.storage import (
    AssetStorage,
    build_avatar_object_name,
    get_storage,
)
from linkcv.integrations.wechat_client import WeChatClient, WeChatUpstreamError
from linkcv.modules.identity.dependencies import get_optional_user, get_settings
from linkcv.modules.identity.models import User
from linkcv.modules.identity.routes import issue_session
from linkcv.modules.identity.schemas import OkResponse, UserResponse

router = APIRouter(prefix="/auth/wechat", tags=["identity"])
logger = logging.getLogger(__name__)

MAX_AVATAR_BYTES = 10 * 1024 * 1024
SUPPORTED_IMAGE_CONTENT_TYPES = {
    "image/apng",
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
WECHAT_MODE = Literal["login", "bind"]


class WeChatQrcodeResponse(BaseModel):
    scene: str
    qr_base64: str


class WeChatStatusResponse(BaseModel):
    status: Literal["pending", "success", "expired"]
    user: UserResponse | None = None


def get_wechat_client(request: Request) -> WeChatClient:
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


def bind_user_or_none(
    mode: WECHAT_MODE = Form(...),
    user: User | None = Depends(get_optional_user),
) -> User | None:
    if mode == "bind" and user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def require_login_for_bind_mode(
    mode: WECHAT_MODE = Body(embed=True),
    user: User | None = Depends(get_optional_user),
) -> str:
    if mode == "bind" and user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return mode


def resolve_wechat_user(
    db: Session,
    wechat_openid: str,
    *,
    nickname: str | None,
    avatar: tuple[bytes, str] | None,
    storage: AssetStorage,
) -> User:
    """按 openid 查用户；不存在则创建微信账号，昵称头像仅建号时写入。"""
    user = db.scalar(select(User).where(User.wechat_openid == wechat_openid))
    if user is not None:
        return user

    user = User(
        wechat_openid=wechat_openid,
        email=None,
        password_hash=None,
        nickname=nickname or f"微信用户{secrets.token_hex(3)}",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # 并发建号竞态：另一请求已插入相同 openid，回读现成账号。
        db.rollback()
        user = db.scalar(select(User).where(User.wechat_openid == wechat_openid))
        if user is None:
            raise ApiError(409, "WECHAT_BIND_CONFLICT")
        return user
    db.refresh(user)

    if avatar is not None:
        data, content_type = avatar
        object_name = build_avatar_object_name(
            str(user.id), "wechat-avatar", content_type
        )
        try:
            storage.upload(object_name, data, content_type)
        except Exception:
            # 头像只是建号的可选项，上传失败不阻塞登录；后续可在设置页补。
            logger.warning("failed to store wechat avatar for user %s", user.id)
        else:
            user.avatar_object_key = object_name
            db.commit()
            db.refresh(user)
    return user


@router.post("/qrcode", response_model=WeChatQrcodeResponse)
async def create_qrcode(
    request: Request,
    mode: str = Depends(require_login_for_bind_mode),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    wechat: WeChatClient = Depends(get_wechat_client),
) -> WeChatQrcodeResponse:
    check_qrcode_rate_limit(client_ip(request), settings, redis_client)

    # scene 编码 mode 前缀（login:/bind:），小程序扫码后可从 options.scene
    # 解析出本次是登录还是绑定；整体长度受微信小程序码 32 字符上限约束。
    scene = f"{mode}:{secrets.token_hex(8)}"
    redis_client.set(
        scene_key(scene),
        f"pending:{mode}",
        ex=settings.wechat_scene_ttl_seconds,
    )

    try:
        image = await wechat.create_wxacode(scene=scene)
    except WeChatUpstreamError as error:
        redis_client.delete(scene_key(scene))
        raise ApiError(error.status_code, error.code) from error
    return WeChatQrcodeResponse(
        scene=scene,
        qr_base64=base64.b64encode(image).decode("ascii"),
    )


@router.get("/status", response_model=WeChatStatusResponse)
def status(
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
    if not uid.isdecimal():
        redis_client.delete(key)
        return WeChatStatusResponse(status="expired")
    user = db.scalar(select(User).where(User.id == int(uid)))
    if user is None or user.status != 1:
        redis_client.delete(key)
        return WeChatStatusResponse(status="expired")

    # 消费结果后立即删除 scene；login 模式发放与邮箱一致的会话。
    redis_client.delete(key)
    if mode == "login":
        issue_session(response, user, settings, redis_client)
    return WeChatStatusResponse(status="success", user=UserResponse.model_validate(user))


@router.post("/confirm", response_model=OkResponse)
async def confirm(
    scene: str = Form(min_length=8, max_length=128),
    code: str = Form(min_length=1, max_length=128),
    mode: WECHAT_MODE = Form(...),
    nickname: str | None = Form(default=None, max_length=50),
    avatar: UploadFile | None = File(default=None),
    bind_user: User | None = Depends(bind_user_or_none),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
    db: Session = Depends(get_db),
    storage: AssetStorage = Depends(get_storage),
    wechat: WeChatClient = Depends(get_wechat_client),
) -> OkResponse:
    key = scene_key(scene)
    if mode == "bind" and bind_user is not None and bind_user.wechat_openid is not None:
        raise ApiError(409, "WECHAT_ALREADY_BOUND")
    # 防重放抢占：GETSET 原子地把 pending:<mode> 翻转为 claimed，原值必须是
    # 匹配的 pending 才算抢占成功；一次抢占后重复提交返回 409。
    previous = redis_client.getset(key, "claimed")
    if previous is None:
        raise ApiError(410, "SCENE_EXPIRED")
    if not previous.startswith("pending:") or previous.split(":", 1)[1] != mode:
        redis_client.delete(key)
        raise ApiError(409, "SCENE_REUSED")

    try:
        wechat_session = await wechat.code2_session(code=code)
    except WeChatUpstreamError as error:
        redis_client.delete(key)
        raise ApiError(error.status_code, error.code) from error

    avatar_payload = None
    if avatar is not None:
        data = avatar.file.read()
        content_type = (avatar.content_type or "").lower()
        if content_type not in SUPPORTED_IMAGE_CONTENT_TYPES:
            redis_client.delete(key)
            raise ApiError(400, "INVALID_AVATAR")
        if len(data) > MAX_AVATAR_BYTES:
            redis_client.delete(key)
            raise ApiError(413, "IMAGE_TOO_LARGE")
        avatar_payload = (data, content_type)

    if mode == "login":
        user = resolve_wechat_user(
            db,
            wechat_session.openid,
            nickname=nickname,
            avatar=avatar_payload,
            storage=storage,
        )
        user.last_login_at = utc_now()
        db.commit()
        db.refresh(user)
        # 结果写回 scene 供 status 轮询消费；会话由 status 按 login 模式发放。
        redis_client.set(
            key,
            f"confirmed:{user.id}:{mode}",
            ex=settings.wechat_scene_ttl_seconds,
        )
        return OkResponse(ok=True)

    assert bind_user is not None
    existing = db.scalar(
        select(User.id).where(
            User.wechat_openid == wechat_session.openid, User.id != bind_user.id
        )
    )
    if existing is not None:
        redis_client.delete(key)
        raise ApiError(409, "WECHAT_BIND_CONFLICT")
    bind_user.wechat_openid = wechat_session.openid
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        redis_client.delete(key)
        raise ApiError(409, "WECHAT_BIND_CONFLICT") from error
    redis_client.set(
        key,
        f"confirmed:{bind_user.id}:{mode}",
        ex=settings.wechat_scene_ttl_seconds,
    )
    return OkResponse(ok=True)
