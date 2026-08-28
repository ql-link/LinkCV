from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserDatasetRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(strict=True)


class UserDatasetDeleteResponse(BaseModel):
    deleted: bool


class UserDatasetRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    file_name: str
    file_format: str
    file_size: int
    upload_status: str
    parse_status: str | None
    failure_reason: str | None
    created_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class UserDatasetLimits(BaseModel):
    max_file_bytes: int
    max_files_per_batch: int
    allowed_extensions: list[str]


class UserDatasetListResponse(BaseModel):
    datasets: list[UserDatasetRecord]
    limits: UserDatasetLimits


class UserDatasetContentResponse(BaseModel):
    id: str
    file_name: str
    file_format: str
    markdown: str

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)
