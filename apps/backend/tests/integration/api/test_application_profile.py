"""Application facts stay owned, explicit, versioned and outside career AI material."""
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from linkresume.modules.agent.context_service import _profile_content
from linkresume.modules.browser_extension.profile import project
from linkresume.modules.identity.application_data import ApplicationData, ApplicationRecord, import_preview
from linkresume.modules.identity.application_data import FACT_FIELDS
from linkresume.modules.browser_extension.field_catalog import FIELD_CATALOG
from linkresume.modules.identity.models import UserProfile
from tests.integration.api.test_account_routes import build_test_app
from tests.integration.api.test_account_completion import register


def resume(client, app):
    return client.post("/api/resumes", json={"title": "张三的测试简历", "template_id": app.state.test_template_id}).json()["resume"]


def test_all_structured_facts_have_extension_catalog_consumers():
    assert {f"{group}.{key}" for group, keys in FACT_FIELDS.items() for key in keys} <= set(FIELD_CATALOG)


def test_legacy_save_preserves_details_clear_is_explicit_and_stale_save_is_rejected():
    app = build_test_app()
    with TestClient(app) as client:
        uid = register(client)
        cv = resume(client, app)
        data = ApplicationData(resume_ids=[cv["id"]], basics={"name": "张三", "idNumber": "fictional-id"}, contact={"email": "facts@example.test"}).model_dump(mode="json")
        saved = client.put("/api/account/user-profile", json={"base_lock_version": 1, "skills": ["Python"], "application_data": data})
        assert saved.status_code == 200
        old = client.put("/api/account/user-profile", json={"base_lock_version": 1, "skills": ["Java"]})
        assert old.status_code == 200 and old.json()["application_data"] == data
        stale = client.put("/api/account/user-profile", json={"base_lock_version": 1, "application_data": None})
        assert stale.status_code == 409
        assert stale.json()["profile"]["application_data"] == data
        with app.state.session_factory() as db:
            row = db.scalar(select(UserProfile).where(UserProfile.user_id == uid))
            ai = _profile_content(row)
            assert "Java" in ai
            assert "fictional-id" not in ai and "facts@example.test" not in ai and "application_data" not in ai
        cleared = client.put("/api/account/user-profile", json={"base_lock_version": 2, "application_data": None})
        assert cleared.status_code == 200 and cleared.json()["application_data"] is None


def test_import_preview_is_owned_read_only_and_sources_cannot_reference_another_user():
    app = build_test_app()
    with TestClient(app) as owner, TestClient(app) as other:
        register(owner)
        cv = resume(owner, app)
        before = owner.get(f"/api/resumes/{cv['id']}").json()
        preview = owner.get(f"/api/account/user-profile/resume-preview/{cv['id']}")
        assert preview.status_code == 200
        assert preview.json()["application_data"]["resume_ids"] == [cv["id"]]
        assert owner.get("/api/account/user-profile").json()["created_at"] is None
        assert owner.get(f"/api/resumes/{cv['id']}").json() == before
        register(other, "other@example.test")
        assert other.get(f"/api/account/user-profile/resume-preview/{cv['id']}").status_code == 404
        response = other.put("/api/account/user-profile", json={"base_lock_version": 1, "application_data": preview.json()["application_data"]})
        assert response.status_code == 400
        assert other.get("/api/account/user-profile").json()["created_at"] is None


def test_autofill_endpoint_reads_only_explicitly_bound_facts_and_does_not_change_resume():
    app = build_test_app()
    with TestClient(app) as client:
        register(client)
        cv = resume(client, app)
        before = client.get(f"/api/resumes/{cv['id']}").json()
        data = ApplicationData(resume_ids=[cv["id"]], basics={"birthDate": "2000-05"}, records=[
            {"id": "campus_extra", "group": "campus", "fields": {"organization": "示例社团", "title": "干事"}, "source": {"resume_id": cv["id"]}},
            {"id": "unbound", "group": "certificates", "fields": {"name": "尚未确认的测试证书"}},
        ]).model_dump(mode="json")
        assert client.put("/api/account/user-profile", json={"base_lock_version": 1, "application_data": data}).status_code == 200
        projection = client.get(f"/api/resumes/{cv['id']}/autofill-profile")
        assert projection.status_code == 200
        assert projection.json()["profile"]["basics"]["birthDate"] == "2000-05"
        assert projection.json()["profile"]["campus"][-1] == {"organization": "示例社团", "title": "干事"}
        assert "尚未确认的测试证书" not in projection.text
        assert client.get(f"/api/resumes/{cv['id']}").json() == before


