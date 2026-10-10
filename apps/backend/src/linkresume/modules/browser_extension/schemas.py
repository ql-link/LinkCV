from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .field_catalog import FIELD_CATALOG


class ExtensionModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageField(ExtensionModel):
    uid: str = Field(min_length=1, max_length=128)
    section: str = Field(default="", max_length=200)
    label: str = Field(default="", max_length=300)
    placeholder: str = Field(default="", max_length=300)
    kind: str = Field(max_length=80)
    options: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=6)


class DecisionRequest(ExtensionModel):
    version: Literal[1]
    field: PageField


class FieldDecision(ExtensionModel):
    choice: str
    prob: float = Field(ge=0, le=1, allow_inf_nan=False)
    ranked: list[tuple[str, Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]]] = Field(max_length=3)

    @model_validator(mode="after")
    def known_choices(self):
        allowed = {*FIELD_CATALOG, "none"}
        if self.choice not in allowed or any(key not in allowed for key, _ in self.ranked):
            raise ValueError("unknown autofill field")
        return self
