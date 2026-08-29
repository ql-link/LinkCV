"""Deterministic SourceGraph -> CanonicalResumeDocument composition.

The importer has two deliberately separate inputs:

* :class:`~linkcv.domain.resume.models.SourceGraph` is the complete, ordered
  source inventory owned by LinkCV; and
* :class:`~linkcv.domain.resume.models.SparseResumeAnnotations` is an
  optional set of model hints.

The model is never allowed to remove a source leaf or to provide visible
resume text.  Every leaf receives a deterministic fallback result, while
validated sparse annotations may add structured contact/entry fields.  This
module therefore does not need (and intentionally does not have) an
``unclassified`` section or a model-complete mapping requirement.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import hashlib
import re
from typing import Any, Iterable, Literal

from linkcv.domain.resume.models import (
    CanonicalResumeDocument,
    Contact,
    ContentBlock,
    EntryFields,
    Identity,
    InlineStyle,
    ListBlock,
    ListItem,
    ParagraphBlock,
    ResumeEntry,
    ResumeSection,
    SourceGraph,
    SourceLeaf,
    SourceDisposition,
    SparseAnnotation,
    SparseResumeAnnotations,
    TextRun,
    TextValue,
    validate_source_closure,
    validate_sparse_annotations,
)


class CanonicalCompositionError(ValueError):
    """A sparse hint or deterministic composition cannot be made safe."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "RESUME_STRUCTURE_INVALID",
    ) -> None:
        super().__init__(message)
        self.code = code


# A small result object keeps the graph and the closed document together for
# the worker.  The source IDs are useful for diagnostics but are not persisted
# as an additional business table.
@dataclass(frozen=True, slots=True)
class CanonicalCompositionResult:
    document: CanonicalResumeDocument
    graph: SourceGraph
    accepted_source_ids: tuple[str, ...]
    discarded_source_ids: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def content_sha256(self) -> str:
        return self.document.content_sha256()


_FIELD_KEYS = {
    "name",
    "organization",
    "role",
    "location",
    "start_date",
    "end_date",
    "url",
    "degree",
    "major",
}
_CONTACT_KEYS = {
    "phone",
    "email",
    "website",
    "location",
    "github",
    "linkedin",
    "other",
}

_SECTION_ALIASES: dict[str, frozenset[str]] = {
    "profile": frozenset(
        {"profile", "summary", "个人简介", "简介", "自我介绍", "个人总结"}
    ),
    "work": frozenset(
        {
            "work",
            "experience",
            "experiences",
            "工作经历",
            "工作经验",
            "职业经历",
            "任职经历",
            "实习经历",
        }
    ),
    "education": frozenset({"education", "教育经历", "教育背景", "学历"}),
    "project": frozenset(
        {
            "project",
            "projects",
            "项目经历",
            "项目经验",
            "个人项目",
            "开源经历及个人作品",
        }
    ),
    "skills": frozenset({"skill", "skills", "专业技能", "技能清单", "技术栈"}),
    "activity": frozenset({"activity", "activities", "活动经历", "校园活动"}),
    "interests": frozenset({"interest", "interests", "兴趣爱好"}),
    "certificates": frozenset({"certificate", "certificates", "证书"}),
    "awards": frozenset({"award", "awards", "奖项", "荣誉"}),
    "languages": frozenset({"language", "languages", "语言能力", "语言"}),
}

_PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d ()-]{6,}\d)(?!\d)")
_EMAIL_RE = re.compile(r"(?i)(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w.-])")
_URL_RE = re.compile(r"(?i)(?<![\w])(?:https?://|www\.)[^\s|｜<>]+")
_CONTACT_SPLIT_RE = re.compile(r"\s*(?:\|+|｜+|·{1,3}|•{1,3})\s*")
_CONTACT_LABEL_RE = re.compile(
    r"^(?:电话|手机|tel|mobile|邮箱|email|网址|website|个人网站|个人主页|"
    r"地址|所在地|location)"
    r"\s*[:：]\s*",
    re.IGNORECASE,
)
_CONTACT_TRAILING_PUNCTUATION = ".,;；，。)]}》）"

