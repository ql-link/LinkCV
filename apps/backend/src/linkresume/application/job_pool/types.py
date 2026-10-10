from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from linkresume.domain.job_source import normalize_job_source


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "iframe"}:
            self.hidden += 1
        elif tag in {"br", "p", "div", "li"} and not self.hidden:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "iframe"}:
            self.hidden = max(0, self.hidden - 1)
        elif tag in {"p", "div", "li"} and not self.hidden:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def clean_text(value: str) -> str:
    if "<" not in value:
        return value.strip()
    parser = PlainText()
    parser.feed(value)
    return re.sub(r"\n{3,}", "\n\n", "".join(parser.parts)).strip()


def cities(raw: list[str]) -> dict:
    original = list(dict.fromkeys(x.strip() for x in raw if x.strip()))
    # Only normalize formatting, never infer a city from a province or translate it.
    names = [x[:-1] if x.endswith("市") else x for x in original]
    return {"schema_version": 1, "cities": list(dict.fromkeys(names)), "raw": original}


def job_key(native_id: object, url: str) -> str:
    value = str(native_id).strip() if native_id is not None else ""
    if value and value.isascii() and len(value) <= 189:
        return "id:" + value
    identity = value if value else normalize_job_source(url).url
    return "url:" + hashlib.sha256(identity.encode()).hexdigest()


def source_date(value: object) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value / 1000 if value > 10**11 else value, timezone.utc)
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        # These curated mainland portals expose naive wall times in China Standard Time.
        return (parsed.replace(tzinfo=timezone(timedelta(hours=8))) if parsed.tzinfo is None else parsed).astimezone(timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


class JobObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_job_key: str = Field(min_length=1, max_length=192, pattern=r"^[\x21-\x7e]+$")
    job_title: str = Field(min_length=1, max_length=200)
    job_category: str | None = Field(default=None, max_length=100)
    recruitment_channel: Literal["campus", "experienced", "unknown"] = "unknown"
    employment_type: Literal["internship", "full_time", "part_time", "contract", "unknown"] = "unknown"
    salary_text: str | None = Field(default=None, max_length=128)
    locations: dict
    description: str = Field(min_length=1, max_length=200_000)
    source_attributes: dict = Field(default_factory=lambda: {"schema_version": 1})
    published_at: datetime | None = None
    source_url: str = Field(max_length=2048)

    @field_validator("job_title", "description")
    @classmethod
    def text(cls, value):
        result = clean_text(value)
        if not result:
            raise ValueError("empty job text")
        return result

    @field_validator("locations")
    @classmethod
    def location(cls, value):
        if value.get("schema_version") != 1 or not isinstance(value.get("cities"), list) or not isinstance(value.get("raw"), list):
            raise ValueError("invalid locations")
        if set(value) != {"schema_version", "cities", "raw"} or len(value["cities"]) > 128 or len(value["raw"]) > 128:
            raise ValueError("invalid locations")
        if any(not isinstance(x, str) or not x or len(x) > 100 for x in value["cities"]) or any(not isinstance(x, str) or not x or len(x) > 200 for x in value["raw"]):
            raise ValueError("invalid city")
        return value

    @field_validator("source_url")
    @classmethod
    def url(cls, value):
        normalized = normalize_job_source(value).url
        if not normalized.startswith("https://"):
            raise ValueError("official URL must be HTTPS")
        return normalized

    @field_validator("source_attributes")
    @classmethod
    def attributes(cls, value):
        allowed = {"schema_version", "department", "education_requirement", "experience_requirement", "graduation_year", "batch", "deadline"}
        if value.get("schema_version") != 1 or set(value) - allowed:
            raise ValueError("invalid source attributes")
        for key, item in value.items():
            limit = 100 if key in {"education_requirement", "experience_requirement"} else 200
            if key != "schema_version" and item is not None and (not isinstance(item, str) or len(item) > limit):
                raise ValueError("invalid source attribute")
        return {key: item for key, item in value.items() if item is not None}


class SyncResult(BaseModel):
    jobs: list[JobObservation] = Field(default_factory=list)
    is_complete: bool = False
    invalid_count: int = 0
    error_code: str | None = None
    company_logo_url: str | None = Field(default=None, max_length=2048)
    company_logo_error_code: str | None = Field(default=None, max_length=64)


class SourceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    host: str
    portals: list[str] = Field(min_length=1, max_length=8)
    site_id: int | None = Field(default=None, ge=1)


class SourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    adapter_key: str
    portal_config: SourceConfig
    is_enabled: bool = False


class SourceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_generation: str = Field(pattern=r"^(0|[1-9][0-9]{0,19})$")
    portal_config: SourceConfig | None = None
    is_enabled: bool | None = None


class AcceptSync(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_generation: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
