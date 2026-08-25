from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import logging
from pathlib import PurePath, PurePosixPath
from time import monotonic
from zipfile import BadZipFile, ZipFile

from pydantic import ValidationError
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownConverter,
)
from linkcv.domain.import_warnings import merge_import_warnings
from linkcv.domain.resume_normalization import finalize_resume_document
from linkcv.domain.resume_document import ResumeDocument
from linkcv.domain.section_ir import build_section_ir
from linkcv.integrations.resume_structuring import (
    ResumeStructureInvalidError,
    ResumeStructuringClient,
    StructuringModelError,
    StructuringModelNotConfiguredError,
)

logger = logging.getLogger(__name__)

SUPPORTED_IMPORT_MIME = {
    "md": {"text/markdown", "text/plain", "text/x-markdown"},
    "docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    "pdf": {"application/pdf"},
}
DOCX_MAX_ENTRIES = 5000
DOCX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
DOCX_MAX_COMPRESSION_RATIO = 100
OLE_COMPOUND_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")
ENCRYPTED_DOCX_MARKERS = tuple(
    value.encode("utf-16le") for value in ("EncryptedPackage", "EncryptionInfo")
)


class ResumeImportFailure(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        *,
        stage: str | None = None,
        exception_type: str | None = None,
        validation_model: str | None = None,
        validation_paths: str | None = None,
        validation_types: str | None = None,
    ) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.stage = stage
        self.exception_type = exception_type
        self.validation_model = validation_model
        self.validation_paths = validation_paths
        self.validation_types = validation_types


def _validation_metadata(error: ValidationError) -> dict[str, str]:
    entries = error.errors(
        include_url=False,
        include_context=False,
        include_input=False,
    )
    paths = sorted(
        {
            ".".join(str(part) for part in entry.get("loc", ())) or "<root>"
            for entry in entries
        }
    )
    error_types = sorted(
        {str(entry.get("type", "validation_error")) for entry in entries}
    )
    return {
        "validation_model": error.title,
        "validation_paths": ",".join(paths[:20]),
        "validation_types": ",".join(error_types[:20]),
    }


@dataclass(frozen=True)
class ParsedImportResult:
    document: ResumeDocument
    extracted_markdown: str
    source_file_format: str
    warnings: list[str]


def safe_import_filename(filename: str) -> str:
    safe_filename = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    if (
        not safe_filename
        or len(safe_filename) > 255
        or any(ord(character) < 32 for character in safe_filename)
    ):
        raise ResumeImportFailure(400, "INVALID_IMPORT_FILENAME")
    return safe_filename


