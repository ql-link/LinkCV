from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class RagAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    media_type: str
    content: bytes | None = Field(default=None, exclude=True)


class RagMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_file_name: str
    source_format: str
    page_count: int | None = Field(default=None, ge=1)
    converter_version: str | None = None


class RagMarkdownResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    markdown: str
    assets: list[RagAsset] = Field(default_factory=list)
    metadata: RagMetadata
    warnings: list[str] = Field(default_factory=list)


class RagConverter(Protocol):
    async def convert(
        self,
        *,
        filename: str,
        content_type: str,
        content: bytes,
    ) -> RagMarkdownResult: ...
