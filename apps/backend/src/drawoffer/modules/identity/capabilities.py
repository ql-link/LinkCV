"""Ordinary-user identity policy. Administrator login is a separate surface."""
from drawoffer.core.config import Settings
from drawoffer.core.errors import ApiError


def password_login_enabled(settings: Settings) -> bool:
    return settings.app_environment.strip().lower() in {"local", "development"}


def wechat_login_enabled(settings: Settings) -> bool:
    return settings.app_environment.strip().lower() == "production" and settings.wechat_enabled


def require_password_enabled(settings: Settings) -> None:
    if not password_login_enabled(settings):
        raise ApiError(404, "NOT_FOUND")


def require_wechat_enabled(settings: Settings) -> None:
    if settings.app_environment.strip().lower() != "production":
        raise ApiError(404, "NOT_FOUND")
    if not settings.wechat_enabled:
        raise ApiError(503, "WECHAT_SERVICE_UNAVAILABLE")