def _validate_docx(content: bytes) -> None:
    if not content.startswith(b"PK\x03\x04"):
        if content.startswith(OLE_COMPOUND_SIGNATURE) and all(
            marker in content for marker in ENCRYPTED_DOCX_MARKERS
        ):
            raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID")
        raise ResumeImportFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
    try:
        from io import BytesIO

        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            names = {item.filename for item in entries}
            if not {"[Content_Types].xml", "word/document.xml"}.issubset(names):
                raise ResumeImportFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
            if len(entries) > DOCX_MAX_ENTRIES:
                raise ResumeImportFailure(413, "IMPORT_FILE_TOO_LARGE")
            total_size = 0
            for item in entries:
                path = PurePosixPath(item.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or item.flag_bits & 0x1:
                    raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID")
                total_size += item.file_size
                if (
                    item.file_size > 1024 * 1024
                    and item.file_size / max(1, item.compress_size)
                    > DOCX_MAX_COMPRESSION_RATIO
                ):
                    raise ResumeImportFailure(413, "IMPORT_FILE_TOO_LARGE")
            if total_size > DOCX_MAX_UNCOMPRESSED_BYTES:
                raise ResumeImportFailure(413, "IMPORT_FILE_TOO_LARGE")
    except ResumeImportFailure:
        raise
    except (BadZipFile, OSError) as error:
        raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID") from error


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
    else:
        _validate_docx(content)
    return extension


class ResumeImportService:
    def __init__(
        self,
        *,
        document_converter: DocumentMarkdownConverter,
        structuring_client: ResumeStructuringClient,
        max_structuring_bytes: int,
        structuring_timeout_seconds: float,
    ) -> None:
        self._document_converter = document_converter
        self._structuring_client = structuring_client
        self._max_structuring_bytes = max_structuring_bytes
        self._structuring_timeout_seconds = structuring_timeout_seconds

    async def parse_resume(
        self,
        *,
        user_id: int,
        filename: str,
        content_type: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
        on_markdown_extracted: Callable[[str], Awaitable[None]] | None = None,
    ) -> ParsedImportResult:
        conversion_started = monotonic()
        logger.info(
            "resume import stage started",
            extra={
                "operation_id": operation_id,
                "stage": "document_conversion",
            },
        )
        try:
            conversion = await self._document_converter.convert(
                filename=filename,
                content_type=content_type,
                content=content,
                operation_id=operation_id,
                deadline_monotonic=deadline_monotonic,
            )
        except DocumentConversionFailure as error:
            raise ResumeImportFailure(
                error.status_code,
                error.code,
                stage="document_conversion",
                exception_type=type(error).__name__,
            ) from error
        logger.info(
            "resume import stage completed",
            extra={
                "operation_id": operation_id,
                "stage": "document_conversion",
                "duration_ms": round((monotonic() - conversion_started) * 1000),
                "source_format": conversion.source_format,
                "warning_count": len(conversion.warnings),
            },
        )
        if on_markdown_extracted is not None:
            await on_markdown_extracted(conversion.markdown)
        if len(conversion.markdown.encode("utf-8")) > self._max_structuring_bytes:
            raise ResumeImportFailure(413, "STRUCTURING_INPUT_TOO_LARGE")

        section_ir = build_section_ir(conversion.markdown)
        remaining = deadline_monotonic - monotonic()
        if remaining <= 15:
            raise ResumeImportFailure(
                504,
                "IMPORT_DEADLINE_EXCEEDED",
                stage="resume_structuring",
            )
        structuring_started = monotonic()
        logger.info(
            "resume import stage started",
            extra={
                "operation_id": operation_id,
                "stage": "resume_structuring",
            },
        )
        try:
            draft = await self._structuring_client.extract(
                user_id=user_id,
                section_ir=section_ir,
                timeout_seconds=min(
                    self._structuring_timeout_seconds,
                    remaining - 15,
                ),
            )
        except StructuringModelNotConfiguredError as error:
            raise ResumeImportFailure(
                503,
                "STRUCTURING_MODEL_UNAVAILABLE",
                stage="resume_structuring",
                exception_type=type(error).__name__,
            ) from error
        except ResumeStructureInvalidError as error:
            raise ResumeImportFailure(
                422,
                "RESUME_STRUCTURE_INVALID",
                stage="model_response_validation",
                exception_type=type(error).__name__,
            ) from error
        except StructuringModelError as error:
            raise ResumeImportFailure(
                502,
                "STRUCTURING_MODEL_FAILED",
                stage="resume_structuring",
                exception_type=type(error).__name__,
            ) from error
        logger.info(
            "resume import stage completed",
            extra={
                "operation_id": operation_id,
                "stage": "resume_structuring",
                "duration_ms": round((monotonic() - structuring_started) * 1000),
            },
        )

        normalization_started = monotonic()
        logger.info(
            "resume import stage started",
            extra={
                "operation_id": operation_id,
                "stage": "resume_normalization",
            },
        )
        try:
            normalized = finalize_resume_document(draft, conversion.markdown)
        except ValidationError as error:
            metadata = _validation_metadata(error)
            raise ResumeImportFailure(
                422,
                "RESUME_STRUCTURE_INVALID",
                stage="resume_normalization",
                exception_type=type(error).__name__,
                **metadata,
            ) from error
        except ValueError as error:
            raise ResumeImportFailure(
                422,
                "RESUME_STRUCTURE_INVALID",
                stage="resume_normalization",
                exception_type=type(error).__name__,
            ) from error
        logger.info(
            "resume import stage completed",
            extra={
                "operation_id": operation_id,
                "stage": "resume_normalization",
                "duration_ms": round((monotonic() - normalization_started) * 1000),
                "warning_count": len(normalized.warnings),
            },
        )
        if deadline_monotonic - monotonic() <= 0:
            raise ResumeImportFailure(
                504,
                "IMPORT_DEADLINE_EXCEEDED",
                stage="resume_normalization",
            )
        return ParsedImportResult(
            document=normalized.document,
            extracted_markdown=conversion.markdown,
            source_file_format=conversion.source_format,
            warnings=merge_import_warnings(
                conversion.warnings,
                section_ir.warnings,
                normalized.warnings,
            ),
        )
