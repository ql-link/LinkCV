import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ID_PATTERN = re.compile(r"^[a-z][a-z0-9_:-]{2,127}$")
DANGEROUS_MARKDOWN_PATTERN = re.compile(
    r"<(?:script|iframe|object|embed|style)\b|javascript:", re.IGNORECASE
)
Keyword = Annotated[str, Field(max_length=200)]

TIPTAP_NODE_TYPES = {
    "doc",
    "text",
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "codeBlock",
    "horizontalRule",
    "hardBreak",
    "resumeBlockAnchor",
    "avatarImage",
    "resumeImage",
    "resumeRow",
    "resumeColumn",
    "resumeColumns",
    "resumeMetaRow",
    "resumeTrioRow",
    "inlineImage",
    "inlineIcon",
}
TIPTAP_MARK_TYPES = {
    "bold",
    "italic",
    "underline",
    "strike",
    "code",
    "link",
    "textStyle",
    "highlight",
}
TIPTAP_SEMANTIC_KINDS = {
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
}
TIPTAP_INLINE_ICON_NAMES = {
    "Mail",
    "Phone",
    "MapPin",
    "Globe",
    "Github",
    "Linkedin",
    "GraduationCap",
    "Briefcase",
    "Award",
    "Star",
    "Calendar",
    "Code2",
}
TIPTAP_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
TIPTAP_FONT_SIZE_PATTERN = re.compile(r"^\d+(?:\.\d+)?pt$")
TIPTAP_MAX_NODES = 5_000
TIPTAP_MAX_TEXT_LENGTH = 20_000


def _is_safe_http_url(value: str) -> bool:
    return (
        len(value) <= 2_048
        and not any(character.isspace() or ord(character) < 32 for character in value)
        and value.lower().startswith(("https://", "http://"))
    )


def _is_safe_resume_asset(value: str) -> bool:
    return len(value) <= 2_048 and (
        _is_safe_http_url(value)
        or (
            not any(character.isspace() or ord(character) < 32 for character in value)
            and value.startswith(("/api/assets/", "/api/resumes/", "/templates/"))
        )
    )


def _assert_exact_keys(
    value: dict[str, Any],
    allowed: set[str],
    *,
    path: str,
) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"unsupported tiptap keys at {path}: {sorted(unknown)}")


def _validate_tiptap_mark(value: object, *, path: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"tiptap mark at {path} must be an object")
    _assert_exact_keys(value, {"type", "attrs"}, path=path)
    mark_type = value.get("type")
    if mark_type not in TIPTAP_MARK_TYPES:
        raise ValueError(f"unsupported tiptap mark at {path}")
    attrs = value.get("attrs")
    if attrs is None:
        attrs = {}
    if not isinstance(attrs, dict):
        raise ValueError(f"tiptap mark attrs at {path} must be an object")
    if mark_type in {"bold", "italic", "underline", "strike", "code"}:
        _assert_exact_keys(attrs, set(), path=f"{path}.attrs")
        return
    if mark_type == "link":
        _assert_exact_keys(attrs, {"href", "target", "rel", "class"}, path=f"{path}.attrs")
        href = attrs.get("href")
        if not isinstance(href, str) or not _is_safe_http_url(href):
            raise ValueError(f"tiptap link at {path} must use HTTP or HTTPS")
        for key in ("target", "rel", "class"):
            if attrs.get(key) is not None and (
                not isinstance(attrs[key], str) or len(attrs[key]) > 100
            ):
                raise ValueError(f"tiptap link {key} at {path} must be text")
        return
    if mark_type == "textStyle":
        _assert_exact_keys(attrs, {"color", "fontSize"}, path=f"{path}.attrs")
        color = attrs.get("color")
        font_size = attrs.get("fontSize")
        if color is not None and (
            not isinstance(color, str) or not TIPTAP_COLOR_PATTERN.fullmatch(color)
        ):
            raise ValueError(f"invalid tiptap text color at {path}")
        if font_size is not None and (
            not isinstance(font_size, str)
            or not TIPTAP_FONT_SIZE_PATTERN.fullmatch(font_size)
            or not 6 <= float(font_size.removesuffix("pt")) <= 48
        ):
            raise ValueError(f"invalid tiptap font size at {path}")
        if color is None and font_size is None:
            raise ValueError(f"empty tiptap text style at {path}")
        return
    _assert_exact_keys(attrs, {"color"}, path=f"{path}.attrs")
    color = attrs.get("color")
    if not isinstance(color, str) or not TIPTAP_COLOR_PATTERN.fullmatch(color):
        raise ValueError(f"invalid tiptap highlight color at {path}")


