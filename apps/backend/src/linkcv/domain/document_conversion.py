from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field


class DocumentConversionFailure(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


class DocumentMarkdownResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    markdown: str
    source_file_name: str
    source_format: Literal["md", "docx", "pdf"]
    parser: str
    parser_version: str
    page_count: int | None = Field(default=None, ge=1, le=50)
    ocr_applied: bool = False
    warnings: list[str] = Field(default_factory=list)


class DocumentMarkdownConverter(Protocol):
    async def convert(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
    ) -> DocumentMarkdownResult: ...
