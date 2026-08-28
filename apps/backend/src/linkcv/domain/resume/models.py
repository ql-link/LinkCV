from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from linkcv.domain.resume.canonical_json import canonical_json_bytes, canonical_sha256


NodeId = Annotated[str, Field(pattern=r"^node_[a-z0-9]{16,64}$")]
SourceId = Annotated[str, Field(pattern=r"^src_[a-z0-9]{16,64}$")]
TemplateKey = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{2,63}$")]
SemanticKind = Literal[
    "identity",
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
]
SectionSemanticKind = Literal[
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
]
ALL_SEMANTIC_KINDS = {
    "identity",
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
}


class ClosedModel(BaseModel):
    # JSON Schema does not coerce scalar types.  Keep the Python boundary equally
    # strict so a payload cannot pass Pydantic and fail the shared contract (or
    # vice versa).
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    @model_validator(mode="after")
    def validate_canonical_scalars(self) -> "ClosedModel":
        canonical_json_bytes(self.model_dump(mode="json"))
        return self


class SourceReferenced(ClosedModel):
    node_id: NodeId
    source_refs: list[SourceId] = Field(max_length=64)

    @model_validator(mode="after")
    def unique_sources(self) -> "SourceReferenced":
        if len(self.source_refs) != len(set(self.source_refs)):
            raise ValueError("source_refs must be unique")
        return self


class TextValue(SourceReferenced):
    value: str = Field(max_length=20_000)


class Contact(SourceReferenced):
    contact_kind: Literal[
        "phone", "email", "website", "location", "github", "linkedin", "other"
    ]
    value: str = Field(min_length=1, max_length=2048)
    label: str | None = Field(default=None, max_length=100)


class Identity(ClosedModel):
    node_id: NodeId
    name: TextValue | None
    headline: TextValue | None
    contacts: list[Contact] = Field(max_length=32)
    avatar: MediaReference | None

    @model_validator(mode="after")
    def validate_avatar_kind(self) -> "Identity":
        if self.avatar is not None and self.avatar.media_kind != "avatar":
            raise ValueError("identity avatar must use avatar media kind")
        return self


class InlineStyle(ClosedModel):
    """User-authored inline overrides; template defaults never belong here."""

    color: Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")] | None
    font_size_pt: float | None = Field(ge=6, le=48)
    highlight_color: Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")] | None


class TextRun(ClosedModel):
    inline_type: Literal["text"]
    text: str = Field(min_length=1, max_length=20_000)
    marks: list[Literal["bold", "italic", "underline", "strike", "code"]] = Field(
        max_length=5
    )
    href: Annotated[str, Field(pattern=r"^https?://[^\s]{1,2040}$")] | None
    style: InlineStyle

    @model_validator(mode="after")
    def unique_marks(self) -> "TextRun":
        if len(self.marks) != len(set(self.marks)):
            raise ValueError("text run marks must be unique")
        return self


class ParagraphBlock(SourceReferenced):
    block_type: Literal["paragraph"]
    runs: list[InlineContent] = Field(max_length=2000)


class MediaReference(SourceReferenced):
    media_kind: Literal["avatar", "resume_image", "inline_image"]
    src: Annotated[
        str,
        Field(
            pattern=(
                r"^(?:https?://[^\s]{1,2040}|/(?:api/assets|api/resumes|templates)/[^\s]{1,2020})$"
            )
        ),
    ]
    alt: str | None = Field(max_length=300)
    width: float | None = Field(gt=0, le=794)
    width_unit: Literal["px", "%"] | None
    height_px: float | None = Field(ge=16, le=240)
    align: Literal["left", "center", "right", "full"] | None
    system_fallback: bool

    @model_validator(mode="after")
    def validate_media_layout(self) -> "MediaReference":
        if self.media_kind == "avatar":
            if self.width_unit not in {None, "px"} or self.align is not None:
                raise ValueError("avatar media cannot declare body-image layout")
            if self.width is not None and not 56 <= self.width <= 220:
                raise ValueError("avatar width must be between 56 and 220 px")
        elif self.media_kind == "inline_image":
            if self.width_unit not in {None, "px"} or self.align is not None:
                raise ValueError("inline image cannot declare body-image layout")
            if self.width is not None and not 16 <= self.width <= 240:
                raise ValueError("inline image width must be between 16 and 240 px")
            if self.system_fallback:
                raise ValueError("only avatar media may be a system fallback")
        else:
            if self.height_px is not None or self.system_fallback:
                raise ValueError("resume image cannot declare inline/avatar attributes")
            if self.width_unit is None or self.align is None or self.width is None:
                raise ValueError("resume image requires width, width_unit and align")
            if self.width_unit == "%" and self.width > 100:
                raise ValueError("percentage resume image width cannot exceed 100")
        return self


