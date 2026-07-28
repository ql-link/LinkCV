import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import Scope
from sqlalchemy.orm import Session, sessionmaker

from linkcv.api.router import api_router
from linkcv.core.config import Settings, load_settings
from linkcv.core.database import Base, build_engine, build_session_factory
from linkcv.core.errors import ApiError, install_error_handlers
from linkcv.core.redis import build_redis_client
from linkcv.core.storage import AssetStorage
from linkcv.integrations.llm_client import (
    HttpStructuredLlmClient,
    UnconfiguredStructuringClient,
)
from linkcv.integrations.rag_client import HttpRagClient, UnconfiguredRagClient
from linkcv.modules.llm.crypto import CredentialCipher
from linkcv.modules.llm.gateway import LLMGateway, LiteLLMGateway
from linkcv.modules.llm.service import LLMService
from linkcv.services.import_admission import ImportAdmissionController
from linkcv.services.storage_cleanup_service import run_storage_cleanup_worker

logger = logging.getLogger(__name__)


class SpaStaticFiles(StaticFiles):
    @staticmethod
    def _path_is_api(path: str) -> bool:
        # Normalise OS path separators so the check works on Windows too.
        return path.replace("\\", "/").lstrip("/").startswith("api/")

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or self._path_is_api(path):
                raise
            return await super().get_response("index.html", scope)
        if response.status_code != 404 or self._path_is_api(path):
            return response
        return await super().get_response("index.html", scope)


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: sessionmaker[Session] | None = None,
    storage: Any | None = None,
    llm_gateway: LLMGateway | None = None,
    redis: Any | None = None,
    rag_converter: Any | None = None,
    structuring_client: Any | None = None,
    create_schema: bool = False,
) -> FastAPI:
    runtime_settings = settings or load_settings()
    engine = None
    if session_factory is None:
        engine = build_engine(runtime_settings.sqlalchemy_url)
        session_factory = build_session_factory(engine)

    if create_schema:
        if engine is None:
            raise ValueError(
                "create_schema requires the application to create its database engine"
            )
        import linkcv.models  # noqa: F401

        Base.metadata.create_all(engine)

    runtime_storage = storage or AssetStorage(runtime_settings)
    runtime_llm_gateway = llm_gateway or LiteLLMGateway()
    llm_service = LLMService(
        session_factory,
        runtime_llm_gateway,
        CredentialCipher(runtime_settings.llm_credential_encryption_keys),
    )
    if redis is None:
        redis = build_redis_client(runtime_settings)
    runtime_rag_converter = rag_converter
    if runtime_rag_converter is None:
        runtime_rag_converter = (
            HttpRagClient(
                base_url=runtime_settings.rag_base_url,
                api_key=runtime_settings.rag_api_key,
                convert_path=runtime_settings.rag_convert_path,
                timeout_seconds=runtime_settings.rag_timeout_seconds,
            )
            if runtime_settings.rag_base_url
            else UnconfiguredRagClient()
        )
    runtime_structuring_client = structuring_client
    if runtime_structuring_client is None:
        runtime_structuring_client = (
            HttpStructuredLlmClient(
                base_url=runtime_settings.llm_base_url,
                api_key=runtime_settings.llm_api_key,
                model=runtime_settings.llm_model,
                structured_path=runtime_settings.llm_structured_path,
                timeout_seconds=runtime_settings.llm_timeout_seconds,
                max_retries=runtime_settings.llm_max_retries,
            )
            if runtime_settings.llm_base_url and runtime_settings.llm_model
            else UnconfiguredStructuringClient()
        )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            await asyncio.to_thread(runtime_storage.ensure_bucket)
        except Exception:
            logger.warning(
                "MinIO is unavailable; asset routes will retry on demand", exc_info=True
            )
        try:
            await asyncio.to_thread(redis.ping)
        except Exception:
            logger.warning("Redis is unavailable; auth sessions will fail", exc_info=True)
        cleanup_task = asyncio.create_task(
            run_storage_cleanup_worker(session_factory, runtime_storage)
        )
        try:
            yield
        finally:
            cleanup_task.cancel()
            try:
                await cleanup_task
            except asyncio.CancelledError:
                pass
            try:
                await asyncio.to_thread(redis.close)
            except Exception:
                logger.warning("Redis close failed", exc_info=True)

    app = FastAPI(
        title="LinkCV API",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings
    app.state.session_factory = session_factory
    app.state.storage = runtime_storage
    app.state.llm_service = llm_service
    app.state.redis = redis
    app.state.rag_converter = runtime_rag_converter
    app.state.structuring_client = runtime_structuring_client
    app.state.import_admission = ImportAdmissionController(
        requests_per_minute=runtime_settings.resume_import_requests_per_minute,
        global_concurrency=runtime_settings.resume_import_global_concurrency,
        user_concurrency=runtime_settings.resume_import_user_concurrency,
    )
    install_error_handlers(app)
    app.include_router(api_router, prefix="/api")

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        include_in_schema=False,
    )
    async def api_not_found(path: str) -> Response:
        del path
        raise ApiError(404, "NOT_FOUND")

    web_dist_dir = runtime_settings.web_dist_dir
    if web_dist_dir:
        path = Path(web_dist_dir)
        if path.is_dir():
            app.mount("/", SpaStaticFiles(directory=path, html=True), name="web")
    return app


app = create_app()