# A paragraph is only a name fallback when it has the compact shape of a
# person's name.  The lexical exclusions are intentionally conservative: a
# heading-like or prose-like preamble must remain visible content instead of
# being promoted to the identity header.
_DOCUMENT_TITLE_ALIASES = frozenset(
    {
        "简历",
        "个人简历",
        "求职简历",
        "个人履历",
        "个人资料",
        "个人信息",
        "基本信息",
        "联系方式",
        "resume",
        "cv",
        "curriculum vitae",
        "about me",
        "personal profile",
    }
)
_IDENTITY_NAME_REJECT_TERMS = frozenset(
    {
        "个人",
        "信息",
        "联系方式",
        "简历",
        "履历",
        "简介",
        "总结",
        "经历",
        "教育",
        "工作",
        "项目",
        "技能",
        "活动",
        "证书",
        "奖项",
        "语言",
        "正文",
        "内容",
        "示例",
        "文本",
        "说明",
        "介绍",
        "求职",
        "应聘",
        "工程师",
        "开发",
        "设计",
        "经理",
        "负责人",
        "student",
        "teacher",
        "engineer",
        "developer",
        "designer",
        "manager",
        "experience",
        "education",
        "project",
        "skill",
        "profile",
        "summary",
        "objective",
    }
)
_CJK_NAME_RE = re.compile(r"^[\u3400-\u4dbf\u4e00-\u9fff]{2,4}$")
_LATIN_NAME_RE = re.compile(
    r"^[A-Za-z][A-Za-z.'-]{0,31}(?:\s+[A-Za-z][A-Za-z.'-]{0,31}){1,3}$"
)


@dataclass(frozen=True, slots=True)
class _SourceView:
    leaf: SourceLeaf
    # The optional parser view supplies heading depth/list metadata not part
    # of the public v1 SourceGraph contract.  It is never serialized.
    markdown: str
    heading_level: int | None = None
    list_depth: int = 0

    @property
    def source_id(self) -> str:
        return self.leaf.source_id

    @property
    def ordinal(self) -> int:
        return self.leaf.ordinal

    @property
    def text(self) -> str:
        return self.leaf.text.strip()


def _node_id(kind: str, *parts: object) -> str:
    raw = "\x1f".join(["canonical-resume-v1", kind, *(str(part) for part in parts)])
    return "node_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _normalise_title(value: str) -> str:
    value = value.strip().casefold()
    value = re.sub(r"^[#\s]+", "", value)
    value = re.sub(r"[：:：\s]+$", "", value)
    return value


def _inferred_kind(text: str) -> str | None:
    normalized = _normalise_title(text)
    for kind, aliases in _SECTION_ALIASES.items():
        if normalized in aliases:
            return kind
    return None


def _annotation_map(
    annotations: SparseResumeAnnotations,
) -> dict[str, tuple[SparseAnnotation, ...]]:
    result: dict[str, list[SparseAnnotation]] = defaultdict(list)
    for annotation in annotations.annotations:
        result[annotation.source_id].append(annotation)
    return {source_id: tuple(values) for source_id, values in result.items()}


def _source_views(graph: SourceGraph, source_ir: object | None) -> list[_SourceView]:
    """Pair public graph leaves with optional parser-only source metadata."""

    blocks = list(getattr(source_ir, "blocks", ())) if source_ir is not None else []
    blocks = sorted(blocks, key=lambda item: item.ordinal)
    views: list[_SourceView] = []
    for leaf in sorted(graph.leaves, key=lambda item: item.ordinal):
        # SourceLayoutIR ordinals include deterministic discards, whereas the
        # public SourceGraph contains only content leaves and renumbers them
        # contiguously.  Pair by sorted content index rather than by ordinal.
        block = blocks[leaf.ordinal] if leaf.ordinal < len(blocks) else None
        markdown = (
            str(getattr(block, "markdown", leaf.text))
            if block is not None
            else leaf.text
        )
        views.append(
            _SourceView(
                leaf=leaf,
                markdown=markdown,
                heading_level=getattr(block, "heading_level", None)
                if block is not None
                else None,
                list_depth=getattr(getattr(block, "list", None), "depth", 0)
                if block is not None
                else 0,
            )
        )
    return views


def _annotation_kind(
    view: _SourceView,
    by_source: dict[str, tuple[SparseAnnotation, ...]],
) -> str | None:
    values = [
        item.semantic_kind
        for item in by_source.get(view.source_id, ())
        if item.semantic_kind is not None
        and item.role not in {"contact", "identity_name"}
    ]
    if len(set(values)) > 1:
        raise CanonicalCompositionError(
            "one source cannot receive multiple semantic kinds"
        )
    if values:
        return values[0]
    if view.leaf.leaf_kind == "heading":
        return _inferred_kind(view.text) or "custom"
    return None


