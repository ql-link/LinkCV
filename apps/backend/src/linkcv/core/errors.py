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
        request: Request,
        error: RequestValidationError,
    ):
        if request.method == "PUT" and request.url.path.startswith("/api/resumes/"):
            fields = {
                item["loc"][1]
                for item in error.errors()
                if len(item.get("loc", ())) > 1 and item["loc"][0] == "body"
            }
            if "style" in fields:
                return JSONResponse(
                    status_code=400,
                    content={"error": "INVALID_RESUME_STYLE"},
                )
            if "data" in fields:
                return JSONResponse(
                    status_code=400,
                    content={"error": "INVALID_RESUME_DOCUMENT"},
                )
        return await request_validation_exception_handler(request, error)
