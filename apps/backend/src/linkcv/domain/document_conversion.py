from __future__ import annotations

import math
from typing import Literal, Protocol

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictFloat,
    StrictInt,
    StrictStr,
    model_validator,
)


class DocumentConversionFailure(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


PdfLayoutRole = Literal[
    "heading",
    "paragraph",
    "ordered_list_item",
    "bullet_list_item",
]
PdfLayoutRoleSource = Literal["opendataloader", "visual_inference", "ocr"]


class PdfLayoutBlock(BaseModel):
    """One physical PDF text line returned by LinkParse.

    The model is deliberately strict because this payload is an untrusted
    cross-service boundary. Cross-block relationships (order, rows and
    continuation references) are checked by the LinkParse adapter after all
    blocks have been parsed.
    """

    model_config = ConfigDict(extra="forbid")

    block_id: StrictStr = Field(min_length=1, max_length=200)
    source_order: StrictInt = Field(ge=0)
    source_page: StrictInt = Field(ge=1)
    role: PdfLayoutRole
    heading_level: Literal[1, 2] | None = None
    text: StrictStr = Field(min_length=1, max_length=20_000)
    bbox: tuple[float, float, float, float]
    row_id: StrictStr | None = Field(default=None, min_length=1, max_length=200)
    continuation_of: StrictStr | None = Field(
        default=None, min_length=1, max_length=200
    )
    join_with: Literal["", " "] = ""
    confidence: StrictFloat | None = Field(default=None, ge=0, le=1)
    role_source: PdfLayoutRoleSource

    @model_validator(mode="before")
    @classmethod
    def validate_bbox_shape(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        bbox = value.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            raise ValueError("bbox must contain exactly four numbers")
        # Do not let Pydantic coerce arbitrary strings or booleans into
        # coordinates. JSON integers are valid coordinates and are converted
        # to floats by the declared tuple type below.
        if any(
            isinstance(coordinate, bool)
            or not isinstance(coordinate, (int, float))
            or not math.isfinite(float(coordinate))
            for coordinate in bbox
        ):
            raise ValueError("bbox coordinates must be finite numbers")
        return value

    @model_validator(mode="after")
    def validate_shape(self) -> "PdfLayoutBlock":
        if not self.text.strip() or "\n" in self.text or "\r" in self.text:
            raise ValueError(
                "layout block text must contain one non-empty physical line"
            )
        x0, y0, x1, y1 = self.bbox
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError("layout block bbox must be inside the page")
        if self.role == "heading":
            if self.heading_level not in {1, 2}:
                raise ValueError("heading blocks require heading_level 1 or 2")
        elif self.heading_level is not None:
            raise ValueError("non-heading blocks cannot have heading_level")
        if self.continuation_of is None and self.join_with != "":
            raise ValueError("join_with is only valid for continuation blocks")
        if self.continuation_of == self.block_id:
            raise ValueError("a block cannot continue itself")
        return self


class PdfLayoutQuality(BaseModel):
    """Quality counters accompanying a PDF layout extraction."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["passed", "degraded"]
    source_line_count: StrictInt = Field(ge=0)
    output_block_count: StrictInt = Field(ge=0)
    heading_count: StrictInt = Field(ge=0)
    row_group_count: StrictInt = Field(ge=0)
    warnings: list[StrictStr] = Field(default_factory=list, max_length=100)


class PdfLayout(BaseModel):
    """Versioned PDF layout contract nested under ``meta.pdf.layout``."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    blocks: list[PdfLayoutBlock] = Field(max_length=5_000)
    quality: PdfLayoutQuality


# More explicit aliases make the type useful to callers that prefer the
# document-prefixed naming while keeping the wire/domain name concise.
DocumentPdfLayoutBlock = PdfLayoutBlock
DocumentPdfLayoutQuality = PdfLayoutQuality
DocumentPdfLayout = PdfLayout


class DocumentMarkdownResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    markdown: str
    source_file_name: str
    source_format: Literal["md", "docx", "pdf", "txt"]
    parser: str
    parser_version: str
    page_count: int | None = Field(default=None, ge=1, le=50)
    detected_type: Literal["text_pdf", "scanned_pdf", "mixed_pdf", "docx"] | None = None
    ocr_applied: bool = False
    warnings: list[str] = Field(default_factory=list)
    # A PDF result is trusted by the import service only when the adapter has
    # validated and consumed the versioned layout contract. DOCX/Markdown
    # keep the default false and therefore retain their existing behavior.
    layout_applied: bool = False
    layout_schema_version: Literal[1] | None = None

    @model_validator(mode="after")
    def validate_layout_marker(self) -> "DocumentMarkdownResult":
        if self.layout_applied and self.source_format != "pdf":
            raise ValueError("layout_applied is only valid for PDF results")
        if self.layout_applied and self.layout_schema_version != 1:
            raise ValueError("layout_applied requires layout schema version 1")
        if not self.layout_applied and self.layout_schema_version is not None:
            raise ValueError("layout schema version requires layout_applied")
        return self


class DocumentMarkdownConverter(Protocol):
    async def convert(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
        operation_id: str,
        deadline_monotonic: float,
        require_pdf_layout: bool = False,
    ) -> DocumentMarkdownResult: ...
