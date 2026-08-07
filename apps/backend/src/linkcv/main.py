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
from linkcv.integrations.document_converter import DocumentConverter
from linkcv.integrations.docx_parse_runner import DocxParseRunner
from linkcv.integrations.linkparse_client import LinkParseClient
from linkcv.integrations.resume_structuring import LLMResumeStructuringClient
from linkcv.integrations.wechat_client import WeChatClient
from linkcv.modules.llm.crypto import CredentialCipher
from linkcv.modules.llm.gateway import LLMGateway, LiteLLMGateway
from linkcv.modules.llm.catalog import CHAT_CAPABILITY
from linkcv.modules.llm.models import LLMCapabilityBinding
from linkcv.modules.llm.service import LLMService
from linkcv.services.import_admission import ImportAdmissionController
from linkcv.services.resume_import_idempotency import ResumeImportIdempotency

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
    document_converter: Any | None = None,
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
        with session_factory() as schema_db:
            if schema_db.get(LLMCapabilityBinding, CHAT_CAPABILITY) is None:
                schema_db.add(LLMCapabilityBinding(capability=CHAT_CAPABILITY))
                schema_db.commit()

    runtime_storage = storage or AssetStorage(runtime_settings)
    runtime_llm_gateway = llm_gateway or LiteLLMGateway(
        runtime_settings.llm_timeout_seconds
    )
    llm_service = LLMService(
        session_factory,
        runtime_llm_gateway,
        CredentialCipher(runtime_settings.llm_credential_encryption_keys),
    )
    if redis is None:
        redis = build_redis_client(runtime_settings)
    runtime_document_converter = document_converter
    if runtime_document_converter is None:
        linkparse_key = (
            runtime_settings.linkparse_api_key.get_secret_value()
            if runtime_settings.linkparse_api_key is not None
            else None
        )
        runtime_document_converter = DocumentConverter(
            linkparse=LinkParseClient(
                base_url=runtime_settings.linkparse_base_url,
                api_key=linkparse_key,
                parse_path=runtime_settings.linkparse_parse_path,
                timeout_seconds=runtime_settings.linkparse_timeout_seconds,
                response_max_bytes=runtime_settings.linkparse_response_max_bytes,
                markdown_max_bytes=runtime_settings.resume_markdown_max_bytes,
            ),
            docx_runner=DocxParseRunner(
                timeout_seconds=runtime_settings.docx_conversion_timeout_seconds
            ),
            markdown_max_bytes=runtime_settings.resume_markdown_max_bytes,
        )
    runtime_structuring_client = structuring_client
    if runtime_structuring_client is None:
        runtime_structuring_client = LLMResumeStructuringClient(llm_service)
    wechat_appsecret = (
        runtime_settings.wechat_appsecret.get_secret_value()
        if runtime_settings.wechat_appsecret is not None
        else None
    )
    runtime_wechat_client = WeChatClient(
        appid=runtime_settings.wechat_appid,
        appsecret=wechat_appsecret or "",
        login_page=runtime_settings.wechat_login_page,
        redis_client=redis,
        timeout_seconds=runtime_settings.wechat_timeout_seconds,
    )
    import_idempotency = ResumeImportIdempotency(
        redis,
        processing_ttl_seconds=(
            runtime_settings.resume_import_idempotency_processing_ttl_seconds
        ),
        success_ttl_seconds=(
            runtime_settings.resume_import_idempotency_success_ttl_seconds
        ),
        failure_ttl_seconds=(
            runtime_settings.resume_import_idempotency_failure_ttl_seconds
        ),
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
        try:
            yield
        finally:
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
    app.state.document_converter = runtime_document_converter
    app.state.structuring_client = runtime_structuring_client
    app.state.wechat_client = runtime_wechat_client
    app.state.import_idempotency = import_idempotency
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
