import re
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    from linkcv.domain.resume_document import ResumeDocument


class PageStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    size: Literal["A4"] = "A4"
    margin_top_mm: float = Field(default=14, ge=0, le=50)
    margin_right_mm: float = Field(default=16, ge=0, le=50)
    margin_bottom_mm: float = Field(default=14, ge=0, le=50)
    margin_left_mm: float = Field(default=16, ge=0, le=50)


TemplateRegionKind = Literal["header", "sidebar", "main", "footer"]
TemplateRendererKey = Literal["flow", "columns"]
TemplateContentKind = Literal[
    "basics",
    "profile",
    "work",
    "education",
    "project",
    "skills",
    "activity",
    "interests",
    "certificates",
    "awards",
    "languages",
    "custom",
    "avatar",
]


class TemplateRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    kind: TemplateRegionKind
    order: int = Field(default=0, ge=0, le=100)


class TemplateSlot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    region_id: str = Field(min_length=1, max_length=64)
    accepts: list[TemplateContentKind] = Field(min_length=1, max_length=20)
    required: bool = False
    fallback: bool = False
    order: int = Field(default=0, ge=0, le=100)

    @model_validator(mode="after")
    def validate_accepts(self) -> "TemplateSlot":
        if len(self.accepts) != len(set(self.accepts)):
            raise ValueError("slot accepts cannot contain duplicates")
        return self


class TemplateAvatar(BaseModel):
    model_config = ConfigDict(extra="forbid")

    visibility: Literal["show", "hide"] = "hide"
    fallback_asset: Literal["system-default", "none"] = "none"
    size: int = Field(default=96, ge=56, le=220)

    @model_validator(mode="after")
    def validate_fallback(self) -> "TemplateAvatar":
        if self.visibility == "hide" and self.fallback_asset != "none":
            raise ValueError("hidden avatar cannot declare a fallback asset")
        return self


class TemplateManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    renderer_key: TemplateRendererKey
    regions: list[TemplateRegion] = Field(min_length=1, max_length=8)
    slots: list[TemplateSlot] = Field(min_length=1, max_length=30)
    avatar: TemplateAvatar

    @model_validator(mode="after")
    def validate_manifest(self) -> "TemplateManifest":
        region_ids = [region.id for region in self.regions]
        slot_ids = [slot.id for slot in self.slots]
        if len(region_ids) != len(set(region_ids)):
            raise ValueError("template region ids must be unique")
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("template slot ids must be unique")
        if any(slot.region_id not in region_ids for slot in self.slots):
            raise ValueError("template slot references an unknown region")
        fallback_slots = [slot for slot in self.slots if slot.fallback]
        if len(fallback_slots) != 1 or "custom" not in fallback_slots[0].accepts:
            raise ValueError("template requires exactly one custom fallback slot")
        main_count = sum(region.kind == "main" for region in self.regions)
        sidebar_count = sum(region.kind == "sidebar" for region in self.regions)
        if main_count != 1:
            raise ValueError("template requires exactly one main region")
        if self.renderer_key == "columns" and sidebar_count != 1:
            raise ValueError("columns renderer requires exactly one sidebar region")
        if self.renderer_key == "flow" and sidebar_count:
            raise ValueError("flow renderer cannot declare a sidebar region")
        explicit_accepts = [
            content_kind
            for slot in self.slots
            if not slot.fallback
            for content_kind in slot.accepts
            if content_kind != "avatar"
        ]
        if len(explicit_accepts) != len(set(explicit_accepts)):
            raise ValueError("content kind cannot target multiple explicit slots")
        if self.avatar.visibility == "show" and not any(
            "avatar" in slot.accepts for slot in self.slots
        ):
            raise ValueError("visible avatar requires an avatar slot")
        return self


def default_template_manifest(
    *,
    renderer_key: TemplateRendererKey = "flow",
    avatar_visibility: Literal["show", "hide"] = "hide",
) -> TemplateManifest:
    regions = [TemplateRegion(id="main", kind="main", order=1)]
    slots = [
        TemplateSlot(
            id="main-content",
            region_id="main",
            accepts=[
                "basics",
                "profile",
                "work",
                "education",
                "project",
                "skills",
                "activity",
                "interests",
                "certificates",
                "awards",
                "languages",
                "custom",
            ],
            fallback=True,
        )
    ]
    if renderer_key == "columns":
        regions.insert(0, TemplateRegion(id="sidebar", kind="sidebar", order=0))
        slots.insert(
            0,
            TemplateSlot(
                id="sidebar-basics",
                region_id="sidebar",
                # Keep the identity/header block in the main reading flow. A
                # sidebar may collect secondary semantic sections and the
                # avatar, but moving the complete basics block here would also
                # move the candidate name and headline out of the template
                # header.
                accepts=["profile", "skills", "interests", "languages", "avatar"],
                order=0,
            ),
        )
    else:
        slots.insert(
            0,
            TemplateSlot(
                id="avatar",
                region_id="main",
                accepts=["avatar"],
                order=0,
            ),
        )
    return TemplateManifest(
        renderer_key=renderer_key,
        regions=regions,
        slots=slots,
        avatar=TemplateAvatar(
            visibility=avatar_visibility,
            fallback_asset="system-default" if avatar_visibility == "show" else "none",
        ),
    )


def template_content_assignments(
    document: "ResumeDocument",
    manifest: TemplateManifest,
) -> dict[str, str]:
    """Build the deterministic content-id to slot-id composition plan.

    The plan is validated before a template switch is committed. Presentation
    renderers may arrange regions differently, but they must all consume this
    same exactly-once assignment.
    """

    slots = sorted(manifest.slots, key=lambda slot: slot.order)
    fallback = next((slot for slot in slots if slot.fallback), None)
    if fallback is None:
        raise ValueError("template manifest requires a fallback slot")

    assignments: dict[str, str] = {}
    for section in document.semantic_sections:
        explicit = next(
            (
                slot
                for slot in slots
                if not slot.fallback and section.semantic_kind in slot.accepts
            ),
            None,
        )
        slot = explicit or fallback
        if section.id in assignments:
            raise ValueError("resume content id is assigned more than once")
        assignments[section.id] = slot.id

    if len(assignments) != len(document.semantic_sections):
        raise ValueError("resume content assignment is incomplete")
    return assignments


class ResumePresentation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_key: str = Field(default="classic-cn", min_length=1, max_length=64)
    font_family: str = Field(default="source-han-serif", min_length=1, max_length=100)
    font_size: float = Field(default=14, ge=6, le=32)
    line_height: float = Field(default=1.55, ge=1, le=3)
    accent_color: str = "#2F4858"
    smart_one_page: bool = False
    page: PageStyle = Field(default_factory=PageStyle)
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
    manifest: TemplateManifest

    @model_validator(mode="after")
    def validate_style(self) -> "ResumePresentation":
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", self.accent_color):
            raise ValueError("accent_color must use #RRGGBB")
        if len(self.section_order) != len(set(self.section_order)):
            raise ValueError("section_order cannot contain duplicates")
        return self


def default_resume_style() -> ResumePresentation:
    return ResumePresentation(manifest=default_template_manifest())
