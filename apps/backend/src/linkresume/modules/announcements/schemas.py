from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TITLE_MAX = 120
BODY_MAX = 5000

Level = Literal["normal", "important"]
Status = Literal["draft", "published", "unpublished"]
Visibility = Literal["draft", "scheduled", "active", "expired", "unpublished"]


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class _AnnouncementFields(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @field_validator("title", "body", check_fields=False)
    @classmethod
    def reject_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("must not be blank")
        return value

    @field_validator("starts_at", "ends_at", check_fields=False)
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("datetime must include a timezone")
        return value


class AnnouncementCreateRequest(_AnnouncementFields):
    level: Level = "normal"
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    body: str = Field(min_length=1, max_length=BODY_MAX)
    starts_at: datetime | None = Field(default=None, alias="startsAt")
    ends_at: datetime | None = Field(default=None, alias="endsAt")


class AnnouncementUpdateRequest(_AnnouncementFields):
    level: Level | None = None
    title: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX)
    body: str | None = Field(default=None, min_length=1, max_length=BODY_MAX)
    starts_at: datetime | None = Field(default=None, alias="startsAt")
    ends_at: datetime | None = Field(default=None, alias="endsAt")


class AdminAnnouncement(ApiModel):
    id: str
    level: Level
    title: str
    body: str
    status: Status
    visibility: Visibility
    starts_at: datetime | None = Field(alias="startsAt")
    ends_at: datetime | None = Field(alias="endsAt")
    published_at: datetime | None = Field(alias="publishedAt")
    unpublished_at: datetime | None = Field(alias="unpublishedAt")
    created_by: str = Field(alias="createdBy")
    published_by: str | None = Field(alias="publishedBy")
    unpublished_by: str | None = Field(alias="unpublishedBy")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class AdminAnnouncementResponse(ApiModel):
    announcement: AdminAnnouncement


class AdminAnnouncementListResponse(ApiModel):
    items: list[AdminAnnouncement]
    next_cursor: str | None = Field(alias="nextCursor")


class AdminAnnouncementStatsResponse(ApiModel):
    draft: int
    published: int
    unpublished: int
    active: int
    # Published but not started yet; "published" minus "active" minus this is expired.
    scheduled: int


class UserAnnouncement(ApiModel):
    id: str
    level: Level
    title: str
    body: str
    starts_at: datetime | None = Field(alias="startsAt")
    ends_at: datetime | None = Field(alias="endsAt")
    published_at: datetime = Field(alias="publishedAt")
    read: bool


class UserAnnouncementListResponse(ApiModel):
    items: list[UserAnnouncement]
    unread_count: int = Field(alias="unreadCount")


class UnreadCountResponse(ApiModel):
    unread_count: int = Field(alias="unreadCount")
