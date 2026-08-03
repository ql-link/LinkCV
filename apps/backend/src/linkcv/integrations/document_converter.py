from __future__ import annotations

import unicodedata

from linkcv.domain.document_conversion import (
    DocumentConversionFailure,
    DocumentMarkdownResult,
)
from linkcv.integrations.docx_parse_runner import DocxParseRunner
from linkcv.integrations.linkparse_client import LinkParseClient


def normalize_markdown(markdown: str) -> str:
    value = unicodedata.normalize("NFC", markdown)
    lines = [
        line.rstrip()
        for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    ]
    normalized: list[str] = []
    previous_blank = False
    for line in lines:
        if not line:
            if previous_blank:
                continue
            previous_blank = True
        else:
            previous_blank = False
        normalized.append(line)
    return "\n".join(normalized).strip()


class DocumentConverter:
    def __init__(
        self,
        *,
        linkparse: LinkParseClient,
        docx_runner: DocxParseRunner,
        markdown_max_bytes: int,
    ) -> None:
        self._linkparse = linkparse
        self._docx_runner = docx_runner
        self._markdown_max_bytes = markdown_max_bytes

    async def convert(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
    ) -> DocumentMarkdownResult:
        del content_type
        extension = filename.rsplit(".", 1)[-1].lower()
        if extension == "pdf":
            return await self._linkparse.parse_pdf(
                filename=filename,
                content=content,
                operation_id=operation_id,
                deadline_monotonic=deadline_monotonic,
            )
        if extension == "md":
            markdown = normalize_markdown(content.decode("utf-8"))
            warnings: list[str] = []
            parser = "linkcv-direct-markdown"
        elif extension == "docx":
            markdown, warnings = await self._docx_runner.convert(
                content,
                deadline_monotonic=deadline_monotonic,
            )
            markdown = normalize_markdown(markdown)
            parser = "mammoth"
        else:
            raise DocumentConversionFailure(415, "UNSUPPORTED_IMPORT_FORMAT")
        if not markdown:
            raise DocumentConversionFailure(422, "IMPORT_CONTENT_INVALID")
        if len(markdown.encode("utf-8")) > self._markdown_max_bytes:
            raise DocumentConversionFailure(413, "IMPORT_FILE_TOO_LARGE")
        return DocumentMarkdownResult(
            markdown=markdown,
            source_file_name=filename,
            source_format=extension,
            parser=parser,
            parser_version="1",
            warnings=warnings,
        )
