import json
import re
from decimal import Decimal
from types import SimpleNamespace
from pathlib import Path

import pytest
from pydantic import ValidationError

from linkresume.modules.browser_extension.decisions import decision_messages, native_decision, native_request
from linkresume.modules.browser_extension.field_catalog import FIELD_CATALOG
from linkresume.modules.browser_extension.profile import project
from linkresume.modules.browser_extension.profile import date
from linkresume.modules.browser_extension.schemas import DecisionRequest, FieldDecision, PageField


def test_mapping_preserves_entries_and_does_not_infer_private_fields():
    value = lambda text: {"value": text}
    document = {"identity": {"name": value("张三"), "contacts": [
        {"contact_kind": "email", "value": "candidate@example.test"}]}, "sections": [
        {"semantic_kind": "education", "title": value("教育"), "entries": [
            {"fields": {"organization": value("示例大学"), "major": value("计算机"), "start_date": value("2020年9月")}},
            {"fields": {}}, {"fields": {"organization": value("示例学院")}}]},
        {"semantic_kind": "work", "title": value("工作经历"), "entries": [{"fields": {"organization": value("示例公司")}}]},
        {"semantic_kind": "work", "title": value("实习经历"), "entries": [{"fields": {"organization": value("示例实习公司")}}]},
        {"semantic_kind": "project", "entries": [{"fields": {"name": value("示例项目")}, "blocks": [
            {"block_type": "paragraph", "runs": [{"inline_type": "text", "text": "项目描述"}, {"inline_type": "media", "src": "private-image"}]}]}]},
    ]}
    profile, warnings, missing = project(document)
    assert profile["basics"] == {"name": "张三"}
    assert profile["education"] == [{"school": "示例大学", "major": "计算机", "enrollDate": "2020-09"}, {}, {"school": "示例学院"}]
    assert profile["work"] == [{"company": "示例公司"}]
    assert profile["internship"] == [{"company": "示例实习公司"}]
    assert profile["projects"] == [{"name": "示例项目", "description": "项目描述"}]
    assert "basics.idNumber" in missing and "basics.birthDate" in missing
    assert not warnings
    assert "private-image" not in json.dumps(profile)


def test_catalog_matches_extension_and_rejects_personal_values():
    root = Path(__file__).resolve().parents[5]
    source = (root / "apps/extension/src/autofill/profile/keys.ts").read_text()
    catalog_source = source.split("export const KEYS", 1)[1].split("};", 1)[0]
    catalog = dict(re.findall(r"^  '([^']+\.[^']+)': '([^']*)',?", catalog_source, re.M))
    assert catalog == FIELD_CATALOG
    with pytest.raises(ValidationError):
        DecisionRequest(version=1, field={"uid": "one", "kind": "input", "value": "personal value"})
    with pytest.raises(ValidationError):
        FieldDecision(choice="arbitrary.path", prob=0.9, ranked=[])


def test_native_decision_uses_only_page_metadata_and_valid_probabilities():
    field = PageField(uid="one", section="教育", label="毕业院校", kind="input:text")
    payload = native_request(decision_messages(field))
    assert set(payload) == {"state", "questions"}
    assert "uid" not in payload["state"]
    decision = native_decision({"answers": {"slot": {"choice": "education.school", "probabilities": {"education.school": 0.95, "none": 0.05}}}})
    assert decision.choice == "education.school" and decision.prob == 0.95
    with pytest.raises(ValueError):
        native_decision({"answers": {"slot": {"choice": "education.school", "probabilities": {"education.school": float("nan")}}}})


def test_preferences_preserve_currency_period_range_and_calendar_dates():
    prefs = SimpleNamespace(candidate_cities=["示例城市"], years_experience=2, employment_types=["full_time"],
                            salary_min=Decimal("10000"), salary_max=Decimal("20000"), salary_currency="CNY",
                            salary_period="month", skills=["示例技能"])
    profile, _, _ = project({"identity": {}, "sections": []}, prefs)
    assert profile["intent"] == {"cities": ["示例城市"], "workExperience": 2, "jobType": ["全职"], "salary": "10000–20000 CNY/月"}
    assert date({"value": "2024-02-31"}) == ""
    assert date({"value": "2024-02-29"}) == "2024-02-29"