def _number_between(value: object, minimum: float, maximum: float, *, path: str) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"tiptap numeric attribute at {path} is invalid")
    if not minimum <= float(value) <= maximum:
        raise ValueError(f"tiptap numeric attribute at {path} is out of range")


def _validate_tiptap_attrs(node_type: str, value: object, *, path: str) -> None:
    attrs = {} if value is None else value
    if not isinstance(attrs, dict):
        raise ValueError(f"tiptap attrs at {path} must be an object")
    allowed: dict[str, set[str]] = {
        "paragraph": {"textAlign"},
        "heading": {"level", "textAlign"},
        "orderedList": {"start"},
        "codeBlock": {"language"},
        "resumeBlockAnchor": {"blockId", "semanticKind"},
        "avatarImage": {"src", "size", "alt", "systemFallback"},
        "resumeImage": {"src", "width", "widthUnit", "align", "alt"},
        "resumeRow": {"leftWidth"},
        "resumeColumn": {"variant"},
        "inlineImage": {"src", "width", "height", "aspectRatio", "alt"},
        "inlineIcon": {"name"},
    }
    _assert_exact_keys(attrs, allowed.get(node_type, set()), path=path)
    if node_type in {"paragraph", "heading"}:
        if attrs.get("textAlign") not in {None, "left", "center", "right"}:
            raise ValueError(f"invalid tiptap text alignment at {path}")
    if node_type == "heading" and attrs.get("level") not in {1, 2, 3}:
        raise ValueError(f"invalid tiptap heading level at {path}")
    if node_type == "orderedList":
        start = attrs.get("start", 1)
        if not isinstance(start, int) or isinstance(start, bool) or not 1 <= start <= 10_000:
            raise ValueError(f"invalid tiptap ordered-list start at {path}")
    if node_type == "codeBlock" and attrs.get("language") is not None:
        language = attrs["language"]
        if not isinstance(language, str) or len(language) > 40:
            raise ValueError(f"invalid tiptap code language at {path}")
    if node_type == "resumeBlockAnchor":
        block_id = attrs.get("blockId")
        if not isinstance(block_id, str) or not re.fullmatch(r"blk_[a-z0-9]{16,64}", block_id):
            raise ValueError(f"invalid tiptap block id at {path}")
        if attrs.get("semanticKind") not in TIPTAP_SEMANTIC_KINDS | {None}:
            raise ValueError(f"invalid tiptap semantic kind at {path}")
    if node_type in {"avatarImage", "resumeImage", "inlineImage"}:
        source = attrs.get("src")
        if not isinstance(source, str) or not _is_safe_resume_asset(source):
            raise ValueError(f"unsafe tiptap image source at {path}")
        alt = attrs.get("alt")
        if alt is not None and (not isinstance(alt, str) or len(alt) > 300):
            raise ValueError(f"invalid tiptap image alt at {path}")
    if node_type == "avatarImage":
        _number_between(attrs.get("size", 96), 56, 220, path=f"{path}.size")
        if not isinstance(attrs.get("systemFallback", False), bool):
            raise ValueError(f"invalid tiptap avatar fallback at {path}")
    if node_type == "resumeImage":
        width_unit = attrs.get("widthUnit", "%")
        if width_unit not in {"%", "px"}:
            raise ValueError(f"invalid tiptap image width unit at {path}")
        _number_between(
            attrs.get("width", 55),
            0.1,
            100 if width_unit == "%" else 794,
            path=f"{path}.width",
        )
        if attrs.get("align", "center") not in {"left", "center", "right", "full"}:
            raise ValueError(f"invalid tiptap image alignment at {path}")
    if node_type == "inlineImage":
        _number_between(attrs.get("width", 72), 16, 240, path=f"{path}.width")
        if attrs.get("height") is not None:
            _number_between(attrs["height"], 16, 240, path=f"{path}.height")
        _number_between(
            attrs.get("aspectRatio", 3), 0.1, 20, path=f"{path}.aspectRatio"
        )
    if node_type == "resumeRow":
        _number_between(attrs.get("leftWidth", 50), 30, 80, path=f"{path}.leftWidth")
    if node_type == "resumeColumn" and attrs.get("variant", "main") not in {
        "sidebar",
        "main",
    }:
        raise ValueError(f"invalid tiptap column variant at {path}")
    if node_type == "inlineIcon" and attrs.get("name", "Star") not in TIPTAP_INLINE_ICON_NAMES:
        raise ValueError(f"invalid tiptap inline icon at {path}")


