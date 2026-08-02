import asyncio
import logging
from dataclasses import dataclass
from pathlib import PurePath
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from pydantic import ValidationError
from sqlalchemy.orm import Session

from linkcv.application.resumes.commands import CreateResumeCommand
from linkcv.application.resumes.service import (
    ResumeLimitExceeded,
    create_resume_with_initial_version,
)
from linkcv.core.storage import AssetStorage, build_import_object_name
from linkcv.domain.rag import RagConverter, RagMarkdownResult, RagMetadata
from linkcv.domain.resume_normalization import finalize_resume_document
from linkcv.domain.section_ir import build_section_ir
from linkcv.integrations.llm_client import (
    ResumeStructuringClient,
    StructuringModelError,
    StructuringModelNotConfiguredError,
)
from linkcv.integrations.rag_client import (
    RagNotConfiguredError,
    RagServiceError,
)
from linkcv.modules.resumes.models import Resume

logger = logging.getLogger(__name__)

SUPPORTED_IMPORT_MIME = {
    "md": {"text/markdown", "text/plain", "text/x-markdown"},
    "docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    "pdf": {"application/pdf"},
}


class ResumeImportFailure(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True)
class ImportResult:
    resume: Resume
    source_file_name: str
    source_file_format: str
    warnings: list[str]


def validate_import_file(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    max_bytes: int,
) -> str:
    if not content:
        raise ResumeImportFailure(400, "EMPTY_IMPORT_FILE")
    if len(content) > max_bytes:
        raise ResumeImportFailure(413, "IMPORT_FILE_TOO_LARGE")

    extension = PurePath(filename).suffix.lower().lstrip(".")
    normalized_content_type = content_type.partition(";")[0].strip().lower()
    allowed_mime = SUPPORTED_IMPORT_MIME.get(extension)
    if allowed_mime is None or normalized_content_type not in allowed_mime:
        raise ResumeImportFailure(415, "UNSUPPORTED_IMPORT_FORMAT")

    if extension == "md":
        if b"\x00" in content:
            raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID")
        try:
            content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID") from error
    elif extension == "pdf":
        if not content.startswith(b"%PDF-"):
            raise ResumeImportFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
        if b"/Encrypt" in content:
            raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID")
    elif extension == "docx":
        if not content.startswith(b"PK\x03\x04"):
            raise ResumeImportFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
        try:
            from io import BytesIO

            with ZipFile(BytesIO(content)) as archive:
                names = set(archive.namelist())
                if not {"[Content_Types].xml", "word/document.xml"}.issubset(names):
                    raise ResumeImportFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
                if any(item.flag_bits & 0x1 for item in archive.infolist()):
                    raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID")
                if sum(item.file_size for item in archive.infolist()) > 50 * 1024 * 1024:
                    raise ResumeImportFailure(413, "IMPORT_FILE_TOO_LARGE")
        except (BadZipFile, OSError) as error:
            raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID") from error
    return extension


async def extract_markdown(
    *,
    extension: str,
    filename: str,
    content_type: str,
    content: bytes,
    rag_converter: RagConverter,
    max_markdown_bytes: int,
) -> RagMarkdownResult:
    if extension == "md":
        result = RagMarkdownResult(
            markdown=content.decode("utf-8"),
            metadata=RagMetadata(
                source_file_name=filename,
                source_format="md",
                converter_version="linkcv/direct-markdown-v1",
            ),
        )
    else:
        try:
            result = await rag_converter.convert(
                filename=filename,
                content_type=content_type,
                content=content,
            )
        except RagNotConfiguredError as error:
            raise ResumeImportFailure(503, "RAG_SERVICE_UNAVAILABLE") from error
        except RagServiceError as error:
            raise ResumeImportFailure(502, "RAG_SERVICE_FAILED") from error

    markdown = result.markdown.strip()
    if not markdown:
        raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID")
    if len(markdown.encode("utf-8")) > max_markdown_bytes:
        raise ResumeImportFailure(413, "IMPORT_FILE_TOO_LARGE")
    return result.model_copy(update={"markdown": markdown})


