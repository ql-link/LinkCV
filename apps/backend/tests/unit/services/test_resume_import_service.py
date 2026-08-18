import asyncio
from time import monotonic

import pytest

from linkcv.domain.document_conversion import DocumentMarkdownResult
from linkcv.domain.resume_extraction import DraftBasics, ResumeExtractionDraft
from linkcv.services.resume_import_service import (
    ResumeImportFailure,
    ResumeImportService,
    safe_import_filename,
    validate_import_file,
)


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