class MediaBlock(MediaReference):
    block_type: Literal["media"]

    @model_validator(mode="after")
    def validate_block_media_kind(self) -> "MediaBlock":
        if self.media_kind != "resume_image":
            raise ValueError("media blocks must use resume_image kind")
        return self


class InlineMedia(MediaReference):
    inline_type: Literal["media"]

    @model_validator(mode="after")
    def validate_inline_media_kind(self) -> "InlineMedia":
        if self.media_kind != "inline_image":
            raise ValueError("inline media must use inline_image kind")
        return self


InlineContent = Annotated[TextRun | InlineMedia, Field(discriminator="inline_type")]

ParagraphBlock.model_rebuild()


# Identity is declared before MediaReference to keep the document structure near
# its scalar fields. Resolve that forward annotation once the media contract is
# available.
Identity.model_rebuild()


class ListItem(SourceReferenced):
    runs: list[InlineContent] = Field(min_length=1, max_length=2000)


class ListBlock(ClosedModel):
    node_id: NodeId
    block_type: Literal["ordered_list", "bullet_list"]
    start: int | None = Field(ge=1, le=10_000)
    items: list[ListItem] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_start(self) -> "ListBlock":
        if self.block_type == "ordered_list" and self.start is None:
            raise ValueError("ordered lists require start")
        if self.block_type == "bullet_list" and self.start is not None:
            raise ValueError("bullet lists cannot declare start")
        return self


SimpleContentBlock = Annotated[
    ParagraphBlock | ListBlock | MediaBlock, Field(discriminator="block_type")
]


class RowCell(SourceReferenced):
    """One cell in a section-internal row.

    Rows are content structure, not page layout.  A cell deliberately accepts
    only the simple content blocks so a page/column container cannot be hidden
    inside a canonical row and later acquire template-specific meaning.
    """

    blocks: list[SimpleContentBlock] = Field(max_length=500)


class RowBlock(SourceReferenced):
    block_type: Literal["row"]
    row_kind: Literal["pair", "meta", "trio"]
    cells: list[RowCell] = Field(min_length=1, max_length=4)
    left_width_percent: float | None = Field(default=None, ge=30, le=80)

    @model_validator(mode="after")
    def validate_shape(self) -> "RowBlock":
        expected = {"pair": 2, "meta": 4, "trio": 3}[self.row_kind]
        if len(self.cells) != expected:
            raise ValueError(
                f"{self.row_kind} rows require exactly {expected} cells"
            )
        if self.row_kind == "pair" and self.left_width_percent is None:
            raise ValueError("pair rows require left_width_percent")
        if self.row_kind != "pair" and self.left_width_percent is not None:
            raise ValueError("only pair rows may declare left_width_percent")
        return self

    @property
    def kind(self) -> Literal["pair", "meta", "trio"]:
        """A short alias for adapters that call the row variant `kind`."""

        return self.row_kind


ContentBlock = Annotated[
    ParagraphBlock | ListBlock | MediaBlock | RowBlock,
    Field(discriminator="block_type"),
]