class ResumeImportService:
    def __init__(
        self,
        *,
        rag_converter: RagConverter,
        structuring_client: ResumeStructuringClient,
        storage: AssetStorage,
        max_file_bytes: int,
        max_markdown_bytes: int,
        max_structuring_bytes: int,
    ) -> None:
        self._rag_converter = rag_converter
        self._structuring_client = structuring_client
        self._storage = storage
        self._max_file_bytes = max_file_bytes
        self._max_markdown_bytes = max_markdown_bytes
        self._max_structuring_bytes = max_structuring_bytes

    async def import_resume(
        self,
        *,
        db: Session,
        user_id: int,
        filename: str,
        content_type: str,
        content: bytes,
        title: str | None,
    ) -> ImportResult:
        safe_filename = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
        if (
            not safe_filename
            or len(safe_filename) > 255
            or any(ord(character) < 32 for character in safe_filename)
        ):
            raise ResumeImportFailure(400, "INVALID_IMPORT_FILENAME")
        extension = validate_import_file(
            filename=safe_filename,
            content_type=content_type,
            content=content,
            max_bytes=self._max_file_bytes,
        )
        operation_id = uuid4().hex
        object_key = build_import_object_name(user_id, operation_id, safe_filename)
        try:
            await asyncio.to_thread(
                self._storage.upload,
                object_key,
                content,
                content_type,
            )
        except Exception as error:
            raise ResumeImportFailure(502, "IMPORT_STORAGE_FAILED") from error

        created = False
        try:
            rag_result = await extract_markdown(
                extension=extension,
                filename=safe_filename,
                content_type=content_type,
                content=content,
                rag_converter=self._rag_converter,
                max_markdown_bytes=self._max_markdown_bytes,
            )
            if len(rag_result.markdown.encode("utf-8")) > self._max_structuring_bytes:
                raise ResumeImportFailure(413, "STRUCTURING_INPUT_TOO_LARGE")
            section_ir = build_section_ir(rag_result.markdown)
            try:
                draft = await self._structuring_client.extract(section_ir)
            except StructuringModelNotConfiguredError as error:
                raise ResumeImportFailure(
                    503, "STRUCTURING_MODEL_UNAVAILABLE"
                ) from error
            except StructuringModelError as error:
                raise ResumeImportFailure(502, "STRUCTURING_MODEL_FAILED") from error

            try:
                normalized = finalize_resume_document(draft, rag_result.markdown)
            except (ValidationError, ValueError) as error:
                raise ResumeImportFailure(422, "RESUME_STRUCTURE_INVALID") from error

            inferred_title = " ".join(
                value
                for value in (
                    normalized.document.basics.name,
                    normalized.document.basics.headline or "",
                )
                if value
            )
            try:
                resume = create_resume_with_initial_version(
                    CreateResumeCommand(
                        user_id=user_id,
                        title=title or inferred_title or PurePath(safe_filename).stem,
                        data=normalized.document,
                        source_type="import",
                        source_filename=safe_filename,
                        source_object_key=object_key,
                        extracted_markdown=rag_result.markdown,
                    ),
                    db,
                )
            except ResumeLimitExceeded as error:
                raise ResumeImportFailure(409, "RESUME_LIMIT_REACHED") from error
            except Exception as error:
                raise ResumeImportFailure(500, "IMPORT_CREATE_FAILED") from error
            created = True
            return ImportResult(
                resume=resume,
                source_file_name=safe_filename,
                source_file_format=extension,
                warnings=sorted(set(rag_result.warnings + normalized.warnings)),
            )
        finally:
            if not created:
                try:
                    await asyncio.to_thread(self._storage.delete, object_key)
                except Exception as cleanup_error:
                    logger.warning(
                        "resume import cleanup failed",
                        extra={
                            "operation_id": operation_id,
                            "user_id": user_id,
                            "error_type": type(cleanup_error).__name__,
                        },
                    )
