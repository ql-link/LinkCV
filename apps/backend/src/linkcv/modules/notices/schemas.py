from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field


DatabaseId = Annotated[str, Field(pattern=r"^[1-9][0-9]{0,19}$")]


class NoticeItem(BaseModel):
    id: DatabaseId
    title: str
    content: str
    published_at: datetime


class NoticeListResponse(BaseModel):
    items: list[NoticeItem]
    unread_count: int


class NoticeMarkReadResponse(BaseModel):
    ok: bool
    unread_count: int


class AdminNoticeItem(NoticeItem):
    revoked_at: datetime | None


class AdminNoticeListResponse(BaseModel):
    items: list[AdminNoticeItem]


class AdminNoticeMutationResponse(BaseModel):
    notice: AdminNoticeItem


class NoticeCreateRequest(BaseModel):
    title: str
    content: str
