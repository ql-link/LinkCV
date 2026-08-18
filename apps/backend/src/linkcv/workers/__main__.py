import asyncio

from linkcv.core.config import load_settings
from linkcv.core.database import build_engine, build_session_factory
from linkcv.core.redis import build_redis_client
from linkcv.core.storage import AssetStorage
from linkcv.integrations.document_converter import DocumentConverter
from linkcv.integrations.linkparse_client import LinkParseClient
from linkcv.integrations.resume_structuring import LLMResumeStructuringClient
from linkcv.modules.llm.crypto import CredentialCipher
from linkcv.modules.llm.gateway import LiteLLMGateway
from linkcv.modules.llm.service import LLMService
from linkcv.modules.observability.logging import configure_logging
from linkcv.services.resume_import_service import ResumeImportService
from linkcv.workers.resume_import_consumer import run_consumer
from linkcv.workers.resume_import_worker import ResumeImportProcessor


async def main() -> None:
    settings = load_settings()
    configure_logging(settings)
    session_factory = build_session_factory(build_engine(settings.sqlalchemy_url))
    storage = AssetStorage(settings)
    redis = build_redis_client(settings)
    llm_service = LLMService(
        session_factory,
        LiteLLMGateway(settings.llm_timeout_seconds),
        CredentialCipher(settings.llm_credential_encryption_keys),
    )
    linkparse_key = (
        settings.linkparse_api_key.get_secret_value()
        if settings.linkparse_api_key is not None
        else None
    )
    converter = DocumentConverter(
        linkparse=LinkParseClient(
            base_url=settings.linkparse_base_url,
            api_key=linkparse_key,
            parse_path=settings.linkparse_parse_path,
            timeout_seconds=settings.linkparse_timeout_seconds,
            response_max_bytes=settings.linkparse_response_max_bytes,
            markdown_max_bytes=settings.resume_markdown_max_bytes,
        ),
        markdown_max_bytes=settings.resume_markdown_max_bytes,
    )
    import_service = ResumeImportService(
        document_converter=converter,
        structuring_client=LLMResumeStructuringClient(llm_service),
        max_structuring_bytes=settings.resume_structuring_max_bytes,
        structuring_timeout_seconds=settings.resume_structuring_timeout_seconds,
    )
    processor = ResumeImportProcessor(
        session_factory=session_factory,
        storage=storage,
        redis=redis,
        import_service=import_service,
        settings=settings,
    )
    try:
        await run_consumer(processor=processor, settings=settings)
    finally:
        redis.close()


if __name__ == "__main__":
    asyncio.run(main())
