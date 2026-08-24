from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.details = details


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, error: ApiError) -> JSONResponse:
        request.state.error_code = error.code
        content: dict[str, object] = {"error": error.code}
        if error.details:
            content.update(error.details)
        return JSONResponse(
            status_code=error.status_code, content=content
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(
        request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        if request.url.path.rstrip("/") == "/api/admin/plugin-releases":
            return JSONResponse(
                status_code=422,
                content={"error": "PLUGIN_RELEASE_INVALID_FILE"},
            )
        if request.url.path.startswith("/api/job-descriptions"):
            if request.url.path.rstrip("/") == "/api/job-descriptions/import":
                code = "INVALID_JOB_IMPORT"
            elif (
                request.method == "GET"
                and request.url.path.rstrip("/") == "/api/job-descriptions"
            ):
                code = "INVALID_JOB_QUERY"
            else:
                code = "INVALID_JOB_DESCRIPTION"
            request.state.error_code = code
            return JSONResponse(status_code=400, content={"error": code})
        if (
            request.url.path.startswith(
                (
                    "/api/job-applications",
                    "/api/interview-sessions",
                    "/api/interview-assets",
                )
            )
            or request.url.path == "/api/interview-overview"
        ):
            code = (
                "INVALID_INTERVIEW_QUERY"
                if request.method == "GET"
                else "INVALID_INTERVIEW_REQUEST"
            )
            request.state.error_code = code
            return JSONResponse(status_code=400, content={"error": code})
        if request.url.path.startswith("/api/admin/llm"):
            code = (
                "INVALID_LLM_CALL_QUERY"
                if request.method == "GET" and request.url.path.endswith("/calls")
                else "INVALID_LLM_MODEL_CONFIG"
            )
            request.state.error_code = code
            return JSONResponse(status_code=400, content={"error": code})
        if request.method == "PUT" and request.url.path.startswith("/api/resumes/"):
            fields = {
                item["loc"][1]
                for item in error.errors()
                if len(item.get("loc", ())) > 1 and item["loc"][0] == "body"
            }
            if "style" in fields:
                request.state.error_code = "INVALID_RESUME_STYLE"
                return JSONResponse(
                    status_code=400,
                    content={"error": "INVALID_RESUME_STYLE"},
                )
            if "data" in fields:
                request.state.error_code = "INVALID_RESUME_DOCUMENT"
                return JSONResponse(
                    status_code=400,
                    content={"error": "INVALID_RESUME_DOCUMENT"},
                )
        if request.url.path.startswith("/api/admin/logs/system"):
            request.state.error_code = "INVALID_SYSTEM_LOG_QUERY"
            return JSONResponse(
                status_code=400,
                content={"error": "INVALID_SYSTEM_LOG_QUERY"},
            )
        if request.url.path.startswith("/api/admin/logs/audit"):
            request.state.error_code = "INVALID_AUDIT_LOG_QUERY"
            return JSONResponse(
                status_code=400,
                content={"error": "INVALID_AUDIT_LOG_QUERY"},
            )
        if request.url.path.startswith("/api/admin/logs/summary"):
            request.state.error_code = "INVALID_LOG_SUMMARY_QUERY"
            return JSONResponse(
                status_code=400,
                content={"error": "INVALID_LOG_SUMMARY_QUERY"},
            )
        if request.url.path == "/api/observability/client-events":
            request.state.error_code = "INVALID_CLIENT_LOG_EVENT"
            return JSONResponse(
                status_code=400,
                content={"error": "INVALID_CLIENT_LOG_EVENT"},
            )
        if request.url.path == "/api/audit/events":
            request.state.error_code = "INVALID_AUDIT_EVENT"
            return JSONResponse(
                status_code=400,
                content={"error": "INVALID_AUDIT_EVENT"},
            )
        request.state.error_code = "REQUEST_VALIDATION_ERROR"
        return await request_validation_exception_handler(request, error)