def _strip_list_marker(text: str, leaf: SourceLeaf) -> str:
    value = text.strip()
    if leaf.list_kind == "ordered":
        value = re.sub(r"^\s*\d{1,5}[.、．)）]\s*", "", value, count=1)
    elif leaf.list_kind == "bullet":
        value = re.sub(r"^\s*[-*+•]\s+", "", value, count=1)
    return value.strip()


def _text_value(
    *,
    kind: str,
    value: str,
    source_ids: Iterable[str],
) -> TextValue:
    source_refs = list(dict.fromkeys(source_ids))
    return TextValue(
        node_id=_node_id(kind, *source_refs, value),
        value=value,
        source_refs=source_refs,
    )


def _default_style() -> InlineStyle:
    return InlineStyle(color=None, font_size_pt=None, highlight_color=None)


def _paragraph(view: _SourceView, *, text: str | None = None) -> ParagraphBlock:
    value = view.text if text is None else text.strip()
    if not value:
        raise CanonicalCompositionError("empty source cannot become a paragraph")
    run = TextRun(
        inline_type="text",
        text=value,
        marks=[],
        href=None,
        style=_default_style(),
    )
    return ParagraphBlock(
        node_id=_node_id("paragraph", view.source_id),
        block_type="paragraph",
        runs=[run],
        source_refs=[view.source_id],
    )


def _contact_candidates(text: str) -> list[tuple[str, str]]:
    """Best-effort deterministic contact extraction for unannotated lines."""

    candidates: list[tuple[str, str]] = []
    for piece in _CONTACT_SPLIT_RE.split(text.strip()):
        value = piece.strip().strip("，,;；")
        if not value:
            continue
        lowered = value.casefold()
        if _EMAIL_RE.search(value):
            kind = "email"
        elif _URL_RE.search(value):
            if "github.com" in lowered:
                kind = "github"
            elif "linkedin.com" in lowered:
                kind = "linkedin"
            else:
                kind = "website"
        elif _PHONE_RE.search(value) or re.search(
            r"(?:电话|手机|tel|mobile)\s*[:：]", lowered
        ):
            kind = "phone"
        elif re.search(r"(?:地址|所在地|location)\s*[:：]", lowered):
            kind = "location"
        else:
            continue
        # Labels are useful to a renderer but are not part of the value.
        value = _CONTACT_LABEL_RE.sub("", value, count=1)
        if value:
            candidates.append((kind, value))
    return candidates


def _is_compact_contact_line(
    text: str, candidates: list[tuple[str, str]]
) -> bool:
    """Tell a paragraph contact line from prose containing a contact token."""

    pieces = [piece.strip() for piece in _CONTACT_SPLIT_RE.split(text) if piece.strip()]
    if len(pieces) != len(candidates):
        return False
    for piece, (kind, _value) in zip(pieces, candidates, strict=True):
        has_label = bool(_CONTACT_LABEL_RE.match(piece))
        value = _CONTACT_LABEL_RE.sub("", piece, count=1).strip()
        value = value.strip("，,;；")
        token = value.rstrip(_CONTACT_TRAILING_PUNCTUATION)
        if kind == "email":
            if not _EMAIL_RE.fullmatch(token):
                return False
        elif kind in {"website", "github", "linkedin"}:
            if not _URL_RE.fullmatch(token):
                return False
        elif kind == "phone":
            if not _PHONE_RE.fullmatch(token):
                return False
        elif kind == "location":
            # Locations are inherently free-form, so require the explicit
            # contact label that made the deterministic extraction possible.
            if not has_label:
                return False
        else:
            return False
    return True


def _automatic_contact_candidates(view: _SourceView) -> list[tuple[str, str]]:
    """Return contacts only when the source kind or line shape is trusted."""

    candidates = _contact_candidates(view.text)
    if view.leaf.leaf_kind == "contact":
        return candidates
    if view.leaf.leaf_kind != "paragraph" or not candidates:
        return []
    # Keep paragraph auto-detection deterministic and avoid treating prose
    # such as "项目主页见 https://..." as a contact value.
    if not any(
        pattern.search(view.text) for pattern in (_EMAIL_RE, _URL_RE, _PHONE_RE)
    ):
        return []
    return candidates if _is_compact_contact_line(view.text, candidates) else []


