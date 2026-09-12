from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePath, PurePosixPath
from zipfile import BadZipFile, ZipFile

import pypdfium2 as pdfium

from linkcv.core.errors import ApiError
from linkcv.services.resume_import_service import (
    DOCX_MAX_COMPRESSION_RATIO,
    DOCX_MAX_ENTRIES,
    DOCX_MAX_UNCOMPRESSED_BYTES,
)

SUPPORTED_DATASET_FORMATS = frozenset({"docx", "pdf", "md", "txt"})
CANONICAL_CONTENT_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "md": "text/markdown",
    "txt": "text/plain",
}
DOCX_MAX_ENTRY_BYTES = 10 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ValidatedDatasetFile:
    file_name: str
    file_format: str
    content_type: str
    content: bytes
    file_size: int
    sha256: str
    request_fingerprint: str


def safe_dataset_filename(filename: str) -> str:
    safe_filename = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    if (
        not safe_filename
        or len(safe_filename) > 255
        or any(ord(character) < 32 or ord(character) == 127 for character in safe_filename)
    ):
        raise ApiError(400, "INVALID_DATASET_FILENAME")
    return safe_filename


def _validate_pdf(content: bytes) -> None:
    if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-1024:]:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
    try:
        document = pdfium.PdfDocument(content)
        try:
            if len(document) < 1:
                raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
        finally:
            document.close()
    except ApiError:
        raise
    except Exception as error:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE") from error


def _validate_docx(content: bytes) -> None:
    if not content.startswith(b"PK\x03\x04"):
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            names = {item.filename for item in entries}
            if not {"[Content_Types].xml", "word/document.xml"}.issubset(names):
                raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
            if len(entries) > DOCX_MAX_ENTRIES:
                raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
            total_size = 0
            for item in entries:
                path = PurePosixPath(item.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or item.flag_bits & 0x1:
                    raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
                if item.file_size > DOCX_MAX_ENTRY_BYTES:
                    raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
                total_size += item.file_size
                if (
                    item.file_size > 1024 * 1024
                    and item.file_size / max(1, item.compress_size)
                    > DOCX_MAX_COMPRESSION_RATIO
                ):
                    raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
            if total_size > DOCX_MAX_UNCOMPRESSED_BYTES:
                raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
    except ApiError:
        raise
    except (BadZipFile, OSError) as error:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE") from error


def _validate_text(content: bytes) -> None:
    if b"\x00" in content:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
    try:
        content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE") from error


def validate_dataset_file(
    *,
    filename: str,
    content: bytes,
    max_bytes: int,
) -> ValidatedDatasetFile:
    safe_filename = safe_dataset_filename(filename)
    if not content:
        raise ApiError(400, "EMPTY_DATASET_FILE")
    if len(content) > max_bytes:
        raise ApiError(413, "DATASET_FILE_TOO_LARGE")

    extension = PurePath(safe_filename).suffix.lower().lstrip(".")
    if extension not in SUPPORTED_DATASET_FORMATS:
        raise ApiError(400, "UNSUPPORTED_DATASET_FILE")
    if extension == "pdf":
        _validate_pdf(content)
    elif extension == "docx":
        _validate_docx(content)
    else:
        _validate_text(content)

    content_sha256 = hashlib.sha256(content).hexdigest()
    canonical_content_type = CANONICAL_CONTENT_TYPES[extension]
    fingerprint_payload = {
        "version": 1,
        "file_name": safe_filename,
        "file_format": extension,
        "content_type": canonical_content_type,
        "file_size": len(content),
        "content_sha256": content_sha256,
    }
    encoded = json.dumps(
        fingerprint_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return ValidatedDatasetFile(
        file_name=safe_filename,
        file_format=extension,
        content_type=canonical_content_type,
        content=content,
        file_size=len(content),
        sha256=content_sha256,
        request_fingerprint=hashlib.sha256(encoded).hexdigest(),
    )
