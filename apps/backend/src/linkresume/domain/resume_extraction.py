"""Schemas for resume extraction.

The model-facing contract is intentionally small: a model may classify a
source block and request a deterministic layout group, but it cannot return
visible resume text, source quotes, or an ``unmapped`` bucket.  The older
``Draft*`` value objects remain importable for callers that are still being
migrated; ``ResumeExtractionDraft`` accepts their values only through its
direct-constructor compatibility shim and never exposes them in its schema or
serialized model output.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Annotated, Any, ClassVar, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, PrivateAttr


class DraftModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftLink(DraftModel):
    label: str = Field(default="", max_length=100)
    url: str = Field(default="", max_length=2_048)


class DraftBasics(DraftModel):
    name: str | None = Field(default=None, max_length=200)
    headline: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=20_000)
    links: list[DraftLink] = Field(default_factory=list, max_length=30)


class DraftWorkExperience(DraftModel):
    organization: str = Field(default="", max_length=300)
    position: str = Field(default="", max_length=300)
    location: str | None = Field(default=None, max_length=300)
    raw_start_date: str | None = Field(default=None, max_length=100)
    raw_end_date: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=20_000)
    highlights: list[str] = Field(default_factory=list, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftEducation(DraftModel):
    institution: str = Field(default="", max_length=300)
    area: str | None = Field(default=None, max_length=300)
    study_type: str | None = Field(default=None, max_length=200)
    raw_start_date: str | None = Field(default=None, max_length=100)
    raw_end_date: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=20_000)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftProject(DraftModel):
    name: str = Field(default="", max_length=300)
    role: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)
    raw_start_date: str | None = Field(default=None, max_length=100)
    raw_end_date: str | None = Field(default=None, max_length=100)
    summary: str | None = Field(default=None, max_length=20_000)
    highlights: list[str] = Field(default_factory=list, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftSkill(DraftModel):
    name: str = Field(default="", max_length=200)
    level: str | None = Field(default=None, max_length=100)
    keywords: list[str] = Field(default_factory=list, max_length=100)


class DraftNamedItem(DraftModel):
    name: str = Field(default="", max_length=300)
    detail: str | None = Field(default=None, max_length=300)
    raw_date: str | None = Field(default=None, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


class DraftCustomSection(DraftModel):
    title: str = Field(default="", max_length=200)
    items: list[str] = Field(default_factory=list, max_length=100)
    source_quotes: list[str] = Field(default_factory=list, max_length=50)


SemanticKind = Literal[
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
]
LayoutRole = Literal[
    "name",
    "contact_row",
    "contact_phone",
    "contact_email",
    "contact_location",
    "contact_link",
    "section_heading",
    "entry_header",
    "entry_left",
    "entry_right",
    "body",
]

SourceID = Annotated[str, Field(pattern=r"^src_[0-9]+_[a-z0-9]+$")]


class StructureDecision(DraftModel):
    """A semantic/layout decision referring to exactly one source block."""

    source_id: SourceID
    semantic_kind: SemanticKind
    layout_role: LayoutRole
    confidence: float | None = Field(default=None, ge=0, le=1)


class LayoutGroup(DraftModel):
    """A deterministic relationship between existing source blocks."""

    role: Literal["contact_row", "entry_row"]
    member_source_ids: list[SourceID] = Field(min_length=1, max_length=20)


class ResumeExtractionDraft(DraftModel):
    """Strict model-facing extraction result.

    ``structure_decisions`` and ``layout_groups`` are accepted as input
    aliases to make adapter migrations less brittle, while ``model_dump``
    always emits the concise ``decisions``/``groups`` names.
    """

    decisions: list[StructureDecision] = Field(
        default_factory=list,
        max_length=5_000,
        validation_alias=AliasChoices("decisions", "structure_decisions"),
    )
    groups: list[LayoutGroup] = Field(
        default_factory=list,
        max_length=500,
        validation_alias=AliasChoices("groups", "layout_groups"),
    )

    # A few in-process fakes and old worker integrations construct the old
    # typed draft directly.  Keep that constructor path working without
    # putting the fields into the response schema or allowing them through
    # model_validate/model_validate_json (which are the untrusted model
    # boundaries).
    _legacy_values: dict[str, Any] | None = PrivateAttr(default=None)

    _LEGACY_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "basics",
            "work_experiences",
            "educations",
            "projects",
            "skills",
            "certificates",
            "awards",
            "languages",
            "custom_sections",
            "unmapped_fragments",
        }
    )

    @classmethod
    def _reject_legacy_payload(cls, value: Mapping[str, Any]) -> dict[str, Any]:
        """Keep model validation strict despite the direct-constructor shim."""

        payload = dict(value)
        legacy = sorted(cls._LEGACY_KEYS.intersection(payload))
        if legacy:
            # The sentinel is intentionally unknown to the strict model.  The
            # direct constructor removes only the compatibility fields, so
            # both model_validate and model_validate_json still produce the
            # normal extra-forbidden ValidationError instead of silently
            # dropping the old typed payload.
            payload["__legacy_payload_fields__"] = legacy
        return payload

    @classmethod
    def model_validate(cls, obj: Any, **kwargs: Any) -> "ResumeExtractionDraft":
        if isinstance(obj, Mapping):
            obj = cls._reject_legacy_payload(obj)
        return super().model_validate(obj, **kwargs)

    @classmethod
    def model_validate_json(
        cls,
        json_data: str | bytes | bytearray,
        **kwargs: Any,
    ) -> "ResumeExtractionDraft":
        try:
            parsed = json.loads(json_data)
        except (TypeError, ValueError):
            return super().model_validate_json(json_data, **kwargs)
        if isinstance(parsed, Mapping):
            parsed = cls._reject_legacy_payload(parsed)
            json_data = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
        return super().model_validate_json(json_data, **kwargs)

    def __init__(self, **data: Any) -> None:
        legacy = {
            key: data.pop(key)
            for key in tuple(data)
            if key in self._LEGACY_KEYS
        }
        super().__init__(**data)
        if legacy:
            self._legacy_values = legacy

    @property
    def is_legacy(self) -> bool:
        return self._legacy_values is not None

    def legacy_value(self, name: str, default: Any = None) -> Any:
        """Return a compatibility value for the pre-canonical adapter."""

        if self._legacy_values is None:
            return default
        return self._legacy_values.get(name, default)

    # Properties below make the old normalization helper usable while the
    # worker moves to the canonical composer.  They are deliberately absent
    # from the Pydantic schema and cannot be populated by model JSON.
    @property
    def basics(self) -> DraftBasics:
        value = self.legacy_value("basics")
        return value if isinstance(value, DraftBasics) else DraftBasics.model_validate(value or {})

    @property
    def work_experiences(self) -> list[DraftWorkExperience]:
        return self.legacy_value("work_experiences", [])

    @property
    def educations(self) -> list[DraftEducation]:
        return self.legacy_value("educations", [])

    @property
    def projects(self) -> list[DraftProject]:
        return self.legacy_value("projects", [])

    @property
    def skills(self) -> list[DraftSkill]:
        return self.legacy_value("skills", [])

    @property
    def certificates(self) -> list[DraftNamedItem]:
        return self.legacy_value("certificates", [])

    @property
    def awards(self) -> list[DraftNamedItem]:
        return self.legacy_value("awards", [])

    @property
    def languages(self) -> list[DraftNamedItem]:
        return self.legacy_value("languages", [])

    @property
    def custom_sections(self) -> list[DraftCustomSection]:
        return self.legacy_value("custom_sections", [])

    @property
    def unmapped_fragments(self) -> list[str]:
        # Kept only for callers that explicitly invoke the retired legacy
        # normalizer.  The field is absent from the strict schema and is
        # rejected by model_validate/model_validate_json.
        return self.legacy_value("unmapped_fragments", [])


__all__ = [
    "DraftBasics",
    "DraftCustomSection",
    "DraftEducation",
    "DraftLink",
    "DraftModel",
    "DraftNamedItem",
    "DraftProject",
    "DraftSkill",
    "DraftWorkExperience",
    "LayoutGroup",
    "ResumeExtractionDraft",
    "StructureDecision",
]