def _validate_tiptap_node(
    value: object,
    *,
    path: str,
    counters: dict[str, int],
) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"tiptap node at {path} must be an object")
    _assert_exact_keys(value, {"type", "attrs", "content", "marks", "text"}, path=path)
    node_type = value.get("type")
    if node_type not in TIPTAP_NODE_TYPES:
        raise ValueError(f"unsupported tiptap node at {path}")
    counters["nodes"] += 1
    if counters["nodes"] > TIPTAP_MAX_NODES:
        raise ValueError("tiptap document contains too many nodes")
    _validate_tiptap_attrs(str(node_type), value.get("attrs"), path=f"{path}.attrs")
    marks = value.get("marks", [])
    if not isinstance(marks, list) or len(marks) > len(TIPTAP_MARK_TYPES):
        raise ValueError(f"invalid tiptap marks at {path}")
    if node_type != "text" and marks:
        raise ValueError(f"only tiptap text nodes can have marks at {path}")
    seen_marks: set[str] = set()
    for index, mark in enumerate(marks):
        _validate_tiptap_mark(mark, path=f"{path}.marks[{index}]")
        mark_type = str(mark["type"])
        if mark_type in seen_marks:
            raise ValueError(f"duplicate tiptap mark at {path}")
        seen_marks.add(mark_type)
    text = value.get("text")
    content = value.get("content", [])
    if node_type == "text":
        if not isinstance(text, str) or not text:
            raise ValueError(f"tiptap text node at {path} must contain text")
        if "content" in value:
            raise ValueError(f"tiptap text node at {path} cannot contain children")
        counters["text"] += len(text)
        if counters["text"] > TIPTAP_MAX_TEXT_LENGTH:
            raise ValueError("tiptap document text is too long")
        return
    if "text" in value:
        raise ValueError(f"non-text tiptap node at {path} cannot contain text")
    if not isinstance(content, list) or len(content) > 1_000:
        raise ValueError(f"invalid tiptap children at {path}")
    for index, child in enumerate(content):
        _validate_tiptap_node(
            child,
            path=f"{path}.content[{index}]",
            counters=counters,
        )


def validate_tiptap_document(value: object) -> None:
    counters = {"nodes": 0, "text": 0}
    _validate_tiptap_node(value, path="$", counters=counters)
    if not isinstance(value, dict) or value.get("type") != "doc":
        raise ValueError("tiptap rich text requires a doc root")


