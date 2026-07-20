from fastapi import FastAPI

from linkcv.api.router import api_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="LinkCV API",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
