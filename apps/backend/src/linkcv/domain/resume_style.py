import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PageStyleV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    size: Literal["A4"] = "A4"
    margin_top_mm: float = Field(default=14, ge=0, le=50)
    margin_right_mm: float = Field(default=16, ge=0, le=50)
    margin_bottom_mm: float = Field(default=14, ge=0, le=50)
    margin_left_mm: float = Field(default=16, ge=0, le=50)


class ResumeStyleV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    template_key: str = Field(default="classic-cn", min_length=1, max_length=64)
    font_family: str = Field(default="source-han-serif", min_length=1, max_length=100)
    font_size: float = Field(default=14, ge=6, le=32)
    line_height: float = Field(default=1.55, ge=1, le=3)
    accent_color: str = "#2F4858"
    smart_one_page: bool = False
    page: PageStyleV1 = Field(default_factory=PageStyleV1)
    section_order: list[str] = Field(
        default_factory=lambda: [
            "basics",
            "work_experiences",
            "projects",
            "educations",
            "skills",
        ],
        max_length=50,
    )

    @model_validator(mode="after")
    def validate_style(self) -> "ResumeStyleV1":
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", self.accent_color):
            raise ValueError("accent_color must use #RRGGBB")
        if len(self.section_order) != len(set(self.section_order)):
            raise ValueError("section_order cannot contain duplicates")
        return self


def default_resume_style() -> ResumeStyleV1:
    return ResumeStyleV1()
