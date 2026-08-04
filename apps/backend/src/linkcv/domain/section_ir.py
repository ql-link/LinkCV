from typing import Literal

from markdown_it import MarkdownIt
from pydantic import BaseModel, ConfigDict, Field

from linkcv.domain.import_warnings import ImportWarning

SECTION_ALIASES = {
    "work": {"工作经历", "工作经验", "职业经历", "任职经历", "实习经历", "experience"},
    "education": {"教育经历", "教育背景", "学历", "education"},
    "projects": {"项目经历", "项目经验", "个人项目", "开源经历及个人作品", "projects"},
    "skills": {"专业技能", "技能清单", "技术栈", "skills"},
}


class SectionFragment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    heading: str | None = None
    normalized_kind: Literal["work", "education", "projects", "skills"] | None = None
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    markdown: str


class SectionIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preamble: SectionFragment | None = None
    sections: list[SectionFragment] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def _normalize_heading(heading: str) -> str | None:
    candidate = heading.strip().lower()
    for kind, aliases in SECTION_ALIASES.items():
        if candidate in {alias.lower() for alias in aliases}:
            return kind
    return None


def _fragment(
    *,
    fragment_id: str,
    lines: list[str],
    start: int,
    end: int,
    heading: str | None,
) -> SectionFragment:
    return SectionFragment(
        id=fragment_id,
        heading=heading,
        normalized_kind=_normalize_heading(heading) if heading else None,
        start_line=start + 1,
        end_line=max(start + 1, end),
        markdown="\n".join(lines[start:end]).strip(),
    )


def build_section_ir(markdown: str) -> SectionIR:
    lines = markdown.splitlines()
    tokens = MarkdownIt("commonmark", {"html": False}).parse(markdown)
    headings: list[tuple[int, str]] = []
    for index, token in enumerate(tokens):
        if (
            token.type != "heading_open"
            or token.tag not in {"h1", "h2", "h3"}
            or token.map is None
        ):
            continue
        inline = tokens[index + 1] if index + 1 < len(tokens) else None
        heading = inline.content.strip() if inline and inline.type == "inline" else ""
        headings.append((token.map[0], heading))

    if not headings:
        if not markdown.strip():
            return SectionIR(
                warnings=[ImportWarning.DOCUMENT_HEADING_STRUCTURE_MISSING.value]
            )
        return SectionIR(
            sections=[
                _fragment(
                    fragment_id="section-1",
                    lines=lines,
                    start=0,
                    end=len(lines),
                    heading=None,
                )
            ],
            warnings=[ImportWarning.DOCUMENT_HEADING_STRUCTURE_MISSING.value],
        )

    preamble = None
    if headings[0][0] > 0 and any(line.strip() for line in lines[: headings[0][0]]):
        preamble = _fragment(
            fragment_id="preamble",
            lines=lines,
            start=0,
            end=headings[0][0],
            heading=None,
        )

    sections: list[SectionFragment] = []
    for index, (start, heading) in enumerate(headings):
        end = headings[index + 1][0] if index + 1 < len(headings) else len(lines)
        sections.append(
            _fragment(
                fragment_id=f"section-{index + 1}",
                lines=lines,
                start=start,
                end=end,
                heading=heading,
            )
        )
    return SectionIR(preamble=preamble, sections=sections)
