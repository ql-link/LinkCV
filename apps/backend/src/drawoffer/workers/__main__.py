import asyncio

from drawoffer.core.config import load_settings
from drawoffer.core.database import build_engine, build_session_factory
from drawoffer.core.redis import build_redis_client
from drawoffer.core.storage import AssetStorage
from drawoffer.integrations.document_converter import DocumentConverter
from drawoffer.integrations.linkparse_client import LinkParseClient
from drawoffer.integrations.linkrag_client import build_linkrag_client
from drawoffer.integrations.resume_structuring import LLMResumeStructuringClient
from drawoffer.modules.llm.crypto import CredentialCipher
from drawoffer.modules.llm.gateway import LiteLLMGateway
from drawoffer.modules.llm.service import LLMService
from drawoffer.modules.observability.logging import configure_logging
from drawoffer.services.rag_sync_service import RagSyncService
from drawoffer.services.resume_import_service import ResumeImportService
from drawoffer.workers.dataset_parse_worker import DatasetParseProcessor
from drawoffer.workers.document_parse_consumer import run_consumer
from drawoffer.workers.rag_sync_worker import run_rag_sync_loop
from drawoffer.workers.resume_import_worker import ResumeImportProcessor
from drawoffer.application.interviews.transcription_service import TranscriptionRunner
from drawoffer.modules.speech.file_transcription import DashScopeFileTranscriber
from drawoffer.workers.transcription_worker import run_transcription_loop
from drawoffer.workers.account_deletion_worker import AccountDeletionProcessor, run_account_deletion_loop


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
    resume_processor = ResumeImportProcessor(
        session_factory=session_factory,
        storage=storage,
        redis=redis,
        import_service=import_service,
        settings=settings,
    )
    dataset_processor = DatasetParseProcessor(
        session_factory=session_factory,
        storage=storage,
        redis=redis,
        document_converter=converter,
        settings=settings,
    )
    rag_client = build_linkrag_client(
        settings, timeout_seconds=settings.linkrag_sync_timeout_seconds
    )
    rag_task = None
    deletion_task = asyncio.create_task(run_account_deletion_loop(AccountDeletionProcessor(
        session_factory=session_factory, storage=storage, redis=redis,
        rag_client=rag_client, settings=settings,
    )))
    if rag_client is not None:
        rag_task = asyncio.create_task(
            run_rag_sync_loop(
                RagSyncService(
                    session_factory=session_factory,
                    storage=storage,
                    client=rag_client,
                    batch_size=settings.linkrag_sync_batch_size,
                    max_attempts=settings.linkrag_sync_max_attempts,
                    markdown_max_bytes=settings.dataset_upload_max_bytes,
                ),
                redis,
                interval_seconds=settings.linkrag_sync_interval_seconds,
            )
        )
    transcription_task = None
    transcriber = None
    if settings.interview_transcription_enabled:
        transcriber = DashScopeFileTranscriber(settings.interview_transcription_model)
        transcription_task = asyncio.create_task(
            run_transcription_loop(
                TranscriptionRunner(
                    session_factory,
                    storage,
                    llm_service,
                    transcriber,
                    poll_seconds=settings.interview_transcription_poll_seconds,
                ),
                redis,
                interval_seconds=settings.interview_transcription_poll_seconds,
            )
        )
    try:
        await run_consumer(
            resume_processor=resume_processor,
            dataset_processor=dataset_processor,
            settings=settings,
        )
    finally:
        if transcription_task is not None:
            transcription_task.cancel()
            try:
                await transcription_task
            except asyncio.CancelledError:
                pass
        if transcriber is not None:
            transcriber.close()
        deletion_task.cancel()
        try:
            await deletion_task
        except asyncio.CancelledError:
            pass
        if rag_task is not None:
            rag_task.cancel()
            try:
                await rag_task
            except asyncio.CancelledError:
                pass
            rag_client.close()
        redis.close()


if __name__ == "__main__":
    asyncio.run(main())
