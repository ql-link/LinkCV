from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import logging
import re
from pathlib import PurePath, PurePosixPath
from time import monotonic
from typing import Literal
from zipfile import BadZipFile, ZipFile

from pydantic import ValidationError
from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
    DocumentMarkdownConverter,
)
from linkcv.domain.import_warnings import merge_import_warnings
from linkcv.domain.resume_import_composition import (
    ImportLayoutRecipe,
    ResumeImportCompositionError,
    compose_canonical_resume,
    recipe_for_template,
)
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
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "pdf": {"application/pdf"},
}
DOCX_MAX_ENTRIES = 5000
DOCX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
DOCX_MAX_COMPRESSION_RATIO = 100
OLE_COMPOUND_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")
ENCRYPTED_DOCX_MARKERS = tuple(
    value.encode("utf-16le") for value in ("EncryptedPackage", "EncryptionInfo")
)

STRICT_LAYOUT_WARNINGS = {
    "pdf_low_text_quality",
    "docx_embedded_images_omitted",
    "docx_table_content_present",
    "docx_textbox_order_may_change",
}
_MARKDOWN_HTML_RE = re.compile(
    r"<\s*/?\s*[A-Za-z][A-Za-z0-9-]*(?:\s+[^>]*|/?)\s*>"
    r"|<!DOCTYPE\b|<!--[\s\S]*?-->",
    re.IGNORECASE,
)
_MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])")
_MARKDOWN_TABLE_RE = re.compile(
    r"^\s*\|?.+\|.+\|?\s*$\n\s*\|?\s*:?-{3,}:?\s*\|",
    re.MULTILINE,
)
_MARKDOWN_EMBED_RE = re.compile(
    r"\[\[\s*(?:embed|object|iframe)\b",
    re.IGNORECASE,
)
_DOCX_LOSS_TAGS = (
    b"w:drawing",
    b"w:pict",
    b"w:tbl",
    b"w:txbxContent",
)
_DOCX_LOSS_TAG_RE = re.compile(
    rb"</?(?:[A-Za-z_][A-Za-z0-9_.-]*:)?(?:drawing|pict|tbl|txbxContent)(?:\s|/?>)"
)

_LINKPARSE_MARKER_RE = re.compile(
    r"^\s*(?:"
    r"<!--\s*(?:linkparse\s*[:_-]?\s*)?(?:"
    r"page\s*(?:break|separator)?|page[-_ ]?\d+)[^>]*-->"
    r"|\[\[\s*(?:linkparse\s*[:_-]?\s*)?page[-_ ]?(?:break|separator|\d+)[^\]]*\]\]"
    r"|---\s*(?:page\s+\d+|第\s*\d+\s*页)\s*---"
    r"|<!--\s*linkparse\s*[:_-][^>]*-->"
    r"|\[//\]:\s*#\s*\(\s*linkparse\b[^\n]*"
    r")\s*$",
    re.IGNORECASE,
)


def _markdown_has_unsupported_layout(markdown: str) -> bool:
    """Detect Markdown constructs that cannot be represented losslessly."""

    # LinkParse may annotate page boundaries/provenance using HTML comments.
    # Those exact, deterministic markers are represented as IR discards and
    # are not user HTML.  Unknown HTML remains unsupported.
    sanitized = "\n".join(
        line
        for line in markdown.splitlines()
        if not _LINKPARSE_MARKER_RE.fullmatch(line)
    )
    return bool(
        _MARKDOWN_HTML_RE.search(sanitized)
        or _MARKDOWN_IMAGE_RE.search(sanitized)
        or _MARKDOWN_TABLE_RE.search(sanitized)
        or _MARKDOWN_EMBED_RE.search(sanitized)
    )


def _docx_has_unsupported_layout(content: bytes) -> bool:
    """Inspect already-validated WordprocessingML parts.

    This is deliberately a byte-level tag check: it neither executes XML nor
    trusts arbitrary package relationships or external resources.  Headers,
    footers and text boxes can carry the same loss-prone layout as the main
    document, so all ``word/*.xml`` parts are checked.
    """

    try:
        from io import BytesIO

        with ZipFile(BytesIO(content)) as archive:
            for item in archive.infolist():
                if not item.filename.startswith("word/") or not item.filename.endswith(
                    ".xml"
                ):
                    continue
                document_xml = archive.read(item)
                if _DOCX_LOSS_TAG_RE.search(document_xml):
                    return True
    except (BadZipFile, KeyError, OSError):
        return False
    return False


def _pdf_has_embedded_images(content: bytes) -> bool | None:
    """Best-effort detection for PDF image objects omitted by text conversion.

    LinkParse reports OCR use for scanned and mixed PDFs, but a text PDF can
    still contain a photo or raster logo.  Those objects are visible source
    content and cannot be silently dropped from an editable import.
    """

    try:
        import pypdfium2 as pdfium
        import pypdfium2.raw as pdfium_c

        document = pdfium.PdfDocument(content)
    except Exception:
        # A text-PDF image check is a strict loss boundary. Returning unknown
        # lets the caller fail closed instead of treating inspection failure
        # as proof that no visible image exists.
        return None
    inspection: bool | None = False
    try:
        for page_index in range(len(document)):
            page = document[page_index]
            try:
                if (
                    next(
                        page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE]),
                        None,
                    )
                    is not None
                ):
                    inspection = True
                    break
            finally:
                page.close()
    except Exception:
        inspection = None
    finally:
        try:
            document.close()
        except Exception:
            inspection = None
    return inspection


