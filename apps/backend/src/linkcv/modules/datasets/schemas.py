from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserDatasetRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(strict=True)


class DatasetFolderCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(strict=True)


class DatasetFolderRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(strict=True)


class DatasetFolderRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    dataset_count: int = 0
    created_at: datetime
    updated_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class DatasetFolderListResponse(BaseModel):
    folders: list[DatasetFolderRecord]
    total_count: int
    uncategorized_count: int


class DatasetFolderDeleteResponse(BaseModel):
    deleted: bool
    affected_dataset_count: int


class DatasetMoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    folder_id: str = Field(min_length=1)


class DatasetBatchMoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_ids: list[str]
    folder_id: str = Field(min_length=1)


class DatasetBatchMoveResponse(BaseModel):
    moved_count: int


class UserDatasetDeleteResponse(BaseModel):
    deleted: bool


class UserDatasetRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    folder_id: str | None = None
    file_name: str
    file_format: str
    file_size: int
    upload_status: str
    parse_status: str | None
    failure_reason: str | None
    created_at: datetime
    content_revision: str = "0"
    content_updated_at: datetime | None = None
    replacement: dict | None = None
    folder_name: str | None = None

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)

    @field_validator("folder_id", mode="before")
    @classmethod
    def stringify_folder_id(cls, value: object) -> str | None:
        if value is None:
            return None
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
    content_format: str = "markdown"
    content_revision: str = "0"
    content_updated_at: datetime | None = None

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)




class DatasetReplacementRetryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=64, strict=True)
    confirm_replace: bool
