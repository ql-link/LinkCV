import secrets

from fastapi import Header, Request

from linkcv.core.errors import ApiError


def _bearer_token(authorization: str | None) -> str | None:
    scheme, separator, value = (authorization or "").partition(" ")
    if not separator or scheme.lower() != "bearer" or not value:
        return None
    return value


def require_pi_service(
    request: Request, authorization: str | None = Header(default=None)
) -> None:
    configured = request.app.state.settings.linkcv_internal_agent_token
    expected = configured.get_secret_value() if configured is not None else ""
    actual = _bearer_token(authorization) or ""
    if not expected or not secrets.compare_digest(actual, expected):
        raise ApiError(401, "AGENT_SERVICE_UNAUTHORIZED")