class SourceDisposition(ClosedModel):
    source_id: SourceId
    outcome: Literal["mapped", "transformed", "dropped"]
    target_node_ids: list[NodeId] = Field(max_length=64)
    reason_code: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")] | None

    @model_validator(mode="after")
    def validate_outcome(self) -> "SourceDisposition":
        if len(self.target_node_ids) != len(set(self.target_node_ids)):
            raise ValueError("disposition target_node_ids must be unique")
        if self.outcome == "mapped" and (
            not self.target_node_ids or self.reason_code is not None
        ):
            raise ValueError("mapped disposition requires targets and no reason")
        if self.outcome == "transformed" and (
            not self.target_node_ids or self.reason_code is None
        ):
            raise ValueError("transformed disposition requires targets and a reason")
        if self.outcome == "dropped" and (
            self.target_node_ids or self.reason_code is None
        ):
            raise ValueError("dropped disposition requires a reason and no targets")
        return self


class EntryFields(ClosedModel):
    name: TextValue | None = None
    organization: TextValue | None = None
    role: TextValue | None = None
    location: TextValue | None = None
    start_date: TextValue | None = None
    end_date: TextValue | None = None
    url: TextValue | None = None
    degree: TextValue | None = None
    major: TextValue | None = None


class ResumeEntry(SourceReferenced):
    fields: EntryFields
    blocks: list[ContentBlock] = Field(max_length=500)


class ResumeSection(SourceReferenced):
    semantic_kind: SectionSemanticKind
    title: TextValue | None
    entries: list[ResumeEntry] = Field(max_length=200)
    blocks: list[ContentBlock] = Field(max_length=500)


class CanonicalResumeDocument(ClosedModel):
    schema_version: Literal["canonical-resume.v1"]
    document_id: NodeId
    identity: Identity
    sections: list[ResumeSection] = Field(max_length=100)
    source_dispositions: list[SourceDisposition] = Field(max_length=5000)

    @model_validator(mode="after")
    def unique_node_ids(self) -> "CanonicalResumeDocument":
        ids: list[str] = [self.document_id]

        def collect(value: object) -> None:
            if isinstance(value, BaseModel):
                node_id = getattr(value, "node_id", None)
                if isinstance(node_id, str):
                    ids.append(node_id)
                for field_value in value.__dict__.values():
                    collect(field_value)
            elif isinstance(value, list):
                for item in value:
                    collect(item)

        collect(self)
        if len(ids) != len(set(ids)):
            raise ValueError("canonical node ids must be unique")
        dispositions = [item.source_id for item in self.source_dispositions]
        if len(dispositions) != len(set(dispositions)):
            raise ValueError("canonical source dispositions must be unique")
        known_nodes = set(ids)
        if any(
            target not in known_nodes
            for item in self.source_dispositions
            for target in item.target_node_ids
        ):
            raise ValueError("canonical source disposition targets an unknown node")
        return self

    def content_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))

    def layout_node_ids(self) -> set[str]:
        return {self.identity.node_id, *(section.node_id for section in self.sections)}


