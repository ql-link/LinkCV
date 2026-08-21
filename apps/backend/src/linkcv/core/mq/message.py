from time import time
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, TypeAdapter, field_validator


def _canonical_positive_id(value: str) -> str:
    if not value.isascii() or not value.isdecimal() or value.startswith("0"):
        raise ValueError("identifier must be a canonical positive decimal string")
    parsed = int(value)
    if parsed <= 0 or parsed > 2**64 - 1 or str(parsed) != value:
        raise ValueError("identifier must be a canonical positive decimal string")
    return value


class ResumeImportPayload(BaseModel):
    message_id: UUID = Field(default_factory=uuid4)
    timestamp: float = Field(default_factory=time)
    import_id: str
    template_id: str

    @field_validator("import_id", "template_id")
    @classmethod
    def validate_identifier(cls, value: str) -> str:
        return _canonical_positive_id(value)


class ResumeImportMessage(BaseModel):
    mq_type: Literal["RESUME_IMPORT_TASK"] = "RESUME_IMPORT_TASK"
    mq_name: Literal["tolink.cv.resume_import"] = "tolink.cv.resume_import"
    payload: ResumeImportPayload

    @classmethod
    def create(cls, *, import_id: int, template_id: int) -> "ResumeImportMessage":
        return cls(
            payload=ResumeImportPayload(
                import_id=str(import_id),
                template_id=str(template_id),
            )
        )

    def body(self) -> bytes:
        return self.model_dump_json().encode("utf-8")


class DatasetParsePayload(BaseModel):
    message_id: UUID = Field(default_factory=uuid4)
    timestamp: float = Field(default_factory=time)
    parse_task_id: str

    @field_validator("parse_task_id")
    @classmethod
    def validate_identifier(cls, value: str) -> str:
        return _canonical_positive_id(value)


class DatasetParseMessage(BaseModel):
    mq_type: Literal["DATASET_PARSE_TASK"] = "DATASET_PARSE_TASK"
    mq_name: Literal["tolink.cv.resume_import"] = "tolink.cv.resume_import"
    payload: DatasetParsePayload

    @classmethod
    def create(cls, *, parse_task_id: int) -> "DatasetParseMessage":
        return cls(payload=DatasetParsePayload(parse_task_id=str(parse_task_id)))

    def body(self) -> bytes:
        return self.model_dump_json().encode("utf-8")


DocumentParseTaskMessage = Annotated[
    ResumeImportMessage | DatasetParseMessage,
    Field(discriminator="mq_type"),
]
document_parse_task_message_adapter = TypeAdapter(DocumentParseTaskMessage)
