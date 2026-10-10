from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class UserDatasetRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(strict=True)


class DatasetFolderCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(strict=True)
    description: str = Field(default="", strict=True)


class DatasetFolderRenameRequest(BaseModel):
    """PATCH 文件夹：名称与说明都可单独修改，至少提供一项。"""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, strict=True)
    description: str | None = Field(default=None, strict=True)


class DatasetFolderRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str = ""
    dataset_count: int = 0
    created_at: datetime = Field(validation_alias=AliasChoices("create_time", "created_at"))
    updated_at: datetime = Field(validation_alias=AliasChoices("update_time", "updated_at"))

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
    created_at: datetime = Field(validation_alias=AliasChoices("create_time", "created_at"))
    content_revision: str = "0"
    content_updated_at: datetime | None = None
    folder_name: str | None = None
    asset_kind: str = "document"
    interview_session_id: str | None = None
    interview_source_type: str | None = None
    duration_ms: int | None = None
    interview_label: str | None = None

    @field_validator("interview_session_id", mode="before")
    @classmethod
    def stringify_session_id(cls, value: object) -> str | None:
        if value is None:
            return None
        return str(value)

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
    max_media_file_bytes: int
    media_allowed_extensions: list[str]
    media_max_count: int
    media_max_total_bytes: int


class UserDatasetListResponse(BaseModel):
    datasets: list[UserDatasetRecord]
    limits: UserDatasetLimits


class DatasetAttachRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=1)


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
