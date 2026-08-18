import asyncio
from time import monotonic

from linkcv.domain.document_conversion import (
    DocumentMarkdownResult,
)
from linkcv.integrations.document_converter import DocumentConverter


class FakeLinkParse:
    def __init__(self) -> None:
        self.pdf_calls = 0
        self.docx_calls = 0

    async def parse_pdf(self, *, filename, content, operation_id, deadline_monotonic):
        del content, operation_id, deadline_monotonic
        self.pdf_calls += 1
        return DocumentMarkdownResult(
            markdown="# PDF",
            source_file_name=filename,
            source_format="pdf",
            parser="fake-linkparse",
            parser_version="1",
        )

    async def parse_docx(
        self, *, filename, content, operation_id, deadline_monotonic
    ):
        del content, operation_id, deadline_monotonic
        self.docx_calls += 1
        return DocumentMarkdownResult(
            markdown="# DOCX",
            source_file_name=filename,
            source_format="docx",
            parser="mammoth_word",
            parser_version="linkparse-v0.2.0",
            page_count=2,
            warnings=["docx_embedded_images_omitted"],
        )


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


def test_dispatcher_keeps_markdown_local_and_routes_docx_and_pdf_to_linkparse() -> None:
    linkparse = FakeLinkParse()
    instance = DocumentConverter(
        linkparse=linkparse,
        markdown_max_bytes=1024,
    )

    markdown = convert(instance, "resume.md", b"# Markdown\r\n\r\n\r\nText  ")
    docx_result = convert(instance, "resume.docx", b"fixture")
    pdf = convert(instance, "resume.pdf", b"%PDF-fixture")

    assert markdown.markdown == "# Markdown\n\nText"
    assert markdown.parser == "linkcv-direct-markdown"
    assert docx_result.parser == "mammoth_word"
    assert docx_result.parser_version == "linkparse-v0.2.0"
    assert docx_result.page_count == 2
    assert docx_result.warnings == ["docx_embedded_images_omitted"]
    assert pdf.parser == "fake-linkparse"
    assert linkparse.docx_calls == 1
    assert linkparse.pdf_calls == 1
