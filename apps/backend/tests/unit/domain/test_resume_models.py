import pytest
from pydantic import ValidationError

from linkcv.domain.resume_document import (
    Highlight,
    Project,
    ResumeBasics,
    ResumeDocumentV1,
    ResumeSections,
    RichTextV1,
    Skill,
    WorkExperience,
    default_resume_document,
)
from linkcv.domain.resume_snapshot import ResumeSnapshot
from linkcv.domain.resume_style import ResumeStyleV1, default_resume_style


def test_default_snapshot_uses_the_v1_contract() -> None:
    snapshot = ResumeSnapshot(
        data=default_resume_document(),
        style=default_resume_style(),
    )

    assert snapshot.data.schema_version == "1.0"
    assert snapshot.data.basics.name == "张三"
    assert snapshot.style.schema_version == "1.0"
    assert snapshot.style.section_order[0] == "basics"
    assert snapshot.style.smart_one_page is False


def test_legacy_style_without_smart_one_page_uses_the_compatible_default() -> None:
    style = ResumeStyleV1.model_validate({"schema_version": "1.0"})

    assert style.smart_one_page is False


def test_document_rejects_duplicate_nested_ids() -> None:
    with pytest.raises(ValidationError, match="must be unique"):
        ResumeDocumentV1(
            sections=ResumeSections(
                work_experiences=[
                    WorkExperience(
                        id="work_001",
                        organization="示例科技有限公司",
                        position="工程师",
                        highlights=[
                            Highlight(
                                id="same_001",
                                content=RichTextV1(content="负责服务开发"),
                            )
                        ],
                    )
                ],
                skills=[Skill(id="same_001", name="Python")],
            )
        )


def test_rich_text_rejects_active_content() -> None:
    with pytest.raises(ValidationError, match="unsafe markdown"):
        RichTextV1(content='<script>alert("x")</script>')


def test_resource_and_link_fields_reject_active_schemes() -> None:
    with pytest.raises(ValidationError, match="photo must use"):
        ResumeBasics(photo="javascript:alert(1)")
    with pytest.raises(ValidationError, match="project URL must use"):
        Project(id="project_001", name="示例项目", url="javascript:alert(1)")


def test_dated_entries_allow_content_inconsistent_dates() -> None:
    reversed_dates = WorkExperience(
        id="work_001",
        organization="示例科技有限公司",
        position="工程师",
        start_date="2025-10",
        end_date="2016-03",
    )
    current_with_end_date = Project(
        id="project_001",
        name="示例项目",
        current=True,
        end_date="2025-01",
    )

    assert reversed_dates.start_date == "2025-10"
    assert reversed_dates.end_date == "2016-03"
    assert current_with_end_date.current is True
    assert current_with_end_date.end_date == "2025-01"


def test_resume_content_fields_do_not_enforce_content_quality() -> None:
    work = WorkExperience(
        id="work_001",
        organization="",
        position="",
        start_date="时间写得有点乱",
    )
    basics = ResumeBasics(email="这不是标准邮箱", phone="电话号码可能写错了")

    assert work.organization == ""
    assert work.position == ""
    assert work.start_date == "时间写得有点乱"
    assert basics.email == "这不是标准邮箱"
    assert basics.phone == "电话号码可能写错了"


def test_snapshot_removes_unknown_style_sections_and_adds_present_sections() -> None:
    snapshot = ResumeSnapshot(
        data=ResumeDocumentV1(
            sections=ResumeSections(skills=[Skill(id="skill_001", name="Python")])
        ),
        style=ResumeStyleV1(section_order=["unknown", "basics"]),
    )

    assert snapshot.style.section_order == ["basics", "skills"]
