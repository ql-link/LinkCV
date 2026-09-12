from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pypdfium2 as pdfium
import pytest

from linkcv.core.errors import ApiError
from linkcv.services.dataset_upload_service import validate_dataset_file


def valid_pdf() -> bytes:
    document = pdfium.PdfDocument.new()
    document.new_page(595, 842)
    output = BytesIO()
    document.save(output)
    document.close()
    return output.getvalue()


def valid_docx() -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", "<document />")
    return output.getvalue()


def oversized_docx_entry() -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", b"0" * (10 * 1024 * 1024 + 1))
    return output.getvalue()


@pytest.mark.parametrize(
    ("filename", "content", "expected_format"),
    [
        ("notes.md", "# 张三".encode(), "md"),
        ("notes.txt", "张三".encode(), "txt"),
        ("resume.pdf", valid_pdf(), "pdf"),
        ("resume.docx", valid_docx(), "docx"),
    ],
)
def test_validate_dataset_file_accepts_supported_content(
    filename: str,
    content: bytes,
    expected_format: str,
) -> None:
    result = validate_dataset_file(
        filename=filename,
        content=content,
        max_bytes=10 * 1024 * 1024,
    )

    assert result.file_format == expected_format
    assert result.file_size == len(content)
    assert len(result.sha256) == 64
    assert len(result.request_fingerprint) == 64


@pytest.mark.parametrize(
    ("filename", "content", "expected_status"),
    [
        ("notes.exe", b"MZ", 400),
        ("fake.pdf", b"%PDF-1.7 without eof", 400),
        ("fake.docx", b"PK\x03\x04broken", 400),
        ("danger.docx", oversized_docx_entry(), 400),
        ("binary.txt", b"hello\x00world", 400),
        ("invalid.md", b"\xff", 400),
        ("empty.md", b"", 400),
    ],
)
def test_validate_dataset_file_rejects_unsafe_content(
    filename: str,
    content: bytes,
    expected_status: int,
) -> None:
    with pytest.raises(ApiError) as captured:
        validate_dataset_file(
            filename=filename,
            content=content,
            max_bytes=10 * 1024 * 1024,
        )

    assert captured.value.status_code == expected_status


def test_validate_dataset_file_rejects_oversize_before_format_processing() -> None:
    with pytest.raises(ApiError) as captured:
        validate_dataset_file(
            filename="notes.md",
            content=b"12345",
            max_bytes=4,
        )

    assert captured.value.status_code == 413
    assert captured.value.code == "DATASET_FILE_TOO_LARGE"


def test_dataset_fingerprint_is_stable_and_sensitive_to_content() -> None:
    first = validate_dataset_file(
        filename="notes.md",
        content=b"same",
        max_bytes=100,
    )
    replay = validate_dataset_file(
        filename="notes.md",
        content=b"same",
        max_bytes=100,
    )
    changed = validate_dataset_file(
        filename="notes.md",
        content=b"different",
        max_bytes=100,
    )

    assert first.request_fingerprint == replay.request_fingerprint
    assert first.request_fingerprint != changed.request_fingerprint