def normalize_tiptap_document(value: dict[str, Any]) -> dict[str, Any]:
    """Remove known no-op defaults emitted by supported Tiptap clients."""
    normalized = dict(value)
    attrs = value.get("attrs")
    if (
        value.get("type") == "orderedList"
        and isinstance(attrs, dict)
        and "type" in attrs
        and attrs["type"] is None
    ):
        normalized["attrs"] = {key: item for key, item in attrs.items() if key != "type"}
    content = value.get("content")
    if isinstance(content, list):
        normalized["content"] = [
            normalize_tiptap_document(child) if isinstance(child, dict) else child
            for child in content
        ]
    return normalized


def _tiptap_marked_text(node: dict[str, Any]) -> str:
    value = str(node.get("text") or "")
    for mark in node.get("marks", []):
        mark_type = mark["type"]
        attrs = mark.get("attrs") or {}
        if mark_type == "bold":
            value = f"**{value}**"
        elif mark_type == "italic":
            value = f"*{value}*"
        elif mark_type == "underline":
            value = f"[[linkcv-underline]]{value}[[/linkcv-underline]]"
        elif mark_type == "strike":
            value = f"~~{value}~~"
        elif mark_type == "code":
            value = f"`{value}`"
        elif mark_type == "link":
            value = f"[{value}]({attrs['href']})"
        elif mark_type == "textStyle":
            if attrs.get("color"):
                value = f"[[linkcv-color:{attrs['color']}]]{value}[[/linkcv-color]]"
            if attrs.get("fontSize"):
                value = f"[[linkcv-size:{attrs['fontSize']}]]{value}[[/linkcv-size]]"
        elif mark_type == "highlight":
            value = (
                f"[[linkcv-highlight:{attrs['color']}]]{value}"
                "[[/linkcv-highlight]]"
            )
    return value


def _tiptap_inline_text(node: dict[str, Any]) -> str:
    node_type = node["type"]
    if node_type == "text":
        return _tiptap_marked_text(node)
    if node_type == "hardBreak":
        return "\n"
    if node_type == "resumeBlockAnchor":
        attrs = node.get("attrs") or {}
        semantic = f":{attrs['semanticKind']}" if attrs.get("semanticKind") else ""
        return f"[[linkcv-block:{attrs['blockId']}{semantic}]]"
    if node_type == "inlineIcon":
        return f":icon[{(node.get('attrs') or {}).get('name', 'Star')}]:"
    if node_type == "inlineImage":
        attrs = node.get("attrs") or {}
        return (
            f"![{attrs.get('alt') or '行内图片'}]({attrs['src']} "
            f'"linkcv-inline-image-v2:{attrs.get("width", 72)}:'
            f'{attrs.get("height") or 24}")'
        )
    return "".join(_tiptap_inline_text(child) for child in node.get("content", []))


