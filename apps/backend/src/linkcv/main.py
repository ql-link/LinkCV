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
from linkcv.core.mq.publisher import MQPublisher
from linkcv.core.mq.factory import build_mq_publisher
from linkcv.core.redis import build_redis_client
from linkcv.core.storage import AssetStorage
from linkcv.integrations.document_converter import DocumentConverter
from linkcv.integrations.docx_parse_runner import DocxParseRunner
from linkcv.integrations.linkparse_client import LinkParseClient
from linkcv.integrations.resume_structuring import LLMResumeStructuringClient
from linkcv.integrations.wechat_client import WechatClient
from linkcv.modules.llm.crypto import CredentialCipher
from linkcv.modules.llm.gateway import LLMGateway, LiteLLMGateway
from linkcv.modules.llm.catalog import CHAT_CAPABILITY
from linkcv.modules.llm.models import LLMCapabilityBinding
from linkcv.modules.llm.service import LLMService
from linkcv.modules.observability.logging import StructuredLogEmitter, configure_logging
from linkcv.modules.observability.middleware import ObservabilityMiddleware
from linkcv.modules.observability.loki import LokiClient
from linkcv.modules.plugin_releases.service import PluginReleaseService
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
    wechat_client: Any | None = None,
    event_emitter: StructuredLogEmitter | None = None,
    loki_client: Any | None = None,
    mq_publisher: MQPublisher | None = None,
    plugin_release_service: Any | None = None,
    create_schema: bool = False,
) -> FastAPI:
    runtime_settings = settings or load_settings()
    runtime_emitter = event_emitter or configure_logging(runtime_settings)
    runtime_loki_client = loki_client
    if runtime_loki_client is None and runtime_settings.loki_query_url:
        runtime_loki_client = LokiClient(
            runtime_settings.loki_query_url,
            runtime_settings.loki_query_timeout_seconds,
        )
    runtime_mq_publisher = mq_publisher
    if runtime_mq_publisher is None and (
        runtime_settings.mq_vendor == "kafka"
        or runtime_settings.rabbitmq_url is not None
    ):
        runtime_mq_publisher = build_mq_publisher(runtime_settings)
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
    runtime_plugin_release_service = plugin_release_service or PluginReleaseService(
        runtime_storage,
        expected_origin=runtime_settings.plugin_release_origin,
    )
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
    runtime_wechat_client = wechat_client
    if runtime_wechat_client is None:
        wechat_secret = (
            runtime_settings.wechat_secret.get_secret_value()
            if runtime_settings.wechat_secret is not None
            else None
        )
        runtime_wechat_client = WechatClient(
            appid=runtime_settings.wechat_appid or "",
            secret=wechat_secret or "",
            qr_page=runtime_settings.wechat_qr_page,
            login_page=runtime_settings.wechat_login_page,
            timeout_seconds=runtime_settings.wechat_api_timeout_seconds,
        )
    import_idempotency = ResumeImportIdempotency(
        redis,
        bind_ttl_seconds=runtime_settings.resume_import_idempotency_bind_ttl_seconds,
        ttl_seconds=runtime_settings.resume_import_idempotency_ttl_seconds,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            await asyncio.to_thread(runtime_storage.ensure_bucket)
        except Exception:
            logger.warning(
                "MinIO is unavailable; asset routes will retry on demand",
                exc_info=True,
                extra={"dependency": "minio", "error_code": "MINIO_UNAVAILABLE"},
            )
        try:
            await asyncio.to_thread(redis.ping)
        except Exception:
            logger.warning(
                "Redis is unavailable; auth sessions will fail",
                exc_info=True,
                extra={"dependency": "redis", "error_code": "REDIS_UNAVAILABLE"},
            )
        try:
            yield
        finally:
            runtime_publisher = _app.state.mq_publisher
            if runtime_publisher is not None:
                try:
                    await runtime_publisher.close()
                except Exception:
                    logger.warning("MQ publisher close failed", exc_info=True)
            try:
                await asyncio.to_thread(redis.close)
            except Exception:
                logger.warning(
                    "Redis close failed",
                    exc_info=True,
                    extra={"dependency": "redis", "error_code": "REDIS_CLOSE_FAILED"},
                )
            if runtime_loki_client is not None:
                try:
                    await asyncio.to_thread(runtime_loki_client.close)
                except Exception:
                    logger.warning(
                        "Loki client close failed",
                        exc_info=True,
                        extra={"error_code": "LOKI_CLOSE_FAILED"},
                    )

    app = FastAPI(
        title="LinkCV API",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings
    # Public password/binding routes are retired. Integration tests temporarily
    # keep their old setup helpers only on ephemeral create_schema applications.
    app.state.legacy_identity_test_routes = create_schema
    app.state.session_factory = session_factory
    app.state.storage = runtime_storage
    app.state.plugin_release_service = runtime_plugin_release_service
    app.state.llm_service = llm_service
    app.state.redis = redis
    app.state.document_converter = runtime_document_converter
    app.state.structuring_client = runtime_structuring_client
    app.state.wechat_client = runtime_wechat_client
    app.state.import_idempotency = import_idempotency
    app.state.mq_publisher = runtime_mq_publisher
    app.state.import_admission = ImportAdmissionController(
        requests_per_minute=runtime_settings.resume_import_requests_per_minute,
        global_concurrency=runtime_settings.resume_import_global_concurrency,
        user_concurrency=runtime_settings.resume_import_user_concurrency,
    )
    app.state.event_emitter = runtime_emitter
    app.state.loki_client = runtime_loki_client
    install_error_handlers(app)
    app.add_middleware(ObservabilityMiddleware, emitter=runtime_emitter)
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
