from dataclasses import dataclass
import re

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

import redis

from linkresume.core.config import Settings
from linkresume.core.database import get_db
from linkresume.core.errors import ApiError
from linkresume.core.redis import get_redis
from linkresume.core.security import decode_access_token, session_key
from linkresume.modules.identity.models import User
from linkresume.modules.identity.capabilities import wechat_login_enabled
from linkresume.modules.identity.session_service import MINIPROGRAM_CHANNEL, WEB_CHANNEL
from linkresume.modules.observability.audit import bind_audit_actor


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


@dataclass(frozen=True)
class AuthenticationContext:
    user: User
    sid: str
    channel: str


def _load_context(
    token: str | None,
    expected_channel: str,
    request: Request,
    db: Session,
    settings: Settings,
    redis_client: "redis.Redis",
) -> AuthenticationContext | None:
    decoded = decode_access_token(token, settings)
    if decoded is None:
        return None
    user_id, sid, channel = decoded
    if channel != expected_channel:
        return None
    session = redis_client.hgetall(session_key(sid))
    session_channel = session.get("channel") or WEB_CHANNEL
    if not session or session.get("uid") != str(user_id) or session_channel != channel:
        return None
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None or user.status != 1 or user.deletion_requested_at is not None:
        return None
    request.state.session_id = sid
    bind_audit_actor(request, user.id, is_admin=bool(user.is_admin))
    request.state.auth_channel = channel
    return AuthenticationContext(user, sid, channel)


def _load_user(token, expected_channel, request, db, settings, redis_client) -> User | None:
    context = _load_context(token, expected_channel, request, db, settings, redis_client)
    return context.user if context else None


def get_current_desktop_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User:
    if _has_auth_cookie(request, settings):
        raise ApiError(401, "SESSION_INVALID")
    try:
        user = _load_user(_bearer_token(request), "desktop", request, db, settings, redis_client)
    except redis.RedisError as error:
        raise ApiError(503, "AUTH_SERVICE_UNAVAILABLE") from error
    if user is None:
        raise ApiError(401, "SESSION_INVALID")
    return user


def _has_auth_cookie(request: Request, settings: Settings) -> bool:
    return any(name in request.cookies for name in (
        settings.access_cookie_name, settings.refresh_cookie_name, settings.session_cookie_name,
    ))


def get_current_workspace_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User:
    if request.headers.get("authorization") is not None:
        return get_current_desktop_user(request, db, settings, redis_client)
    user = _load_user(request.cookies.get(settings.access_cookie_name), WEB_CHANNEL, request, db, settings, redis_client)
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_career_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User:
    """Desktop career surface, including stage records, recordings and AI review."""
    if request.headers.get("authorization") is None:
        return get_current_user(get_optional_user(request, db, settings, redis_client))
    path, method = request.url.path, request.method
    session = r"/api/interview-sessions/[0-9]+"
    allowed = (
        method == "GET" and path in {"/api/interview-overview", "/api/job-applications", "/api/interview-sessions", "/api/job-descriptions"}
        or method in {"GET", "PUT", "DELETE"} and re.fullmatch(r"/api/(?:job-applications|job-descriptions)/[0-9]+", path)
        or method == "POST" and path in {"/api/job-descriptions", "/api/job-descriptions/parse-draft", "/api/job-applications"}
        or method == "POST" and re.fullmatch(r"/api/job-applications/[0-9]+/(?:stages|terminate|offer|close|archive|restore|interview-sessions)", path)
        or method == "GET" and re.fullmatch(r"/api/job-descriptions/[0-9]+/logo", path)
        or method in {"GET", "PUT"} and re.fullmatch(r"/api/interview-sessions/[0-9]+", path)
        or method == "POST" and re.fullmatch(r"/api/interview-sessions/[0-9]+/(?:complete|cancel|reschedule)", path)
        or method == "PUT" and re.fullmatch(r"/api/interview-sessions/[0-9]+/answer-plan", path)
        # Stage detail: delete, recordings, transcription, review notes and AI review.
        or method == "DELETE" and re.fullmatch(session, path)
        or method in {"GET", "POST"} and re.fullmatch(session + r"/assets", path)
        or method == "GET" and re.fullmatch(r"/api/interview-assets/[0-9]+/content", path)
        or method == "POST" and re.fullmatch(session + r"/transcriptions/[0-9]+:(?:retry|apply)", path)
        or method == "POST" and re.fullmatch(session + r"/(?:written-questions:extract|review:generate)", path)
        or method == "PUT" and re.fullmatch(session + r"/review-notes", path)
        or method == "DELETE" and re.fullmatch(session + r"/review-notes/[0-9]+", path)
    )
    if not allowed:
        raise ApiError(403, "DESKTOP_ROUTE_FORBIDDEN")
    return get_current_desktop_user(request, db, settings, redis_client)


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization")
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value or " " in value:
        return None
    return value


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User | None:
    # Existing Web routes accept only HttpOnly cookies. Supplying Authorization
    # never upgrades a mini-program session into the full Web user surface.
    if request.headers.get("authorization"):
        return None
    return _load_user(
        request.cookies.get(settings.access_cookie_name),
        WEB_CHANNEL,
        request,
        db,
        settings,
        redis_client,
    )