class BoundingBox(ClosedModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def stay_inside_normalized_page(self) -> "BoundingBox":
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("normalized bbox must stay inside the page")
        return self


class SourceLeaf(ClosedModel):
    source_id: SourceId
    ordinal: int = Field(ge=0)
    page: int = Field(ge=1)
    block_id: str = Field(min_length=1, max_length=128)
    leaf_kind: Literal["heading", "paragraph", "list_item", "contact", "media"]
    text: str = Field(max_length=20_000)
    bbox: BoundingBox | None
    list_kind: Literal["ordered", "bullet"] | None
    list_ordinal: int | None = Field(ge=1)

    @model_validator(mode="after")
    def validate_list_metadata(self) -> "SourceLeaf":
        if self.leaf_kind == "list_item" and self.list_kind is None:
            raise ValueError("list_item source leaf requires list_kind")
        if self.leaf_kind != "list_item" and self.list_kind is not None:
            raise ValueError("only list_item source leaf may declare list_kind")
        if self.list_kind == "ordered" and self.list_ordinal is None:
            raise ValueError("ordered source leaf requires list_ordinal")
        if self.list_kind != "ordered" and self.list_ordinal is not None:
            raise ValueError("only ordered source leaf may declare list_ordinal")
        return self


class SourceGraph(ClosedModel):
    schema_version: Literal["source-graph.v1"]
    source_document_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    leaves: list[SourceLeaf] = Field(max_length=5000)

    @model_validator(mode="after")
    def validate_identity_and_order(self) -> "SourceGraph":
        ids = [leaf.source_id for leaf in self.leaves]
        if len(ids) != len(set(ids)):
            raise ValueError("source ids must be unique")
        if [leaf.ordinal for leaf in self.leaves] != list(range(len(self.leaves))):
            raise ValueError("source ordinals must be contiguous and ordered")
        return self

    def graph_sha256(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


class SparseAnnotation(ClosedModel):
    source_id: SourceId
    role: Literal[
        "section_title", "identity_name", "contact", "entry_field", "body", "list_item"
    ]
    semantic_kind: SectionSemanticKind | None
    entry_anchor_source_id: SourceId | None
    field_key: str | None = Field(min_length=1, max_length=64)
    normalized_value: str | None = Field(max_length=20_000)
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_role_fields(self) -> "SparseAnnotation":
        if self.role == "entry_field" and (
            self.field_key is None or self.entry_anchor_source_id is None
        ):
            raise ValueError(
                "entry_field annotation requires field_key and entry anchor"
            )
        if self.role == "contact" and self.field_key is None:
            raise ValueError("contact annotation requires field_key")
        if self.role not in {"entry_field", "contact"} and self.field_key is not None:
            raise ValueError("only field annotations may declare field_key")
        return self


class SparseResumeAnnotations(ClosedModel):
    schema_version: Literal["sparse-resume-annotations.v1"]
    source_graph_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    annotations: list[SparseAnnotation] = Field(max_length=5000)


def validate_sparse_annotations(
    graph: SourceGraph, annotations: SparseResumeAnnotations
) -> None:
    if annotations.source_graph_sha256 != graph.graph_sha256():
        raise ValueError("sparse annotations target a different SourceGraph")
    known = {leaf.source_id for leaf in graph.leaves}
    annotated = [annotation.source_id for annotation in annotations.annotations]
    anchors = [
        annotation.entry_anchor_source_id
        for annotation in annotations.annotations
        if annotation.entry_anchor_source_id is not None
    ]
    if any(source_id not in known for source_id in [*annotated, *anchors]):
        raise ValueError("sparse annotations reference an unknown source_id")
    keys = [
        (annotation.source_id, annotation.role, annotation.field_key)
        for annotation in annotations.annotations
    ]
    if len(keys) != len(set(keys)):
        raise ValueError("sparse annotation composite keys must be unique")
    ordinals = {leaf.source_id: leaf.ordinal for leaf in graph.leaves}
    if any(
        ordinals[anchor] > ordinals[annotation.source_id]
        for annotation in annotations.annotations
        if (anchor := annotation.entry_anchor_source_id) is not None
    ):
        raise ValueError("entry anchor must not follow the annotated source")


def validate_source_closure(
    graph: SourceGraph, document: CanonicalResumeDocument
) -> None:
    """Prove that every source leaf has one explicit, valid final disposition."""

    source_ids = {leaf.source_id for leaf in graph.leaves}
    disposition_ids = [item.source_id for item in document.source_dispositions]
    if len(disposition_ids) != len(set(disposition_ids)):
        raise ValueError("source dispositions must be unique")
    if set(disposition_ids) != source_ids:
        raise ValueError("source dispositions must close the SourceGraph")

    node_ids: set[str] = set()
    referenced_sources: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, BaseModel):
            node_id = getattr(value, "node_id", None)
            if isinstance(node_id, str):
                node_ids.add(node_id)
            refs = getattr(value, "source_refs", None)
            if isinstance(refs, list):
                referenced_sources.update(refs)
            for field_name, field_value in value.__dict__.items():
                if field_name != "source_dispositions":
                    collect(field_value)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    collect(document)
    if not referenced_sources <= source_ids:
        raise ValueError("canonical content references an unknown source_id")
    for disposition in document.source_dispositions:
        if any(node_id not in node_ids for node_id in disposition.target_node_ids):
            raise ValueError("source disposition references an unknown target node")
        if (
            disposition.outcome != "dropped"
            and disposition.source_id not in referenced_sources
        ):
            raise ValueError("mapped source is not referenced by canonical content")
        if (
            disposition.outcome == "dropped"
            and disposition.source_id in referenced_sources
        ):
            raise ValueError("dropped source cannot be referenced by canonical content")


class SemanticLabels(ClosedModel):
    profile: str = Field(min_length=1, max_length=120)
    work: str = Field(min_length=1, max_length=120)
    education: str = Field(min_length=1, max_length=120)
    project: str = Field(min_length=1, max_length=120)
    skills: str = Field(min_length=1, max_length=120)
    activity: str = Field(min_length=1, max_length=120)
    interests: str = Field(min_length=1, max_length=120)
    certificates: str = Field(min_length=1, max_length=120)
    awards: str = Field(min_length=1, max_length=120)
    languages: str = Field(min_length=1, max_length=120)


class TemplateRegion(ClosedModel):
    region_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
    region_kind: Literal["header", "sidebar", "main", "footer"]
    order: int = Field(ge=0, le=100)


class TemplateSlot(ClosedModel):
    slot_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
    region_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
    accepts: list[SemanticKind] = Field(min_length=1)
    universal_fallback: bool
    order: int = Field(ge=0, le=100)


class TemplateTokens(ClosedModel):
    font_family: str = Field(min_length=1, max_length=100)
    font_size_pt: float = Field(ge=6, le=32)
    line_height: float = Field(ge=1, le=3)
    accent_color: Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
    page_margin_mm: float = Field(ge=0, le=50)
    vertical_page_margin_mm: float | None = Field(default=None, ge=0, le=50)
    # The legacy contract only had one horizontal and one vertical value.  Keep
    # those fields as fallbacks, but carry all four edges when the source style
    # was asymmetric (for example the full-bleed civic/creative templates).
    page_margin_top_mm: float | None = Field(default=None, ge=0, le=50)
    page_margin_right_mm: float | None = Field(default=None, ge=0, le=50)
    page_margin_bottom_mm: float | None = Field(default=None, ge=0, le=50)
    page_margin_left_mm: float | None = Field(default=None, ge=0, le=50)


class TemplateAvatar(ClosedModel):
    visibility: Literal["show", "hide"]
    fallback_asset: Literal["system-default", "none"]
    size_px: int = Field(ge=56, le=220)
    region_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]

    @model_validator(mode="after")
    def validate_fallback(self) -> "TemplateAvatar":
        if self.visibility == "hide" and self.fallback_asset != "none":
            raise ValueError("hidden avatar cannot declare a fallback asset")
        return self