def _is_identity_name_candidate(view: _SourceView) -> bool:
    """Return whether a leading paragraph has a conservative name shape."""

    if view.leaf.leaf_kind != "paragraph":
        return False
    value = view.text
    if not value or "\n" in value or len(value) > 40:
        return False
    if any(pattern.search(value) for pattern in (_EMAIL_RE, _URL_RE, _PHONE_RE)):
        return False
    normalized = _normalise_title(value)
    if normalized in _DOCUMENT_TITLE_ALIASES or _inferred_kind(value) is not None:
        return False
    if any(term in normalized for term in _IDENTITY_NAME_REJECT_TERMS):
        return False
    return bool(_CJK_NAME_RE.fullmatch(value) or _LATIN_NAME_RE.fullmatch(value))


def _is_recognized_section_title(
    view: _SourceView,
    by_source: dict[str, tuple[SparseAnnotation, ...]],
) -> bool:
    """Return whether a source starts a semantically known section."""

    if any(
        annotation.role == "section_title"
        and annotation.semantic_kind is not None
        for annotation in by_source.get(view.source_id, ())
    ):
        return True
    return view.leaf.leaf_kind == "heading" and _inferred_kind(view.text) is not None


def _identity_preamble(
    views: list[_SourceView],
    by_source: dict[str, tuple[SparseAnnotation, ...]],
    *,
    identity_source_id: str | None,
) -> tuple[set[str], str | None]:
    """Return the leading identity/contact sources and fallback name source.

    The first recognized section title bounds the preamble.  Within that
    bound, only blank leaves, the existing first-heading identity, compact
    contacts, and compact name-shaped paragraphs are considered preamble.  A
    paragraph fallback is accepted only when that same run has contact
    evidence.  A prose paragraph or unrelated heading closes the region,
    preventing later body links from being promoted to identity contacts.
    """

    first_section_ordinal = next(
        (
            view.ordinal
            for view in views
            if _is_recognized_section_title(view, by_source)
        ),
        len(views),
    )
    preamble_source_ids: set[str] = set()
    fallback_name_source_id: str | None = None
    has_compact_contact = False
    for view in views:
        if view.ordinal >= first_section_ordinal:
            break
        if view.source_id == identity_source_id:
            preamble_source_ids.add(view.source_id)
            continue
        if not view.text:
            preamble_source_ids.add(view.source_id)
            continue
        if _automatic_contact_candidates(view):
            preamble_source_ids.add(view.source_id)
            has_compact_contact = True
            continue
        if _is_identity_name_candidate(view):
            preamble_source_ids.add(view.source_id)
            if fallback_name_source_id is None:
                fallback_name_source_id = view.source_id
            continue
        # A non-contact paragraph/list or a second heading is body/document
        # content.  Do not scan beyond it for a later identity or contact.
        break
    # A short paragraph can look like a name by shape alone (for example a
    # two-character Chinese phrase).  Require independent contact evidence in
    # the same continuous preamble before promoting it to identity.
    if not has_compact_contact:
        fallback_name_source_id = None
    return preamble_source_ids, fallback_name_source_id


def _contact_kind(
    field_key: str,
) -> Literal["phone", "email", "website", "location", "github", "linkedin", "other"]:
    if field_key not in _CONTACT_KEYS:
        raise CanonicalCompositionError(f"unsupported contact field: {field_key}")
    return field_key  # type: ignore[return-value]


def _entry_fields(
    *,
    anchor: str,
    annotations: Iterable[SparseAnnotation],
    views_by_id: dict[str, _SourceView],
) -> tuple[EntryFields, list[str], set[str]]:
    values: dict[str, TextValue | None] = {key: None for key in _FIELD_KEYS}
    target_ids: list[str] = []
    source_ids: set[str] = {anchor}
    for annotation in annotations:
        field_key = annotation.field_key
        if field_key not in _FIELD_KEYS:
            raise CanonicalCompositionError(f"unsupported entry field: {field_key}")
        source = views_by_id[annotation.source_id]
        raw = annotation.normalized_value
        value = raw.strip() if raw is not None and raw.strip() else source.text
        if not value:
            raise CanonicalCompositionError("entry field source is empty")
        text_value = _text_value(
            kind=f"entry-field:{field_key}",
            value=value,
            source_ids=[annotation.source_id],
        )
        values[field_key] = text_value
        target_ids.append(text_value.node_id)
        source_ids.add(annotation.source_id)
    return EntryFields(**values), target_ids, source_ids