def get_optional_miniprogram_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User | None:
    if not wechat_login_enabled(settings):
        return None
    if request.cookies.get(settings.access_cookie_name):
        return None
    return _load_user(
        _bearer_token(request),
        MINIPROGRAM_CHANNEL,
        request,
        db,
        settings,
        redis_client,
    )


def lock_active_user(db: Session, user_id: int) -> User:
    """Take the owner lock before any personal resource lock or write."""
    user = db.scalar(
        select(User).where(User.id == user_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or user.status != 1 or user.deletion_requested_at is not None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_miniprogram_user(
    user: User | None = Depends(get_optional_miniprogram_user),
) -> User:
    if user is None:
        raise ApiError(401, "UNAUTHORIZED")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise ApiError(403, "FORBIDDEN")
    return user


def get_current_mock_interview_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User:
    """Native text-interview surface. No recording, speech or dataset mutation access."""
    if request.headers.get("authorization") is None:
        return get_current_user(get_optional_user(request, db, settings, redis_client))
    path, method = request.url.path, request.method
    identifier = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    allowed = (
        method in {"GET", "POST"} and path == "/api/mock-interviews"
        or method == "GET" and path == "/api/datasets"
        or method in {"GET", "DELETE"} and re.fullmatch(r"/api/mock-interviews/" + identifier, path)
        or method == "POST" and re.fullmatch(
            r"/api/mock-interviews/" + identifier + r"/(?:answers|skip|reply:retry|finish|abandon|retry|repeat)", path
        )
    )
    if not allowed:
        raise ApiError(403, "DESKTOP_SCOPE_FORBIDDEN")
    return get_current_desktop_user(request, db, settings, redis_client)


def get_current_dataset_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    redis_client: "redis.Redis" = Depends(get_redis),
) -> User:
    """Native library uses the existing owned dataset/folder services."""
    if request.headers.get("authorization") is None:
        return get_current_user(get_optional_user(request, db, settings, redis_client))
    path, method = request.url.path, request.method
    number = r"[1-9][0-9]*"
    allowed = (
        path == "/api/datasets" and method in {"GET", "POST"}
        or path == "/api/datasets/folders" and method in {"GET", "POST"}
        or path == "/api/datasets/move-batch" and method == "POST"
        or re.fullmatch(r"/api/datasets/folders/" + number, path) and method in {"PATCH", "DELETE"}
        or re.fullmatch(r"/api/datasets/" + number, path) and method in {"GET", "PATCH", "DELETE"}
        or re.fullmatch(r"/api/datasets/" + number + r"/(?:content|source)", path) and method == "GET"
        or re.fullmatch(r"/api/datasets/" + number + r"/retry", path) and method == "POST"
        or re.fullmatch(r"/api/datasets/" + number + r"/folder", path) and method == "PATCH"
        or re.fullmatch(r"/api/datasets/" + number + r"/file", path) and method == "PUT"
        or re.fullmatch(r"/api/interview-sessions/" + number + r"/assets/attach", path) and method == "POST"
        or re.fullmatch(r"/api/interview-sessions/" + number + r"/assets/" + number, path) and method == "DELETE"
    )
    if not allowed:
        raise ApiError(403, "DESKTOP_SCOPE_FORBIDDEN")
    return get_current_desktop_user(request, db, settings, redis_client)
