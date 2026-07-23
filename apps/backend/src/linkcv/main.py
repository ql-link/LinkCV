import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session, sessionmaker

from linkcv.api.router import api_router
from linkcv.core.config import Settings, load_settings
from linkcv.core.database import Base, build_engine, build_session_factory
from linkcv.core.errors import install_error_handlers
from linkcv.core.storage import AssetStorage

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: sessionmaker[Session] | None = None,
    storage: Any | None = None,
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

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            await asyncio.to_thread(runtime_storage.ensure_bucket)
        except Exception:
            logger.warning(
                "MinIO is unavailable; asset routes will retry on demand", exc_info=True
            )
        yield

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
    install_error_handlers(app)
    app.include_router(api_router, prefix="/api")

    web_dist_dir = runtime_settings.web_dist_dir
    if web_dist_dir:
        path = Path(web_dist_dir)
        if path.is_dir():
            app.mount("/", StaticFiles(directory=path, html=True), name="web")
    return app


app = create_app()
