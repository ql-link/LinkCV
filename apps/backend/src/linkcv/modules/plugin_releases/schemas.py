from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class PluginReleasePointer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    environment: str
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
