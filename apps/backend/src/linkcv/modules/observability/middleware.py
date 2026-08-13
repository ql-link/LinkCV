from __future__ import annotations

import time
from uuid import uuid4

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from linkcv.modules.observability.audit import (
    audit_action_for,
    audit_target_id,
    canonical_route_path,
)
from linkcv.modules.observability.context import (
    reset_request_id,
    set_request_id,
    valid_request_id,
)
from linkcv.modules.observability.logging import (
    StructuredLogEmitter,
    dependency_for_exception,
    emergency_log,
    exception_fields,
)


class ObservabilityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, emitter: StructuredLogEmitter) -> None:
        super().__init__(app)
        self.emitter = emitter

    @staticmethod
    def _route(request: Request) -> str:
        return canonical_route_path(request)

    def _write_audit(
        self,
        request: Request,
        *,
        result: str,
        error_code: str | None,
    ) -> bool | None:
        action = audit_action_for(request)
        if action is None:
            return None
        actor_id = getattr(request.state, "actor_user_id", None)
        actor_type = getattr(request.state, "actor_type", "anonymous")
        try:
            recorded, _event_id = self.emitter.audit(
                action=action.action,
                actor_user_id=actor_id,
                actor_type=actor_type,
                target_type=action.target_type,
                target_id=audit_target_id(request, action),
                result=result,
                error_code=error_code,
                http_method=request.method,
                http_route=self._route(request),
                operation_id=getattr(request.state, "operation_id", None),
            )
            return recorded
        except Exception as sink_error:
            emergency_log(
                f"audit sink failed: {type(sink_error).__name__}"
            )
            return False

    def _write_system(self, level: str, message: str, **fields: object) -> bool:
        try:
            return self.emitter.system(level, message, **fields)
        except Exception as sink_error:
            emergency_log(
                f"system log sink failed: {type(sink_error).__name__}"
            )
            return False

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        supplied = request.headers.get("X-Request-ID")
        request_id = supplied if valid_request_id(supplied) else uuid4().hex
        token = set_request_id(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception as error:
                duration_ms = round((time.perf_counter() - started) * 1000)
                self._write_system(
                    "ERROR",
                    "http request failed",
                    logger="linkcv.http",
                    http_method=request.method,
                    http_route=self._route(request),
                    http_status=500,
                    duration_ms=duration_ms,
                    actor_user_id=getattr(request.state, "actor_user_id", None),
                    error_code="INTERNAL_SERVER_ERROR",
                    operation_id=getattr(request.state, "operation_id", None),
                    dependency=dependency_for_exception(error),
                    **exception_fields(type(error), error, error.__traceback__),
                )
                self._write_audit(
                    request,
                    result="failed",
                    error_code="INTERNAL_SERVER_ERROR",
                )
                raise

            duration_ms = round((time.perf_counter() - started) * 1000)
            error_code = getattr(request.state, "error_code", None)
            level = (
                "ERROR"
                if response.status_code >= 500
                else "WARNING"
                if response.status_code >= 400
                else "INFO"
            )
            self._write_system(
                level,
                "http request completed",
                logger="linkcv.http",
                http_method=request.method,
                http_route=self._route(request),
                http_status=response.status_code,
                duration_ms=duration_ms,
                actor_user_id=getattr(request.state, "actor_user_id", None),
                error_code=error_code,
                operation_id=getattr(request.state, "operation_id", None),
            )
            recorded = self._write_audit(
                request,
                result="succeeded" if response.status_code < 400 else "failed",
                error_code=error_code,
            )
            response.headers["X-Request-ID"] = request_id
            if recorded is not None:
                response.headers["X-Audit-Recorded"] = str(recorded).lower()
            return response
        finally:
            reset_request_id(token)