class TemplateDefinition(ClosedModel):
    schema_version: Literal["template-definition.v1"]
    template_key: TemplateKey
    semantic_labels: SemanticLabels
    regions: list[TemplateRegion] = Field(min_length=1, max_length=8)
    slots: list[TemplateSlot] = Field(min_length=1, max_length=30)
    tokens: TemplateTokens
    avatar: TemplateAvatar

    @model_validator(mode="after")
    def validate_total_renderability(self) -> "TemplateDefinition":
        region_ids = [region.region_id for region in self.regions]
        slot_ids = [slot.slot_id for slot in self.slots]
        if len(region_ids) != len(set(region_ids)) or len(slot_ids) != len(
            set(slot_ids)
        ):
            raise ValueError("template region and slot ids must be unique")
        if any(slot.region_id not in region_ids for slot in self.slots):
            raise ValueError("template slot references an unknown region")
        if self.avatar.region_id not in region_ids:
            raise ValueError("template avatar references an unknown region")
        if any(len(slot.accepts) != len(set(slot.accepts)) for slot in self.slots):
            raise ValueError("template slot accepts must be unique")
        fallbacks = [slot for slot in self.slots if slot.universal_fallback]
        if len(fallbacks) != 1 or set(fallbacks[0].accepts) != ALL_SEMANTIC_KINDS:
            raise ValueError(
                "template requires one universal fallback covering all kinds"
            )
        explicit_kinds = [
            kind
            for slot in self.slots
            if not slot.universal_fallback
            for kind in slot.accepts
        ]
        if len(explicit_kinds) != len(set(explicit_kinds)):
            raise ValueError("a semantic kind may target only one explicit slot")
        return self


