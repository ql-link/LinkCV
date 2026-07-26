from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code, content={"error": error.code}
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        if request.url.path.startswith("/api/admin/llm"):
            code = (
                "INVALID_LLM_CALL_QUERY"
                if request.method == "GET" and request.url.path.endswith("/calls")
                else "INVALID_LLM_MODEL_CONFIG"
            )
            return JSONResponse(status_code=400, content={"error": code})
        return await request_validation_exception_handler(request, error)