def _tiptap_block_markdown(node: dict[str, Any]) -> str:
    node_type = node["type"]
    attrs = node.get("attrs") or {}
    if node_type == "heading":
        return f"{'#' * int(attrs.get('level', 2))} {_tiptap_inline_text(node)}"
    if node_type == "paragraph":
        return _tiptap_inline_text(node)
    if node_type == "listItem":
        return "\n".join(_tiptap_block_markdown(child) for child in node.get("content", []))
    if node_type == "bulletList":
        return "\n".join(
            f"- {_tiptap_block_markdown(child)}" for child in node.get("content", [])
        )
    if node_type == "orderedList":
        start = int(attrs.get("start", 1))
        return "\n".join(
            f"{start + index}. {_tiptap_block_markdown(child)}"
            for index, child in enumerate(node.get("content", []))
        )
    if node_type == "blockquote":
        return "\n".join(
            f"> {line}"
            for child in node.get("content", [])
            for line in _tiptap_block_markdown(child).splitlines()
        )
    if node_type == "codeBlock":
        language = attrs.get("language") or ""
        return f"```{language}\n{_tiptap_inline_text(node)}\n```"
    if node_type == "horizontalRule":
        return "---"
    if node_type == "resumeRow":
        children = node.get("content", [])
        left = _tiptap_inline_text(children[0]) if children else ""
        right = _tiptap_inline_text(children[1]) if len(children) > 1 else ""
        return (
            f"::: left {attrs.get('leftWidth', 50)}\n{left}\n:::\n\n"
            f"::: right\n{right}\n:::"
        )
    if node_type == "resumeColumns":
        return "\n\n".join(
            f":::: {(child.get('attrs') or {}).get('variant', 'main')}\n"
            f"{_tiptap_block_markdown(child)}\n::::"
            for child in node.get("content", [])
        )
    if node_type == "resumeColumn":
        return "\n\n".join(
            _tiptap_block_markdown(child) for child in node.get("content", [])
        )
    if node_type in {"resumeMetaRow", "resumeTrioRow"}:
        kind = "meta" if node_type == "resumeMetaRow" else "trio"
        return (
            f":::: {kind}\n"
            + "\n".join(_tiptap_inline_text(child) for child in node.get("content", []))
            + "\n::::"
        )
    if node_type == "avatarImage":
        if attrs.get("systemFallback"):
            return ""
        return (
            f"![{attrs.get('alt') or '简历头像'}]({attrs['src']} "
            f'"linkcv-avatar:{attrs.get("size", 96)}")'
        )
    if node_type == "resumeImage":
        return (
            f"![{attrs.get('alt') or '简历图片'}]({attrs['src']} "
            f'"linkcv-image:{attrs.get("width", 55)}:'
            f'{attrs.get("widthUnit", "%")}:{attrs.get("align", "center")}")'
        )
    return _tiptap_inline_text(node)


def tiptap_document_to_markdown(value: dict[str, Any]) -> str:
    validate_tiptap_document(value)
    return "\n\n".join(
        part
        for node in value.get("content", [])
        if (part := _tiptap_block_markdown(node))
    ).strip()


def rich_text_to_markdown(value: "RichText") -> str:
    if value.format == "markdown":
        return str(value.content)
    return tiptap_document_to_markdown(value.content)  # type: ignore[arg-type]


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RichText(DomainModel):
    format: Literal["markdown", "tiptap-json"] = "markdown"
    content: str | dict[str, Any]

    @model_validator(mode="after")
    def reject_unsafe_markup(self) -> "RichText":
        if self.format == "markdown":
            if not isinstance(self.content, str):
                raise ValueError("markdown rich text requires string content")
            if len(self.content) > TIPTAP_MAX_TEXT_LENGTH:
                raise ValueError("markdown content is too long")
            if DANGEROUS_MARKDOWN_PATTERN.search(self.content):
                raise ValueError("unsafe markdown content")
        else:
            if not isinstance(self.content, dict):
                raise ValueError("tiptap rich text requires object content")
            self.content = normalize_tiptap_document(self.content)
            validate_tiptap_document(self.content)
        return self


class SourceRef(DomainModel):
    field: str = Field(min_length=1, max_length=64)
    source: Literal["extracted_markdown"] = "extracted_markdown"
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    quote: str = Field(min_length=1, max_length=1_000)

    @model_validator(mode="after")
    def validate_line_range(self) -> "SourceRef":
        if self.end_line < self.start_line:
            raise ValueError("source line range is reversed")
        return self


class IdentifiedModel(DomainModel):
    id: str = Field(min_length=3, max_length=128)

    @model_validator(mode="after")
    def validate_stable_id(self) -> "IdentifiedModel":
        if not ID_PATTERN.fullmatch(self.id):
            raise ValueError("invalid stable id")
        return self


class ResumeLink(IdentifiedModel):
    label: str = Field(max_length=100)
    url: str = Field(min_length=1, max_length=2_048)

    @model_validator(mode="after")
    def validate_url(self) -> "ResumeLink":
        if not _is_safe_http_url(self.url):
            raise ValueError("link URL must use HTTP or HTTPS")
        return self


