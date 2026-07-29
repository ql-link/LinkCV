from decimal import Decimal

import pytest

from linkcv.application.job_descriptions.import_service import (
    InvalidJobImport,
    build_job_description_from_capture,
)
from linkcv.modules.job_descriptions.schemas import JobDescriptionImportRequest


def import_payload(**capture_overrides: object) -> JobDescriptionImportRequest:
    capture: dict[str, object] = {
        "job_title": "  高级 Python   工程师  ",
        "company_name": "示例\u00a0科技",
        "description_text": "职位描述\n\n负责平台开发。\n\n举报\n不应保留",
        "skills": ["生日福利", "高温补贴", "Python", " FastAPI ", "Python", "全勤奖"],
    }
    capture.update(capture_overrides)
    return JobDescriptionImportRequest(
        source_url="https://www.zhipin.com/job_detail/job_42.html?ka=detail",
        capture=capture,
    )


def test_capture_is_cleaned_and_mapped_to_existing_storage_contract() -> None:
    result = build_job_description_from_capture(
        import_payload(
            salary_text="15-25K·13薪",
            employment_type_text="全职",
            work_schedule_text="支持远程办公",
            experience_text="5天/周 6个月",
            company_tags=["企业服务", "100-499人", "B轮"],
        )
    )

    assert result.job_title == "高级 Python 工程师"
    assert result.company_name == "示例 科技"
    assert result.description == "负责平台开发。"
    assert result.skills == ["Python", "FastAPI"]
    assert result.experience_requirement is None
    assert result.work_schedule == "5天/周 6个月 远程办公"
    assert result.employment_type == "full_time"
    assert result.work_mode == "remote"
    assert result.salary_min == Decimal("15000")
    assert result.salary_max == Decimal("25000")
    assert result.salary_currency == "CNY"
    assert result.salary_period == "month"
    assert result.salary_months_per_year == 13
    assert result.company_industry == "企业服务"
    assert result.company_size == "100-499人"
    assert result.company_financing_stage == "B轮"
    assert result.source_type == "external_import"
    assert result.source_url == "https://www.zhipin.com/job_detail/job_42.html"


@pytest.mark.parametrize(
    ("source_url", "capture"),
    [
        ("https://example.test/jobs/1", {"job_title": "x", "company_name": "y", "description_text": "z"}),
        ("https://www.zhipin.com/jobs/1", {"job_title": "x", "company_name": "y", "description_text": "z"}),
        ("https://www.zhipin.com/job_detail/abc.html", {"job_title": "", "company_name": "y", "description_text": "z"}),
    ],
)
def test_non_boss_or_incomplete_capture_is_rejected(
    source_url: str, capture: dict[str, object]
) -> None:
    payload = JobDescriptionImportRequest(source_url=source_url, capture=capture)

    with pytest.raises(InvalidJobImport):
        build_job_description_from_capture(payload)
