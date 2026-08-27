import asyncio
from time import monotonic

from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
import pytest
from linkcv.integrations.document_converter import DocumentConverter


class FakeLinkParse:
    def __init__(self) -> None:
        self.pdf_calls = 0
        self.docx_calls = 0
        self.pdf_layout_requirements: list[bool] = []

    async def parse_pdf(
        self,
        *,
        filename,
        content,
        operation_id,
        deadline_monotonic,
        require_layout=False,
    ):
        del content, operation_id, deadline_monotonic
        self.pdf_calls += 1
        self.pdf_layout_requirements.append(require_layout)
        return DocumentMarkdownResult(
            markdown="# PDF",
            source_file_name=filename,
            source_format="pdf",
            parser="fake-linkparse",
            parser_version="1",
        )

    async def parse_docx(self, *, filename, content, operation_id, deadline_monotonic):
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


def convert(
    instance: DocumentConverter,
    filename: str,
    content: bytes,
    *,
    require_pdf_layout: bool = False,
):
    content_types = {
        "md": "text/markdown",
        "txt": "text/plain",
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
            require_pdf_layout=require_pdf_layout,
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
    assert linkparse.pdf_layout_requirements == [False]


def test_dispatcher_only_requests_pdf_layout_when_caller_opts_in() -> None:
    linkparse = FakeLinkParse()
    instance = DocumentConverter(linkparse=linkparse, markdown_max_bytes=1024)

    convert(
        instance,
        "resume.pdf",
        b"%PDF-fixture",
        require_pdf_layout=True,
    )

    assert linkparse.pdf_layout_requirements == [True]


def test_txt_is_normalized_locally() -> None:
    linkparse = FakeLinkParse()
    instance = DocumentConverter(linkparse=linkparse, markdown_max_bytes=1024)

    result = convert(instance, "notes.txt", "标题\r\n\r\n\r\n正文  ".encode())

    assert result.markdown == "标题\n\n正文"
    assert result.source_format == "txt"
    assert result.parser == "linkcv-direct-txt"
    assert linkparse.docx_calls == 0
    assert linkparse.pdf_calls == 0


@pytest.mark.parametrize("content", [b"", b"\xff"])
def test_txt_rejects_empty_or_non_utf8_content(content: bytes) -> None:
    instance = DocumentConverter(linkparse=FakeLinkParse(), markdown_max_bytes=1024)

    with pytest.raises((DocumentConversionFailure, UnicodeDecodeError)):
        convert(instance, "notes.txt", content)