class PresentationSettings(ClosedModel):
    smart_one_page: bool = False
    font_scale: float | None = Field(default=None, ge=0.75, le=1.5)
    line_height: float | None = Field(default=None, ge=1, le=3)
    accent_color: Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")] | None = None
    page_margin_mm: float | None = Field(default=None, ge=0, le=50)
    vertical_page_margin_mm: float | None = Field(default=None, ge=0, le=50)
    page_margin_top_mm: float | None = Field(default=None, ge=0, le=50)
    page_margin_right_mm: float | None = Field(default=None, ge=0, le=50)
    page_margin_bottom_mm: float | None = Field(default=None, ge=0, le=50)
    page_margin_left_mm: float | None = Field(default=None, ge=0, le=50)
    avatar_size_px: int | None = Field(default=None, ge=48, le=240)
    sidebar_width_percent: float | None = Field(default=None, ge=20, le=50)


class ResumePresentation(ClosedModel):
    schema_version: Literal["resume-presentation.v1"]
    portable: PresentationSettings
    template_scoped: dict[TemplateKey, PresentationSettings]
    template_snapshot: TemplateDefinition


class LayoutNode(ClosedModel):
    node_id: NodeId
    semantic_kind: SemanticKind
    slot_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]


class LayoutRegion(ClosedModel):
    region_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
    order: int = Field(ge=0, le=100)
    nodes: list[LayoutNode] = Field(max_length=5000)


class LayoutPlan(ClosedModel):
    schema_version: Literal["layout-plan.v1"]
    content_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    template_key: TemplateKey
    regions: list[LayoutRegion] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def unique_node_ids(self) -> "LayoutPlan":
        region_ids = [region.region_id for region in self.regions]
        if len(region_ids) != len(set(region_ids)):
            raise ValueError("LayoutPlan region ids must be unique")
        node_ids = [node.node_id for region in self.regions for node in region.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("LayoutPlan node ids must be unique")
        return self


def validate_layout_coverage(
    document: CanonicalResumeDocument, template: TemplateDefinition, plan: LayoutPlan
) -> None:
    if plan.content_sha256 != document.content_sha256():
        raise ValueError("LayoutPlan targets different content")
    if plan.template_key != template.template_key:
        raise ValueError("LayoutPlan targets different template")
    region_ids = {region.region_id for region in template.regions}
    slots = {slot.slot_id: slot for slot in template.slots}
    if any(region.region_id not in region_ids for region in plan.regions):
        raise ValueError("LayoutPlan references an unknown region")
    nodes = [node for region in plan.regions for node in region.nodes]
    if {node.node_id for node in nodes} != document.layout_node_ids():
        raise ValueError(
            "LayoutPlan must cover every renderable canonical node exactly once"
        )
    if any(node.slot_id not in slots for node in nodes):
        raise ValueError("LayoutPlan references an unknown slot")
    canonical_kinds = {document.identity.node_id: "identity"}
    canonical_kinds.update(
        {section.node_id: section.semantic_kind for section in document.sections}
    )
    for region in plan.regions:
        for node in region.nodes:
            slot = slots[node.slot_id]
            if (
                slot.region_id != region.region_id
                or node.semantic_kind not in slot.accepts
            ):
                raise ValueError(
                    "LayoutPlan assignment violates template slot contract"
                )
            if canonical_kinds[node.node_id] != node.semantic_kind:
                raise ValueError(
                    "LayoutPlan semantic kind differs from canonical content"
                )
