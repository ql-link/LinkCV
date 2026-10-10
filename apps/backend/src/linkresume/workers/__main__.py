import asyncio

from linkresume.core.config import load_settings
from linkresume.core.database import build_engine, build_session_factory
from linkresume.core.redis import build_redis_client
from linkresume.core.storage import AssetStorage
from linkresume.integrations.document_converter import DocumentConverter
from linkresume.integrations.linkparse_client import LinkParseClient
from linkresume.integrations.linkrag_client import build_linkrag_client
from linkresume.integrations.resume_structuring import LLMResumeStructuringClient
from linkresume.modules.llm.crypto import CredentialCipher
from linkresume.modules.llm.gateway import LiteLLMGateway
from linkresume.modules.llm.service import LLMService
from linkresume.modules.observability.logging import configure_logging
from linkresume.services.rag_sync_service import RagSyncService
from linkresume.services.resume_import_service import ResumeImportService
from linkresume.workers.dataset_parse_worker import DatasetParseProcessor
from linkresume.workers.document_parse_consumer import run_consumer
from linkresume.workers.rag_sync_worker import run_rag_sync_loop
from linkresume.workers.job_pool_worker import JobPoolProcessor, run_job_pool_loop
from linkresume.workers.resume_import_worker import ResumeImportProcessor
from linkresume.application.interviews.transcription_service import TranscriptionRunner
from linkresume.modules.speech.file_transcription import DashScopeFileTranscriber
from linkresume.workers.transcription_worker import run_transcription_loop
from linkresume.workers.account_deletion_worker import AccountDeletionProcessor, run_account_deletion_loop


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
    job_pool_task = None
    try:
        job_pool_task = asyncio.create_task(run_job_pool_loop(JobPoolProcessor(session_factory, settings, storage=storage))) if settings.job_pool_sync_enabled else None
        await run_consumer(
            resume_processor=resume_processor,
            dataset_processor=dataset_processor,
            settings=settings,
        )
    finally:
        if job_pool_task is not None:
            job_pool_task.cancel()
            try:
                await job_pool_task
            except asyncio.CancelledError:
                pass
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
