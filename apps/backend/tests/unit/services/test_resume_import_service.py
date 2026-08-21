import asyncio
from io import BytesIO
from time import monotonic
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from linkcv.domain.document_conversion import DocumentMarkdownResult
from linkcv.domain.resume_extraction import DraftBasics, ResumeExtractionDraft
from linkcv.services.resume_import_service import (
    ResumeImportFailure,
    ResumeImportService,
    safe_import_filename,
    validate_import_file,
)


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def docx_fixture(*, document_content: bytes = b"<w:document />") -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", b"<Types />")
        archive.writestr("word/document.xml", document_content)
    return output.getvalue()


class FakeConverter:
    async def convert(self, *, filename: str, **_kwargs) -> DocumentMarkdownResult:
        return DocumentMarkdownResult(
            markdown="# 张三\n\n## 专业技能\nPython",
            source_file_name=filename,
            source_format="md",
            parser="fake",
            parser_version="1",
            warnings=[],
        )


class FakeStructuringClient:
    async def extract(self, **_kwargs) -> ResumeExtractionDraft:
        return ResumeExtractionDraft(basics=DraftBasics(name="张三"))


def test_file_validation_and_safe_filename_are_side_effect_free() -> None:
    assert safe_import_filename(" C:/fakepath/resume.md ") == "resume.md"
    assert validate_import_file(
        filename="resume.md",
        content_type="text/markdown",
        content=b"# Resume",
        max_bytes=1024,
    ) == "md"
    with pytest.raises(ResumeImportFailure) as error:
        validate_import_file(
            filename="resume.md",
            content_type="text/markdown",
            content=b"",
            max_bytes=1024,
        )
    assert error.value.code == "EMPTY_IMPORT_FILE"


def test_docx_validation_accepts_required_zip_structure() -> None:
    assert (
        validate_import_file(
            filename="resume.docx",
            content_type=DOCX_MIME,
            content=docx_fixture(),
            max_bytes=2 * 1024 * 1024,
        )
        == "docx"
    )


def test_docx_validation_rejects_encrypted_compound_document() -> None:
    encrypted = bytes.fromhex("D0CF11E0A1B11AE1") + b"".join(
        value.encode("utf-16le") for value in ("EncryptedPackage", "EncryptionInfo")
    )

    with pytest.raises(ResumeImportFailure) as error:
        validate_import_file(
            filename="resume.docx",
            content_type=DOCX_MIME,
            content=encrypted,
            max_bytes=1024,
        )

    assert error.value.status_code == 422
    assert error.value.code == "IMPORT_CONTENT_INVALID"


def test_docx_validation_rejects_compression_bomb() -> None:
    compressed = docx_fixture(document_content=b"x" * (1024 * 1024 + 1))

    with pytest.raises(ResumeImportFailure) as error:
        validate_import_file(
            filename="resume.docx",
            content_type=DOCX_MIME,
            content=compressed,
            max_bytes=2 * 1024 * 1024,
        )

    assert error.value.status_code == 413
    assert error.value.code == "IMPORT_FILE_TOO_LARGE"


def test_parse_resume_calls_markdown_callback_without_changing_result() -> None:
    service = ResumeImportService(
        document_converter=FakeConverter(),
        structuring_client=FakeStructuringClient(),
        max_structuring_bytes=10_000,
        structuring_timeout_seconds=30,
    )
    archived: list[str] = []

    async def archive(markdown: str) -> None:
        archived.append(markdown)

    result = asyncio.run(
        service.parse_resume(
            user_id=1,
            filename="resume.md",
            content_type="text/markdown",
            content=b"# Zhang San",
            operation_id="task-1",
            deadline_monotonic=monotonic() + 60,
            on_markdown_extracted=archive,
        )
    )

    assert archived == [result.extracted_markdown]
    assert result.document.basics.name == "张三"