class ResumeBasics(DomainModel):
    name: str = Field(default="", max_length=200)
    headline: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=300)
    photo: str | None = Field(default=None, max_length=512)
    summary: RichText | None = None
    links: list[ResumeLink] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_photo_reference(self) -> "ResumeBasics":
        if self.photo and not (
            _is_safe_http_url(self.photo)
            or self.photo.startswith(("/api/assets/", "/api/resumes/"))
        ):
            raise ValueError("photo must use a private API path or HTTP(S) URL")
        return self


class Highlight(IdentifiedModel):
    content: RichText


class DatedEntry(IdentifiedModel):
    start_date: str | None = Field(default=None, max_length=100)
    end_date: str | None = Field(default=None, max_length=100)
    current: bool = False
    source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)


class WorkExperience(DatedEntry):
    organization: str = Field(max_length=300)
    position: str = Field(max_length=300)
    location: str | None = Field(default=None, max_length=300)
    summary: RichText | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)


class Education(DatedEntry):
    institution: str = Field(max_length=300)
    area: str | None = Field(default=None, max_length=300)
    study_type: str | None = Field(default=None, max_length=200)
    score: str | None = Field(default=None, max_length=100)
    summary: RichText | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)


class Project(DatedEntry):
    name: str = Field(max_length=300)
    role: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)
    summary: RichText | None = None
    highlights: list[Highlight] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_url(self) -> "Project":
        if self.url and not _is_safe_http_url(self.url):
            raise ValueError("project URL must use HTTP or HTTPS")
        return self


class Skill(IdentifiedModel):
    name: str = Field(max_length=200)
    level: str | None = Field(default=None, max_length=100)
    keywords: list[Keyword] = Field(default_factory=list, max_length=100)


class Certificate(DatedEntry):
    name: str = Field(max_length=300)
    issuer: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=2_048)

    @model_validator(mode="after")
    def validate_url(self) -> "Certificate":
        if self.url and not _is_safe_http_url(self.url):
            raise ValueError("certificate URL must use HTTP or HTTPS")
        return self


class Award(DatedEntry):
    title: str = Field(max_length=300)
    awarder: str | None = Field(default=None, max_length=300)
    summary: RichText | None = None


class Language(IdentifiedModel):
    name: str = Field(max_length=300)
    fluency: str | None = Field(default=None, max_length=300)


class CustomItem(IdentifiedModel):
    title: str | None = Field(default=None, max_length=300)
    subtitle: str | None = Field(default=None, max_length=300)
    content: RichText
    source_refs: list[SourceRef] = Field(default_factory=list, max_length=50)


class CustomSection(IdentifiedModel):
    title: str = Field(max_length=200)
    items: list[CustomItem] = Field(default_factory=list, max_length=100)


class ResumeSections(DomainModel):
    work_experiences: list[WorkExperience] = Field(default_factory=list, max_length=100)
    educations: list[Education] = Field(default_factory=list, max_length=100)
    projects: list[Project] = Field(default_factory=list, max_length=100)
    skills: list[Skill] = Field(default_factory=list, max_length=200)
    certificates: list[Certificate] = Field(default_factory=list, max_length=100)
    awards: list[Award] = Field(default_factory=list, max_length=100)
    languages: list[Language] = Field(default_factory=list, max_length=100)
    custom_sections: list[CustomSection] = Field(default_factory=list, max_length=50)


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
SemanticSource = Literal["import", "model", "user", "system"]
ContentKey = Literal[
    "basics",
    "work_experiences",
    "educations",
    "projects",
    "skills",
    "certificates",
    "awards",
    "languages",
    "custom_sections",
]


