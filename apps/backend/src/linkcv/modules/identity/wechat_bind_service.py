"""用户中心微信绑定票据：生成、校验与状态维护。

票据是 Web 已登录用户发起绑定的临时凭证，生命周期由 Redis TTL 控制；
同一用户同时只保留一个有效票据，重新发起时覆盖旧票据。
"""

from __future__ import annotations

import json
import secrets
from typing import Any

BIND_TICKET_PREFIX = "wechat:bind_ticket:"
BIND_STATUS_PREFIX = "wechat:bind_status:"
USER_TICKET_PREFIX = "wechat:bind_user_ticket:"


def new_bind_ticket(redis_client: Any, user_id: int, ttl_seconds: int) -> str:
    """为已登录用户生成绑定票据，作废并覆盖该用户的旧票据。"""
    old_ticket = redis_client.get(f"{USER_TICKET_PREFIX}{user_id}")
    if old_ticket:
        redis_client.delete(f"{BIND_TICKET_PREFIX}{old_ticket}")
        redis_client.delete(f"{BIND_STATUS_PREFIX}{old_ticket}")
    ticket = secrets.token_urlsafe(24)
    redis_client.set(
        f"{BIND_TICKET_PREFIX}{ticket}",
        json.dumps({"user_id": str(user_id)}),
        ex=ttl_seconds,
    )
    redis_client.set(f"{BIND_STATUS_PREFIX}{ticket}", "pending", ex=ttl_seconds)
    redis_client.set(f"{USER_TICKET_PREFIX}{user_id}", ticket, ex=ttl_seconds)
    return ticket


def bind_ticket_user(redis_client: Any, ticket: str) -> int | None:
    """返回票据关联的用户 id；票据不存在或已过期时返回 None。"""
    raw = redis_client.get(f"{BIND_TICKET_PREFIX}{ticket}")
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        user_id = int(payload["user_id"])
    except (ValueError, TypeError, KeyError) as error:
        raise ValueError("invalid bind ticket payload") from error
    if user_id <= 0:
        raise ValueError("invalid bind ticket payload")
    return user_id


def bind_status(redis_client: Any, ticket: str) -> str:
    """返回票据状态：pending / bound / expired。"""
    status = redis_client.get(f"{BIND_STATUS_PREFIX}{ticket}")
    return status if status in {"pending", "bound"} else "expired"


def mark_bind_success(redis_client: Any, ticket: str, ttl_seconds: int) -> None:
    redis_client.set(f"{BIND_STATUS_PREFIX}{ticket}", "bound", ex=ttl_seconds)