def _validate_annotation_semantics(
    graph: SourceGraph,
    annotations: SparseResumeAnnotations,
) -> None:
    try:
        validate_sparse_annotations(graph, annotations)
    except (TypeError, ValueError) as error:
        raise CanonicalCompositionError(str(error)) from error
    known = {leaf.source_id for leaf in graph.leaves}
    for annotation in annotations.annotations:
        if annotation.role == "identity_name" and annotation.semantic_kind is not None:
            raise CanonicalCompositionError(
                "identity annotation cannot declare a section kind"
            )
        if annotation.role == "contact":
            if annotation.field_key not in _CONTACT_KEYS:
                raise CanonicalCompositionError(
                    "contact annotation has an unsupported field"
                )
            if annotation.semantic_kind is not None:
                raise CanonicalCompositionError(
                    "contact annotation cannot declare a section kind"
                )
        if annotation.role == "section_title" and annotation.semantic_kind is None:
            raise CanonicalCompositionError(
                "section title annotation requires a semantic kind"
            )
        if (
            annotation.role == "entry_field"
            and annotation.entry_anchor_source_id not in known
        ):
            raise CanonicalCompositionError("entry field has an unknown anchor")


def compose_canonical_resume_document(
    graph: SourceGraph,
    annotations: SparseResumeAnnotations | None = None,
    *,
    source_ir: object | None = None,
    warnings: Iterable[str] = (),
) -> CanonicalCompositionResult:
    """Compose a closed canonical document from a complete source graph.

    ``annotations`` may be empty or absent.  It is intentionally not required
    to mention every leaf.  Unknown IDs, graph mismatches and duplicate
    ``(source_id, role, field_key)`` enhancements fail before a document is
    returned, so callers can safely avoid creating a half-complete resume.
    """

    if not graph.leaves:
        raise CanonicalCompositionError("source graph contains no content")
    annotations = annotations or SparseResumeAnnotations(
        schema_version="sparse-resume-annotations.v1",
        source_graph_sha256=graph.graph_sha256(),
        annotations=[],
    )
    _validate_annotation_semantics(graph, annotations)
    views = _source_views(graph, source_ir)
    views_by_id = {view.source_id: view for view in views}
    by_source = _annotation_map(annotations)

    identity_annotations = [
        annotation
        for annotation in annotations.annotations
        if annotation.role == "identity_name"
    ]
    if len(identity_annotations) > 1:
        raise CanonicalCompositionError("identity name enhancement is duplicated")
    identity_source_id: str | None = (
        identity_annotations[0].source_id if identity_annotations else None
    )
    if identity_source_id is None and views:
        first = views[0]
        if first.leaf.leaf_kind == "heading" and _inferred_kind(first.text) is None:
            identity_source_id = first.source_id
    identity_preamble_sources, fallback_name_source_id = _identity_preamble(
        views,
        by_source,
        identity_source_id=identity_source_id,
    )
    if identity_source_id is None:
        identity_source_id = fallback_name_source_id

    consumed: set[str] = set()
    disposition_targets: dict[str, list[str]] = defaultdict(list)
    disposition_reason: dict[str, str] = {}
    transformed_sources: set[str] = set()
    dropped_sources: set[str] = set()

    identity_name: TextValue | None = None
    if identity_source_id is not None:
        identity_view = views_by_id[identity_source_id]
        if not identity_view.text:
            raise CanonicalCompositionError("identity name source is empty")
        identity_name = _text_value(
            kind="identity-name",
            value=identity_view.text,
            source_ids=[identity_source_id],
        )
        consumed.add(identity_source_id)
        disposition_targets[identity_source_id].append(identity_name.node_id)
        transformed_sources.add(identity_source_id)

    contacts: list[Contact] = []
    contact_source_ids: set[str] = set()
    for view in views:
        if view.source_id in consumed:
            continue
        source_annotations = by_source.get(view.source_id, ())
        explicit = [item for item in source_annotations if item.role == "contact"]
        candidates: list[tuple[str, str, str | None]] = []
        for annotation in explicit:
            assert annotation.field_key is not None
            raw = annotation.normalized_value
            value = raw.strip() if raw is not None and raw.strip() else view.text
            if value:
                candidates.append((annotation.field_key, value, None))
        if not explicit and view.source_id in identity_preamble_sources:
            candidates = [
                (kind, value, None)
                for kind, value in _automatic_contact_candidates(view)
            ]
        if not candidates:
            continue
        for field_key, value, label in candidates:
            contact = Contact(
                node_id=_node_id("contact", view.source_id, field_key, value),
                contact_kind=_contact_kind(field_key),
                value=value,
                label=label,
                source_refs=[view.source_id],
            )
            contacts.append(contact)
            disposition_targets[view.source_id].append(contact.node_id)
        consumed.add(view.source_id)
        contact_source_ids.add(view.source_id)
        transformed_sources.add(view.source_id)

    # Group all field enhancements by their explicit anchor.  This is what
    # lets one source block contribute organization, role and dates to the
    # same entry rather than overwriting an earlier field.
    entry_annotations: dict[str, list[SparseAnnotation]] = defaultdict(list)
    for annotation in annotations.annotations:
        if annotation.role == "entry_field":
            assert annotation.entry_anchor_source_id is not None
            entry_annotations[annotation.entry_anchor_source_id].append(annotation)

    entry_by_anchor: dict[str, ResumeEntry] = {}
    entry_event_ordinal: dict[str, int] = {}
    entry_source_ids: dict[str, set[str]] = {}
    for anchor, values in entry_annotations.items():
        if anchor not in views_by_id:
            raise CanonicalCompositionError("entry anchor references an unknown source")
        semantic_kinds = {
            value.semantic_kind for value in values if value.semantic_kind
        }
        if len(semantic_kinds) != 1:
            raise CanonicalCompositionError("entry fields must share one semantic kind")
        fields, field_targets, source_ids = _entry_fields(
            anchor=anchor,
            annotations=values,
            views_by_id=views_by_id,
        )
        entry_id = _node_id("entry", anchor, next(iter(semantic_kinds)))
        entry_refs = sorted(
            source_ids, key=lambda source_id: views_by_id[source_id].ordinal
        )
        entry = ResumeEntry(
            node_id=entry_id,
            fields=fields,
            blocks=[],
            source_refs=entry_refs,
        )
        entry_by_anchor[anchor] = entry
        entry_event_ordinal[anchor] = min(
            views_by_id[source_id].ordinal for source_id in source_ids
        )
        entry_source_ids[anchor] = source_ids
        disposition_targets[anchor].append(entry.node_id)
        disposition_targets[anchor].extend(field_targets)
        for source_id in source_ids:
            disposition_targets[source_id].extend(
                field_targets if source_id != anchor else []
            )
            consumed.add(source_id)
            transformed_sources.add(source_id)

    entry_source_members = {
        source_id
        for source_ids in entry_source_ids.values()
        for source_id in source_ids
    }

    sections_acc: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def new_section(
        view: _SourceView | None, kind: str, title: str | None
    ) -> dict[str, Any]:
        section: dict[str, Any] = {
            "kind": kind
            if kind
            in {
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
            else "custom",
            "title": title,
            "title_source_id": view.source_id
            if view is not None and title is not None
            else None,
            "events": [],
            "source_ids": [],
            "start_ordinal": view.ordinal if view is not None else 0,
        }
        sections_acc.append(section)
        return section

    def section_for(view: _SourceView, kind: str | None) -> dict[str, Any]:
        nonlocal current
        if current is None:
            current = new_section(None, kind or "custom", None)
        elif (
            kind is not None
            and view.leaf.leaf_kind != "heading"
            and current["kind"] == "custom"
            and current["title"] is None
        ):
            current["kind"] = kind
        return current

    for view in views:
        source_id = view.source_id
        if source_id in {identity_source_id, *contact_source_ids}:
            continue
        source_annotations = by_source.get(source_id, ())
        explicit_title = any(
            item.role == "section_title" for item in source_annotations
        )
        kind = _annotation_kind(view, by_source)
        # Parser heading metadata is not sufficient to establish a section
        # boundary: entry-internal fields can be emitted as headings too.  Once
        # a section exists, only an explicit sparse section title or a heading
        # with a known semantic kind starts another section.  Keep the
        # current-is-none fallback for a genuine custom first section.
        if view.leaf.leaf_kind == "heading" and (
            current is None or _is_recognized_section_title(view, by_source)
        ):
            title = view.text or None
            current = new_section(
                view, kind or _inferred_kind(view.text) or "custom", title
            )
            current["source_ids"].append(source_id)
            if title:
                title_node = _text_value(
                    kind="section-title", value=title, source_ids=[source_id]
                )
                current["title_node"] = title_node
                disposition_targets[source_id].append(title_node.node_id)
            consumed.add(source_id)
            transformed_sources.add(source_id)
            continue
        if source_id in entry_by_anchor:
            target_section = section_for(view, kind)
            target_section["events"].append(
                (entry_event_ordinal[source_id], "entry", source_id)
            )
            target_section["source_ids"].extend(entry_source_ids[source_id])
            continue
        if source_id in entry_source_members:
            # A non-anchor field source is represented by its structured field
            # value and must not be emitted a second time as a body block.
            continue
        if explicit_title:
            title = view.text or None
            current = new_section(view, kind or "custom", title)
            current["source_ids"].append(source_id)
            if title:
                title_node = _text_value(
                    kind="section-title", value=title, source_ids=[source_id]
                )
                current["title_node"] = title_node
                disposition_targets[source_id].append(title_node.node_id)
            consumed.add(source_id)
            transformed_sources.add(source_id)
            continue
        target_section = section_for(view, kind)
        target_section["source_ids"].append(source_id)
        if view.leaf.leaf_kind == "list_item":
            target_section["events"].append((view.ordinal, "list", source_id))
        else:
            target_section["events"].append((view.ordinal, "paragraph", source_id))
        consumed.add(source_id)

    # An entry anchor can be a field-only source and may not have entered the
    # loop as a normal block.  Place any such entry in the current/first
    # semantic section while preserving its source ordinal.
    for anchor, entry in entry_by_anchor.items():
        if not any(
            event_kind == "entry" and payload == anchor
            for section in sections_acc
            for _, event_kind, payload in section["events"]
        ):
            target = current or new_section(None, "custom", None)
            target["events"].append((entry_event_ordinal[anchor], "entry", anchor))
            target["source_ids"].extend(entry_source_ids[anchor])

    # Build immutable canonical sections and connect source dispositions to
    # their final target nodes.  Events are emitted in source order; list
    # leaves become one ListBlock per contiguous list run.
    canonical_sections: list[ResumeSection] = []
    for section_index, section in enumerate(
        sorted(sections_acc, key=lambda value: value["start_ordinal"])
    ):
        events = sorted(section["events"], key=lambda value: value[0])
        blocks: list[ContentBlock] = []
        entries: list[ResumeEntry] = []
        index = 0
        while index < len(events):
            _, event_kind, payload = events[index]
            if event_kind == "entry":
                entry = entry_by_anchor[payload]
                entries.append(entry)
                index += 1
                continue
            if event_kind == "list":
                first_view = views_by_id[payload]
                run = [first_view]
                cursor = index + 1
                while cursor < len(events) and events[cursor][1] == "list":
                    candidate = views_by_id[events[cursor][2]]
                    if candidate.leaf.list_kind != first_view.leaf.list_kind:
                        break
                    # A nested list remains in the same logical block.  A
                    # source gap or a second list run starts another block.
                    if candidate.ordinal != run[-1].ordinal + 1:
                        break
                    run.append(candidate)
                    cursor += 1
                block_type = (
                    "ordered_list"
                    if first_view.leaf.list_kind == "ordered"
                    else "bullet_list"
                )
                start = (
                    first_view.leaf.list_ordinal
                    if block_type == "ordered_list"
                    else None
                )
                items: list[ListItem] = []
                for item_view in run:
                    item_text = _strip_list_marker(item_view.text, item_view.leaf)
                    if not item_text:
                        dropped_sources.add(item_view.source_id)
                        disposition_reason[item_view.source_id] = "empty_list_item"
                        continue
                    list_item = ListItem(
                        node_id=_node_id("list-item", item_view.source_id),
                        runs=[
                            TextRun(
                                inline_type="text",
                                text=item_text,
                                marks=[],
                                href=None,
                                style=_default_style(),
                            )
                        ],
                        source_refs=[item_view.source_id],
                    )
                    items.append(list_item)
                    disposition_targets[item_view.source_id].append(list_item.node_id)
                    consumed.add(item_view.source_id)
                    if item_text != item_view.text:
                        transformed_sources.add(item_view.source_id)
                if items:
                    list_node = ListBlock(
                        node_id=_node_id("list", *(item.node_id for item in items)),
                        block_type=block_type,
                        start=start,
                        items=items,
                    )
                    blocks.append(list_node)
                index = cursor
                continue
            view = views_by_id[payload]
            try:
                block = _paragraph(view)
            except CanonicalCompositionError:
                dropped_sources.add(payload)
                disposition_reason[payload] = "empty_source"
                index += 1
                continue
            blocks.append(block)
            disposition_targets[payload].append(block.node_id)
            consumed.add(payload)
            index += 1

        source_ids = list(
            dict.fromkeys(
                sorted(
                    section["source_ids"],
                    key=lambda source_id: views_by_id[source_id].ordinal,
                )
            )
        )
        # Keep only source refs that really belong to this section; entry refs
        # may have been added above more than once.
        title_value = section.get("title_node")
        section_refs = list(dict.fromkeys(source_ids))
        section_node_id = _node_id(
            "section", section_index, *section_refs, section["kind"]
        )
        canonical_section = ResumeSection(
            node_id=section_node_id,
            semantic_kind=section["kind"],
            title=title_value,
            entries=entries,
            blocks=blocks,
            source_refs=section_refs,
        )
        canonical_sections.append(canonical_section)
        # A source may have been given a section-local placeholder target before
        # the final section ID was known.  The section itself is a useful
        # target for entry-only source blocks, so add it after construction.
        for source_id in section_refs:
            if source_id not in disposition_targets:
                disposition_targets[source_id].append(section_node_id)

    # There is no source-bearing content section when the graph only contains
    # an identity.  That is valid; the identity still forms a complete resume.
    identity = Identity(
        node_id=_node_id("identity", graph.graph_sha256()),
        name=identity_name,
        headline=None,
        contacts=contacts,
        avatar=None,
    )
    if identity_name is not None:
        # The identity node is itself the structural target as well as the
        # child name value, making the disposition unambiguous to consumers.
        disposition_targets[identity_source_id].append(identity.node_id)  # type: ignore[index]

    document_id = _node_id("document", graph.graph_sha256())
    dispositions: list[SourceDisposition] = []
    for leaf in sorted(graph.leaves, key=lambda value: value.ordinal):
        source_id = leaf.source_id
        targets = list(dict.fromkeys(disposition_targets.get(source_id, [])))
        targets = [target for target in targets if target]
        if source_id in dropped_sources or not targets:
            dispositions.append(
                SourceDisposition(
                    source_id=source_id,
                    outcome="dropped",
                    target_node_ids=[],
                    reason_code=disposition_reason.get(source_id, "empty_source"),
                )
            )
            dropped_sources.add(source_id)
            continue
        outcome = "transformed" if source_id in transformed_sources else "mapped"
        dispositions.append(
            SourceDisposition(
                source_id=source_id,
                outcome=outcome,
                target_node_ids=targets,
                reason_code=(
                    "deterministic_structuring" if outcome == "transformed" else None
                ),
            )
        )

    document = CanonicalResumeDocument(
        schema_version="canonical-resume.v1",
        document_id=document_id,
        identity=identity,
        sections=canonical_sections,
        source_dispositions=dispositions,
    )
    try:
        validate_source_closure(graph, document)
    except (TypeError, ValueError) as error:
        raise CanonicalCompositionError(str(error)) from error
    return CanonicalCompositionResult(
        document=document,
        graph=graph,
        accepted_source_ids=tuple(
            leaf.source_id
            for leaf in sorted(graph.leaves, key=lambda value: value.ordinal)
            if leaf.source_id not in dropped_sources
        ),
        discarded_source_ids=tuple(
            sorted(
                dropped_sources,
                key=lambda source_id: next(
                    leaf.ordinal for leaf in graph.leaves if leaf.source_id == source_id
                ),
            )
        ),
        warnings=tuple(warnings),
    )


# Public aliases used by the service and by callers migrating from the old
# importer module.  All aliases point to the same deterministic implementation.
compose_canonical_resume = compose_canonical_resume_document
compose_resume_document = compose_canonical_resume_document
compose_import_document = compose_canonical_resume_document


__all__ = [
    "CanonicalCompositionError",
    "CanonicalCompositionResult",
    "compose_canonical_resume",
    "compose_canonical_resume_document",
    "compose_import_document",
    "compose_resume_document",
]
