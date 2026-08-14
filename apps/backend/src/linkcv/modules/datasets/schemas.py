from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class UserDatasetRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    file_name: str
    file_format: str
    file_size: int
    created_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> str:
        return str(value)


class UserDatasetListResponse(BaseModel):
    datasets: list[UserDatasetRecord]
