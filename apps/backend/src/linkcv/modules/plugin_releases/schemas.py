from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class PluginReleasePointer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[2, 3] = 3
    status: Literal["published", "unpublished"] = "published"
    version: str
    released_at: datetime
    object_key: str
    size: int
    sha256: str


class PluginRelease(BaseModel):
    version: str
    released_at: datetime
    browser: Literal["Chrome"] = "Chrome"
    manifest_version: Literal[3] = 3
    size: int
    sha256: str
    download_url: str


class PluginReleaseCurrentResponse(BaseModel):
    status: Literal["available", "unpublished"]
    release: PluginRelease | None


class PluginReleasePublishResponse(BaseModel):
    release: PluginRelease
    cleanup_pending: bool = False


class AdminPluginReleaseCurrentResponse(BaseModel):
    status: Literal["absent", "published", "unpublished"]
    release: PluginRelease | None


class PluginReleaseUnpublishResponse(BaseModel):
    unpublished: Literal[True] = True
    release: PluginRelease


class PluginReleaseReactivateResponse(BaseModel):
    release: PluginRelease


class PluginReleaseDeleteResponse(BaseModel):
    deleted: Literal[True] = True
