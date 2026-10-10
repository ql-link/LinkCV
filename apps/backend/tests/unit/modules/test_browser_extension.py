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