def _raise_layout_unsupported(*, stage: str = "document_conversion") -> None:
    raise ResumeImportFailure(
        422,
        "RESUME_LAYOUT_UNSUPPORTED",
        stage=stage,
        exception_type="UnsupportedLayout",
    )


def validate_conversion_layout(
    conversion: DocumentMarkdownResult,
    *,
    source_content: bytes = b"",
) -> None:
    """Apply strict, deterministic format-loss checks available to service.

    LinkParse's warning envelope is the primary signal.  The service also
    checks the original DOCX package and the Markdown representation so a
    stale/mocked converter cannot silently turn unsupported input into a
    successful import.
    """

    warnings = {getattr(warning, "value", warning) for warning in conversion.warnings}
    if warnings.intersection(STRICT_LAYOUT_WARNINGS):
        _raise_layout_unsupported()
    source_format = conversion.source_format
    # PDF content is accepted only after LinkParse has validated and consumed
    # its versioned layout blocks. This deliberately permits trusted OCR,
    # scanned and mixed PDFs; OCR itself is not a loss signal once layout
    # quality and source coverage have passed upstream validation.
    if source_format == "pdf":
        if not conversion.layout_applied or conversion.layout_schema_version != 1:
            _raise_layout_unsupported()
        if conversion.detected_type not in {
            "text_pdf",
            "scanned_pdf",
            "mixed_pdf",
        }:
            _raise_layout_unsupported()
    if source_format != "pdf" and conversion.layout_applied:
        _raise_layout_unsupported()
    if (
        source_format == "pdf"
        and conversion.detected_type == "text_pdf"
        and _pdf_has_embedded_images(source_content) is not False
    ):
        _raise_layout_unsupported()
    if source_format == "docx" and _docx_has_unsupported_layout(source_content):
        _raise_layout_unsupported()
    # The converter's Markdown is the only representation available to the
    # composer, so table/image/embed constructs are rejected for every input
    # format, including stale DOCX/PDF converter results that omitted a
    # warning.  Known LinkParse comments are removed by the helper above.
    if _markdown_has_unsupported_layout(conversion.markdown):
        _raise_layout_unsupported()


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
            decoded = content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ResumeImportFailure(422, "IMPORT_CONTENT_INVALID") from error
        if _markdown_has_unsupported_layout(decoded):
            _raise_layout_unsupported()
    elif extension == "pdf":
        if not content.startswith(b"%PDF-"):
            raise ResumeImportFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
    else:
        _validate_docx(content)
        if _docx_has_unsupported_layout(content):
            _raise_layout_unsupported()
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
        import_recipe: ImportLayoutRecipe | None = None,
        template_key: str | None = None,
        renderer: Literal["flow", "columns"] = "flow",
        require_pdf_layout: bool = True,
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
                require_pdf_layout=require_pdf_layout,
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
        validate_conversion_layout(conversion, source_content=content)
        if on_markdown_extracted is not None:
            await on_markdown_extracted(conversion.markdown)
        if len(conversion.markdown.encode("utf-8")) > self._max_structuring_bytes:
            raise ResumeImportFailure(413, "STRUCTURING_INPUT_TOO_LARGE")

        section_ir = build_section_ir(
            conversion.markdown,
            source_format=(
                conversion.source_format
                if conversion.source_format in {"md", "docx", "pdf"}
                else "md"
            ),
        )
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

        composition_started = monotonic()
        composition_stage = "resume_composition"
        logger.info(
            "resume import stage started",
            extra={
                "operation_id": operation_id,
                "stage": composition_stage,
            },
        )
        try:
            # Model responses are source mappings only.  The canonical
            # composer is the sole import path; no typed/unmapped fallback is
            # allowed to turn an incomplete mapping into a successful resume.
            composed = compose_canonical_resume(
                section_ir,
                draft,
                import_recipe or recipe_for_template(template_key, renderer=renderer),
            )
            document = composed.document
            normalization_warnings = list(composed.warnings)
        except ValidationError as error:
            metadata = _validation_metadata(error)
            raise ResumeImportFailure(
                422,
                "RESUME_STRUCTURE_INVALID",
                stage=composition_stage,
                exception_type=type(error).__name__,
                **metadata,
            ) from error
        except ResumeImportCompositionError as error:
            raise ResumeImportFailure(
                422,
                error.code,
                stage=composition_stage,
                exception_type=type(error).__name__,
            ) from error
        except ValueError as error:
            raise ResumeImportFailure(
                422,
                "RESUME_STRUCTURE_INVALID",
                stage=composition_stage,
                exception_type=type(error).__name__,
            ) from error
        logger.info(
            "resume import stage completed",
            extra={
                "operation_id": operation_id,
                "stage": composition_stage,
                "duration_ms": round((monotonic() - composition_started) * 1000),
                "warning_count": len(normalization_warnings),
            },
        )
        if deadline_monotonic - monotonic() <= 0:
            raise ResumeImportFailure(
                504,
                "IMPORT_DEADLINE_EXCEEDED",
                stage=composition_stage,
            )
        return ParsedImportResult(
            document=document,
            extracted_markdown=conversion.markdown,
            source_file_format=conversion.source_format,
            warnings=merge_import_warnings(
                conversion.warnings,
                section_ir.warnings,
                normalization_warnings,
            ),
        )
