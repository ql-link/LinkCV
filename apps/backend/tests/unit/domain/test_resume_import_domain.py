from linkcv.domain.resume_extraction import (
    DraftBasics,
    DraftLink,
    DraftProject,
    DraftSkill,
    DraftWorkExperience,
    ResumeExtractionDraft,
)
from linkcv.domain.resume_normalization import (
    finalize_resume_document,
    normalize_date,
    normalize_http_url,
)
from linkcv.domain.section_ir import build_section_ir
from linkcv.services.resume_import_service import validate_import_file


def test_markdown_is_split_into_model_facing_sections() -> None:
    markdown = """# 张三
邮箱：zhangsan@example.com

## 工作经历
示例科技有限公司

## 专业技能
Python
"""

    result = build_section_ir(markdown)

    assert result.preamble is None
    assert [(item.heading, item.normalized_kind) for item in result.sections] == [
        ("张三", None),
        ("工作经历", "work"),
        ("专业技能", "skills"),
    ]
    assert result.sections[1].start_line == 4


def test_markdown_without_level_two_heading_remains_available() -> None:
    result = build_section_ir("张三\n后端工程师")

    assert result.preamble is None
    assert result.sections[0].markdown == "张三\n后端工程师"
    assert result.warnings == ["document_heading_structure_missing"]


def test_draft_normalization_preserves_source_refs_and_unmapped_content() -> None:
    markdown = """# 张三

## 工作经历
示例科技有限公司 - 后端工程师
2023.03 - 至今
"""
    draft = ResumeExtractionDraft(
        basics=DraftBasics(name="张三", headline="后端工程师"),
        work_experiences=[
            DraftWorkExperience(
                organization="示例科技有限公司",
                position="后端工程师",
                raw_start_date="2023.03",
                raw_end_date="至今",
                highlights=["负责服务开发"],
                source_quotes=["示例科技有限公司 - 后端工程师"],
            )
        ],
        skills=[DraftSkill(name="Python", keywords=["FastAPI"])],
        unmapped_fragments=["社区志愿服务经历"],
    )

    result = finalize_resume_document(draft, markdown)

    work = result.document.sections.work_experiences[0]
    assert work.start_date == "2023-03"
    assert work.end_date is None
    assert work.current is True
    assert work.source_refs[0].start_line == 4
    assert result.document.sections.custom_sections[0].title == "未分类内容"
    assert "unmapped_fragments_preserved" in result.warnings


def test_date_normalization_does_not_invent_a_month() -> None:
    assert normalize_date("2024") == ("2024", False)
    assert normalize_date("2024 年 7 月") == ("2024-07", False)
    assert normalize_date("至今") == (None, True)
    assert normalize_date("不确定") == (None, False)


def test_url_normalization_adds_https_only_to_bare_hosts() -> None:
    assert normalize_http_url("example.test/profile") == (
        "https://example.test/profile",
        False,
    )
    assert normalize_http_url(" https://example.test/profile ") == (
        "https://example.test/profile",
        False,
    )
    assert normalize_http_url("javascript:alert(1)") == (None, True)


def test_draft_normalization_omits_unsafe_urls_without_failing_document() -> None:
    draft = ResumeExtractionDraft(
        basics=DraftBasics(
            name="张三",
            links=[
                DraftLink(label="主页", url="portfolio.example.test/profile"),
                DraftLink(label="危险链接", url="javascript:alert(1)"),
            ],
        ),
        projects=[
            DraftProject(name="安全项目", url="github.com/example/project"),
            DraftProject(name="无效项目", url="ftp://example.test/file"),
        ],
    )

    result = finalize_resume_document(draft, "# 张三")

    assert [link.url for link in result.document.basics.links] == [
        "https://portfolio.example.test/profile"
    ]
    assert [project.url for project in result.document.sections.projects] == [
        "https://github.com/example/project",
        None,
    ]
    assert result.warnings == [
        "invalid_link_url_omitted",
        "invalid_project_url_omitted",
    ]


def test_import_content_type_allows_standard_charset_parameter() -> None:
    assert validate_import_file(
        filename="resume.md",
        content_type="text/markdown; charset=utf-8",
        content=b"# Resume",
        max_bytes=1024,
    ) == "md"
