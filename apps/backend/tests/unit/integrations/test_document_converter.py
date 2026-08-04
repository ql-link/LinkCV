import asyncio
from time import monotonic

import pytest

from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.integrations.document_converter import DocumentConverter
from linkcv.integrations.docx_parse_runner import DocxParseRunner


class FakeLinkParse:
    def __init__(self) -> None:
        self.calls = 0

    async def parse_pdf(self, *, filename, content, operation_id, deadline_monotonic):
        del content, operation_id, deadline_monotonic
        self.calls += 1
        return DocumentMarkdownResult(
            markdown="# PDF",
            source_file_name=filename,
            source_format="pdf",
            parser="fake-linkparse",
            parser_version="1",
        )


class FakeDocxRunner:
    def __init__(self) -> None:
        self.calls = 0

    async def convert(self, content, *, deadline_monotonic):
        del content, deadline_monotonic
        self.calls += 1
        return "# DOCX", ["docx_embedded_images_omitted"]


def convert(instance: DocumentConverter, filename: str, content: bytes):
    content_types = {
        "md": "text/markdown",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pdf": "application/pdf",
    }
    extension = filename.rsplit(".", 1)[-1]
    return asyncio.run(
        instance.convert(
            filename=filename,
            content_type=content_types[extension],
            content=content,
            operation_id="operation",
            deadline_monotonic=monotonic() + 120,
        )
    )


def test_dispatcher_keeps_markdown_local_and_routes_docx_and_pdf_separately() -> None:
    linkparse = FakeLinkParse()
    docx = FakeDocxRunner()
    instance = DocumentConverter(
        linkparse=linkparse,
        docx_runner=docx,
        markdown_max_bytes=1024,
    )

    markdown = convert(instance, "resume.md", b"# Markdown\r\n\r\n\r\nText  ")
    docx_result = convert(instance, "resume.docx", b"fixture")
    pdf = convert(instance, "resume.pdf", b"%PDF-fixture")

    assert markdown.markdown == "# Markdown\n\nText"
    assert markdown.parser == "linkcv-direct-markdown"
    assert docx_result.parser == "mammoth"
    assert docx_result.warnings == ["docx_embedded_images_omitted"]
    assert pdf.parser == "fake-linkparse"
    assert docx.calls == 1
    assert linkparse.calls == 1


def test_docx_runner_maps_worker_spawn_failure_to_stable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_spawn(*_args, **_kwargs):
        raise OSError("process creation failed")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fail_spawn)
    runner = DocxParseRunner(timeout_seconds=1)
    with pytest.raises(DocumentConversionFailure) as raised:
        asyncio.run(
            runner.convert(
                b"fixture",
                deadline_monotonic=monotonic() + 5,
            )
        )
    assert raised.value.status_code == 502
    assert raised.value.code == "DOCUMENT_CONVERSION_FAILED"