def paragraph(value):
    return {"block_type": "paragraph", "runs": [{"inline_type": "text", "text": value}]}


def test_source_only_import_projects_explicit_facts_without_editing_the_document():
    document = {"identity": {"name": {"value": "张三 - Java实习生"}}, "sections": [
        {"semantic_kind": "education", "title": {"value": "教育背景"}, "blocks": [
            paragraph("示例大学 - 计算机学院 - 软件工程 ｜ 2020.9-2024.6")]},
        {"semantic_kind": "work", "title": {"value": "实习经历"}, "blocks": [
            paragraph("示例甲公司 ｜ 2024.04-2024.09 ｜ 后端工程师"), paragraph("实现示例接口。"),
            paragraph("示例乙公司 ｜ 2023.10-2024.01 ｜ 开发实习生"), paragraph("编写示例测试。") ]},
        {"semantic_kind": "project", "title": {"value": "个人项目"}, "blocks": [
            paragraph("DemoRag"), paragraph("项目描述：示例资料检索。"),
            paragraph("项目描述：另一个项目的内容。") ]},
    ]}
    before = json.dumps(document)
    profile, warnings, missing = project(document)
    assert profile["basics"] == {"name": "张三"}
    assert profile["education"] == [{"school": "示例大学", "major": "软件工程", "enrollDate": "2020-09", "gradDate": "2024-06"}]
    assert profile["internship"] == [
        {"company": "示例甲公司", "title": "后端工程师", "startDate": "2024-04", "endDate": "2024-09", "summary": "实现示例接口。"},
        {"company": "示例乙公司", "title": "开发实习生", "startDate": "2023-10", "endDate": "2024-01", "summary": "编写示例测试。"},
    ]
    assert profile["projects"] == [{"name": "DemoRag"}]
    assert len(warnings) == 3 and "basics.idNumber" in missing
    assert json.dumps(document) == before


def test_source_recovery_keeps_unrecognized_entry_positions_and_ignores_body_dates():
    document = {"sections": [{"semantic_kind": "work", "title": {"value": "工作经历"}, "blocks": [
        paragraph("示例甲公司 ｜ 2024.02-2024.09 ｜ 工程师"),
        {"block_type": "bullet_list", "items": [{"runs": [{"inline_type": "text", "text": "项目在2024.03-2024.05上线"}]}]},
        paragraph("名称不明 ｜ 2023.02-2023.09 ｜ 工程师"), paragraph("不得合并到第一段。"),
        paragraph("示例丙公司 ｜ 2022.02-2022.09 ｜ 工程师"),
    ]}]}
    profile, _, _ = project(document)
    assert len(profile["work"]) == 3
    assert profile["work"][1] == {}
    assert profile["work"][2]["company"] == "示例丙公司"
    assert profile["work"][0]["summary"] == "项目在2024.03-2024.05上线"


def test_structured_entries_remain_authoritative_and_unlabeled_prose_is_not_inferred():
    document = {"identity": {"name": {"value": "张三 - 爱好"}}, "sections": [
        {"semantic_kind": "education", "entries": [{"fields": {"organization": {"value": "明确大学"}}}],
         "blocks": [paragraph("另一大学 ｜ 2020.09-2024.06")]},
        {"semantic_kind": "work", "blocks": [paragraph("曾经在某公司开发后端。") ]},
        {"semantic_kind": "project", "blocks": [paragraph("项目描述：参与多个系统。") ]},
    ]}
    profile, warnings, _ = project(document)
    assert profile["basics"]["name"] == "张三 - 爱好"
    assert profile["education"] == [{"school": "明确大学"}]
    assert "work" not in profile and "projects" not in profile
    assert len(warnings) == 2


def test_recovery_does_not_guess_degree_major_or_replace_invalid_dates():
    document = {"sections": [{"semantic_kind": "education", "blocks": [
        paragraph("示例大学 - 计算机学院 ｜ 2020.09-2024.06"),
        paragraph("另一大学 ｜ 2024.02.31-2025.06"),
    ]}]}
    profile, _, _ = project(document)
    assert profile["education"] == [{"school": "示例大学", "enrollDate": "2020-09", "gradDate": "2024-06"}, {}]
