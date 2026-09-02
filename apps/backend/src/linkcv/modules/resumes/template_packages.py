import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from linkcv.domain.resume import (
    CanonicalResumeDocument,
    TemplateDefinition,
    compile_layout_plan,
)

TEMPLATE_PACKAGE_MAX_BYTES = 512 * 1024
TEMPLATE_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
UNSAFE_TEMPLATE_TEXT = re.compile(
    r"<[^>]+>|javascript:|file://|https?://|\{[^}]*\}|(?:^|;)\s*[-a-z]+\s*:[^;]+;",
    re.IGNORECASE,
)
LOCAL_PATH = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\)")


class TemplatePackage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=1000)
    data: CanonicalResumeDocument
    style: TemplateDefinition

    @model_validator(mode="before")
    @classmethod
    def require_canonical_contract(cls, value: object) -> object:
        if not isinstance(value, dict):
            raise ValueError("template package must be an object")
        data = value.get("data")
        style = value.get("style")
        if not isinstance(data, dict) or data.get("schema_version") != "canonical-resume.v1":
            raise ValueError("template package requires canonical resume data")
        if not isinstance(style, dict) or style.get("schema_version") != "template-definition.v1":
            raise ValueError("template package requires a template definition")
        return value

    @model_validator(mode="after")
    def validate_package(self) -> "TemplatePackage":
        if not TEMPLATE_KEY_PATTERN.fullmatch(self.key):
            raise ValueError("invalid template key")
        if self.style.template_key != self.key:
            raise ValueError("style template key does not match package key")
        _reject_unsafe_values(self.model_dump(mode="json"))
        if self.data.identity.name is not None or self.data.sections:
            raise ValueError("template package data must be blank")
        compile_layout_plan(self.data, self.style)
        return self


def _reject_unsafe_values(value: Any) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"url", "photo"} and item is not None:
                raise ValueError("external resources are not allowed")
            _reject_unsafe_values(item)
        return
    if isinstance(value, list):
        for item in value:
            _reject_unsafe_values(item)
        return
    if isinstance(value, str) and (
        UNSAFE_TEMPLATE_TEXT.search(value) or LOCAL_PATH.search(value)
    ):
        raise ValueError("unsafe template content")


def parse_template_package(content: bytes) -> TemplatePackage:
    if not content or len(content) > TEMPLATE_PACKAGE_MAX_BYTES:
        raise ValueError("invalid template package size")
    try:
        payload = json.loads(content.decode("utf-8"))
        return TemplatePackage.model_validate(payload)
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError) as error:
        raise ValueError("invalid template package") from error