def test_projection_uses_matching_source_and_skips_changed_source_and_conflicts():
    value = lambda text: {"value": text}
    document = {"identity": {"name": value("张三")}, "sections": [{"semantic_kind": "education", "entries": [
        {"fields": {"organization": value("示例大学"), "major": value("计算机")}},
        {"fields": {"organization": value("示例学院")}},
    ]}]}
    original, _, _ = project(document)
    details = import_preview(original, "1")
    details.basics.update({"birthDate": "2000-05", "gender": "女"})
    details.records[0].fields.update({"gpa": "3.8", "gpaScale": "4", "studyMode": "全日制", "trainingMode": "统招"})
    details.records[1].fields["major"] = "设计"
    prefs = SimpleNamespace(candidate_cities=[], years_experience=None, employment_types=[], salary_min=None, salary_max=None, skills=[], application_data=details.model_dump(mode="json"))
    filled, _, _ = project(document, prefs, "1")
    assert filled["education"][0]["gpa"] == "3.8"
    assert filled["education"][1]["major"] == "设计"
    assert filled["basics"]["birthDate"] == "2000-05"
    unrelated, _, _ = project(document, prefs, "2")
    assert "gpa" not in unrelated["education"][0] and "birthDate" not in unrelated["basics"]
    changed = deepcopy(document)
    changed["sections"][0]["entries"].reverse()
    result, warnings, _ = project(changed, prefs, "1")
    assert all("gpa" not in row for row in result["education"])
    assert len([w for w in warnings if "条目已变化" in w]) == 2
    details.records[0].fields["major"] = "物理"
    prefs.application_data = details.model_dump(mode="json")
    result, warnings, _ = project(document, prefs, "1")
    assert "major" not in result["education"][0]
    assert any("不一致" in w for w in warnings)
    other_person = deepcopy(document)
    other_person["identity"]["name"] = value("示例另一人")
    result, warnings, _ = project(other_person, prefs, "1")
    assert "name" not in result["basics"] and "birthDate" not in result["basics"]
    assert all("gpa" not in row for row in result["education"])
    assert any("确认身份对应关系" in w for w in warnings)


def test_identical_source_rows_are_ambiguous_and_partial_additional_records_are_not_filled():
    document = {"sections": [{"semantic_kind": "education", "entries": [
        {"fields": {"organization": {"value": "示例大学"}}}, {"fields": {"organization": {"value": "示例大学"}}},
    ]}]}
    original, _, _ = project(document)
    details = import_preview(original, "1")
    details.records[0].fields["gpa"] = "3.8"
    details.records.append(ApplicationRecord.model_validate({"id": "partial", "group": "education", "fields": {"gpa": "4"}, "source": {"resume_id": "1"}}))
    details = ApplicationData.model_validate(details.model_dump(mode="json"))
    prefs = SimpleNamespace(candidate_cities=[], years_experience=None, employment_types=[], salary_min=None, salary_max=None, skills=[], application_data=details.model_dump(mode="json"))
    result, warnings, _ = project(document, prefs, "1")
    assert result["education"] == original["education"]
    assert any("对应不明确" in w for w in warnings) and any("缺少明确" in w for w in warnings)


@pytest.mark.parametrize("data", [
    {"basics": {"birthDate": "2024-02-31"}},
    {"basics": {"gender": True}},
    {"basics": {"inferred": "unknown"}},
    {"resume_ids": ["99999999999999999999"]},
    {"records": [{"id": "x", "group": "education", "fields": {"gpa": "3.8/4"}}]},
    {"records": [{"id": "x", "group": "education", "fields": {"gpa": "4.2", "gpaScale": "4"}}]},
    {"records": [{"id": "x", "group": "work", "fields": {"startDate": "2025", "endDate": "2024"}}]},
    {"records": [{"id": "x", "group": "work", "source": {"resume_id": "1", "index": 0}}]},
])
def test_invalid_or_inferred_facts_rejected(data):
    with pytest.raises(ValidationError):
        ApplicationData.model_validate(data)