class SemanticSection(IdentifiedModel):
    semantic_kind: SemanticKind
    display_title: str = Field(min_length=1, max_length=200)
    semantic_source: SemanticSource = "system"
    semantic_confidence: float | None = Field(default=None, ge=0, le=1)
    content_key: ContentKey
    custom_section_id: str | None = Field(default=None, min_length=3, max_length=128)

    @model_validator(mode="after")
    def validate_reference(self) -> "SemanticSection":
        if self.content_key == "custom_sections":
            if self.custom_section_id is None or not ID_PATTERN.fullmatch(self.custom_section_id):
                raise ValueError("custom semantic section requires a stable section id")
        elif self.custom_section_id is not None:
            raise ValueError("standard semantic section cannot reference custom content")
        return self


STANDARD_SEMANTIC_SECTIONS: tuple[tuple[ContentKey, SemanticKind, str], ...] = (
    ("basics", "basics", "基本信息"),
    ("work_experiences", "work", "工作经历"),
    ("educations", "education", "教育经历"),
    ("projects", "project", "项目经历"),
    ("skills", "skills", "专业技能"),
    ("certificates", "certificates", "证书"),
    ("awards", "awards", "荣誉奖项"),
    ("languages", "languages", "语言能力"),
)


class ResumeDocument(DomainModel):
    basics: ResumeBasics = Field(default_factory=ResumeBasics)
    sections: ResumeSections = Field(default_factory=ResumeSections)
    semantic_sections: list[SemanticSection] = Field(max_length=100)

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "ResumeDocument":
        ids: list[str] = [item.id for item in self.basics.links]
        for collection in (
            self.sections.work_experiences,
            self.sections.educations,
            self.sections.projects,
            self.sections.skills,
            self.sections.certificates,
            self.sections.awards,
            self.sections.languages,
            self.sections.custom_sections,
        ):
            for item in collection:
                ids.append(item.id)
                highlights = getattr(item, "highlights", [])
                ids.extend(highlight.id for highlight in highlights)
                custom_items = getattr(item, "items", [])
                ids.extend(custom_item.id for custom_item in custom_items)
        if len(ids) != len(set(ids)):
            raise ValueError("resume element ids must be unique")

        custom_ids = {section.id for section in self.sections.custom_sections}
        semantic_ids = [section.id for section in self.semantic_sections]
        references = [
            (section.content_key, section.custom_section_id)
            for section in self.semantic_sections
        ]
        if len(semantic_ids) != len(set(semantic_ids)):
            raise ValueError("semantic section ids must be unique")
        if len(references) != len(set(references)):
            raise ValueError("semantic content references must be unique")
        if any(
            section.custom_section_id not in custom_ids
            for section in self.semantic_sections
            if section.content_key == "custom_sections"
        ):
            raise ValueError("semantic section references missing custom content")
        return self


def default_semantic_sections(document: ResumeDocument) -> list[SemanticSection]:
    sections = [
        SemanticSection(
            id=f"semantic_{content_key}",
            semantic_kind=semantic_kind,
            display_title=display_title,
            content_key=content_key,
        )
        for content_key, semantic_kind, display_title in STANDARD_SEMANTIC_SECTIONS
        if content_key == "basics" or bool(getattr(document.sections, content_key))
    ]
    sections.extend(
        SemanticSection(
            id=f"semantic_{section.id}",
            semantic_kind="custom",
            display_title=section.title,
            content_key="custom_sections",
            custom_section_id=section.id,
        )
        for section in document.sections.custom_sections
    )
    return sections


def with_default_semantics(document: ResumeDocument) -> ResumeDocument:
    if document.semantic_sections:
        return document
    return document.model_copy(update={"semantic_sections": default_semantic_sections(document)})


def default_resume_document() -> ResumeDocument:
    document = ResumeDocument(
        basics=ResumeBasics(name="张三", headline="后端开发工程师"),
        sections=ResumeSections(),
        semantic_sections=[],
    )
    return with_default_semantics(document)
